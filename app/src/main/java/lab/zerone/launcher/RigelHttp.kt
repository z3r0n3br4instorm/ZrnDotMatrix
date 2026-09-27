package lab.zerone.launcher

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Direct line to RIGEL's background daemon on 127.0.0.1:4096.
 *
 * Everything used to reach RIGEL through a Termux RUN_COMMAND round trip: bind to
 * RunCommandService, spawn a bash session, wait for a PendingIntent broadcast to come back.
 * That is hundreds of milliseconds at best, and the UI polls RIGEL's status four times a
 * second while it is thinking — so the polling alone was spawning Termux sessions
 * continuously and starving the thing it was waiting on.
 *
 * A plain HTTP call to the daemon is ~1ms by comparison. Replies are handed back through the
 * very same `ZL.onTermux(id, out, err, code, extra)` callback the Termux path uses, so the UI
 * code does not care which road the answer came down.
 */
class RigelHttp(private val act: MainActivity) {

    private val pool = Executors.newFixedThreadPool(2)

    /** Cached daemon reachability, so a dead daemon is not probed on every single call. */
    @Volatile private var aliveUntil = 0L
    @Volatile private var alive = false
    private val probing = AtomicBoolean(false)

    /**
     * Best-effort "is the daemon up" for call routing. Never blocks: if the cached answer has
     * expired it returns the stale one and refreshes in the background, so a caller on the JS
     * thread is never held up by a socket.
     */
    fun daemonUp(): Boolean {
        val now = System.currentTimeMillis()
        if (now > aliveUntil && probing.compareAndSet(false, true)) {
            pool.execute {
                val ok = try { get("/ping", 700) != null } catch (e: Throwable) { false }
                alive = ok
                // A live daemon is re-checked lazily; a dead one is retried sooner, since the
                // usual reason is "it has not been started yet".
                aliveUntil = System.currentTimeMillis() + if (ok) 20000L else 3000L
                probing.set(false)
            }
        }
        return alive
    }

    /** Marks the daemon as known-good, e.g. right after a call succeeds. */
    private fun markAlive(ok: Boolean) {
        alive = ok
        aliveUntil = System.currentTimeMillis() + if (ok) 20000L else 1500L
    }

    // ---- raw calls (worker threads only) -------------------------------------------------

    private fun open(path: String, timeoutMs: Int): HttpURLConnection {
        val c = URL("http://127.0.0.1:$PORT$path").openConnection() as HttpURLConnection
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs
        c.useCaches = false
        c.setRequestProperty("Connection", "keep-alive")
        return c
    }

    private fun body(c: HttpURLConnection): String {
        val stream = try { c.inputStream } catch (e: Throwable) { c.errorStream } ?: return ""
        val buf = ByteArrayOutputStream()
        stream.use {
            val chunk = ByteArray(8192)
            while (true) {
                val n = it.read(chunk)
                if (n <= 0) break
                buf.write(chunk, 0, n)
            }
        }
        return buf.toString("UTF-8")
    }

    private fun get(path: String, timeoutMs: Int): String? {
        var c: HttpURLConnection? = null
        return try {
            c = open(path, timeoutMs)
            c.requestMethod = "GET"
            body(c)
        } catch (e: Throwable) {
            null
        } finally {
            try { c?.disconnect() } catch (e: Throwable) {}
        }
    }

    private fun post(path: String, payload: String, timeoutMs: Int): String? {
        var c: HttpURLConnection? = null
        return try {
            c = open(path, timeoutMs)
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
            val bytes = payload.toByteArray(Charsets.UTF_8)
            c.setFixedLengthStreamingMode(bytes.size)
            c.outputStream.use { it.write(bytes) }
            body(c)
        } catch (e: Throwable) {
            null
        } finally {
            try { c?.disconnect() } catch (e: Throwable) {}
        }
    }

    // ---- UI-facing calls ----------------------------------------------------------------

    /** Runs on a worker and reports back through ZL.onTermux, exactly like the Termux path. */
    private fun dispatch(id: String, timeoutMs: Int, fallback: (() -> Unit)?, call: () -> String?) {
        pool.execute {
            val out = try { call() } catch (e: Throwable) { null }
            if (out == null) {
                markAlive(false)
                if (fallback != null) act.runOnUiThread(fallback)
                else reply(id, "", "DAEMON UNREACHABLE", 1)
                return@execute
            }
            markAlive(true)
            reply(id, out, "", 0)
        }
    }

    private fun reply(id: String, out: String, err: String, code: Int) {
        act.js("ZL.onTermux(${JSONObject.quote(id)},${JSONObject.quote(out)}," +
            "${JSONObject.quote(err)},$code,'')")
    }

    /** One turn. `prompt` is already decoded plain text. */
    fun ask(id: String, prompt: String, fallback: () -> Unit) =
        dispatch(id, ASK_TIMEOUT, fallback) { post("/ask", prompt, ASK_TIMEOUT) }

    /**
     * Status + streamed text in a single round trip, shaped like the Termux command's output so
     * the existing parser is unchanged.
     */
    fun status(id: String, fallback: () -> Unit) = dispatch(id, POLL_TIMEOUT, fallback) {
        val raw = get("/status", POLL_TIMEOUT)
        if (raw == null) null else {
            val o = try { JSONObject(raw.trim()) } catch (e: Throwable) { null }
            val st = (o?.optString("status", "") ?: "").ifEmpty { "NONE" }
            val stream = o?.optString("stream", "") ?: ""
            st + "\n---RIGEL_STREAM---\n" + stream
        }
    }

    fun glyphs(id: String, fallback: () -> Unit) =
        dispatch(id, READ_TIMEOUT, fallback) { get("/custom-glyphs", READ_TIMEOUT) }

    fun mediaGlyphs(id: String, fallback: () -> Unit) =
        dispatch(id, READ_TIMEOUT, fallback) { get("/media-glyphs", READ_TIMEOUT) }

    fun scenes(id: String, fallback: () -> Unit) =
        dispatch(id, READ_TIMEOUT, fallback) { get("/ui-scenes", READ_TIMEOUT) }

    fun models(id: String, fallback: () -> Unit) =
        dispatch(id, MODELS_TIMEOUT, fallback) { get("/models", MODELS_TIMEOUT) }

    fun setModel(id: String, model: String, fallback: () -> Unit) =
        dispatch(id, READ_TIMEOUT, fallback) { post("/setmodel", model, READ_TIMEOUT) }

    /** Fire-and-forget writes and control calls: nothing in the UI waits on the answer. */
    fun postQuiet(path: String, payload: String) {
        pool.execute {
            val ok = post(path, payload, READ_TIMEOUT) != null
            markAlive(ok)
        }
    }

    private companion object {
        const val PORT = 4096
        const val ASK_TIMEOUT = 240000        // a turn with tool calls can run for minutes
        const val POLL_TIMEOUT = 1500
        const val READ_TIMEOUT = 2500
        const val MODELS_TIMEOUT = 12000
    }
}

package lab.zerone.launcher

import android.Manifest
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.text.format.DateFormat
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Everything the dot-matrix UI can ask Android for. Methods run on the WebView's JS thread. */
class Bridge(private val act: MainActivity) {

    private val pm: PackageManager get() = act.packageManager

    /** Fast path to RIGEL's daemon; Termux is only the fallback when it is not listening. */
    private val http by lazy { RigelHttp(act) }

    // ---- app list ------------------------------------------------------------------------
    // loadLabel() opens every installed app's resources to read its name, which costs the
    // better part of a second on a full phone. That ran on the WebView's JS thread the moment
    // the drawer opened, freezing the UI mid-gesture. Now it is built on a worker and pushed
    // to the UI when ready; nothing on the JS thread ever waits for it.
    @Volatile private var appsJson: String? = null
    private val appsWorker = Executors.newSingleThreadExecutor()
    private val appsBuilding = AtomicBoolean(false)
    private val appsStale = AtomicBoolean(false)

    /** The cached list, or "[]" while the first build runs. Returns immediately, always. */
    @JavascriptInterface
    fun apps(): String {
        val cached = appsJson
        if (cached != null) return cached
        warmApps()
        return "[]"
    }

    /** False until the first build has landed, so the UI can show its own progress instead. */
    @JavascriptInterface
    fun appsReady(): Boolean = appsJson != null

    /** Kicks a background rebuild; the result arrives through ZL.onApps(). */
    @JavascriptInterface
    fun refreshApps() = warmApps()

    /**
     * Builds the list off the UI and JS threads. Calls that arrive mid-build mark the result
     * stale and get folded into one more pass, so a package change during a build is not lost.
     */
    fun warmApps() {
        appsStale.set(true)
        if (!appsBuilding.compareAndSet(false, true)) return
        appsWorker.execute {
            try {
                while (appsStale.getAndSet(false)) {
                    val json = try { buildApps() } catch (e: Throwable) { "[]" }
                    appsJson = json
                    act.js("ZL.onApps(${JSONObject.quote(json)})")
                }
            } finally {
                appsBuilding.set(false)
                if (appsStale.get() && !appsBuilding.get()) warmApps()   // raced with a new request
            }
        }
    }

    private fun buildApps(): String {
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val out = pm.queryIntentActivities(main, 0)
            .filter { it.activityInfo.packageName != act.packageName }
            .map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
            .distinctBy { it.second }
            .sortedBy { it.first.lowercase() }
        val arr = JSONArray()
        out.forEach { arr.put(JSONObject().put("label", it.first).put("pkg", it.second)) }
        return arr.toString()
    }

    @JavascriptInterface
    fun launch(action: String) = act.runOnUiThread {
        val i: Intent? = when {
            action == "camera" -> Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
            action == "dial" -> Intent(Intent.ACTION_DIAL)
            action == "browser" -> pm.getLaunchIntentForPackage("com.android.chrome")
                ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com"))
            action == "music" -> try {
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC)
            } catch (e: Exception) {
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MUSIC)
            }
            action == "chat" || action == "messaging" -> try {
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MESSAGING)
            } catch (e: Exception) {
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MESSAGING)
            }
            action.startsWith("pkg:") -> {
                val p = action.removePrefix("pkg:")
                pm.getLaunchIntentForPackage(p) ?: Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$p"))
            }
            else -> null
        }
        // The UI freezes its render loop the moment it fires a launch, so it has to be told
        // when the launch did not take — otherwise it would sit on OPENING forever.
        if (i == null) {
            Toast.makeText(act, "No app for that", Toast.LENGTH_SHORT).show()
            act.js("ZL.launchFailed()")
            return@runOnUiThread
        }
        try {
            act.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(act, "No app for that", Toast.LENGTH_SHORT).show()
            act.js("ZL.launchFailed()")
        }
    }

    /** Authoritative foreground check — the UI must never "recover" while an app covers us. */
    @JavascriptInterface fun isForeground(): Boolean = act.isForeground

    /**
     * Opens RIGEL's bootstrap in a *visible* Termux session so the user can paste an API
     * key. RUN_COMMAND's normal background mode has no tty, and a launcher cannot write
     * into Termux's private home, so the script is base64'd into the command itself.
     */
    @JavascriptInterface
    fun rigelSetup(backend: String): Boolean {
        val script = try {
            act.assets.open("rigel/bootstrap.sh").use { it.readBytes() }
        } catch (e: Exception) {
            act.js("ZL.rigelSetupFailed(${JSONObject.quote("BOOTSTRAP MISSING")})"); return false
        }
        val b64 = android.util.Base64.encodeToString(script, android.util.Base64.NO_WRAP)
        val safeBackend = if (backend in listOf("agy", "antigravity", "opencode")) backend else "agy"

        // Two steps on purpose. Termux's RunCommandService rejects a very long argument
        // when it has to open a *visible* session, so the ~10KB base64 payload goes in
        // through a background command first and the foreground session only carries a
        // short "run that file" line.
        val write = "mkdir -p \$HOME/.rigel && printf %s " + shq(b64) +
            " | base64 -d > \$HOME/.rigel/bootstrap.sh && chmod +x \$HOME/.rigel/bootstrap.sh"
        runTermux("rigelwrite", write)

        // Give the write a beat to land before the session opens and reads the file.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            runTermuxVisible("bash \$HOME/.rigel/bootstrap.sh $safeBackend")
        }, 700)
        return true
    }

    /** Single-quote for a POSIX shell, closing and reopening around any embedded quote. */
    private fun shq(s: String): String = "'" + s.replace("'", "'\\''") + "'"

    /**
     * Termux refuses RUN_COMMAND until the user sets `allow-external-apps = true` in
     * ~/.termux/termux.properties. That is Termux's own security boundary and no app can
     * set it on the user's behalf, so the best we can do is hand them the exact line and
     * open Termux for them to paste it.
     */
    @JavascriptInterface
    fun copyUnlockCommand(): Boolean = try {
        val cmd = "mkdir -p ~/.termux && echo 'allow-external-apps = true' >> " +
            "~/.termux/termux.properties && termux-reload-settings && echo ENABLED"
        val cb = act.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cb.setPrimaryClip(android.content.ClipData.newPlainText("termux", cmd))
        true
    } catch (e: Throwable) { false }

    @JavascriptInterface
    fun openTermuxApp(): Boolean = try {
        pm.getLaunchIntentForPackage("com.termux")?.let {
            act.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
        } ?: false
    } catch (e: Throwable) { false }

    /**
     * Antigravity needs an interactive login, so this one genuinely has to open Termux.
     * The script is pushed from the APK first so it is always the current version.
     */
    @JavascriptInterface
    fun rigelAgySetup(): Boolean {
        val script = try {
            act.assets.open("rigel/agy-setup.sh").use { it.readBytes() }
        } catch (e: Exception) {
            act.js("ZL.rigelSetupFailed(${JSONObject.quote("AGY SCRIPT MISSING")})"); return false
        }
        val b64 = android.util.Base64.encodeToString(script, android.util.Base64.NO_WRAP)
        val cmd = "mkdir -p \$HOME/.rigel/bin && printf %s " + shq(b64) +
            " | base64 -d > \$HOME/.rigel/bin/agy-setup && chmod +x \$HOME/.rigel/bin/agy-setup && " +
            "bash \$HOME/.rigel/bin/agy-setup"
        return runTermuxVisible(cmd)
    }

    /** True once RIGEL's config exists — i.e. setup has been completed at least once. */
    @JavascriptInterface
    fun rigelReady(id: String) = runTermux(id, "test -f \$HOME/.rigel/config.json && " +
        "cat \$HOME/.rigel/config.json || echo NOTSET")

    /** Foreground Termux session: the user sees it and can type into it. */
    private fun runTermuxVisible(cmd: String): Boolean {
        if (pm.getLaunchIntentForPackage("com.termux") == null) {
            act.js("ZL.rigelSetupFailed(${JSONObject.quote("TERMUX NOT INSTALLED")})"); return false
        }
        if (androidx.core.content.ContextCompat.checkSelfPermission(act, MainActivity.TERMUX_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            act.js("ZL.rigelSetupFailed(${JSONObject.quote("ALLOW RUN_COMMAND PERMISSION")})"); return false
        }
        val i = Intent().setClassName("com.termux", "com.termux.app.RunCommandService")
            .setAction("com.termux.RUN_COMMAND")
            .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", cmd))
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)     // <- visible session
            .putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")   // open and show it now
        return try {
            act.startService(i)
            // Termux's service starts the session but does not always come to the front.
            pm.getLaunchIntentForPackage("com.termux")?.let {
                act.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            true
        } catch (e: Exception) {
            act.js("ZL.rigelSetupFailed(${JSONObject.quote("TERMUX: " + (e.message ?: "FAILED"))})")
            false
        }
    }

    /** Runs `bash -lc <cmd>` in Termux; the result comes back through TermuxResultReceiver. */
    @JavascriptInterface
    fun runTermux(id: String, cmd: String) {
        fun fail(msg: String) = act.js("ZL.onTermux(${JSONObject.quote(id)},'','',1,${JSONObject.quote(msg)})")
        if (pm.getLaunchIntentForPackage("com.termux") == null) return fail("TERMUX NOT INSTALLED")
        if (androidx.core.content.ContextCompat.checkSelfPermission(act, MainActivity.TERMUX_PERMISSION) != PackageManager.PERMISSION_GRANTED)
            return fail("ALLOW RUN_COMMAND PERMISSION")
        val result = Intent(act, TermuxResultReceiver::class.java).putExtra("id", id)
        // FLAG_MUTABLE only exists from API 31; below that the PendingIntent is mutable anyway.
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val pi = PendingIntent.getBroadcast(act, id.hashCode(), result,
            PendingIntent.FLAG_UPDATE_CURRENT or mutable)
        val i = Intent().setClassName("com.termux", "com.termux.app.RunCommandService")
            .setAction("com.termux.RUN_COMMAND")
            .putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-lc", cmd))
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pi)
        try { act.startService(i) } catch (e: Exception) { fail("TERMUX: " + (e.message ?: "FAILED")) }
    }

    @JavascriptInterface fun is24h(): Boolean = DateFormat.is24HourFormat(act)

    @JavascriptInterface fun location(): String = location(act)?.let { "${it.first},${it.second}" } ?: ""

    @JavascriptInterface fun version(): String = try {
        val ver = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(act.packageName, PackageManager.PackageInfoFlags.of(0)).versionName
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(act.packageName, 0).versionName
        }
        "v" + ver
    } catch (_: Exception) {
        "v0.2.0"
    }

    /** Page finished loading: push status and location once. */
    @JavascriptInterface fun ready() = act.runOnUiThread {
        act.status.push()
        location(act)?.let { act.js("ZL.location(${it.first},${it.second})") }
        // Pre-warm the daemon in Termux in the background
        runTermux("daemonsync", "test -f \$HOME/.rigel/bin/rigel-daemon.js && node \$HOME/.rigel/bin/rigel-daemon.js >/dev/null 2>&1 &")
    }

    @JavascriptInterface fun haptic() = act.runOnUiThread { act.haptics.tick(1.0f) }

    @JavascriptInterface fun isPreciseHaptics(): Boolean = act.haptics.isPreciseHapticsSupported
    @JavascriptInterface fun hapticRipple() = act.haptics.ripple()
    @JavascriptInterface fun hapticTransition() = act.haptics.transition()
    @JavascriptInterface fun hapticTick(scale: Double) = act.haptics.tick(scale.toFloat())
    /** Boot dot-flight: accelerating cascade that lands on a click. */
    @JavascriptInterface fun hapticArrange(ms: Double) = act.haptics.arrange(ms.toLong())
    /** Boot wordmark sweep: soft ticks swelling and fading as the light bar crosses. */
    @JavascriptInterface fun hapticSweep(ms: Double) = act.haptics.sweep(ms.toLong())
    @JavascriptInterface fun cancelHaptic() = act.haptics.cancel()

    /** Global multiplier on every haptic effect; 0 mutes. Driven by the settings screen. */
    @JavascriptInterface fun setHapticIntensity(scale: Double) {
        act.haptics.intensity = scale.toFloat()
    }

    /** True once the Visualizer is running on the output mix (equalizer is on real audio). */
    @JavascriptInterface fun audioLive(): Boolean = act.audio.live

    @JavascriptInterface fun requestAudioAccess() = act.runOnUiThread {
        act.requestAudioPermission()
    }

    @JavascriptInterface
    fun mediaPlayPause() {
        val controller = MediaListenerService.getActiveController(act)
        if (controller != null) {
            val state = controller.playbackState?.state
            if (state == android.media.session.PlaybackState.STATE_PLAYING) {
                controller.transportControls.pause()
            } else {
                controller.transportControls.play()
            }
        } else {
            sendMediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        }
    }

    @JavascriptInterface
    fun mediaNext() {
        val controller = MediaListenerService.getActiveController(act)
        if (controller != null) {
            controller.transportControls.skipToNext()
        } else {
            sendMediaKey(android.view.KeyEvent.KEYCODE_MEDIA_NEXT)
        }
    }

    @JavascriptInterface
    fun mediaPrev() {
        val controller = MediaListenerService.getActiveController(act)
        if (controller != null) {
            controller.transportControls.skipToPrevious()
        } else {
            sendMediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS)
        }
    }

    @JavascriptInterface
    fun openNotificationAccess() = act.runOnUiThread {
        act.requestAudioPermission()                 // the wave needs RECORD_AUDIO as well
        if (!act.checkNotificationAccess()) {
            try {
                act.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {}
        } else {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    android.service.notification.NotificationListenerService.requestRebind(
                        ComponentName(act, MediaListenerService::class.java)
                    )
                }
            } catch (_: Exception) {}
            Toast.makeText(act, "Notification Access Active", Toast.LENGTH_SHORT).show()
        }
    }

    private fun sendMediaKey(keyCode: Int) {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        am.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, keyCode))
        am.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, keyCode))
    }


    // ---- quick-settings radios ----
    /** Capabilities so the grid can mark which toggles only deep-link. See [Radios]. */
    @JavascriptInterface
    fun radioCaps(): String = JSONObject()
        .put("wifi", Radios.wifiCapability())
        .put("bt", Radios.btCapability())
        .put("data", Radios.dataCapability())
        .put("loc", Radios.locCapability())
        .toString()

    /** @return true if the radio flipped in place, false if a settings surface opened. */
    @JavascriptInterface
    fun toggleRadio(which: String): Boolean {
        var flipped = false
        act.runOnUiThread {
            flipped = when (which) {
                "wifi" -> Radios.toggleWifi(act)
                "bt" -> Radios.toggleBt(act)
                "data" -> Radios.toggleData(act)
                "loc" -> Radios.toggleLoc(act)
                else -> false
            }
            act.status.push()
        }
        return flipped
    }

    // ---- RIGEL ----
    @JavascriptInterface fun tiltAvailable(): Boolean = act.tilt.available

    /** The UI turns the accelerometer on only while the RIGEL screen is showing. */
    @JavascriptInterface fun setTiltWanted(v: Boolean) = act.runOnUiThread { act.tiltWanted = v }

    /**
     * Where the under-display fingerprint sensor sits, as fractions of the screen:
     * {x, y, r, found}. The boot animation can then pour the home screen out of the sensor.
     *
     * There is no public API for this. SystemUI draws its own fingerprint overlay from the
     * framework resource `config_udfps_sensor_props` (x, y, radius in pixels), so that is what
     * this reads — every device with an under-display sensor fills it in, and a device without
     * one leaves it empty. When it is missing the caller gets the Pixel 7's position, flagged
     * as not-found so the UI can say so and let the user place it by hand.
     */
    @JavascriptInterface
    fun fingerprintSensor(): String {
        val metrics = act.resources.displayMetrics
        val w = metrics.widthPixels.toFloat().coerceAtLeast(1f)
        val h = metrics.heightPixels.toFloat().coerceAtLeast(1f)
        var x = -1f; var y = -1f; var rad = -1f
        try {
            val res = android.content.res.Resources.getSystem()
            for (name in listOf("config_udfps_sensor_props", "config_udfpsSensorProps")) {
                val id = res.getIdentifier(name, "array", "android")
                if (id == 0) continue
                val arr = try { res.getIntArray(id) } catch (e: Throwable) { continue }
                if (arr.size >= 3 && arr[2] > 0) { x = arr[0].toFloat(); y = arr[1].toFloat(); rad = arr[2].toFloat(); break }
            }
        } catch (e: Throwable) {}

        val found = x >= 0 && y >= 0 && rad > 0
        val o = JSONObject()
        if (found) {
            o.put("x", x / w).put("y", y / h).put("r", rad / w)
        } else {
            // Pixel 7: centred, a touch under 89% of the way down, radius ~9.5% of the width.
            o.put("x", 0.5).put("y", 0.885).put("r", 0.095)
        }
        return o.put("found", found)
            .put("hasSensor", pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT))
            .toString()
    }

    /** The boot's first frame is on the panel: drop the black cover raised at screen-off. */
    @JavascriptInterface fun uiReady() = act.onUiReady()

    /** Kept separate from tilt: a shake-triggered scene needs the sensor on any screen. */
    @JavascriptInterface fun setShakeWanted(v: Boolean) = act.runOnUiThread { act.shakeWanted = v }

    private fun buildRigelAssetsPush(): String {
        val push = StringBuilder("mkdir -p \$HOME/.rigel/bin \$HOME/.rigel/out \$HOME/.rigel/memory " +
            "\$HOME/.gemini/config/skills/natural-response \$HOME/.gemini/config/skills/rigel-glyphs " +
            "\$HOME/.gemini/config/skills/termux-api \$HOME/.gemini/config/skills/media-glyphs " +
            "\$HOME/.gemini/config/skills/ui-scenes \$HOME/.agents/skills/ui-scenes " +
            "\$HOME/.agents/skills/natural-response \$HOME/.agents/skills/rigel-glyphs " +
            "\$HOME/.agents/skills/termux-api \$HOME/.agents/skills/media-glyphs")
        val files = listOf(
            "rigel-run.sh" to listOf("\$HOME/.rigel/bin/rigel-run"),
            "rigel-install.sh" to listOf("\$HOME/.rigel/bin/rigel-install"),
            "rigel-add-glyph.sh" to listOf("\$HOME/.rigel/bin/rigel-add-glyph"),
            "rigel-daemon.js" to listOf("\$HOME/.rigel/bin/rigel-daemon.js"),
            "AGENTS.md" to listOf("\$HOME/AGENTS.md", "\$HOME/.gemini/config/AGENTS.md"),
            "skills/natural-response/SKILL.md" to listOf("\$HOME/.gemini/config/skills/natural-response/SKILL.md", "\$HOME/.agents/skills/natural-response/SKILL.md"),
            "skills/rigel-glyphs/SKILL.md" to listOf("\$HOME/.gemini/config/skills/rigel-glyphs/SKILL.md", "\$HOME/.agents/skills/rigel-glyphs/SKILL.md"),
            "skills/termux-api/SKILL.md" to listOf("\$HOME/.gemini/config/skills/termux-api/SKILL.md", "\$HOME/.agents/skills/termux-api/SKILL.md"),
            "skills/media-glyphs/SKILL.md" to listOf("\$HOME/.gemini/config/skills/media-glyphs/SKILL.md", "\$HOME/.agents/skills/media-glyphs/SKILL.md"),
            "skills/ui-scenes/SKILL.md" to listOf("\$HOME/.gemini/config/skills/ui-scenes/SKILL.md", "\$HOME/.agents/skills/ui-scenes/SKILL.md")
        )
        for ((asset, dests) in files) {
            val body = try {
                act.assets.open("rigel/$asset").use { it.readBytes() }
            } catch (e: Exception) { continue }
            val b64 = android.util.Base64.encodeToString(body, android.util.Base64.NO_WRAP)
            for (dest in dests) {
                push.append(" && printf %s ").append(shq(b64))
                    .append(" | base64 -d > ").append(dest)
                if (dest.contains("/bin/")) {
                    push.append(" && chmod +x ").append(dest)
                }
            }
        }
        return push.toString()
    }

    /**
     * Pushes the current helper scripts out of the APK, then installs the chosen backend —
     * all in the background, no terminal. Refreshing the scripts on every install is what
     * lets a launcher update fix rigel-run without the user redoing key entry.
     * Progress lands in ~/.rigel/status, which the UI polls.
     */
    @JavascriptInterface
    fun rigelInstall(id: String, backend: String) {
        val safe = if (backend in listOf("agy", "antigravity", "opencode")) backend else "agy"
        val cmd = buildRigelAssetsPush() + " && \$HOME/.rigel/bin/rigel-install " + safe
        runTermux(id, cmd)
    }

    /** One line of install progress + streamed text buffer, polled by the UI. */
    @JavascriptInterface
    fun rigelStatus(id: String) {
        if (http.daemonUp()) return http.status(id) { statusViaTermux(id) }
        statusViaTermux(id)
    }

    private fun statusViaTermux(id: String) = runTermux(id,
        "cat \$HOME/.rigel/status 2>/dev/null || echo NONE; echo '---RIGEL_STREAM---'; cat \$HOME/.rigel/stream 2>/dev/null || true")

    /** Abort running RIGEL turn and kill the underlying agy process */
    @JavascriptInterface
    fun rigelAbort() {
        val cmd = "curl -s -m 1 -X POST http://127.0.0.1:4096/abort >/dev/null 2>&1 || true; pkill -f agy >/dev/null 2>&1 || true; echo IDLE > \$HOME/.rigel/status; rm -f \$HOME/.rigel/stream 2>/dev/null || true"
        runTermux("rigelabort", cmd)
    }

    /** Load custom media glyph configuration */
    @JavascriptInterface
    fun mediaGlyphs(id: String) {
        if (http.daemonUp()) return http.mediaGlyphs(id) { runTermux(id, "cat \$HOME/.rigel/media_glyphs.json 2>/dev/null || echo '[]'") }
        runTermux(id, "cat \$HOME/.rigel/media_glyphs.json 2>/dev/null || echo '[]'")
    }

    /** Load custom glyph definitions */
    @JavascriptInterface
    fun customGlyphs(id: String) {
        if (http.daemonUp()) return http.glyphs(id) { runTermux(id, "cat \$HOME/.rigel/custom_glyphs.json 2>/dev/null || echo '{}'") }
        runTermux(id, "cat \$HOME/.rigel/custom_glyphs.json 2>/dev/null || echo '{}'")
    }

    /** Persist a glyph RIGEL invented mid-reply, so it survives a restart. */
    @JavascriptInterface
    fun saveGlyph(json: String) {
        if (http.daemonUp()) return http.postQuiet("/custom-glyphs", json)
        runTermux("glyphsave", "mkdir -p \$HOME/.rigel && printf %s " + shq(json) +
            " | curl -s -m 2 -X POST http://127.0.0.1:4096/custom-glyphs --data-binary @- >/dev/null 2>&1 || true")
    }

    /** RIGEL-authored interface scenes: custom triggers and custom drawing. */
    @JavascriptInterface
    fun uiScenes(id: String) {
        if (http.daemonUp()) return http.scenes(id) { runTermux(id, "cat \$HOME/.rigel/ui_scenes.json 2>/dev/null || echo '[]'") }
        runTermux(id, "cat \$HOME/.rigel/ui_scenes.json 2>/dev/null || echo '[]'")
    }

    /** Store (or remove) one scene. The daemon merges it into ui_scenes.json. */
    @JavascriptInterface
    fun saveScene(json: String) {
        if (http.daemonUp()) return http.postQuiet("/ui-scenes", json)
        runTermux("scenesave", "mkdir -p \$HOME/.rigel && printf %s " + shq(json) +
            " | curl -s -m 2 -X POST http://127.0.0.1:4096/ui-scenes --data-binary @- >/dev/null 2>&1 || true")
    }

    /** Reset RIGEL session so user can start a fresh conversation */
    @JavascriptInterface
    fun rigelReset(id: String) {
        if (http.daemonUp()) {
            http.postQuiet("/reset", "")
            return act.js("ZL.onTermux(${JSONObject.quote(id)},'RESET_OK','',0,'')")
        }
        runTermux(id, "curl -s -X POST http://127.0.0.1:4096/reset >/dev/null 2>&1 || true; echo 'RESET_OK'")
    }

    /** Dynamically pull models available on the device */
    @JavascriptInterface
    fun rigelModels(id: String) {
        val viaTermux = { runTermux(id, "curl -s http://127.0.0.1:4096/models 2>/dev/null || (export PATH=\"\$HOME/.rigel/bin:/data/data/com.termux/files/usr/bin:\$PATH\"; agy models 2>/dev/null || antigravity models 2>/dev/null)") }
        if (http.daemonUp()) return http.models(id) { viaTermux() }
        viaTermux()
    }

    /** Set active model */
    @JavascriptInterface
    fun rigelSetModel(id: String, model: String) {
        val safeModel = model.replace("\"", "").replace("'", "").trim()
        val viaTermux = { runTermux(id, "printf %s ${shq(safeModel)} | curl -s -X POST http://127.0.0.1:4096/setmodel --data-binary @- >/dev/null 2>&1 || true") }
        if (http.daemonUp()) return http.setModel(id, safeModel) { viaTermux() }
        viaTermux()
    }

    /** One RIGEL turn. Pushes the current helper scripts if available, then executes. */
    @JavascriptInterface
    fun rigelAsk(id: String, promptB64: String) {
        val viaTermux = {
            runTermux(id, buildRigelAssetsPush() + " && \$HOME/.rigel/bin/rigel-run " +
                JSONObject.quote(id) + " " + JSONObject.quote(promptB64))
        }
        // Straight to the daemon when it is listening: this skips a Termux session spawn per
        // turn, which was the bulk of the wait before the model had even seen the prompt.
        if (http.daemonUp()) {
            val prompt = try {
                String(android.util.Base64.decode(promptB64, android.util.Base64.DEFAULT), Charsets.UTF_8)
            } catch (e: Throwable) { "" }
            if (prompt.isNotEmpty()) return http.ask(id, prompt) { viaTermux() }
        }
        viaTermux()
    }

    // ---- voice ----
    /** What this device can actually do, so the UI never offers a mic that cannot work. */
    @JavascriptInterface
    fun voiceCaps(): String = JSONObject()
        .put("recognition", act.voice.recognitionAvailable)
        .put("onDevice", act.voice.onDeviceAvailable)
        .put("mic", androidx.core.content.ContextCompat.checkSelfPermission(act, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        .toString()

    /**
     * Fire-and-forget. This used to block the JS thread on a latch waiting for the main
     * thread, which stalled the whole UI for up to two seconds — long enough that rapid
     * taps on the RIGEL mark were swallowed and the 4-tap gesture could never complete.
     * Success or failure now comes back asynchronously through ZL.onVoiceState.
     */
    @JavascriptInterface
    fun voiceStart(): Boolean {
        if (androidx.core.content.ContextCompat.checkSelfPermission(act, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            act.runOnUiThread { act.requestAudioPermission() }
            return false
        }
        act.runOnUiThread { act.voice.start() }
        return true
    }

    @JavascriptInterface fun voiceStop() = act.runOnUiThread { act.voice.stop() }
    @JavascriptInterface fun voiceSpeak(text: String) = act.runOnUiThread { act.voice.speak(text) }
    @JavascriptInterface fun voiceShutUp() = act.runOnUiThread { act.voice.shutUp() }

    /** RIGEL's own shell access — same RUN_COMMAND path, used by its tools. */
    @JavascriptInterface fun rigelExec(id: String, cmd: String) = runTermux(id, cmd)

    companion object {
        fun location(ctx: Context): Pair<Double, Double>? {
            if (androidx.core.content.ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            return try {
                listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
                    .mapNotNull { lm.getLastKnownLocation(it) }
                    .maxByOrNull { it.time }
                    ?.let { it.latitude to it.longitude }
            } catch (e: Exception) { null }
        }
    }
}

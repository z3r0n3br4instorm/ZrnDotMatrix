package lab.zerone.launcher

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

/**
 * Predicts the app you are about to open, for the home screen's "OPEN <APP>?" widget.
 *
 * Deliberately not a foundation model. Google's own app prediction rides
 * `android.app.prediction.AppPredictionManager`, which is `@SystemApi` — system-signature only,
 * unreachable from a third-party launcher even as the default home — and Gemini Nano via ML Kit
 * is a text generator, wrong shape for this and gated to a handful of devices. This is a
 * frequency/recency model instead: it answers in microseconds, needs no network, no extra
 * dependency, and every byte of history stays in this app's private storage.
 *
 * Two sources feed it, and the difference matters:
 *  - [UsageStatsManager] is the good one. It reports *real* foreground durations and comes with
 *    history already in it, so predictions are useful the first day rather than after weeks of
 *    self-logging, and it sees launches from anywhere — recents, notifications, another
 *    launcher — not just ones this launcher started. It needs PACKAGE_USAGE_STATS, which is a
 *    special access the user grants on a Settings screen and no app can grant itself.
 *  - [noteLaunch] is the fallback for when that access is not granted. It only sees launches
 *    that went through this launcher and cannot observe true durations, so the model is
 *    strictly worse — but it works with zero permissions and needs no consent.
 *
 * Raw events are never kept. They fold immediately into a sparse per-app aggregate (see [Stat]),
 * which is all that is persisted: roughly "how often, how long, and when" per package.
 */
class AppPredictor(private val act: MainActivity) {

    /**
     * What the model remembers about one package. Counts are Double rather than Int because
     * they are both dwell-weighted on the way in and exponentially decayed over time, so they
     * are never whole numbers in practice.
     */
    private class Stat {
        @Volatile var launches = 0.0
        @Volatile var totalMs = 0.0
        @Volatile var lastUsed = 0L
        /** Sparse: key is [slotOf]'s dayType*24+hour, value the dwell-weighted count there. */
        val slots = ConcurrentHashMap<Int, Double>()
    }

    private val stats = ConcurrentHashMap<String, Stat>()
    /** prev package -> next package -> dwell-weighted count. "What usually follows X." */
    private val transitions = ConcurrentHashMap<String, ConcurrentHashMap<String, Double>>()

    @Volatile private var lastEventTs = 0L
    @Volatile private var lastDecayDay = 0L
    @Volatile private var loaded = false
    @Volatile private var lastRefresh = 0L
    /** Set by [noteLaunch]/ingest so the transition model knows what you just came from. */
    @Volatile private var lastPkg: String? = null

    private val file: File get() = File(act.filesDir, "appmodel.json")

    // ---- access ---------------------------------------------------------------------------

    /**
     * PACKAGE_USAGE_STATS is an "app op", not a runtime permission — checkSelfPermission always
     * reports it granted because it is in the manifest, so the only honest check is the op.
     */
    fun hasUsageAccess(): Boolean = try {
        val ops = act.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), act.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), act.packageName)
        }
        mode == AppOpsManager.MODE_ALLOWED
    } catch (e: Throwable) {
        false
    }

    // ---- ingest ---------------------------------------------------------------------------

    /**
     * Folds any usage events newer than the last pass into the aggregate. Cheap to call often:
     * it no-ops unless [minGapMs] has elapsed, since UsageStatsManager itself batches events
     * and re-querying a few seconds later would just walk the same window again.
     */
    fun refresh(minGapMs: Long = 5 * 60_000L) {
        val now = System.currentTimeMillis()
        if (now - lastRefresh < minGapMs) return
        lastRefresh = now
        try {
            ensureLoaded()
            decayIfNeeded(now)
            if (hasUsageAccess()) ingestUsageEvents(now)
            save()
        } catch (e: Throwable) {
            // A prediction is a nicety; never let it take the launcher down.
            android.util.Log.w(TAG, "refresh failed: ${e.message}")
        }
    }

    private fun ingestUsageEvents(now: Long) {
        val usm = act.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        // First run has no watermark: take a month. The platform keeps far less event detail
        // than that, so in practice this is "everything it still has".
        val since = if (lastEventTs > 0) lastEventTs + 1 else now - 30L * 24 * 3600_000L
        if (since >= now) return

        val events = usm.queryEvents(since, now)
        val ev = UsageEvents.Event()
        // A package can only be foregrounded once at a time, so one open timestamp per package
        // is enough to pair RESUMED with the PAUSED that closes it.
        val open = HashMap<String, Long>()
        var maxTs = lastEventTs
        var prev: String? = lastPkg

        while (events.hasNextEvent()) {
            events.getNextEvent(ev)
            val pkg = ev.packageName ?: continue
            if (ev.timeStamp > maxTs) maxTs = ev.timeStamp
            // ACTIVITY_RESUMED/ACTIVITY_PAUSED (API 29+) carry the same int values as the
            // older MOVE_TO_FOREGROUND/MOVE_TO_BACKGROUND, so one branch covers every level.
            @Suppress("DEPRECATION")
            when (ev.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> if (!ignored(pkg)) open[pkg] = ev.timeStamp
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val startedAt = open.remove(pkg) ?: continue
                    val dur = ev.timeStamp - startedAt
                    if (dur <= 0) continue
                    record(pkg, startedAt, dur, prev)
                    prev = pkg
                }
            }
        }
        // Whatever is still foreground at the end of the window has no PAUSED yet — leave it
        // for the next pass rather than inventing a duration for it.
        lastEventTs = maxTs
        lastPkg = prev
    }

    /**
     * The own-log fallback, called from [Bridge.launch]. No duration is observable here — the
     * launcher is being backgrounded, so it cannot see when you leave the app again — so this
     * assumes a middling session rather than pretending to know. Ignored entirely when usage
     * access is granted, since that path records the same launch with a real duration and
     * double-counting would skew the model toward launcher-initiated opens.
     */
    fun noteLaunch(pkg: String) {
        if (ignored(pkg)) return
        try {
            ensureLoaded()
            if (hasUsageAccess()) { lastPkg = pkg; return }
            val now = System.currentTimeMillis()
            record(pkg, now, ASSUMED_SESSION_MS, lastPkg)
            lastPkg = pkg
            save()
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "noteLaunch failed: ${e.message}")
        }
    }

    /**
     * One observed session. Weighted by dwell: a two-second open is usually a misfire or a
     * pass-through on the way somewhere else, and counting it the same as a ten-minute session
     * is what makes naive frequency models keep suggesting apps you immediately back out of.
     */
    private fun record(pkg: String, startedAt: Long, durationMs: Long, prev: String?) {
        val weight = min(1.0, durationMs.toDouble() / FULL_WEIGHT_MS)
        if (weight < MIN_WEIGHT) return
        val st = stats.getOrPut(pkg) { Stat() }
        st.launches += weight
        st.totalMs += durationMs
        if (startedAt > st.lastUsed) st.lastUsed = startedAt
        val slot = slotOf(startedAt)
        st.slots[slot] = (st.slots[slot] ?: 0.0) + weight
        if (prev != null && prev != pkg) {
            val m = transitions.getOrPut(prev) { ConcurrentHashMap() }
            m[pkg] = (m[pkg] ?: 0.0) + weight
        }
    }

    // ---- prediction -------------------------------------------------------------------------

    /**
     * Best guess for right now, as JSON for the UI, or `{}` when nothing clears the bar.
     * Returning nothing is a normal outcome and the common one at odd hours — a launcher that
     * always shows a suggestion trains you to ignore the suggestion.
     */
    fun predict(): String {
        return try {
            ensureLoaded()
            val best = bestCandidate() ?: return "{}"
            JSONObject()
                .put("pkg", best.pkg)
                .put("label", best.label)
                .put("score", best.score)
                .put("icon", IconDots.encode(act, best.pkg, ICON_DOTS))
                .toString()
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "predict failed: ${e.message}")
            "{}"
        }
    }

    private class Candidate(val pkg: String, val label: String, val score: Double)

    private fun bestCandidate(): Candidate? {
        val now = System.currentTimeMillis()
        val slot = slotOf(now)
        val prevSlot = neighbourSlot(slot, -1)
        val nextSlot = neighbourSlot(slot, +1)

        val totalLaunches = stats.values.sumOf { it.launches }
        if (totalLaunches < MIN_TOTAL_LAUNCHES) return null   // not enough history to be useful

        val fromLast = lastPkg?.let { transitions[it] }
        val fromLastTotal = fromLast?.values?.sum() ?: 0.0
        // Null before StatusMonitor exists or before its first push; the context nudges just
        // sit out until then. `lateinit` access throws rather than returning null from here.
        val st = try { act.status.last } catch (e: Throwable) { null }
        val headphones = st?.optBoolean("audio", false) == true || st?.optBoolean("btAudio", false) == true
        val charging = st?.optBoolean("charging", false) == true

        var bestPkg: String? = null
        var bestLabel: String? = null
        var bestScore = Double.NEGATIVE_INFINITY

        for ((pkg, s) in stats) {
            if (s.launches < MIN_APP_LAUNCHES) continue
            // Also filtered here, not just at ingest: a package already in the model from an
            // earlier build — or one that became a launcher since — would otherwise keep
            // being offered until decay finally forgot it.
            if (ignored(pkg)) continue
            // Resolved up front, not after picking a winner: an app uninstalled since it was
            // logged should lose to the runner-up, not suppress the suggestion entirely.
            val label = act.bridge.labelFor(pkg) ?: continue
            // Just came back from it — suggesting it again is noise, not prediction.
            if (now - s.lastUsed < SUPPRESS_RECENT_MS) continue

            // P(app), smoothed.
            val prior = ln((s.launches + PRIOR_ALPHA) / (totalLaunches + PRIOR_ALPHA * stats.size))

            // P(this time slot | app). Adjacent hours count partially: habits sit in a window,
            // not on a clock edge, and without the bleed an app used at 08:58 daily scores zero
            // at 09:01.
            val slotHits = (s.slots[slot] ?: 0.0) +
                ADJACENT * ((s.slots[prevSlot] ?: 0.0) + (s.slots[nextSlot] ?: 0.0))
            val pSlot = ln((slotHits + SLOT_ALPHA) / (s.launches + SLOT_ALPHA * SLOTS))

            // P(app | app you just left). Strong signal when present, absent most of the time.
            val trans = if (fromLastTotal > 0) {
                ln(((fromLast?.get(pkg) ?: 0.0) + TRANS_ALPHA) / (fromLastTotal + TRANS_ALPHA * stats.size))
            } else 0.0

            var score = W_PRIOR * prior + W_SLOT * pSlot + W_TRANS * trans

            // Cheap contextual nudges from state the launcher already tracks. Headphones or a
            // Bluetooth speaker going live is the single most predictive non-temporal signal
            // there is for "about to play something".
            if (headphones && looksLikeMedia(pkg)) score += W_CONTEXT
            if (charging && s.avgMs() > LONG_SESSION_MS) score += W_CONTEXT * 0.5

            if (score > bestScore) { bestScore = score; bestPkg = pkg; bestLabel = label }
        }

        val pkg = bestPkg ?: return null
        if (bestScore < MIN_SCORE) return null
        return Candidate(pkg, bestLabel ?: return null, bestScore)
    }

    private fun Stat.avgMs(): Double = if (launches > 0) totalMs / launches else 0.0

    private fun looksLikeMedia(pkg: String): Boolean =
        MEDIA_HINTS.any { pkg.contains(it, ignoreCase = true) }

    // ---- housekeeping -------------------------------------------------------------------------

    /**
     * Exponential decay so the model tracks habits that change. Without it, an app you opened
     * constantly six months ago and never since outranks the one you actually use now, forever.
     */
    private fun decayIfNeeded(now: Long) {
        val day = now / 86_400_000L
        if (lastDecayDay == 0L) { lastDecayDay = day; return }
        val days = (day - lastDecayDay).toInt()
        if (days <= 0) return
        val f = Math.pow(DAILY_DECAY, days.toDouble())
        val dead = ArrayList<String>()
        for ((pkg, s) in stats) {
            s.launches *= f
            s.totalMs *= f
            for ((k, v) in s.slots) s.slots[k] = v * f
            s.slots.entries.removeAll { it.value < FORGET_BELOW }
            if (s.launches < FORGET_BELOW) dead.add(pkg)
        }
        // Drop what has decayed to nothing, so the file cannot grow without bound.
        for (p in dead) { stats.remove(p); transitions.remove(p) }
        for (m in transitions.values) {
            for ((k, v) in m) m[k] = v * f
            m.entries.removeAll { it.value < FORGET_BELOW || !stats.containsKey(it.key) }
        }
        lastDecayDay = day
    }

    /**
     * Skip ourselves and anything with no launcher entry — services, IMEs, system UI.
     * The label map is built asynchronously, so "not in the map" only means "not launchable"
     * once it has actually been built; treating an empty map as authoritative would discard
     * every event on the first pass, which is exactly the pass that carries a month of it.
     */
    private fun ignored(pkg: String): Boolean =
        pkg == act.packageName ||
            act.bridge.isHomeApp(pkg) ||   // another launcher: never a useful suggestion
            (act.bridge.labelsReady() && act.bridge.labelFor(pkg) == null)

    private fun slotOf(ms: Long): Int {
        val c = Calendar.getInstance()
        c.timeInMillis = ms
        val dow = c.get(Calendar.DAY_OF_WEEK)
        val weekend = if (dow == Calendar.SATURDAY || dow == Calendar.SUNDAY) 1 else 0
        return weekend * 24 + c.get(Calendar.HOUR_OF_DAY)
    }

    /** Hour-of-day wraps within its own day type; midnight's neighbour is 23:00, not a weekend. */
    private fun neighbourSlot(slot: Int, delta: Int): Int {
        val dayType = slot / 24
        val hour = (slot % 24 + delta + 24) % 24
        return dayType * 24 + hour
    }

    // ---- persistence ---------------------------------------------------------------------------

    @Synchronized
    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        val f = file
        if (!f.exists()) return
        try {
            val root = JSONObject(f.readText())
            lastEventTs = root.optLong("lastEventTs", 0L)
            lastDecayDay = root.optLong("lastDecayDay", 0L)
            lastPkg = root.optString("lastPkg", "").ifEmpty { null }
            val apps = root.optJSONObject("apps") ?: JSONObject()
            for (pkg in apps.keys()) {
                val o = apps.getJSONObject(pkg)
                val s = Stat()
                s.launches = o.optDouble("n", 0.0)
                s.totalMs = o.optDouble("ms", 0.0)
                s.lastUsed = o.optLong("last", 0L)
                val sl = o.optJSONObject("slots") ?: JSONObject()
                for (k in sl.keys()) s.slots[k.toInt()] = sl.getDouble(k)
                stats[pkg] = s
            }
            val tr = root.optJSONObject("trans") ?: JSONObject()
            for (from in tr.keys()) {
                val o = tr.getJSONObject(from)
                val m = ConcurrentHashMap<String, Double>()
                for (to in o.keys()) m[to] = o.getDouble(to)
                transitions[from] = m
            }
        } catch (e: Throwable) {
            // A corrupt model is not worth a crash or a migration path — start over.
            android.util.Log.w(TAG, "model unreadable, starting fresh: ${e.message}")
            stats.clear(); transitions.clear()
        }
    }

    @Synchronized
    private fun save() {
        try {
            val apps = JSONObject()
            for ((pkg, s) in stats) {
                val sl = JSONObject()
                for ((k, v) in s.slots) sl.put(k.toString(), v)
                apps.put(pkg, JSONObject()
                    .put("n", s.launches).put("ms", s.totalMs)
                    .put("last", s.lastUsed).put("slots", sl))
            }
            val tr = JSONObject()
            for ((from, m) in transitions) {
                val o = JSONObject()
                for ((to, v) in m) o.put(to, v)
                tr.put(from, o)
            }
            file.writeText(JSONObject()
                .put("lastEventTs", lastEventTs)
                .put("lastDecayDay", lastDecayDay)
                .put("lastPkg", lastPkg ?: "")
                .put("apps", apps).put("trans", tr).toString())
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "save failed: ${e.message}")
        }
    }

    /** Settings "forget everything" — the model is behavioural data, so this has to exist. */
    fun clear() {
        stats.clear(); transitions.clear()
        lastEventTs = 0L; lastDecayDay = 0L; lastPkg = null
        try { file.delete() } catch (e: Throwable) {}
    }

    companion object {
        private const val TAG = "ZrnPredict"

        /** 2 day types (weekday/weekend) x 24 hours. */
        private const val SLOTS = 48
        private const val ICON_DOTS = 20

        // Ingest shaping.
        private const val FULL_WEIGHT_MS = 30_000.0      // a session this long counts fully
        private const val MIN_WEIGHT = 0.05              // below this it was a pass-through
        private const val ASSUMED_SESSION_MS = 60_000L   // own-log fallback, duration unobservable
        private const val LONG_SESSION_MS = 5 * 60_000.0

        // Scoring weights. Time-of-day dominates, which is the whole premise; the prior stops
        // a once-used app winning its slot outright; transitions matter but are usually absent.
        private const val W_PRIOR = 1.0
        private const val W_SLOT = 2.2
        private const val W_TRANS = 0.8
        private const val W_CONTEXT = 0.6
        private const val ADJACENT = 0.45                // weight of the hours either side

        // Laplace smoothing, so an unseen combination is unlikely rather than impossible.
        private const val PRIOR_ALPHA = 1.0
        private const val SLOT_ALPHA = 0.6
        private const val TRANS_ALPHA = 0.4

        // Bars for showing anything at all.
        private const val MIN_TOTAL_LAUNCHES = 12.0
        private const val MIN_APP_LAUNCHES = 2.0
        private const val MIN_SCORE = -9.5
        private const val SUPPRESS_RECENT_MS = 3 * 60_000L

        private const val DAILY_DECAY = 0.985            // ~46-day half-life
        private const val FORGET_BELOW = 0.05

        private val MEDIA_HINTS = listOf(
            "music", "spotify", "audio", "podcast", "player", "youtube", "soundcloud", "deezer"
        )
    }
}

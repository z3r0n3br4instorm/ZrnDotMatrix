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

    /**
     * Learned correction per package per time slot, added straight to the score.
     *
     * This is the reinforcement part, and it is a contextual bandit rather than anything
     * deeper: the slot is the context, naming one app is the action, and what you open next
     * is the reward. Counting alone cannot represent "you open this constantly but never the
     * time I offer it" — the counts say it is popular either way. A signed term that only
     * moves when a guess is graded can, and it moves fast, because a handful of corrections
     * should visibly change behaviour rather than being averaged into thousands of launches.
     */
    private val bias = ConcurrentHashMap<String, ConcurrentHashMap<Int, Double>>()

    /** The guess currently awaiting a verdict: what was named, in which slot, and when. */
    private class Pending(val pkg: String, val slot: Int, val at: Long)
    @Volatile private var pending: Pending? = null

    @Volatile private var lastEventTs = 0L
    @Volatile private var lastDecayDay = 0L
    @Volatile private var loaded = false
    @Volatile private var lastRefresh = 0L
    /** Set by [noteLaunch]/ingest so the transition model knows what you just came from. */
    @Volatile private var lastPkg: String? = null

    private val file: File get() = File(act.filesDir, "appmodel.json")
    /** Single thread: writes are small but must not land on the JS/UI thread, and must not
     *  interleave with each other. */
    private val io = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun saveAsync() { try { io.execute { save() } } catch (e: Throwable) {} }

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
            // Ingest first, then commit to a guess for the period ahead. Runs whether or not
            // the widget is on — with it off this is the only thing keeping the reinforcement
            // loop alive, which is the point of "keep learning in the background".
            formHypothesis()
            save()
            // Ingest runs off the UI thread and a first pass walks a month of events, so the
            // UI's own startup ask can easily beat it and see an empty model. Tell it when
            // there is actually something to ask about.
            act.js("ZL.predictionReady()")
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
        // Whatever is still foreground at the end of the window has no PAUSED yet. Leaving it
        // for the next pass only works if the watermark stays BEHIND its RESUMED — advancing
        // past it meant the pair could never complete on any later pass, so the session was
        // dropped for good. That systematically lost the app you were in most recently, which
        // is precisely the one a pending guess needs grading against.
        val earliestOpen = open.values.minOrNull()
        lastEventTs = if (earliestOpen != null) minOf(maxTs, earliestOpen - 1) else maxTs
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
        grade(pkg, startedAt)
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

    // ---- reinforcement ------------------------------------------------------------------------

    /**
     * Grades the outstanding guess against what you actually opened. Called from [record], so
     * it sees launches from both sources — including ones made outside this launcher entirely.
     *
     * Rewarding the app you chose matters as much as penalising the one that was named: the
     * whole failure mode is a popular app crowding out the right one in a slot it owns, and
     * only a positive term on the chosen app fixes that. Both are clamped so a run of unusual
     * days can bend the ranking without overwriting what the counts know.
     */
    private fun grade(launched: String, at: Long) {
        val p = pending ?: return
        val dt = at - p.at
        // Outside the window this is just the next thing you happened to do, not an answer.
        if (dt < 0 || dt > REWARD_WINDOW_MS) { if (dt > REWARD_WINDOW_MS) pending = null; return }
        pending = null
        if (launched == p.pkg) {
            nudge(p.pkg, p.slot, ACCEPT_LR)
        } else {
            nudge(p.pkg, p.slot, -REJECT_LR)
            nudge(launched, p.slot, ALT_LR)
        }
    }

    private fun nudge(pkg: String, slot: Int, delta: Double) {
        val m = bias.getOrPut(pkg) { ConcurrentHashMap() }
        val v = (m[slot] ?: 0.0) + delta
        m[slot] = v.coerceIn(-BIAS_CLAMP, BIAS_CLAMP)
    }

    private fun biasOf(pkg: String, slot: Int): Double = bias[pkg]?.get(slot) ?: 0.0

    /**
     * Forms a guess without showing one, so the loop keeps turning while the widget is off:
     * the model still commits to an answer and still gets graded on it. Turning the widget
     * back on then gets a predictor that has been learning all along, not one starting cold.
     */
    private fun formHypothesis() {
        val best = bestCandidate() ?: return
        pending = Pending(best.pkg, slotOf(System.currentTimeMillis()), System.currentTimeMillis())
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
            val best = bestCandidate()
            // One line per ask: "is the model empty, is nothing clearing the bar, or is the
            // UI simply not drawing what it was given" is otherwise guesswork from outside.
            android.util.Log.d(TAG, if (best == null) "no candidate (apps=${stats.size})"
                       else "suggest ${best.pkg} confidence=${"%.2f".format(best.score)}")
            if (best == null) return "{}"
            // Naming an app IS the action the policy took, so this is where the bet is placed;
            // record() grades it against whatever gets opened next. Written out immediately
            // (off-thread): the launcher is usually killed between placing the bet and seeing
            // it answered, so a bet only held in memory is one the model never learns from.
            pending = Pending(best.pkg, slotOf(System.currentTimeMillis()), System.currentTimeMillis())
            saveAsync()
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
        val scores = ArrayList<Double>(stats.size)

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

            // The learned correction is added raw, not weighted: it is already in score units
            // and is the one term that reflects your verdict rather than your history.
            var score = W_PRIOR * prior + W_SLOT * pSlot + W_TRANS * trans + biasOf(pkg, slot)

            // Cheap contextual nudges from state the launcher already tracks. Headphones or a
            // Bluetooth speaker going live is the single most predictive non-temporal signal
            // there is for "about to play something".
            if (headphones && looksLikeMedia(pkg)) score += W_CONTEXT
            if (charging && s.avgMs() > LONG_SESSION_MS) score += W_CONTEXT * 0.5

            scores.add(score)
            if (score > bestScore) { bestScore = score; bestPkg = pkg; bestLabel = label }
        }

        val pkg = bestPkg ?: return null
        // Confidence, not a raw cutoff. The score is a sum of log terms whose scale moves with
        // how many apps are installed and how many launches are on record, so any absolute
        // threshold means something different on every phone — and drifted past its own cutoff
        // here after a handful of launches. A softmax over the candidates asks the question
        // that actually matters: given everything else it could have said, how much of the
        // probability mass is on this one? Scale-free, and directly interpretable.
        var sum = 0.0
        for (v in scores) sum += Math.exp(v - bestScore)   // shifted: the max term is exp(0)=1
        val confidence = if (sum > 0) 1.0 / sum else 0.0
        if (confidence < MIN_CONFIDENCE) return null
        return Candidate(pkg, bestLabel ?: return null, confidence)
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
        // Corrections fade faster than counts. A verdict is about how things are now, and a
        // penalty earned months ago should not still be suppressing an app you have since
        // started using — the counts are the long memory, this is the short one.
        val bf = Math.pow(BIAS_DECAY, days.toDouble())
        for ((pkg, m) in bias) {
            for ((k, v) in m) m[k] = v * bf
            m.entries.removeAll { kotlin.math.abs(it.value) < BIAS_FORGET }
            if (m.isEmpty() || !stats.containsKey(pkg)) bias.remove(pkg)
        }
        lastDecayDay = day
    }

    /**
     * Drops anything that should never have been learned — this launcher, other home apps,
     * packages since uninstalled. Filtering these at read time is not enough: they stay in
     * `totalLaunches`, which is the denominator of every app's prior, so a launcher sitting on
     * a tenth of all recorded launches quietly deflates the score of every real candidate.
     * Guarded on labelsReady so an empty label map cannot be read as "nothing is launchable"
     * and wipe the model.
     */
    private fun purgeIgnored() {
        if (!act.bridge.labelsReady()) return
        val dead = stats.keys.filter { ignored(it) }
        if (dead.isEmpty()) return
        val deadSet = dead.toSet()
        for (p in dead) { stats.remove(p); transitions.remove(p); bias.remove(p) }
        for (m in transitions.values) m.keys.removeAll(deadSet)
        pending?.let { if (it.pkg in deadSet) pending = null }
        android.util.Log.d(TAG, "purged ${dead.size} untrackable: ${dead.take(4)}")
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
            val pp = root.optString("pendPkg", "")
            val ps = root.optInt("pendSlot", -1)
            val pa = root.optLong("pendAt", 0L)
            if (pp.isNotEmpty() && ps >= 0 && pa > 0) pending = Pending(pp, ps, pa)
            val bi = root.optJSONObject("bias") ?: JSONObject()
            for (pkg in bi.keys()) {
                val o = bi.getJSONObject(pkg)
                val m = ConcurrentHashMap<Int, Double>()
                for (k in o.keys()) m[k.toInt()] = o.getDouble(k)
                bias[pkg] = m
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
            val bi = JSONObject()
            for ((pkg, m) in bias) {
                val o = JSONObject()
                for ((slot, v) in m) o.put(slot.toString(), v)
                bi.put(pkg, o)
            }
            file.writeText(JSONObject()
                .put("lastEventTs", lastEventTs)
                .put("lastDecayDay", lastDecayDay)
                .put("lastPkg", lastPkg ?: "")
                .put("apps", apps).put("trans", tr).put("bias", bi)
                // The outstanding bet outlives the process on purpose: the launcher is
                // routinely killed while you are inside the very app that would answer it,
                // and a verdict lost to that is a verdict the model never learns from.
                .put("pendPkg", pending?.pkg ?: "")
                .put("pendSlot", pending?.slot ?: -1)
                .put("pendAt", pending?.at ?: 0L)
                .toString())
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "save failed: ${e.message}")
        }
    }

    /** Settings "forget everything" — the model is behavioural data, so this has to exist. */
    fun clear() {
        stats.clear(); transitions.clear(); bias.clear()
        lastEventTs = 0L; lastDecayDay = 0L; lastPkg = null; pending = null
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
        /** Share of the probability mass the winner must hold. ~1-in-4 or better. */
        private const val MIN_CONFIDENCE = 0.22
        private const val SUPPRESS_RECENT_MS = 3 * 60_000L

        private const val DAILY_DECAY = 0.985            // ~46-day half-life
        private const val FORGET_BELOW = 0.05

        // Reinforcement. Rates are deliberately large next to the counts: a few corrections
        // should visibly move the ranking, which is the entire point of grading the guess
        // rather than just counting launches. Accept outweighs reject so the model is not
        // talked out of a good habit by one distracted morning.
        private const val REWARD_WINDOW_MS = 90_000L     // a launch this soon is an answer
        private const val ACCEPT_LR = 0.60               // named it, you opened it
        private const val REJECT_LR = 0.35               // named it, you opened something else
        private const val ALT_LR = 0.25                  // ...and what you opened instead
        private const val BIAS_CLAMP = 2.5               // never allowed to overrule the counts
        private const val BIAS_DECAY = 0.94              // ~11-day half-life: shorter memory
        private const val BIAS_FORGET = 0.02

        private val MEDIA_HINTS = listOf(
            "music", "spotify", "audio", "podcast", "player", "youtube", "soundcloud", "deezer"
        )
    }
}

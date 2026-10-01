package lab.zerone.launcher

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Process
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.TimeZone
import kotlin.math.roundToInt

/**
 * Suggests the app you are about to need, for the home screen's "OPEN <APP>?" widget — and,
 * more often than not, suggests nothing at all.
 *
 * The previous model scored every app at every unlock and showed whichever won, which on a
 * real phone meant WhatsApp most of the time: an app opened 150 times a day wins any
 * frequency contest without telling you anything you did not already know. This one looks for
 * *routines* instead — "Uber, weekday mornings, 08:45-09:30" — and stays quiet whenever the
 * present moment is not inside one. A launcher that always offers something trains you to
 * ignore it, or worse, to open it.
 *
 * Pipeline, each step there because the device's own logs showed the noise it removes:
 *  1. Sessions. UsageStats RESUMED/PAUSED pairs; anything under [MIN_DWELL_MS] is a misfire.
 *  2. Episodes. Repeat opens of one app within [EPISODE_GAP_MS] fold into one: checking a ride
 *     every two minutes is one trip, not seventeen launches.
 *  3. Notification-led episodes are kept but never count as routine evidence. Two thirds of
 *     WhatsApp and Teams opens came within minutes of their own notification — that is the
 *     notification doing its job, and the shade already offers that app.
 *  4. Ambient apps — used most days, all through the day — are never suggested. Feeds
 *     (social, video, games, news) are never suggested either. Neither has a "when".
 *  5. Routine windows are mined per app from the remaining episode starts: dense 15-minute
 *     bins grown into a window of at most three hours, kept only with [MIN_DAYS] distinct days
 *     of evidence and a rate [MIN_LIFT]x the app's own baseline.
 *  6. At unlock a window is live from [LEAD_MIN] before its start to its end. Its support is
 *     the share of comparable days it fired on — same weekday, shrunk toward same day type
 *     while weekdays are thin — and place (Wi-Fi network or coarse cell) gates it once the
 *     routine has a place on record.
 *  7. It stops asking once you have done the thing today, after [MAX_IGNORED] unlocks of being
 *     ignored, while that app has a notification waiting, or for [MUTE_MS] after a dismiss.
 *
 * Everything stays in this app's private storage. Places are stored as a hashed network name
 * or a ~1 km grid cell, never as coordinates or an SSID.
 */
class AppPredictor(private val act: MainActivity) {

    /** One episode: [t] its first open, [d] first open to last close, [led] notification-led. */
    private class Episode(val pkg: String, val t: Long, var d: Long, val led: Boolean, val place: String)

    /** A mined routine: [pkg] tends to be opened between [lo] and [hi] minutes past midnight. */
    private class Routine(
        val pkg: String, val lo: Int, val hi: Int,
        val hitDays: Set<Int>, val places: Map<String, Int>, val lift: Double
    ) {
        val key get() = "$pkg@$lo"
    }

    private val episodes = ArrayList<Episode>()
    /** Local day numbers the phone was actually used on — the denominator of every support. */
    private val days = java.util.TreeSet<Int>()
    /** Recent notification times per package, so a session can tell it was answering one. A
     *  list, not the latest: messages arriving mid-chat must not hide the one that opened it. */
    private val lastNotif = HashMap<String, ArrayList<Long>>()
    /** (time, place) samples taken whenever the launcher looks; episodes borrow the nearest. */
    private val placeLog = ArrayList<Pair<Long, String>>()
    /** Routine key -> muted until (ms). Set by a dismiss or by being ignored for weeks. */
    private val muted = HashMap<String, Long>()
    /** Routine key -> [shown, accepted], decayed; what the user thinks of each routine. */
    private val verdict = HashMap<String, DoubleArray>()
    /** Routine key -> unlocks ignored today, as "day:count". Transient by nature. */
    private val ignoredToday = HashMap<String, Int>()
    private var ignoredDay = -1

    @Volatile private var routines: List<Routine> = emptyList()
    private class Shown(val pkg: String, val key: String, val at: Long) { var accepted = false }
    @Volatile private var lastShown: Shown? = null

    @Volatile private var lastEventTs = 0L
    @Volatile private var recordedUpTo = 0L
    @Volatile private var loaded = false
    @Volatile private var lastRefresh = 0L
    @Volatile private var lastDecayDay = 0

    private val file: File get() = File(act.filesDir, "routines.json")
    private val legacyFile: File get() = File(act.filesDir, "appmodel.json")
    private val lock = Any()
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
     * Folds new usage events in and re-mines the routines. Cheap enough to call on every
     * return to the home screen: a no-op inside [minGapMs], and the miner walks a few hundred
     * episodes, not raw events.
     */
    fun refresh(minGapMs: Long = 5 * 60_000L) {
        val now = System.currentTimeMillis()
        if (now - lastRefresh < minGapMs) return
        lastRefresh = now
        try {
            ensureLoaded()
            synchronized(lock) {
                samplePlace(now)
                if (hasUsageAccess()) ingestUsageEvents(now)
                prune(now)
                decayIfNeeded(now)
                routines = mine(now)
            }
            save()
            android.util.Log.d(TAG, "refresh: ${episodes.size} episodes, ${days.size} days, " +
                "routines=${routines.joinToString { "${it.pkg}@${hhmm(it.lo)}-${hhmm(it.hi)}(${it.hitDays.size}d)" }}")
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
        val since = if (lastEventTs > 0) lastEventTs + 1 else now - BACKFILL_MS
        if (since >= now) return

        val events = usm.queryEvents(since, now)
        val ev = UsageEvents.Event()
        // A package can only be foregrounded once at a time, so one open timestamp per package
        // is enough to pair RESUMED with the PAUSED that closes it.
        val open = HashMap<String, Long>()
        var maxTs = lastEventTs

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
                    // The query window deliberately overlaps the previous one, so a session
                    // already folded in must not be counted twice. Sessions close in stream
                    // order, so one high-water end timestamp is enough.
                    if (ev.timeStamp <= recordedUpTo) continue
                    recordedUpTo = ev.timeStamp
                    record(pkg, startedAt, dur)
                }
                // Hidden constant: NOTIFICATION_INTERRUPTION. Delivered to usage-access holders
                // with the channel obfuscated, which is fine — only the package matters here.
                EVENT_NOTIFICATION_INTERRUPTION -> lastNotif.getOrPut(pkg) { ArrayList() }.let {
                    it.add(ev.timeStamp)
                    if (it.size > NOTIF_KEEP) it.removeAt(0)
                }
            }
        }
        // Whatever is still foreground at the end of the window has no PAUSED yet; keep the
        // watermark behind its RESUMED so the pair can complete on a later pass. Also hold it
        // back from the present, because the system flushes other apps' events late.
        val earliestOpen = open.values.minOrNull()
        var next = if (earliestOpen != null) minOf(maxTs, earliestOpen - 1) else maxTs
        next = minOf(next, now - EVENT_LAG_MS)
        if (next > lastEventTs) lastEventTs = next
    }

    /**
     * The own-log fallback, called from [Bridge.launch]. It is also the one exact, immediate
     * signal that a shown suggestion was taken, so it grades that even when UsageStats owns
     * the counting.
     */
    fun noteLaunch(pkg: String) {
        if (ignored(pkg)) return
        try {
            ensureLoaded()
            val now = System.currentTimeMillis()
            synchronized(lock) {
                accept(pkg, now)
                if (!hasUsageAccess()) { samplePlace(now); record(pkg, now, ASSUMED_SESSION_MS) }
            }
            saveAsync()
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "noteLaunch failed: ${e.message}")
        }
    }

    /** One session, folded into the episode stream. Caller holds [lock]. */
    private fun record(pkg: String, startedAt: Long, durationMs: Long) {
        accept(pkg, startedAt)
        days.add(dayOf(startedAt))
        if (durationMs < MIN_DWELL_MS) return
        // Fold into the open episode for this app if it is recent enough. Scanning back from
        // the end is short: the list is time-ordered and only the last few hours can match.
        for (i in episodes.indices.reversed()) {
            val e = episodes[i]
            if (startedAt - (e.t + e.d) > EPISODE_GAP_MS) break
            if (e.pkg == pkg) {
                e.d = maxOf(e.d, startedAt + durationMs - e.t)
                return
            }
        }
        val led = lastNotif[pkg]?.any { it in (startedAt - NOTIF_LEAD_MS)..startedAt } == true
        episodes.add(Episode(pkg, startedAt, durationMs, led, placeAt(startedAt)))
    }

    // ---- place --------------------------------------------------------------------------------

    /**
     * Where the phone is right now, as a short opaque key: the Wi-Fi network if on one (hashed —
     * the name itself is never stored), else a ~1 km grid cell from the last fix if it is
     * fresh, else "" for unknown. Passive only: the last known location costs no battery.
     */
    private fun currentPlace(now: Long): String {
        val st = try { act.status.last } catch (e: Throwable) { null }
        val ssid = st?.optString("ssid", "") ?: ""
        if (ssid.isNotEmpty()) return "w" + Integer.toHexString(ssid.hashCode())
        if (ContextCompat.checkSelfPermission(act, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return ""
        return try {
            val lm = act.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val fix = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
                .mapNotNull { try { lm.getLastKnownLocation(it) } catch (e: SecurityException) { null } }
                .maxByOrNull { it.time } ?: return ""
            if (now - fix.time > PLACE_FIX_MAX_AGE_MS) return ""
            "g" + (fix.latitude * CELL_PER_DEG).roundToInt() + "," + (fix.longitude * CELL_PER_DEG).roundToInt()
        } catch (e: Throwable) { "" }
    }

    private fun samplePlace(now: Long) {
        val p = currentPlace(now)
        if (p.isEmpty()) return
        val last = placeLog.lastOrNull()
        if (last != null && last.second == p && now - last.first < PLACE_SAMPLE_MS) return
        placeLog.add(now to p)
    }

    /** Nearest place sample to [t], or "" if none is close enough to vouch for it. */
    private fun placeAt(t: Long): String {
        var best = ""; var bestDt = PLACE_MATCH_MS
        for ((ts, p) in placeLog) {
            val dt = kotlin.math.abs(ts - t)
            if (dt <= bestDt) { bestDt = dt; best = p }
        }
        return best
    }

    // ---- mining -------------------------------------------------------------------------------

    /** Re-derives every routine from the episode log. Caller holds [lock]. */
    private fun mine(now: Long): List<Routine> {
        val from = dayOf(now) - MINE_DAYS
        val obs = days.filter { it >= from }
        if (obs.size < MIN_DAYS) return emptyList()
        val byPkg = HashMap<String, MutableList<Episode>>()
        for (e in episodes) if (!e.led && dayOf(e.t) >= from) byPkg.getOrPut(e.pkg) { ArrayList() }.add(e)

        val out = ArrayList<Routine>()
        for ((pkg, eps) in byPkg) {
            if (eps.size < MIN_DAYS || neverSuggest(pkg) || isAmbient(eps, obs.size)) continue
            // Per 15-minute bin, the days with an episode starting there — smeared one bin
            // either side, since a habit sits in a window, not on a clock edge.
            val bins = Array(BINS) { HashSet<Int>() }
            for (e in eps) {
                val b = minuteOf(e.t) / BIN_MIN
                val d = dayOf(e.t)
                for (k in -1..1) bins[(b + k + BINS) % BINS].add(d)
            }
            val used = BooleanArray(BINS)
            for (b in (0 until BINS).sortedByDescending { bins[it].size }) {
                if (used[b] || bins[b].size < 2) continue
                var lo = b; var hi = b
                val floor = maxOf(2.0, GROW_FRACTION * bins[b].size)
                while (hi - lo + 1 < MAX_WINDOW_BINS) {
                    val l = lo - 1; val h = hi + 1
                    val okL = l >= 0 && !used[l] && bins[l].size >= floor
                    val okH = h < BINS && !used[h] && bins[h].size >= floor
                    if (!okL && !okH) break
                    if (okL && (!okH || bins[l].size >= bins[h].size)) lo = l else hi = h
                }
                for (k in maxOf(0, lo - 2)..minOf(BINS - 1, hi + 2)) used[k] = true
                val loM = lo * BIN_MIN; val hiM = (hi + 1) * BIN_MIN
                val inWin = eps.filter { minuteOf(it.t) in loM until hiM }
                val hitDays = inWin.map { dayOf(it.t) }.toSet()
                if (hitDays.size < MIN_DAYS) continue
                val lift = (inWin.size.toDouble() / (hi - lo + 1)) / (eps.size.toDouble() / BINS)
                if (lift < MIN_LIFT) continue
                val places = HashMap<String, Int>()
                for (e in inWin) if (e.place.isNotEmpty()) places[e.place] = (places[e.place] ?: 0) + 1
                out.add(Routine(pkg, loM, hiM, hitDays, places, lift))
            }
        }
        return out
    }

    /**
     * Used on most days, spread across most of each day: a habit, not a routine. Suggesting it
     * is noise at best and a nudge to open it at worst.
     */
    private fun isAmbient(eps: List<Episode>, obsDays: Int): Boolean {
        val blocks = HashMap<Int, HashSet<Int>>()
        for (e in eps) blocks.getOrPut(dayOf(e.t)) { HashSet() }.add(minuteOf(e.t) / 120)
        if (blocks.size < AMBIENT_DAY_SHARE * obsDays) return false
        return blocks.values.sumOf { it.size }.toDouble() / blocks.size >= AMBIENT_BLOCKS
    }

    /** Feeds and system plumbing: never worth an unprompted offer, whatever the counts say. */
    private fun neverSuggest(pkg: String): Boolean {
        if (pkg in NEVER) return true
        if (Build.VERSION.SDK_INT < 26) return false
        return try {
            when (act.packageManager.getApplicationInfo(pkg, 0).category) {
                ApplicationInfo.CATEGORY_SOCIAL, ApplicationInfo.CATEGORY_VIDEO,
                ApplicationInfo.CATEGORY_GAME, ApplicationInfo.CATEGORY_NEWS -> true
                else -> false
            }
        } catch (e: Throwable) { false }
    }

    // ---- prediction -------------------------------------------------------------------------

    /**
     * The suggestion for right now, as JSON for the UI, or `{}` — the normal answer. Only a
     * live routine with enough support is ever named.
     */
    fun predict(): String {
        return try {
            ensureLoaded()
            val best = synchronized(lock) { bestRoutine(System.currentTimeMillis()) }
            android.util.Log.d(TAG, if (best == null) "quiet (routines=${routines.size})"
                       else "suggest ${best.first.pkg} window=${hhmm(best.first.lo)}-${hhmm(best.first.hi)} support=${"%.2f".format(best.second)}")
            if (best == null) return "{}"
            val r = best.first
            JSONObject()
                .put("pkg", r.pkg)
                .put("label", act.bridge.labelFor(r.pkg) ?: return "{}")
                .put("score", best.second)
                .put("until", hhmm(r.hi))
                .put("icon", IconDots.encode(act, r.pkg, ICON_DOTS))
                .toString()
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "predict failed: ${e.message}")
            "{}"
        }
    }

    private fun bestRoutine(now: Long): Pair<Routine, Double>? {
        val today = dayOf(now)
        val minute = minuteOf(now)
        val here = currentPlace(now)
        val waiting = MediaListenerService.notifPkgs
        val obs = days.filter { it >= today - MINE_DAYS && it != today }
        var best: Pair<Routine, Double>? = null
        for (r in routines) {
            if (minute < r.lo - LEAD_MIN || minute >= r.hi) continue
            if ((muted[r.key] ?: 0L) > now) continue
            if (ignoredOn(today, r.key) >= MAX_IGNORED) continue
            // The shade is already offering it; a second offer is just a second nudge.
            if (r.pkg in waiting) continue
            if (act.bridge.labelFor(r.pkg) == null || ignored(r.pkg)) continue
            // Done it already in this window today: the routine is satisfied.
            if (episodes.any { it.pkg == r.pkg && dayOf(it.t) == today && minuteOf(it.t) >= r.lo - LEAD_MIN && minuteOf(it.t) < r.hi }) continue
            var s = support(r, today, obs)
            s *= placeFactor(r, here)
            if (s < SHOW_MIN) continue
            if (best == null || s > best.second) best = r to s
        }
        return best
    }

    /**
     * Share of comparable days the routine fired on. The same weekday is the sharpest context
     * — office days and home days differ more than any hour does — but takes weeks to fill, so
     * it is shrunk toward the weekday/weekend rate until it has, and both carry a pseudo-count
     * so three days of evidence cannot claim certainty.
     */
    private fun support(r: Routine, today: Int, obs: List<Int>): Double {
        val wd = weekdayOf(today)
        val weekend = wd >= 5
        val sameType = obs.filter { (weekdayOf(it) >= 5) == weekend }
        if (sameType.isEmpty()) return 0.0
        val hitsType = r.hitDays.count { (weekdayOf(it) >= 5) == weekend }
        val sType = hitsType / (sameType.size + PRIOR_DAYS)
        val sameWd = obs.count { weekdayOf(it) == wd }
        val hitsWd = r.hitDays.count { weekdayOf(it) == wd }
        return (hitsWd + WEEKDAY_SHRINK * sType) / (sameWd + WEEKDAY_SHRINK)
    }

    /**
     * Place as a gate, once the routine has enough placed evidence to have one. Somewhere it
     * has never happened mostly vetoes it — the evening ride home is not needed from home —
     * and its usual place lends a little confidence. Unknown place is neutral.
     */
    private fun placeFactor(r: Routine, here: String): Double {
        val total = r.places.values.sum()
        if (here.isEmpty() || total < MIN_PLACED) return 1.0
        val share = (r.places[here] ?: 0).toDouble() / total
        return when {
            share == 0.0 -> PLACE_VETO
            share >= 0.5 -> PLACE_BOOST
            else -> 1.0
        }
    }

    // ---- feedback ---------------------------------------------------------------------------

    /**
     * The UI actually put [pkg] on screen. Called once per offer (an unlock or a return home),
     * not per refresh, so "ignored" means a real look that was passed over.
     */
    fun noteShown(pkg: String) {
        try {
            ensureLoaded()
            val now = System.currentTimeMillis()
            synchronized(lock) {
                val r = routines.firstOrNull { it.pkg == pkg && minuteOf(now) in (it.lo - LEAD_MIN) until it.hi } ?: return
                val prev = lastShown
                if (prev != null && !prev.accepted && now - prev.at > ACCEPT_WINDOW_MS) passOver(prev, now)
                if (prev != null && prev.key == r.key && !prev.accepted && now - prev.at <= ACCEPT_WINDOW_MS) return
                lastShown = Shown(pkg, r.key, now)
                val v = verdict.getOrPut(r.key) { DoubleArray(2) }
                v[0] += 1.0
            }
            saveAsync()
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "noteShown failed: ${e.message}")
        }
    }

    /** Double-tap on the suggestion: not wanted. Mutes that routine, not the app. */
    fun dismiss(pkg: String) {
        try {
            ensureLoaded()
            val now = System.currentTimeMillis()
            synchronized(lock) {
                val key = lastShown?.takeIf { it.pkg == pkg }?.key
                    ?: routines.firstOrNull { it.pkg == pkg && minuteOf(now) in (it.lo - LEAD_MIN) until it.hi }?.key
                    ?: return
                muted[key] = now + MUTE_MS
                lastShown = null
            }
            saveAsync()
        } catch (e: Throwable) {}
    }

    private fun accept(pkg: String, at: Long) {
        val s = lastShown ?: return
        if (s.accepted || s.pkg != pkg || at < s.at || at - s.at > ACCEPT_WINDOW_MS) return
        s.accepted = true
        verdict.getOrPut(s.key) { DoubleArray(2) }[1] += 1.0
    }

    private fun passOver(s: Shown, now: Long) {
        val today = dayOf(now)
        ignoredOn(today, s.key)
        ignoredToday[s.key] = (ignoredToday[s.key] ?: 0) + 1
        // Ignored for weeks: this window is not one you want offered, whatever the counts say.
        val v = verdict[s.key] ?: return
        if (v[0] >= MUTE_AFTER_SHOWN && v[1] / v[0] < MUTE_BELOW_RATE) {
            muted[s.key] = now + MUTE_MS
            v[0] = 0.0; v[1] = 0.0
        }
    }

    private fun ignoredOn(today: Int, key: String): Int {
        if (ignoredDay != today) { ignoredToday.clear(); ignoredDay = today }
        return ignoredToday[key] ?: 0
    }

    // ---- housekeeping -------------------------------------------------------------------------

    private fun prune(now: Long) {
        val cutoff = now - KEEP_MS
        episodes.removeAll { it.t < cutoff }
        val dayCut = dayOf(cutoff)
        days.removeAll { it < dayCut }
        placeLog.removeAll { it.first < now - PLACE_LOG_MS }
        for (l in lastNotif.values) l.removeAll { it < now - NOTIF_LEAD_MS - EPISODE_GAP_MS }
        lastNotif.entries.removeAll { it.value.isEmpty() }
        muted.entries.removeAll { it.value < now }
    }

    /** Verdicts fade, so a routine you ignored last month gets another chance. */
    private fun decayIfNeeded(now: Long) {
        val day = dayOf(now)
        if (lastDecayDay == 0) { lastDecayDay = day; return }
        val n = day - lastDecayDay
        if (n <= 0) return
        val f = Math.pow(VERDICT_DECAY, n.toDouble())
        for (v in verdict.values) { v[0] *= f; v[1] *= f }
        verdict.entries.removeAll { it.value[0] < 0.05 }
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

    // Local calendar. Day numbers are local, not UTC, so "today" turns over at your midnight.
    private fun localMs(ms: Long) = ms + TimeZone.getDefault().getOffset(ms)
    private fun dayOf(ms: Long): Int = localMs(ms).floorDiv(86_400_000L).toInt()
    private fun minuteOf(ms: Long): Int = (localMs(ms).mod(86_400_000L) / 60_000L).toInt()
    /** 0 = Monday .. 6 = Sunday. Day 0 of the epoch was a Thursday. */
    private fun weekdayOf(day: Int): Int = (day + 3).mod(7)
    private fun hhmm(m: Int) = "%02d:%02d".format((m / 60) % 24, m % 60)

    // ---- persistence ---------------------------------------------------------------------------

    private fun ensureLoaded() {
        synchronized(lock) {
            if (loaded) return
            loaded = true
            // The frequency model's file is useless to this one; it only wastes storage.
            try { if (legacyFile.exists()) legacyFile.delete() } catch (e: Throwable) {}
            val f = file
            if (!f.exists()) return
            try {
                val root = JSONObject(f.readText())
                if (root.optInt("v", 0) != FORMAT) return
                lastEventTs = root.optLong("lastEventTs", 0L)
                recordedUpTo = root.optLong("recordedUpTo", 0L)
                lastDecayDay = root.optInt("lastDecayDay", 0)
                val ep = root.optJSONArray("eps") ?: JSONArray()
                for (i in 0 until ep.length()) {
                    val a = ep.getJSONArray(i)
                    episodes.add(Episode(a.getString(0), a.getLong(1), a.getLong(2), a.getInt(3) == 1, a.optString(4, "")))
                }
                val ds = root.optJSONArray("days") ?: JSONArray()
                for (i in 0 until ds.length()) days.add(ds.getInt(i))
                val ln = root.optJSONObject("notif") ?: JSONObject()
                for (k in ln.keys()) {
                    val a = ln.optJSONArray(k) ?: continue
                    lastNotif[k] = ArrayList<Long>().apply { for (i in 0 until a.length()) add(a.getLong(i)) }
                }
                val pl = root.optJSONArray("places") ?: JSONArray()
                for (i in 0 until pl.length()) { val a = pl.getJSONArray(i); placeLog.add(a.getLong(0) to a.getString(1)) }
                val mu = root.optJSONObject("muted") ?: JSONObject()
                for (k in mu.keys()) muted[k] = mu.getLong(k)
                val vd = root.optJSONObject("verdict") ?: JSONObject()
                for (k in vd.keys()) { val a = vd.getJSONArray(k); verdict[k] = doubleArrayOf(a.getDouble(0), a.getDouble(1)) }
                routines = mine(System.currentTimeMillis())
            } catch (e: Throwable) {
                // A corrupt model is not worth a crash or a migration path — start over.
                android.util.Log.w(TAG, "model unreadable, starting fresh: ${e.message}")
                episodes.clear(); days.clear(); lastEventTs = 0L; recordedUpTo = 0L
            }
        }
    }

    private fun save() {
        try {
            val text = synchronized(lock) {
                val ep = JSONArray()
                for (e in episodes) ep.put(JSONArray().put(e.pkg).put(e.t).put(e.d).put(if (e.led) 1 else 0).put(e.place))
                val ln = JSONObject(); for ((k, v) in lastNotif) ln.put(k, JSONArray(v))
                val pl = JSONArray(); for ((t, p) in placeLog) pl.put(JSONArray().put(t).put(p))
                val mu = JSONObject(); for ((k, v) in muted) mu.put(k, v)
                val vd = JSONObject(); for ((k, v) in verdict) vd.put(k, JSONArray().put(v[0]).put(v[1]))
                JSONObject()
                    .put("v", FORMAT)
                    .put("lastEventTs", lastEventTs)
                    .put("recordedUpTo", recordedUpTo)
                    .put("lastDecayDay", lastDecayDay)
                    .put("eps", ep).put("days", JSONArray(days.toList()))
                    .put("notif", ln).put("places", pl).put("muted", mu).put("verdict", vd)
                    .toString()
            }
            file.writeText(text)
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "save failed: ${e.message}")
        }
    }

    /** Settings "forget everything" — the model is behavioural data, so this has to exist. */
    fun clear() {
        synchronized(lock) {
            episodes.clear(); days.clear(); lastNotif.clear(); placeLog.clear()
            muted.clear(); verdict.clear(); ignoredToday.clear()
            routines = emptyList(); lastShown = null
            lastEventTs = 0L; recordedUpTo = 0L; lastDecayDay = 0
        }
        try { file.delete(); legacyFile.delete() } catch (e: Throwable) {}
    }

    companion object {
        private const val TAG = "ZrnPredict"
        private const val FORMAT = 2
        private const val ICON_DOTS = 20
        /** UsageEvents.Event.NOTIFICATION_INTERRUPTION, which is @hide. */
        private const val EVENT_NOTIFICATION_INTERRUPTION = 12

        // Preprocessing.
        private const val MIN_DWELL_MS = 5_000L              // shorter is a misfire or pass-through
        private const val EPISODE_GAP_MS = 30 * 60_000L      // re-opens inside this are one episode
        private const val NOTIF_LEAD_MS = 10 * 60_000L       // opened this soon after its notification
        private const val NOTIF_KEEP = 16
        private const val ASSUMED_SESSION_MS = 60_000L       // own-log fallback, duration unobservable
        private const val BACKFILL_MS = 30L * 24 * 3600_000L
        private const val EVENT_LAG_MS = 60_000L
        private const val KEEP_MS = 56L * 24 * 3600_000L     // eight weeks of episodes

        // Mining. Thresholds tuned on the device's own ten days: looser let one-off camera and
        // authenticator coincidences through, tighter lost the commute.
        private const val MINE_DAYS = 42
        private const val BIN_MIN = 15
        private const val BINS = 1440 / BIN_MIN
        private const val MAX_WINDOW_BINS = 12               // three hours
        private const val GROW_FRACTION = 0.6
        private const val MIN_DAYS = 3
        private const val MIN_LIFT = 4.0
        private const val AMBIENT_DAY_SHARE = 0.7
        private const val AMBIENT_BLOCKS = 3.0               // distinct 2h blocks per active day

        // Showing.
        private const val LEAD_MIN = 30                      // offer this long before the window
        private const val SHOW_MIN = 0.40
        private const val PRIOR_DAYS = 2.0
        private const val WEEKDAY_SHRINK = 2.0
        private const val MAX_IGNORED = 2
        private const val ACCEPT_WINDOW_MS = 3 * 60_000L
        private const val MUTE_MS = 14L * 24 * 3600_000L
        private const val MUTE_AFTER_SHOWN = 6.0
        private const val MUTE_BELOW_RATE = 0.15
        private const val VERDICT_DECAY = 0.97

        // Place.
        private const val CELL_PER_DEG = 100.0               // ~1.1 km cells
        private const val PLACE_FIX_MAX_AGE_MS = 30 * 60_000L
        private const val PLACE_SAMPLE_MS = 10 * 60_000L
        private const val PLACE_MATCH_MS = 20 * 60_000L
        private const val PLACE_LOG_MS = 2L * 24 * 3600_000L
        private const val MIN_PLACED = 3
        private const val PLACE_VETO = 0.3
        private const val PLACE_BOOST = 1.2

        private val NEVER = setOf(
            "com.android.settings", "com.google.android.packageinstaller",
            "com.google.android.permissioncontroller", "com.android.vending",
            "com.google.android.documentsui", "com.google.android.gms"
        )
    }
}

package lab.zerone.launcher

import android.app.ActivityManager
import android.app.AlarmManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.PlaybackState
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Locale

/** Battery, charging, Wi-Fi, Bluetooth, mobile data, CPU, RAM, media playback, headphones, signal and next alarm → JSON for the UI. */
class StatusMonitor(private val ctx: Context, private val emit: (String) -> Unit) {

    private val main = Handler(Looper.getMainLooper())
    private val cm = (ContextCompat.getSystemService(ctx, ConnectivityManager::class.java)
        ?: ctx.getSystemService(Context.CONNECTIVITY_SERVICE)) as ConnectivityManager
    private val audio = (ContextCompat.getSystemService(ctx, AudioManager::class.java)
        ?: ctx.getSystemService(Context.AUDIO_SERVICE)) as AudioManager
    private val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    private var running = false
    private var wifi = false
    private var cellular = false

    private var lastTotalTicks = 0L
    private var lastIdleTicks = 0L
    private var cachedCpu = 18
    private var gpuNodeUnavailable = false

    private var lastTrack = ""
    private var lastArtist = ""
    private var lastPlaying = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = push()
    }
    private val mediaReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val track = i.getStringExtra("track") ?: i.getStringExtra("trackName") ?: i.getStringExtra("song")
            val artist = i.getStringExtra("artist") ?: i.getStringExtra("artistName")
            val playing = i.getBooleanExtra("playing", false) || i.getBooleanExtra("playstate", false)
            if (!track.isNullOrBlank()) lastTrack = track
            if (!artist.isNullOrBlank()) lastArtist = artist
            lastPlaying = playing
            push()
        }
    }

    private val net = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) {
            wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            main.post { push() }
        }
        override fun onLost(n: Network) {
            wifi = false
            cellular = false
            main.post { push() }
        }
    }
    private val audioCb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(d: Array<out AudioDeviceInfo>) = push()
        override fun onAudioDevicesRemoved(d: Array<out AudioDeviceInfo>) = push()
    }
    private val poll = object : Runnable {
        override fun run() {
            push()
            if (running) main.postDelayed(this, 2_000)
        }
    }

    fun start() {
        if (running) return
        running = true
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED)
        }
        ContextCompat.registerReceiver(ctx, receiver, f, ContextCompat.RECEIVER_NOT_EXPORTED)

        val mf = IntentFilter().apply {
            addAction("com.android.music.metachanged")
            addAction("com.android.music.playstatechanged")
            addAction("com.spotify.music.metadatachanged")
            addAction("com.spotify.music.playbackstatechanged")
            addAction("com.htc.music.metachanged")
            addAction("fm.last.android.metachanged")
            addAction("com.sec.android.app.music.metachanged")
            addAction("com.nullsoft.winamp.metachanged")
            addAction("com.amazon.mp3.metachanged")
            addAction("com.miui.player.metachanged")
            addAction("com.real.IMP.metachanged")
            addAction("com.sonyericsson.music.metachanged")
            addAction("com.rdio.android.metachanged")
            addAction("com.samsung.sec.android.MusicPlayer.metachanged")
            addAction("com.andrew.apollo.metachanged")
        }
        try {
            ContextCompat.registerReceiver(ctx, mediaReceiver, mf, ContextCompat.RECEIVER_EXPORTED)
        } catch (_: Exception) {}

        try {
            // registerDefaultNetworkCallback is API 24; on Marshmallow ask for the internet
            // capability explicitly instead.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                cm.registerDefaultNetworkCallback(net)
            } else {
                val req = android.net.NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                cm.registerNetworkCallback(req, net)
            }
        } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audio.registerAudioDeviceCallback(audioCb, main)
        }
        main.post(poll)
    }

    fun stop() {
        if (!running) return
        running = false
        try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}
        try { ctx.unregisterReceiver(mediaReceiver) } catch (_: Exception) {}
        try { cm.unregisterNetworkCallback(net) } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try { audio.unregisterAudioDeviceCallback(audioCb) } catch (_: Exception) {}
        }
        main.removeCallbacks(poll)
    }

    fun push() {
        val o = JSONObject()
        ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.let { b ->
            val level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            val plug = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
            val st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            o.put("batt", if (level >= 0) level * 100 / scale else 100)
            o.put("charging", plug != 0 || st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL)
        }
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val onWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true || wifi
        val onCellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true || cellular
        o.put("wifi", onWifi)
        o.put("data", onCellular)
        o.put("ssid", if (onWifi) ssid() else "")
        o.put("bt", try {
            val bm = ContextCompat.getSystemService(ctx, BluetoothManager::class.java)
                ?: (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
            bm?.adapter?.isEnabled ?: BluetoothAdapter.getDefaultAdapter()?.isEnabled ?: false
        } catch (_: SecurityException) { false })

        val hasHeadphones = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val outs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            val phones = mutableSetOf(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_USB_HEADSET)
            if (Build.VERSION.SDK_INT >= 31) phones += AudioDeviceInfo.TYPE_BLE_HEADSET
            outs.any { it.type in phones }
        } else {
            @Suppress("DEPRECATION")
            audio.isWiredHeadsetOn || audio.isBluetoothA2dpOn
        }
        o.put("audio", hasHeadphones)
        o.put("btAudio", btRouted())
        o.put("loc", Radios.isLocOn(ctx))      // drives the quick-settings grid
        o.put("signal", signal())
        o.put("alarm", (ContextCompat.getSystemService(ctx, AlarmManager::class.java)
            ?: (ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager))?.nextAlarmClock?.let {
            SimpleDateFormat("HH:mm", Locale.US).format(it.triggerTime)
        } ?: "")

        // System telemetry: RAM and CPU
        o.put("ram", sampleRam())
        o.put("cpu", sampleCpu())
        sampleGpu()?.let { o.put("gpu", it) }

        // Media playback and metadata
        var track = lastTrack
        var artist = lastArtist
        val controller = MediaListenerService.getActiveController(ctx)
        val isMusicActive = audio.isMusicActive
        var isPlaying = isMusicActive || lastPlaying

        if (controller != null) {
            val meta = controller.metadata
            if (meta != null) {
                val t = meta.getString(MediaMetadata.METADATA_KEY_TITLE)
                val a = meta.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: meta.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
                if (!t.isNullOrBlank()) track = t
                if (!a.isNullOrBlank()) artist = a
            }
            val state = controller.playbackState?.state
            if (state == PlaybackState.STATE_PLAYING) {
                isPlaying = true
            } else if (state == PlaybackState.STATE_PAUSED || state == PlaybackState.STATE_STOPPED) {
                if (!isMusicActive) isPlaying = false
            }
        }
        if (isPlaying && track.isBlank()) track = "NOW PLAYING"
        o.put("playing", isPlaying)
        o.put("track", track)
        o.put("artist", artist)
        // Packages with something waiting, so the dock can blink the tile that owns them.
        o.put("notif", org.json.JSONArray(MediaListenerService.notifPkgs.toList()))

        emit(o.toString())
    }

    /**
     * Is media audio actually routed out over Bluetooth right now? Not the same as the
     * adapter being on. This matters because with A2DP offload the Visualizer on the
     * output mix sees silence, so the UI has to show something other than the spectrum.
     */
    private fun btRouted(): Boolean {
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                val attrs = android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                val routed = audio.getAudioDevicesForAttributes(attrs)
                if (routed.isNotEmpty()) return routed.any { it.type in btOutputTypes }
            } catch (_: Throwable) {}
        }
        @Suppress("DEPRECATION")
        return try { audio.isBluetoothA2dpOn || audio.isBluetoothScoOn } catch (_: Throwable) { false }
    }

    private val btOutputTypes: Set<Int> by lazy {
        val s = mutableSetOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        )
        if (Build.VERSION.SDK_INT >= 31) {
            s += AudioDeviceInfo.TYPE_BLE_HEADSET
            s += AudioDeviceInfo.TYPE_BLE_SPEAKER
        }
        if (Build.VERSION.SDK_INT >= 33) s += AudioDeviceInfo.TYPE_BLE_BROADCAST
        s
    }

    private fun sampleRam(): Int = try {
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        val used = mi.totalMem - mi.availMem
        ((used.toDouble() / mi.totalMem) * 100).toInt().coerceIn(0, 100)
    } catch (_: Exception) { 50 }

    private fun sampleCpu(): Int {
        try {
            val file = RandomAccessFile("/proc/stat", "r")
            val line = file.readLine()
            file.close()
            if (line != null && line.startsWith("cpu ")) {
                val parts = line.trim().split("\\s+".toRegex())
                if (parts.size >= 5) {
                    val user = parts[1].toLong()
                    val nice = parts[2].toLong()
                    val sys = parts[3].toLong()
                    val idle = parts[4].toLong()
                    val iowait = if (parts.size > 5) parts[5].toLong() else 0L
                    val irq = if (parts.size > 6) parts[6].toLong() else 0L
                    val softirq = if (parts.size > 7) parts[7].toLong() else 0L
                    val total = user + nice + sys + idle + iowait + irq + softirq
                    val totalDiff = total - lastTotalTicks
                    val idleDiff = idle - lastIdleTicks
                    if (lastTotalTicks > 0 && totalDiff > 0) {
                        val pct = (((totalDiff - idleDiff).toDouble() / totalDiff) * 100).toInt()
                        cachedCpu = pct.coerceIn(5, 100)
                    }
                    lastTotalTicks = total
                    lastIdleTicks = idle
                    return cachedCpu
                }
            }
        } catch (_: Exception) {}

        // Fallback: frequency load across online CPU cores
        try {
            var sumCur = 0L
            var sumMax = 0L
            for (i in 0..15) {
                val curF = File("/sys/devices/system/cpu/cpu$i/cpufreq/scaling_cur_freq")
                val maxF = File("/sys/devices/system/cpu/cpu$i/cpufreq/cpuinfo_max_freq")
                if (!curF.exists() || !maxF.exists()) break
                val cur = curF.readText().trim().toLongOrNull() ?: 0L
                val max = maxF.readText().trim().toLongOrNull() ?: 0L
                if (max > 0) {
                    sumCur += cur
                    sumMax += max
                }
            }
            if (sumMax > 0) {
                cachedCpu = ((sumCur.toDouble() / sumMax) * 100).toInt().coerceIn(5, 100)
                return cachedCpu
            }
        } catch (_: Exception) {}

        return cachedCpu
    }

    /**
     * Vendor GPU counters, where the sandbox can reach them. On most devices SELinux
     * denies these sysfs nodes outright, so give up after the first miss instead of
     * generating an audit entry on every poll — the UI falls back to its own frame timing.
     */
    private fun sampleGpu(): Int? {
        if (gpuNodeUnavailable) return null
        for (path in GPU_NODES) {
            try {
                val f = File(path)
                if (f.exists()) {
                    val txt = f.readText().trim().removeSuffix("%").trim().substringBefore(' ')
                    txt.toIntOrNull()?.let { return it.coerceIn(0, 100) }
                }
            } catch (_: Throwable) {}
        }
        gpuNodeUnavailable = true
        return null
    }

    private fun signal(): Int = try {
        if (Build.VERSION.SDK_INT >= 28) {
            (ContextCompat.getSystemService(ctx, TelephonyManager::class.java)
                ?: (ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager))?.signalStrength?.level ?: 0
        } else 3
    } catch (_: Exception) { 0 }

    private companion object {
        val GPU_NODES = listOf(
            "/sys/class/kgsl/kgsl-3d0/gpu_busy_percentage",   // Adreno
            "/sys/class/misc/mali0/device/utilization",       // Mali
            "/sys/devices/platform/mali/utilization"
        )
    }

    @Suppress("DEPRECATION")
    private fun ssid(): String = try {
        val s = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo?.ssid ?: ""
        if (s.contains("unknown")) "" else s.trim('"')
    } catch (_: Exception) { "" }
}

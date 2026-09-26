package lab.zerone.launcher

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Real audio. A [Visualizer] on session 0 taps the global output mix; its FFT is folded into
 * [BANDS] log-spaced magnitudes, level-tracked (fast attack / slow release) and pushed to the
 * dot-matrix waveform through `ZL.onAudio`.
 *
 * Needs RECORD_AUDIO — without it the UI falls back to its synthetic wave.
 */
class AudioCapture(private val ctx: Context, private val emit: (String) -> Unit) {

    private val main = Handler(Looper.getMainLooper())
    private var vis: Visualizer? = null
    private var running = false

    private val raw = FloatArray(BANDS)
    private val level = FloatArray(BANDS)
    private var agc = AGC_FLOOR
    private var lastEmit = 0L
    private var quietFrames = 0

    val hasPermission: Boolean
        get() = ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** True once a Visualizer is actually running on the output mix. */
    var live = false
        private set

    fun start() {
        if (running) return
        if (!hasPermission) { live = false; Log.w(TAG, "no RECORD_AUDIO"); emitOffline("PERM"); return }
        try {
            val range = Visualizer.getCaptureSizeRange()
            val v = Visualizer(0)
            v.captureSize = CAPTURE.coerceIn(range[0], range[1])
            try { v.scalingMode = Visualizer.SCALING_MODE_AS_PLAYED } catch (_: Throwable) {}
            val rate = min(Visualizer.getMaxCaptureRate(), 25_000)
            v.setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
                override fun onWaveFormDataCapture(vz: Visualizer, wave: ByteArray, sr: Int) {}
                override fun onFftDataCapture(vz: Visualizer, fft: ByteArray, sr: Int) = onFft(fft)
            }, rate, false, true)
            v.enabled = true
            vis = v
            running = true
            live = true
            Log.i(TAG, "output-mix tap live: captureSize=${v.captureSize} rate=${rate}mHz")
        } catch (e: Throwable) {
            // Visualizer is refused on some OEM builds and on devices with no audio HAL effect slot.
            live = false
            release()
            Log.w(TAG, "output-mix tap unavailable: ${e.javaClass.simpleName}: ${e.message}")
            emitOffline("UNAVAILABLE")
        }
    }

    fun stop() {
        if (!running) return
        running = false
        live = false
        release()
        agc = AGC_FLOOR
        java.util.Arrays.fill(level, 0f)
        emitOffline("IDLE")
    }

    private fun release() {
        try { vis?.enabled = false } catch (_: Throwable) {}
        try { vis?.release() } catch (_: Throwable) {}
        vis = null
    }

    /**
     * fft layout (see [Visualizer.getFft]): [0] = DC real, [1] = Nyquist real,
     * then interleaved (real, imaginary) pairs for bins 1 .. n/2-1.
     */
    private fun onFft(fft: ByteArray) {
        if (!running) return
        val n = fft.size
        if (n < 16) return
        val bins = n / 2

        var frameMax = 0f
        for (b in 0 until BANDS) {
            val lo = binAt(b, bins)
            val hi = max(lo + 1, binAt(b + 1, bins))
            var sum = 0f
            var count = 0
            var k = lo
            while (k < hi && k < bins) {
                val re = fft[2 * k].toFloat()
                val im = fft[2 * k + 1].toFloat()
                sum += hypot(re, im)
                count++
                k++
            }
            // Measured on device: bass hit 90-99 while mids/treble sat flat at 25-45.
            // Tilt hard so the upper bands actually use their range.
            val tilt = 1f + 3.0f * (b.toFloat() / BANDS).toDouble().pow(1.3).toFloat()
            val m = (if (count > 0) sum / count else 0f) * tilt
            raw[b] = m
            if (m > frameMax) frameMax = m
        }

        // Auto gain: snap up to a new peak, bleed back down slowly so quiet passages still fill.
        agc = if (frameMax > agc) frameMax else agc * 0.94f + frameMax * 0.06f
        if (agc < AGC_FLOOR) agc = AGC_FLOOR

        val silent = frameMax < SILENCE
        quietFrames = if (silent) min(quietFrames + 1, 100) else 0

        var peak = 0f
        for (b in 0 until BANDS) {
            val target = if (silent) 0f else (raw[b] / agc).coerceIn(0f, 1f).toDouble().pow(0.62).toFloat()
            // fast attack, slow release
            level[b] = if (target > level[b]) target else level[b] * 0.70f + target * 0.30f
            if (level[b] > peak) peak = level[b]
        }

        val now = SystemClock.uptimeMillis()
        // Stop feeding the WebView once the wave has settled flat.
        if (quietFrames > 30 && peak < 0.02f) return
        if (now - lastEmit < MIN_GAP) return
        lastEmit = now

        val sb = StringBuilder(BANDS * 4 + 40)
        sb.append("{\"live\":true,\"b\":[")
        for (b in 0 until BANDS) {
            if (b > 0) sb.append(',')
            sb.append((level[b] * 100f).toInt().coerceIn(0, 100))
        }
        sb.append("],\"lvl\":").append((peak * 100f).toInt().coerceIn(0, 100)).append('}')
        val payload = sb.toString()
        main.post { emit(payload) }
    }

    private fun emitOffline(why: String) {
        val payload = "{\"live\":false,\"why\":\"$why\",\"b\":[],\"lvl\":0}"
        main.post { emit(payload) }
    }

    /** Log-spaced band edges, skipping the DC bin. */
    private fun binAt(band: Int, bins: Int): Int {
        val f = band.toFloat() / BANDS
        val top = (bins - 1).toFloat()
        return (1f + (top - 1f) * f.toDouble().pow(2.3).toFloat()).toInt().coerceIn(1, bins - 1)
    }

    companion object {
        private const val TAG = "ZrnAudio"
        const val BANDS = 22
        private const val CAPTURE = 1024
        private const val AGC_FLOOR = 7f
        private const val SILENCE = 1.2f
        private const val MIN_GAP = 40L          // ≈ 25 pushes/s into the WebView
    }
}

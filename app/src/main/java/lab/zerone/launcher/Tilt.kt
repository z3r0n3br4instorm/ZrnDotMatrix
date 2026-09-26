package lab.zerone.launcher

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.abs

/**
 * Device tilt for the RIGEL mark's parallax.
 *
 * Uses the accelerometer's gravity vector rather than the rotation vector: it exists on
 * every device back to API 23, costs far less power, and parallax only needs "which way is
 * the phone leaning", not a true orientation quaternion.
 *
 * Output is two numbers in roughly -1..1 (left/right, forward/back), heavily smoothed —
 * raw accelerometer data is noisy enough to make the rings jitter.
 */
class Tilt(private val ctx: Context, private val emit: (Float, Float) -> Unit) {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor: Sensor? = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private var running = false

    private var x = 0f
    private var y = 0f
    private var lastEmit = 0L
    private var lastX = 0f
    private var lastY = 0f

    val available: Boolean get() = sensor != null

    private val listener = object : SensorEventListener {
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        override fun onSensorChanged(e: SensorEvent) {
            // Gravity is ~9.81 on the axis pointing down; normalise to -1..1 and smooth.
            val nx = (e.values[0] / 9.81f).coerceIn(-1f, 1f)
            val ny = (e.values[1] / 9.81f).coerceIn(-1f, 1f)
            x += (nx - x) * SMOOTH
            y += (ny - y) * SMOOTH

            val now = SystemClock.uptimeMillis()
            if (now - lastEmit < MIN_GAP) return
            // Only wake the WebView when the tilt actually moved enough to shift a dot.
            if (abs(x - lastX) < EPS && abs(y - lastY) < EPS) return
            lastEmit = now; lastX = x; lastY = y
            emit(x, y)
        }
    }

    fun start() {
        if (running || sensor == null) return
        running = true
        sm?.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
    }

    fun stop() {
        if (!running) return
        running = false
        sm?.unregisterListener(listener)
    }

    private companion object {
        const val SMOOTH = 0.12f
        const val MIN_GAP = 33L      // ~30 Hz into the WebView is plenty for parallax
        const val EPS = 0.004f
    }
}

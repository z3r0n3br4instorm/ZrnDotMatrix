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
class Tilt(
    private val ctx: Context,
    private val emit: (Float, Float) -> Unit,
    private val onShake: ((Float) -> Unit)? = null
) {

    private val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor: Sensor? = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private var running = false

    private var x = 0f
    private var y = 0f
    private var lastEmit = 0L
    private var lastX = 0f
    private var lastY = 0f

    // Shake detection rides along on the same sensor stream the parallax already uses, so a
    // scene that triggers on shake costs no extra registration and no extra wakeups.
    private var shakeEnergy = 0f
    private var lastShake = 0L
    private var px = 0f
    private var py = 0f
    private var pz = 0f
    private var primed = false

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

            if (onShake != null) {
                // High-pass the raw vector: gravity is the slow part, a shake is the rest.
                val dx = e.values[0] - px
                val dy = e.values[1] - py
                val dz = e.values[2] - pz
                px = e.values[0]; py = e.values[1]; pz = e.values[2]
                if (!primed) {
                    primed = true
                } else {
                    val jolt = abs(dx) + abs(dy) + abs(dz)
                    shakeEnergy = shakeEnergy * 0.82f + jolt * 0.18f
                    if (shakeEnergy > SHAKE_ON && now - lastShake > SHAKE_GAP) {
                        lastShake = now
                        shakeEnergy = 0f
                        onShake.invoke(shakeEnergy.coerceAtLeast(jolt))
                    }
                }
            }

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
        const val SHAKE_ON = 6.5f    // summed per-sample jerk, smoothed; a deliberate shake clears this
        const val SHAKE_GAP = 900L   // one trigger per shake, not one per wobble
    }
}

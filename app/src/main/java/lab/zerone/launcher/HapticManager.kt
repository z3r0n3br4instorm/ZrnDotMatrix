package lab.zerone.launcher

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings

/**
 * Manages tactile feedback for the dot matrix display.
 * When the device has a precise haptic motor (LRA / Linear Resonant Actuator supporting
 * amplitude control or API 30+ composition primitives), it plays micro-ticks during
 * ripple shockwaves and dot transition animations.
 * On legacy devices with imprecise ERM motors (no amplitude control / no primitives),
 * it remains silent to prevent distracting or harsh buzzing.
 */
class HapticManager(private val context: Context) {

    private val vibrator: Vibrator? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator ?: (context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    } catch (e: Throwable) {
        null
    }

    /** Composition primitive ids are plain compile-time ints; the probe itself needs API 30. */
    private fun hasPrimitive(id: Int): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && vibrator != null) {
            try {
                vibrator.areAllPrimitivesSupported(id)
            } catch (e: Throwable) {
                false
            }
        } else false

    private val supportsTick: Boolean = hasPrimitive(VibrationEffect.Composition.PRIMITIVE_TICK)
    private val supportsLowTick: Boolean = hasPrimitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK)
    private val supportsClick: Boolean = hasPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK)
    private val supportsQuickRise: Boolean = hasPrimitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE)

    /** The composition length cap is not public API, so stay well inside what LRAs accept. */
    private val maxPrimitives: Int = 20

    /**
     * How long each primitive actually plays on this motor, so the cascades below add up to the
     * animation they are pacing. Reported from API 31; the fallbacks are Pixel-class nominals.
     */
    private fun primitiveMs(id: Int, fallback: Long): Long = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && vibrator != null) {
            vibrator.getPrimitiveDurations(id).firstOrNull()?.toLong()?.takeIf { it > 0 } ?: fallback
        } else fallback
    } catch (e: Throwable) {
        fallback
    }

    private val tickMs: Long by lazy { primitiveMs(VibrationEffect.Composition.PRIMITIVE_TICK, TICK_MS) }
    private val lowTickMs: Long by lazy { primitiveMs(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, LOW_TICK_MS) }
    private val quickRiseMs: Long by lazy { primitiveMs(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, QUICK_RISE_MS) }

    /** VibrationEffect and amplitude control both arrived in API 26; below that we cannot
     *  shape a vibration at all, only switch the motor on and off. */
    private val hasEffects: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

    private val hasAmplitude: Boolean = try {
        hasEffects && vibrator?.hasAmplitudeControl() == true
    } catch (e: Throwable) {
        false
    }

    /**
     * True ONLY if the device has a precision haptic actuator (e.g. LRA) capable of
     * subtle micro-ticks via composition primitives or amplitude control.
     */
    val isPreciseHapticsSupported: Boolean = (vibrator?.hasVibrator() == true) &&
            (supportsTick || supportsLowTick || hasAmplitude)

    private val touchAttributes: Any? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
            VibrationAttributes.Builder()
                .setUsage(VibrationAttributes.USAGE_TOUCH)
                .build()
        }
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
            @Suppress("DEPRECATION")
            VibrationAttributes.Builder()
                .setUsage(VibrationAttributes.USAGE_TOUCH)
                .build()
        }
        else -> {
            AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .build()
        }
    }

    private var lastRippleTime = 0L
    private var lastTransitionTime = 0L

    /**
     * Global strength multiplier set from the settings screen (0 = muted, 1 = stock).
     * Applied to composition primitive scales and to waveform amplitudes alike.
     */
    var intensity: Float = 1.0f
        set(value) { field = value.coerceIn(0f, 2.0f) }

    /** Primitive scale after the user's intensity, kept inside the API's legal 0..1 range. */
    private fun p(scale: Float): Float = (scale * intensity).coerceIn(0.01f, 1.0f)

    /** Waveform amplitude after the user's intensity, kept inside the API's legal 1..255 range. */
    private fun amp(a: Int): Int = (a * intensity).toInt().coerceIn(1, 255)

    private val muted: Boolean get() = intensity <= 0.01f

    private fun isHapticFeedbackEnabled(): Boolean {
        return try {
            Settings.System.getInt(
                context.contentResolver,
                Settings.System.HAPTIC_FEEDBACK_ENABLED,
                1
            ) != 0
        } catch (e: Throwable) {
            true
        }
    }

    /**
     * Plays tiny decaying vibrations matching the ripple effect shockwave expanding outward.
     */
    fun ripple() {
        if (muted || !isPreciseHapticsSupported || vibrator == null || !isHapticFeedbackEnabled()) return
        val now = SystemClock.uptimeMillis()
        if (now - lastRippleTime < 40) return
        lastRippleTime = now

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (supportsTick || supportsLowTick)) {
                val primaryPrimitive = if (supportsLowTick) {
                    VibrationEffect.Composition.PRIMITIVE_LOW_TICK
                } else {
                    VibrationEffect.Composition.PRIMITIVE_TICK
                }
                val leadPrimitive = if (supportsTick) {
                    VibrationEffect.Composition.PRIMITIVE_TICK
                } else {
                    primaryPrimitive
                }

                val effect = VibrationEffect.startComposition()
                    .addPrimitive(leadPrimitive, p(0.38f), 0)
                    .addPrimitive(primaryPrimitive, p(0.28f), 65)
                    .addPrimitive(primaryPrimitive, p(0.20f), 70)
                    .addPrimitive(primaryPrimitive, p(0.14f), 75)
                    .addPrimitive(primaryPrimitive, p(0.08f), 80)
                    .compose()
                vibrateEffect(effect)
            } else if (hasAmplitude) {
                // Micro-pulses of 8ms with decaying amplitude
                val timings = longArrayOf(0, 8, 57, 8, 62, 8, 67, 8, 72, 8)
                val amplitudes = intArrayOf(0, amp(40), 0, amp(28), 0, amp(20), 0, amp(14), 0, amp(8))
                val effect = VibrationEffect.createWaveform(timings, amplitudes, -1)
                vibrateEffect(effect)
            }
        } catch (e: Throwable) {
            // Gracefully ignore any hardware/driver error
        }
    }

    /**
     * Plays a cascade of delicate micro-ticks during the dot transition animation.
     */
    fun transition() {
        if (muted || !isPreciseHapticsSupported || vibrator == null || !isHapticFeedbackEnabled()) return
        val now = SystemClock.uptimeMillis()
        if (now - lastTransitionTime < 60) return
        lastTransitionTime = now

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (supportsTick || supportsLowTick)) {
                val primitive = if (supportsTick) {
                    VibrationEffect.Composition.PRIMITIVE_TICK
                } else {
                    VibrationEffect.Composition.PRIMITIVE_LOW_TICK
                }

                val effect = VibrationEffect.startComposition()
                    .addPrimitive(primitive, p(0.18f), 0)
                    .addPrimitive(primitive, p(0.22f), 60)
                    .addPrimitive(primitive, p(0.26f), 65)
                    .addPrimitive(primitive, p(0.26f), 65)
                    .addPrimitive(primitive, p(0.22f), 65)
                    .addPrimitive(primitive, p(0.18f), 65)
                    .addPrimitive(primitive, p(0.14f), 70)
                    .compose()
                vibrateEffect(effect)
            } else if (hasAmplitude) {
                val timings = longArrayOf(0, 8, 52, 8, 57, 8, 57, 8, 57, 8, 57, 8, 62, 8)
                val amplitudes = intArrayOf(0, amp(20), 0, amp(24), 0, amp(28), 0, amp(28), 0, amp(24), 0, amp(20), 0, amp(15))
                val effect = VibrationEffect.createWaveform(timings, amplitudes, -1)
                vibrateEffect(effect)
            }
        } catch (e: Throwable) {
            // Gracefully ignore any hardware/driver error
        }
    }

    /**
     * Boot: dots lifting out of scatter and settling into the home screen. A soft rise while
     * the field is in flight, then micro-ticks that pack tighter as it converges, and one
     * firmer click on the frame everything lands. `durationMs` is the visual flight time.
     *
     * Primitive lengths below are the nominal ones a Pixel-class LRA reports (TICK 5ms,
     * QUICK_RISE 150ms); another motor may differ by a few ms, which only shifts the feel
     * slightly — the shape of the cascade is what carries the sensation.
     */
    fun arrange(durationMs: Long) {
        if (muted || !isPreciseHapticsSupported || vibrator == null || !isHapticFeedbackEnabled()) return
        val dur = durationMs.coerceIn(200L, 3000L)

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (supportsTick || supportsLowTick)) {
                val tick = if (supportsTick) {
                    VibrationEffect.Composition.PRIMITIVE_TICK
                } else {
                    VibrationEffect.Composition.PRIMITIVE_LOW_TICK
                }
                val unit = if (supportsTick) tickMs else lowTickMs
                val comp = VibrationEffect.startComposition()
                var budget = dur
                if (supportsQuickRise) {
                    comp.addPrimitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, p(0.30f), 0)
                    budget -= quickRiseMs                    // the rise owns the head of the flight
                }
                // Landing times follow (i/n)^0.6, so the gaps shrink and the cascade accelerates.
                val n = (maxPrimitives - 2).coerceIn(4, 10)
                var prev = 0L
                for (i in 1..n) {
                    val at = (budget.coerceAtLeast(120L) * Math.pow(i.toDouble() / n, 0.6)).toLong()
                    val gap = (at - prev - unit).coerceAtLeast(0L)
                    comp.addPrimitive(tick, p(0.10f + 0.22f * i / n.toFloat()), gap.toInt())
                    prev = at
                }
                if (supportsClick) {
                    comp.addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, p(0.45f), 0)
                } else {
                    comp.addPrimitive(tick, p(0.40f), 0)
                }
                vibrateEffect(comp.compose())
            } else if (hasAmplitude) {
                val n = 8
                val t = ArrayList<Long>(n * 2 + 2)
                val a = ArrayList<Int>(n * 2 + 2)
                var prev = 0L
                for (i in 1..n) {
                    val at = (dur * Math.pow(i.toDouble() / n, 0.6)).toLong()
                    t.add((at - prev - 8L).coerceAtLeast(4L)); a.add(0)
                    t.add(8L); a.add(amp(18 + 26 * i / n))
                    prev = at
                }
                t.add(6L); a.add(0)
                t.add(14L); a.add(amp(70))                   // landing
                vibrateEffect(VibrationEffect.createWaveform(t.toLongArray(), a.toIntArray(), -1))
            }
        } catch (e: Throwable) {
            // Gracefully ignore any hardware/driver error
        }
    }

    /**
     * Boot: the light bar crossing the ZERONE wordmark. Evenly spaced soft ticks under a bell
     * curve — it swells as the bar reaches the middle of the letters and fades as it leaves,
     * so it reads as something brushing across the panel. Deliberately unlike `arrange`:
     * no rise, no closing click, even spacing, and the gentlest primitive the motor has.
     */
    fun sweep(durationMs: Long) {
        if (muted || !isPreciseHapticsSupported || vibrator == null || !isHapticFeedbackEnabled()) return
        val dur = durationMs.coerceIn(200L, 3000L)

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (supportsLowTick || supportsTick)) {
                val soft = if (supportsLowTick) {
                    VibrationEffect.Composition.PRIMITIVE_LOW_TICK
                } else {
                    VibrationEffect.Composition.PRIMITIVE_TICK
                }
                val unit = if (supportsLowTick) lowTickMs else tickMs
                val n = (dur / 62L).toInt().coerceIn(6, maxPrimitives)
                val gap = ((dur - n * unit) / (n - 1)).coerceAtLeast(0L).toInt()
                val comp = VibrationEffect.startComposition()
                for (i in 0 until n) {
                    val bell = Math.sin(Math.PI * i / (n - 1))       // 0 → 1 → 0 across the letters
                    comp.addPrimitive(soft, p((0.05 + 0.20 * bell).toFloat()), if (i == 0) 0 else gap)
                }
                vibrateEffect(comp.compose())
            } else if (hasAmplitude) {
                val n = (dur / 62L).toInt().coerceIn(6, 24)
                val gap = ((dur - n * 8L) / (n - 1)).coerceAtLeast(4L)
                val t = ArrayList<Long>(n * 2)
                val a = ArrayList<Int>(n * 2)
                for (i in 0 until n) {
                    val bell = Math.sin(Math.PI * i / (n - 1))
                    t.add(if (i == 0) 0L else gap); a.add(0)
                    t.add(8L); a.add(amp((8 + 34 * bell).toInt()))
                }
                vibrateEffect(VibrationEffect.createWaveform(t.toLongArray(), a.toIntArray(), -1))
            }
        } catch (e: Throwable) {
            // Gracefully ignore any hardware/driver error
        }
    }

    /**
     * Plays a single tiny tick vibration.
     */
    fun tick(scale: Float = 0.25f) {
        if (muted || !isPreciseHapticsSupported || vibrator == null || !isHapticFeedbackEnabled()) return
        try {
            val clamped = p(scale)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && (supportsTick || supportsLowTick)) {
                val primitive = if (supportsTick) VibrationEffect.Composition.PRIMITIVE_TICK else VibrationEffect.Composition.PRIMITIVE_LOW_TICK
                val effect = VibrationEffect.startComposition()
                    .addPrimitive(primitive, clamped, 0)
                    .compose()
                vibrateEffect(effect)
            } else if (hasAmplitude) {
                val effect = VibrationEffect.createOneShot(8, (clamped * 100).toInt().coerceIn(1, 255))
                vibrateEffect(effect)
            }
        } catch (e: Throwable) {
            // Gracefully ignore
        }
    }

    fun cancel() {
        try {
            vibrator?.cancel()
        } catch (e: Throwable) {
            // Gracefully ignore
        }
    }

    private companion object {
        const val TICK_MS = 5L
        const val LOW_TICK_MS = 12L
        const val QUICK_RISE_MS = 150L
    }

    private fun vibrateEffect(effect: VibrationEffect) {
        val v = vibrator ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            (touchAttributes as? VibrationAttributes)?.let {
                v.vibrate(effect, it)
                return
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            @Suppress("DEPRECATION")
            (touchAttributes as? VibrationAttributes)?.let {
                v.vibrate(effect, it)
                return
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (touchAttributes as? AudioAttributes)?.let {
                v.vibrate(effect, it)
                return
            }
        }
        v.vibrate(effect)
    }
}

package lab.zerone.launcher

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Speech in and out for RIGEL.
 *
 * Recognition is not guaranteed to exist. It is supplied by an installed
 * RecognitionService — on a Pixel that is the Google app plus Android System
 * Intelligence for the on-device path; on a debloated ROM there may be none at all,
 * which is why [recognitionAvailable] is reported to the UI rather than assumed.
 *
 * Preference order:
 *   1. on-device recogniser (API 31+) — no network, lowest latency
 *   2. the normal SpeechRecognizer — usually Google, may go to the network
 *   3. nothing; the UI falls back to text only
 */
class Voice(
    private val ctx: Context,
    private val onResult: (String, Boolean) -> Unit,   // text, isFinal
    private val onLevel: (Float) -> Unit,              // 0..1, drives the fire
    private val onState: (String) -> Unit              // idle | listening | error:<what>
) {

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var listening = false

    /** True when some RecognitionService exists on this device. */
    val recognitionAvailable: Boolean
        get() = try { SpeechRecognizer.isRecognitionAvailable(ctx) } catch (_: Throwable) { false }

    /** True when the recogniser runs locally — no audio leaves the phone. */
    val onDeviceAvailable: Boolean
        get() = try {
            Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
        } catch (_: Throwable) { false }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { onState("listening") }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rms: Float) {
            // SpeechRecognizer reports roughly -2..10 dB; map to 0..1 for the flame.
            onLevel(((rms + 2f) / 12f).coerceIn(0f, 1f))
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { onLevel(0f) }

        override fun onError(error: Int) {
            listening = false
            onLevel(0f)
            onState("error:" + when (error) {
                SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
                SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "NO MIC PERMISSION"
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK"
                SpeechRecognizer.ERROR_NO_MATCH -> "NO MATCH"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "BUSY"
                SpeechRecognizer.ERROR_SERVER -> "SERVER"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "NO SPEECH"
                else -> "ERR $error"
            })
        }

        override fun onPartialResults(partial: Bundle?) {
            partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()?.takeIf { it.isNotBlank() }
                ?.let { onResult(it, false) }
        }

        override fun onResults(results: Bundle?) {
            listening = false
            onLevel(0f)
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            onState("idle")
            if (!text.isNullOrBlank()) onResult(text, true)
        }

        override fun onEvent(type: Int, params: Bundle?) {}
    }

    /** Must be called on the main thread — SpeechRecognizer requires it. */
    fun start(): Boolean {
        if (listening) return true
        if (!recognitionAvailable) { onState("error:NO RECOGNISER"); return false }
        try {
            release()
            recognizer = if (onDeviceAvailable) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
            } else {
                SpeechRecognizer.createSpeechRecognizer(ctx)
            }
            recognizer?.setRecognitionListener(listener)
            val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                // Ask to stay local even on the generic recogniser where the flag is honoured.
                if (Build.VERSION.SDK_INT >= 23) putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                // None of these were set before, so the recogniser fell back to its own short
                // default pause-length and ended listening on an ordinary breath mid-sentence.
                // 5 minutes effectively disables the silence cutoff; stop() (hold-to-dismiss)
                // is still how a turn actually ends.
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 300000L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 300000L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 300000L)
            }
            recognizer?.startListening(i)
            listening = true
            return true
        } catch (e: Throwable) {
            listening = false
            onState("error:" + (e.message ?: "START FAILED"))
            return false
        }
    }

    fun stop() {
        listening = false
        try { recognizer?.stopListening() } catch (_: Throwable) {}
        onLevel(0f)
        onState("idle")
    }

    fun release() {
        try { recognizer?.destroy() } catch (_: Throwable) {}
        recognizer = null
    }

    // ---------------- speaking back ----------------
    fun initTts() {
        if (tts != null) return
        tts = TextToSpeech(ctx) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) try { tts?.language = Locale.getDefault() } catch (_: Throwable) {}
        }
    }

    fun speak(text: String) {
        if (text.isBlank()) return
        initTts()
        if (!ttsReady) return
        try {
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT >= 21) {
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "rigel")
            } else {
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null)
            }
        } catch (_: Throwable) {}
    }

    fun shutUp() { try { tts?.stop() } catch (_: Throwable) {} }

    fun destroy() {
        release()
        try { tts?.stop(); tts?.shutdown() } catch (_: Throwable) {}
        tts = null
    }
}

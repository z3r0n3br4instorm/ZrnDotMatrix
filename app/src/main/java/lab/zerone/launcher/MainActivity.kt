package lab.zerone.launcher

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebViewClient
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Home-screen activity. The whole UI is the DotMatrix engine running in a hardware-accelerated
 * WebView and drawing with WebGL (GPU point sprites); Kotlin supplies apps, status and Termux.
 */
class MainActivity : ComponentActivity() {

    lateinit var web: WebView
    lateinit var status: StatusMonitor
    lateinit var haptics: HapticManager
    lateinit var audio: AudioCapture
    lateinit var tilt: Tilt
    lateinit var voice: Voice
    private var screenWasOff = false
    private var resumed = false

    /** True while this activity is resumed — read by the UI through Bridge.isForeground(). */
    val isForeground: Boolean get() = resumed
    private var audioWanted = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action == Intent.ACTION_SCREEN_OFF) screenWasOff = true
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        haptics = HapticManager(this)

        // full-bleed black canvas; system bars hidden, swipe to peek
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        web = WebView(this).apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, null)     // GPU-composited; WebGL renders on the GPU
            setBackgroundColor(Color.BLACK)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isHapticFeedbackEnabled = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            settings.mediaPlaybackRequiresUserGesture = true
        }
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
                assets.shouldInterceptRequest(android.net.Uri.parse(url))

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String) = true
        }
        // The whole UI is JavaScript; without this, script errors vanish silently.
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                android.util.Log.d("ZrnWeb", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        web.addJavascriptInterface(Bridge(this), "ZLNative")
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        audio = AudioCapture(this) { json -> js("ZL.onAudio(${JSONObject.quote(json)})") }
        tilt = Tilt(this) { x, y -> js("ZL.onTilt($x,$y)") }
        voice = Voice(this,
            onResult = { text, final -> js("ZL.onVoice(${JSONObject.quote(text)},$final)") },
            onLevel = { lvl -> js("ZL.onVoiceLevel($lvl)") },
            onState = { st -> js("ZL.onVoiceState(${JSONObject.quote(st)})") })
        status = StatusMonitor(this) { json ->
            js("ZL.onStatus(${JSONObject.quote(json)})")
            // Tap the output mix only while something is playing, we are on screen, and audio
            // is not going out over Bluetooth — A2DP offload bypasses the mix, so the tap
            // would read silence and the UI shows the Bluetooth widget instead.
            audioWanted = try {
                val s = JSONObject(json)
                s.optBoolean("playing", false) && !s.optBoolean("btAudio", false)
            } catch (_: Exception) { false }
            runOnUiThread { syncAudioCapture() }
        }
        ContextCompat.registerReceiver(this, screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { js("ZL.back()") }
        })
        askPermissions()
    }

    fun checkNotificationAccess(): Boolean {
        val enabled = android.provider.Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        ) ?: ""
        val comp = android.content.ComponentName(this, MediaListenerService::class.java).flattenToString()
        return enabled.contains(comp)
    }

    /** The tilt sensor only runs while the RIGEL screen is actually on show. */
    var tiltWanted = false
        set(v) { field = v; syncTilt() }

    fun syncTilt() {
        if (!::tilt.isInitialized) return
        if (resumed && tiltWanted) tilt.start() else tilt.stop()
    }

    /** Runs the Visualizer only while we are resumed and media is playing. */
    fun syncAudioCapture() {
        if (!::audio.isInitialized) return
        if (resumed && audioWanted) audio.start() else audio.stop()
    }

    fun requestAudioPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            androidx.core.app.ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 2)
        }
    }

    private fun askPermissions() {
        val want = mutableListOf(
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.RECORD_AUDIO,          // Visualizer tap for the equalizer wave
            TERMUX_PERMISSION
        )
        if (Build.VERSION.SDK_INT >= 31) want += Manifest.permission.BLUETOOTH_CONNECT
        if (Build.VERSION.SDK_INT >= 33) want += Manifest.permission.POST_NOTIFICATIONS
        val missing = want.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) androidx.core.app.ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1)

        // Ask for notification access once. This used to fire on every start, which threw the
        // user into Settings each time they came home — unusable as a launcher. The settings
        // screen still has a button for it if they decline.
        val prefs = getSharedPreferences("zl", Context.MODE_PRIVATE)
        if (!checkNotificationAccess() && !prefs.getBoolean("askedNotifAccess", false)) {
            prefs.edit().putBoolean("askedNotifAccess", true).apply()
            android.widget.Toast.makeText(this, "Enable Notification Access for track info", android.widget.Toast.LENGTH_LONG).show()
            try {
                startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (_: Exception) {}
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        status.push()
        syncAudioCapture()
        Bridge.location(this)?.let { js("ZL.location(${it.first},${it.second})") }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Home pressed while already home → ripple / return to the home screen
        if (resumed && intent.hasCategory(Intent.CATEGORY_HOME)) js("ZL.home()")
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && checkNotificationAccess()) {
                android.service.notification.NotificationListenerService.requestRebind(
                    android.content.ComponentName(this, MediaListenerService::class.java)
                )
            }
        } catch (_: Exception) {}
        web.onResume()
        web.resumeTimers()
        status.start()
        syncAudioCapture()
        syncTilt()
        js("ZL.resume()")                                              // restart the frame loop, replay the closing morph
        if (screenWasOff) { screenWasOff = false; js("ZL.wake()") }     // screen came on: play the ZERONE splash
        WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onPause() {
        resumed = false
        haptics.cancel()
        status.stop()
        audio.stop()
        tilt.stop()
        voice.stop()
        js("ZL.pause()")                                 // stop the frame loop before the WebView sleeps
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        haptics.cancel()
        audio.stop()
        tilt.stop()
        voice.destroy()
        unregisterReceiver(screenReceiver)
        web.destroy()
        super.onDestroy()
    }

    fun js(code: String) = runOnUiThread { if (::web.isInitialized) web.evaluateJavascript("window.ZL&&$code", null) }

    companion object {
        const val TERMUX_PERMISSION = "com.termux.permission.RUN_COMMAND"
        var current: WeakReference<MainActivity>? = null
    }
}

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
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
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
    lateinit var bridge: Bridge
    private lateinit var cover: View
    lateinit var audio: AudioCapture
    lateinit var tilt: Tilt
    lateinit var voice: Voice
    private var screenWasOff = false
    private var userPresent = false
    private var resumed = false
    private var focused = false

    val isForeground: Boolean get() = resumed
    private var audioWanted = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    screenWasOff = true; userPresent = false
                    offAt = android.os.SystemClock.uptimeMillis()
                    coverUi()
                }
                Intent.ACTION_USER_PRESENT -> { wakeLog("user present"); userPresent = true; maybeWake() }
                Intent.ACTION_SCREEN_ON -> if (userThrough()) { userPresent = true; maybeWake() }
            }
        }
    }

    private val pkgReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (::bridge.isInitialized) bridge.warmApps()
        }
    }

    private var offAt = 0L
    fun wakeLog(step: String) {
        val t = android.os.SystemClock.uptimeMillis()
        android.util.Log.d("ZrnWake", if (offAt > 0) "+${t - offAt}ms $step" else step)
    }

    fun coverUi() = runOnUiThread { if (::cover.isInitialized) cover.visibility = View.VISIBLE }

    fun revealUi() = runOnUiThread {
        if (::cover.isInitialized && cover.visibility != View.GONE) {
            cover.visibility = View.GONE
            wakeLog("cover down")
        }
        js("ZL.uiShown()")
    }

    /**
     * The UI has drawn the boot's frame 0 behind the cover. postVisualStateCallback fires once
     * everything drawn so far is ready to be composited — exactly when the cover can come down
     * without showing stale content.
     */
    fun onUiReady() = runOnUiThread {
        wakeLog("ui drew frame 0")
        if (!::cover.isInitialized || cover.visibility == View.GONE) { js("ZL.uiShown()"); return@runOnUiThread }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && ::web.isInitialized) {
            web.postVisualStateCallback(System.nanoTime(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    wakeLog("frame 0 composited")
                    revealUi()
                }
            })
        } else {
            revealUi()
        }
    }

    private fun userThrough(): Boolean = try {
        val km = getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 && km.isKeyguardSecure) !km.isDeviceLocked
        else !km.isKeyguardLocked
    } catch (e: Throwable) {
        true
    }

    private fun keyguardLocked(): Boolean = try {
        (getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager)?.isKeyguardLocked == true
    } catch (e: Throwable) {
        false
    }

    private fun maybeWake() {
        if (!resumed || !screenWasOff || !userPresent) return
        screenWasOff = false
        wakeLog("wake dispatched")
        js("ZL.wake()")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        haptics = HapticManager(this)

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
            // Local assets only: HTTP caching buys nothing and can serve a previous build's JS
            // after an in-place update, since WebViewAssetLoader sends no cache headers.
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
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
        bridge = Bridge(this)
        web.addJavascriptInterface(bridge, "ZLNative")
        bridge.warmApps()                                // start reading app labels before the UI asks
        // Black sheet over the WebView, raised at screen-off and dropped when the boot's first
        // frame is composited, so a wake never flashes the stale pre-sleep frame.
        val root = android.widget.FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
        cover = View(this).apply { setBackgroundColor(Color.BLACK); visibility = View.GONE }
        root.addView(cover, android.widget.FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        audio = AudioCapture(this) { json -> js("ZL.onAudio(${JSONObject.quote(json)})") }
        tilt = Tilt(this, { x, y ->
            if (tiltWanted) js("ZL.onTilt($x,$y)")
        }, { mag ->
            js("ZL.onShake($mag)")
        })
        voice = Voice(this,
            onResult = { text, final -> js("ZL.onVoice(${JSONObject.quote(text)},$final)") },
            onLevel = { lvl -> js("ZL.onVoiceLevel($lvl)") },
            onState = { st -> js("ZL.onVoiceState(${JSONObject.quote(st)})") })
        status = StatusMonitor(this) { json ->
            js("ZL.onStatus(${JSONObject.quote(json)})")
            audioWanted = try {
                val s = JSONObject(json)
                s.optBoolean("playing", false) && !s.optBoolean("btAudio", false)
            } catch (_: Exception) { false }
            runOnUiThread { syncAudioCapture() }
        }

        val screenFilter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        ContextCompat.registerReceiver(this, screenReceiver, screenFilter, ContextCompat.RECEIVER_NOT_EXPORTED)

        val pkgFilter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        }
        ContextCompat.registerReceiver(this, pkgReceiver, pkgFilter, ContextCompat.RECEIVER_NOT_EXPORTED)

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

    var tiltWanted = false
        set(v) { field = v; syncTilt() }

    var shakeWanted = false
        set(v) { field = v; syncTilt() }

    fun syncTilt() {
        if (!::tilt.isInitialized) return
        if (resumed && (tiltWanted || shakeWanted)) tilt.start() else tilt.stop()
    }

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
            Manifest.permission.RECORD_AUDIO,
            TERMUX_PERMISSION
        )
        if (Build.VERSION.SDK_INT >= 31) want += Manifest.permission.BLUETOOTH_CONNECT
        if (Build.VERSION.SDK_INT >= 33) want += Manifest.permission.POST_NOTIFICATIONS
        val missing = want.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) androidx.core.app.ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1)

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
        if (resumed && intent.hasCategory(Intent.CATEGORY_HOME)) js("ZL.home()")
    }

    override fun onResume() {
        super.onResume()
        wakeLog("onResume")
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
        val wakeOwed = screenWasOff || keyguardLocked()
        js("ZL.resume($wakeOwed)")
        if (!wakeOwed) revealUi()
        if (keyguardLocked() && !userThrough()) screenWasOff = true
        if (userThrough()) userPresent = true
        maybeWake()
        WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        focused = hasFocus
        if (hasFocus) {
            wakeLog("window focus")
            if (::cover.isInitialized && cover.visibility == View.VISIBLE) cover.postDelayed({
                if (cover.visibility == View.VISIBLE) { wakeLog("cover FALLBACK timer"); revealUi() }
            }, 1500)
            if (userThrough()) userPresent = true
            maybeWake()
        }
    }

    override fun onPause() {
        resumed = false
        focused = false
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
        try { unregisterReceiver(pkgReceiver) } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }

    fun js(code: String) = runOnUiThread { if (::web.isInitialized) web.evaluateJavascript("window.ZL&&$code", null) }

    companion object {
        const val TERMUX_PERMISSION = "com.termux.permission.RUN_COMMAND"
        var current: WeakReference<MainActivity>? = null
    }
}

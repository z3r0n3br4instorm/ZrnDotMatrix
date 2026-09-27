package lab.zerone.launcher

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings

/**
 * Radio toggles for the quick-settings grid.
 *
 * Android progressively took direct radio control away from normal apps:
 *   - `WifiManager.setWifiEnabled` is a no-op from Android 10 (API 29).
 *   - `BluetoothAdapter.enable()/disable()` are no-ops from Android 13 (API 33).
 *   - Mobile data has always needed the system-only MODIFY_PHONE_STATE permission.
 *   - Location has never been app-toggleable.
 *
 * So each toggle tries the direct call where the platform still honours it (which is most
 * of them on the BlackBerry Priv / Android 6) and otherwise opens the narrowest settings
 * surface available — the inline Settings Panel on API 29+, a full settings screen below.
 * [capability] tells the UI which it will get, so the grid can mark the ones that only
 * deep-link instead of pretending they toggle in place.
 */
object Radios {

    const val DIRECT = "direct"     // flips in place, no UI
    const val PANEL = "panel"       // opens an inline system panel / settings screen

    private fun wifi(ctx: Context) =
        ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    private fun bt(ctx: Context): BluetoothAdapter? = try {
        (androidx.core.content.ContextCompat.getSystemService(ctx, BluetoothManager::class.java)
            ?: (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager))?.adapter
            ?: BluetoothAdapter.getDefaultAdapter()
    } catch (_: Throwable) { null }

    fun wifiCapability(): String = if (Build.VERSION.SDK_INT < 29) DIRECT else PANEL
    fun btCapability(): String = if (Build.VERSION.SDK_INT < 33) DIRECT else PANEL
    fun dataCapability(): String = PANEL
    fun locCapability(): String = PANEL

    fun isWifiOn(ctx: Context): Boolean = try { wifi(ctx)?.isWifiEnabled == true } catch (_: Throwable) { false }

    fun isBtOn(ctx: Context): Boolean = try { bt(ctx)?.isEnabled == true } catch (_: Throwable) { false }

    fun isLocOn(ctx: Context): Boolean = try {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
        else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    } catch (_: Throwable) { false }

    /** Mobile data *reachable* — the enabled flag itself is not readable without a system permission. */
    fun isDataOn(ctx: Context): Boolean = try {
        val cm = androidx.core.content.ContextCompat.getSystemService(ctx, ConnectivityManager::class.java)
            ?: (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        caps?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) == true
    } catch (_: Throwable) { false }

    /** @return true if the state flipped in place; false if a settings surface was opened. */
    fun toggleWifi(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 29) {
            try {
                val w = wifi(ctx) ?: return open(ctx, Settings.ACTION_WIFI_SETTINGS)
                @Suppress("DEPRECATION")
                if (w.setWifiEnabled(!w.isWifiEnabled)) return true
            } catch (_: Throwable) {}
        }
        // API 29+: ACTION_INTERNET_CONNECTIVITY is the inline panel with Wi-Fi and data together.
        return open(ctx,
            if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY
            else Settings.ACTION_WIFI_SETTINGS)
    }

    fun toggleBt(ctx: Context): Boolean {
        val a = bt(ctx) ?: return open(ctx, Settings.ACTION_BLUETOOTH_SETTINGS)
        if (Build.VERSION.SDK_INT < 33) {
            try {
                @Suppress("DEPRECATION")
                val ok = if (a.isEnabled) a.disable() else a.enable()
                if (ok) return true
            } catch (_: SecurityException) {
            } catch (_: Throwable) {}
        }
        // API 33+: only the system may flip the radio; ask, or send them to settings to turn it off.
        return if (!a.isEnabled) open(ctx, BluetoothAdapter.ACTION_REQUEST_ENABLE)
        else open(ctx, Settings.ACTION_BLUETOOTH_SETTINGS)
    }

    /** Never app-toggleable — MODIFY_PHONE_STATE is signature-only on every release. */
    fun toggleData(ctx: Context): Boolean = open(ctx,
        if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY
        else Settings.ACTION_DATA_ROAMING_SETTINGS)

    /** Never app-toggleable. */
    fun toggleLoc(ctx: Context): Boolean = open(ctx, Settings.ACTION_LOCATION_SOURCE_SETTINGS)

    private fun open(ctx: Context, action: String): Boolean {
        try {
            ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Throwable) {}
        return false
    }
}

package lab.zerone.launcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Receives the RUN_COMMAND result bundle from Termux and hands it to the UI. */
class TermuxResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val b = intent.getBundleExtra("result") ?: return
        val stdout = b.getString("stdout", "")
        val stderr = b.getString("stderr", "")
        val exit = b.getInt("exitCode", 0)
        val errmsg = if (b.getInt("err", -1) > 0) b.getString("errmsg", "") ?: "" else ""
        MainActivity.current?.get()?.js(
            "ZL.onTermux(${JSONObject.quote(id)},${JSONObject.quote(stdout)},${JSONObject.quote(stderr)},$exit,${JSONObject.quote(errmsg)})"
        )
    }
}

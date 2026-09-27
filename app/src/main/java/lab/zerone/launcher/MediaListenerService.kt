package lab.zerone.launcher

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.lang.ref.WeakReference

/**
 * Listens for active media sessions and track metadata (title, artist, playback state).
 */
class MediaListenerService : NotificationListenerService() {

    private var mm: MediaSessionManager? = null
    private val activeCallbacks = mutableMapOf<MediaController, MediaController.Callback>()

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { sessions ->
        updateCallbacks(sessions)
        MainActivity.current?.get()?.status?.push()
    }

    /**
     * Which packages are currently showing a notification. The dock blinks the tiles that
     * have something waiting, so this listener earns its keep twice: media sessions and here.
     */
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        refreshNotifPkgs()
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        refreshNotifPkgs()
    }

    private fun refreshNotifPkgs() {
        val next = try {
            activeNotifications
                ?.filter { it.isClearable && it.packageName != packageName }
                ?.map { it.packageName }
                ?.toSet() ?: emptySet()
        } catch (e: Throwable) {
            return
        }
        if (next == notifPkgs) return
        notifPkgs = next
        MainActivity.current?.get()?.status?.push()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = WeakReference(this)
        refreshNotifPkgs()
        try {
            mm = getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager
            val comp = ComponentName(this, MediaListenerService::class.java)
            mm?.addOnActiveSessionsChangedListener(sessionsListener, comp)
            updateCallbacks(mm?.getActiveSessions(comp))
        } catch (_: Exception) {}
        MainActivity.current?.get()?.status?.push()
    }

    override fun onListenerDisconnected() {
        try { mm?.removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Exception) {}
        clearCallbacks()
        instance = null
        super.onListenerDisconnected()
    }

    private fun updateCallbacks(sessions: List<MediaController>?) {
        clearCallbacks()
        sessions?.forEach { controller ->
            val cb = object : MediaController.Callback() {
                override fun onPlaybackStateChanged(state: PlaybackState?) {
                    MainActivity.current?.get()?.status?.push()
                }
                override fun onMetadataChanged(metadata: MediaMetadata?) {
                    MainActivity.current?.get()?.status?.push()
                }
            }
            try {
                controller.registerCallback(cb)
                activeCallbacks[controller] = cb
            } catch (_: Exception) {}
        }
    }

    private fun clearCallbacks() {
        activeCallbacks.forEach { (ctrl, cb) ->
            try { ctrl.unregisterCallback(cb) } catch (_: Exception) {}
        }
        activeCallbacks.clear()
    }

    companion object {
        var instance: WeakReference<MediaListenerService>? = null

        /** Packages with a live, dismissable notification. Empty until the listener connects. */
        @Volatile var notifPkgs: Set<String> = emptySet()
            private set

        fun getActiveController(context: Context): MediaController? {
            return try {
                val mm = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager
                val comp = ComponentName(context, MediaListenerService::class.java)
                val sessions = mm?.getActiveSessions(comp)
                sessions?.firstOrNull {
                    val s = it.playbackState?.state
                    s == PlaybackState.STATE_PLAYING || s == PlaybackState.STATE_FAST_FORWARDING || s == PlaybackState.STATE_REWINDING
                } ?: sessions?.firstOrNull()
            } catch (_: Exception) {
                null
            }
        }
    }
}

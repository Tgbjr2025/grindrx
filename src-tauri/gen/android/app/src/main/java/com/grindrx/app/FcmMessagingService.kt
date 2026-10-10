package com.grindrx.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives Firebase Cloud Messaging traffic.
 *
 * Scope note: this handles the token lifecycle, REGISTRATION with our own
 * server, and foreground/data-message display.
 *
 * Token registration was added 2026-10-10. Until then the token was written
 * only to this device's SharedPreferences, so no server had a recipient list
 * and the end-to-end delivery proven in the ledger had nobody to address.
 * `onNewToken` alone was not sufficient — it only fires on first issue and on
 * rotation, so MainActivity calls `registerIfKnown` on every launch.
 *
 * The SENDER is server-side and deliberately so: sending requires a service
 * account that must never exist in an APK. See /home/axis/push-sender on axis.
 *
 * Background messages are handled by the system and surfaced here rather than
 * in Rust: the Tauri runtime is not guaranteed to be alive when the process is
 * backgrounded or killed, so relying on it for a wake-up notification would
 * silently drop messages. The channel and the notification-id scheme match the
 * ones the WebSocket notifier in src-tauri/src/api/ws.rs uses, so both paths
 * land in the same place instead of doubling up.
 */
class FcmMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        FcmTokenStore.set(applicationContext, token)
        android.util.Log.i("GrindrX", "FCM registration token issued; registering")
        registerWithServer(applicationContext, token)
    }



    override fun onMessageReceived(message: RemoteMessage) {
        val conversationId = message.data["conversationId"]
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.data["body"] ?: message.notification?.body ?: return

        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "GrindrX message notifications"
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
            manager.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!conversationId.isNullOrBlank()) {
                putExtra("conversationId", conversationId)
            }
        }
        val pending = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        manager.notify(NOTIFICATION_ID, notification)
    }

    companion object {
        const val CHANNEL_ID = "grindx_messages"

        // Distinct from the WebSocket notifier's ids so a message delivered both
        // ways replaces itself instead of stacking two identical notifications.
        const val NOTIFICATION_ID = 9001

private const val REGISTRY_URL = "https://cam.dominusaxis.com/grindrx/register"

/**
 * Hand this install's FCM token to the server so a release push has
 * someone to send to.
 *
 * Until this existed the token lived only in this device's
 * SharedPreferences, so the server had no recipient list and the
 * end-to-end delivery proven in the ledger had no addressee.
 *
 * The install id is Firebase's own (stable per install, and already
 * provisioned), so there is no second identifier to invent or to keep
 * in sync. A token ROTATES, so this must be called on every launch and
 * not only from onNewToken -- otherwise a rotated token leaves the
 * server addressing one the device no longer owns.
 *
 * Best effort by design: failure is logged and swallowed. A push that
 * cannot be registered must never take the app down with it, and the
 * next launch retries.
 */
fun registerIfKnown(context: Context) {
    try {
        val token = FcmTokenStore.get(context) ?: return
        registerWithServer(context, token)
    } catch (e: Throwable) {
        android.util.Log.w("GrindrX", "FCM register skipped: ${e.message}")
    }
}

private fun registerWithServer(context: Context, token: String) {
    // The install id is a Task. Using the Task listener rather than
    // .await() keeps this dependency-free -- kotlinx-coroutines-play-services
    // is not on the classpath, and adding it for one call would be a
    // version-alignment risk against Firebase's own coroutines version.
    com.google.firebase.installations.FirebaseInstallations.getInstance().id
        .addOnCompleteListener { task ->
            val installId = task.result
            if (installId.isNullOrBlank()) {
                android.util.Log.w("GrindrX", "FCM register: no install id")
                return@addOnCompleteListener
            }
            Thread {
                try {
                    val url = java.net.URL(REGISTRY_URL)
                    val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 8000
                        readTimeout = 8000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    }
                    val enc = { s: String -> java.net.URLEncoder.encode(s, "UTF-8") }
                    val body = "id=" + enc(installId) +
                        "&token=" + enc(token) +
                        "&v=" + enc(appVersion(context)) +
                        "&app=android"
                    conn.outputStream.use { it.write(body.toByteArray()) }
                    val code = conn.responseCode
                    android.util.Log.i("GrindrX", "FCM register HTTP $code")
                    conn.disconnect()
                } catch (e: Throwable) {
                    android.util.Log.w("GrindrX", "FCM register failed: ${e.message}")
                }
            }.start()
        }
}

private fun appVersion(context: Context): String =
    try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
    } catch (e: Throwable) {
        "unknown"
    }

    }
}
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
 * Scope note: this handles the token lifecycle and foreground/data-message
 * display only. Delivering a push to this device requires an upstream sender
 * that already holds the token returned by [FcmTokenStore]; nothing in this
 * repository issues a send, so with no sender pushing, no notification will
 * arrive. See src-tauri/gen/android/FIREBASE_SETUP.md for the operator steps.
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
        // Logged so the token is observable in logcat while there is no
        // upstream endpoint to register it with. Remove once a sender exists.
        android.util.Log.i("GrindrX", "FCM registration token: $token")
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
    }
}
package org.opengrind

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the app's process — and therefore the Rust
 * tokio runtime that owns the chat WebSocket — alive while the UI (WebView /
 * MainActivity) is backgrounded or destroyed.
 *
 * Tauri runs the Rust library in the SAME process as MainActivity. Without a
 * foreground service Android is free to reclaim that process once the activity
 * stops (Doze, low-memory, swipe-away), which kills the WebSocket loop and stops
 * background message notifications. Holding a foreground notification tells
 * Android the process is doing user-visible work and must be kept running.
 *
 * The actual per-message notifications are still posted by the Rust side
 * (api::ws::maybe_notify via tauri-plugin-notification) on the "grindx_messages"
 * channel. This service only owns the persistent "GrindrX is running" notification
 * on the separate, low-importance "grindx_service" channel.
 */
class NotificationService : Service() {

    companion object {
        const val SERVICE_CHANNEL_ID = "grindx_service"
        const val SERVICE_NOTIFICATION_ID = 1001

        const val ACTION_START = "org.opengrind.action.START_FOREGROUND"
        const val ACTION_STOP = "org.opengrind.action.STOP_FOREGROUND"

        /** Start (or no-op if already running) the keep-alive foreground service. */
        fun start(context: Context) {
            val intent = Intent(context, NotificationService::class.java).apply {
                action = ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Stop the keep-alive foreground service (e.g. on logout). */
        fun stop(context: Context) {
            val intent = Intent(context, NotificationService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createServiceChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                startForegroundCompat()
            }
        }
        // START_STICKY: if Android kills us under memory pressure, recreate the
        // service (with a null intent) so the keep-alive resumes when possible.
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val notification = buildServiceNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(SERVICE_NOTIFICATION_ID, notification)
        }
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun buildServiceNotification(): Notification {
        // Tapping the persistent notification opens the app.
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val contentIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, SERVICE_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("GrindrX is running")
            .setContentText("Listening for new messages")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    setVisibility(Notification.VISIBILITY_SECRET)
                }
            }
            .build()
    }

    private fun createServiceChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                SERVICE_CHANNEL_ID,
                "Background service",
                // LOW: no sound, minimally intrusive; this is the keep-alive banner.
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps GrindrX connected so you receive messages in the background"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}

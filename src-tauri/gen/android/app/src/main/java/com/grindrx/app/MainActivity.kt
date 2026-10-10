package com.grindrx.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Must run before any keyring call. android-native-keyring-store reads
    // ndk_context::android_context(), a thread-local initialised only by this
    // JNI entry point. Without it every keyring access on a spawn_blocking
    // thread panics "android context was not initialized", which tauri-macros'
    // stop_unwind turns into a SIGABRT.
    Keyring.initializeNdkContext(applicationContext)
    createNotificationChannel()
    super.onCreate(savedInstanceState)

    // Hide the app's snapshot from the recents/multitasker switcher, where chat
    // text, profile photos and precise location would otherwise sit exposed.
    // Deliberately NOT WindowManager.LayoutParams.FLAG_SECURE: that would also
    // block screenshots and screen recording, which the operator requires to
    // work. This is the narrower API-33+ control.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(false)
    }
  }

  /**
   * Creates the `grindx_messages` channel that the WebSocket notifier posts to
   * (src-tauri/src/api/ws.rs, `.channel_id("grindx_messages")`).
   *
   * VISIBILITY_PRIVATE is load-bearing, not cosmetic. tauri-plugin-notification
   * exposes no per-notification visibility setter — only ChannelBuilder has one —
   * so the channel is the only place this can be enforced from. Without it
   * Android renders the notification title in full on the lock screen, and for
   * this app the title carries chat context. ws.rs bails out of posting when the
   * app lock is engaged, but the device can be locked while the app lock is not.
   */
  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      FcmMessagingService.CHANNEL_ID,
      "Messages",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "GrindrX message notifications"
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}

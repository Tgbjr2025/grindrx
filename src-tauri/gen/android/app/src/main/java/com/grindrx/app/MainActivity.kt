package com.grindrx.app

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
}

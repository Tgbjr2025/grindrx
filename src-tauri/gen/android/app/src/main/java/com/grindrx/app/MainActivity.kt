package com.grindrx.app

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
  }
}

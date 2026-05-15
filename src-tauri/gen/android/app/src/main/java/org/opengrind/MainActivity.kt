package org.opengrind

import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    Keyring.initializeNdkContext(applicationContext)
    super.onCreate(savedInstanceState)

    // Android 15+ enforces edge-to-edge: https://developer.android.com/develop/ui/views/layout/edge-to-edge
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
	WindowCompat.getInsetsController(window, window.decorView).apply {
		isAppearanceLightStatusBars = false
		isAppearanceLightNavigationBars = false
		window.statusBarColor = android.graphics.Color.BLACK
		window.navigationBarColor = android.graphics.Color.BLACK
	}
  }
}

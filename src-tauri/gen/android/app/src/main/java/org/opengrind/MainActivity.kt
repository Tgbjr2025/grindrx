package org.opengrind

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
	private var insetsTop = 0
	private var insetsBottom = 0
	private var insetsLeft = 0
	private var insetsRight = 0
	private var webViewRef: WebView? = null
	
	inner class InsetsInterface {
		@JavascriptInterface fun top() = insetsTop
		@JavascriptInterface fun bottom() = insetsBottom
		@JavascriptInterface fun left() = insetsLeft
		@JavascriptInterface fun right() = insetsRight
	}

	inner class DiscreetModeInterface {
		private fun mainAlias()    = ComponentName(packageName, "$packageName.MainAlias")
		private fun weatherAlias() = ComponentName(packageName, "$packageName.WeatherAlias")

		@JavascriptInterface
		fun isDiscreet(): Boolean {
			return packageManager.getComponentEnabledSetting(weatherAlias()) ==
				PackageManager.COMPONENT_ENABLED_STATE_ENABLED
		}

		@JavascriptInterface
		fun setDiscreet(discreet: Boolean) {
			val flags = PackageManager.DONT_KILL_APP
			packageManager.setComponentEnabledSetting(
				mainAlias(),
				if (discreet) PackageManager.COMPONENT_ENABLED_STATE_DISABLED
				else PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
				flags
			)
			packageManager.setComponentEnabledSetting(
				weatherAlias(),
				if (discreet) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
				else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
				flags
			)
		}
	}
	
	private fun createNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			val channel = NotificationChannel(
				"grindx_messages",
				"Messages",
				NotificationManager.IMPORTANCE_HIGH
			).apply {
				description = "GrindX message notifications"
			}
			val manager = getSystemService(NotificationManager::class.java)
			manager.createNotificationChannel(channel)
		}
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		enableEdgeToEdge()
		Keyring.initializeNdkContext(applicationContext)
		super.onCreate(savedInstanceState)
		createNotificationChannel()
		
		WindowInsetsControllerCompat(window, window.decorView).apply {
			isAppearanceLightStatusBars = false
			isAppearanceLightNavigationBars = false
		}
		
		ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
			val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
			val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
			val isImeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
			val density = resources.displayMetrics.density
			
			insetsTop = (bars.top / density).toInt()
			insetsBottom = if (isImeVisible) 0 else (bars.bottom / density).toInt()
			insetsLeft = (bars.left / density).toInt()
			insetsRight = (bars.right / density).toInt()
			
			val bottomMargin = if (isImeVisible) ime.bottom else 0
			webViewRef?.let { wv ->
				(wv.layoutParams as? ViewGroup.MarginLayoutParams)?.let { params ->
					if (params.bottomMargin != bottomMargin) {
						params.bottomMargin = bottomMargin
						wv.layoutParams = params
					}
				}
			}
			
			webViewRef?.evaluateJavascript("window.__reapplyInsets?.()", null)
			
			ViewCompat.onApplyWindowInsets(view, insets)
		}
	}
	
	override fun onWebViewCreate(webView: WebView) {
		super.onWebViewCreate(webView)
		webViewRef = webView
		webView.addJavascriptInterface(InsetsInterface(), "__AndroidInsets")
		webView.addJavascriptInterface(DiscreetModeInterface(), "__DiscreetMode")
	}
	
	override fun onBackPressed() {
		webViewRef?.evaluateJavascript(
			"try { window.__AndroidOnBackGesture?.() } catch (error) { console.error(error); true; }".trimIndent()
		) { result ->
			if (result == "true") {
				super.onBackPressed();
			}
		}
	}
}

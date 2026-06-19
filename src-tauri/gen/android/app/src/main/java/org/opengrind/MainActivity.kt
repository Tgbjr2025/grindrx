package org.opengrind

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
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

	/** conversationId pulled from a tapped notification, delivered to the webview once ready. */
	private var pendingConversationId: String? = null

	private val requestNotificationsPermission =
		registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* result ignored: best-effort */ }

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

	/**
	 * Bridge exposed to the webview as `__BackgroundService`. Lets the frontend
	 * (behind a user setting) start/stop the keep-alive foreground service that
	 * holds the WebSocket connection open while the app is backgrounded.
	 */
	inner class BackgroundServiceInterface {
		@JavascriptInterface
		fun start() {
			NotificationService.start(applicationContext)
		}

		@JavascriptInterface
		fun stop() {
			NotificationService.stop(applicationContext)
		}
	}

	private fun createNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			val channel = NotificationChannel(
				"grindx_messages",
				"Messages",
				NotificationManager.IMPORTANCE_HIGH
			).apply {
				description = "GrindrX message notifications"
			}
			val manager = getSystemService(NotificationManager::class.java)
			manager.createNotificationChannel(channel)
		}
	}

	private fun requestNotificationPermissionIfNeeded() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
			if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
				PackageManager.PERMISSION_GRANTED
			) {
				requestNotificationsPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
			}
		}
	}

	/**
	 * Extract a conversationId from an intent fired by tapping a message
	 * notification (extra "conversationId"). Routed to the webview once it's up.
	 */
	private fun handleDeepLinkIntent(intent: Intent?) {
		val conversationId = intent?.getStringExtra("conversationId") ?: return
		if (conversationId.isBlank()) return
		pendingConversationId = conversationId
		deliverPendingDeepLink()
	}

	private fun deliverPendingDeepLink() {
		val convId = pendingConversationId ?: return
		val wv = webViewRef ?: return
		// Hand off to the frontend. The supervisor must implement
		// window.__handleNotificationDeepLink(conversationId) to navigate to
		// /chat/{conversationId}. Escaped to a JS string literal.
		val escaped = convId.replace("\\", "\\\\").replace("'", "\\'")
		wv.evaluateJavascript(
			"try { if (window.__handleNotificationDeepLink) { window.__handleNotificationDeepLink('$escaped') } else { window.__pendingNotificationDeepLink = '$escaped' } } catch (e) { console.error(e) }",
			null
		)
		pendingConversationId = null
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		enableEdgeToEdge()
		Keyring.initializeNdkContext(applicationContext)
		super.onCreate(savedInstanceState)
		createNotificationChannel()
		requestNotificationPermissionIfNeeded()

		// Start the keep-alive foreground service so the WebSocket survives
		// backgrounding. Safe to call repeatedly (idempotent).
		NotificationService.start(applicationContext)

		// If we were launched by tapping a message notification, capture the target.
		handleDeepLinkIntent(intent)

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

	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		// singleTask: a notification tap while the app is already running arrives here.
		handleDeepLinkIntent(intent)
	}

	override fun onWebViewCreate(webView: WebView) {
		super.onWebViewCreate(webView)
		webViewRef = webView
		webView.addJavascriptInterface(InsetsInterface(), "__AndroidInsets")
		webView.addJavascriptInterface(DiscreetModeInterface(), "__DiscreetMode")
		webView.addJavascriptInterface(BackgroundServiceInterface(), "__BackgroundService")
		// Deliver any deep link that arrived before the webview existed.
		deliverPendingDeepLink()
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

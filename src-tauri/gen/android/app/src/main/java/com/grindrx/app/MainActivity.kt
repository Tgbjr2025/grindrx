package com.grindrx.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
	// @Volatile because these are read from the WebView's JS-bridge thread, not
	// the UI thread that writes them in the insets listener. Without it the JS
	// side can read a stale (or torn) value.
	@Volatile private var insetsTop = 0
	@Volatile private var insetsBottom = 0
	@Volatile private var insetsLeft = 0
	@Volatile private var insetsRight = 0

	/**
	 * Whether the soft keyboard is currently up, exposed to JS as
	 * `__AndroidInsets.imeVisible()`.
	 *
	 * The frontend needs to tell a keyboard transition apart from any other inset
	 * change at all — `android-native-bridge.ts` defers applying new insets until
	 * the WebView actually resizes and only when the IME visibility flipped, so
	 * `--safe-area-*` does not jump ahead of the layout. `softKeyboardVisibility()`
	 * reads the same flag.
	 */
	@Volatile private var imeVisibleNow = false

	private var webViewRef: WebView? = null

	/**
	 * Safe-area insets in dp, exposed to the WebView as `window.__AndroidInsets`.
	 * Restored because `src/lib/android-native-bridge.ts` reads all five members;
	 * with the interfaces absent it silently degrades every `--safe-area-*` value
	 * to 0 and content draws under the status bar and the gesture pill.
	 */
	inner class InsetsInterface {
		@JavascriptInterface fun top() = insetsTop
		@JavascriptInterface fun bottom() = insetsBottom
		@JavascriptInterface fun left() = insetsLeft
		@JavascriptInterface fun right() = insetsRight
		@JavascriptInterface fun imeVisible() = imeVisibleNow
	}

	/**
	 * `window.__AndroidBack.moveTaskToBack()` — hand the app to the launcher.
	 *
	 * Kept because `android-native-bridge.ts:127` calls it on back when no JS
	 * handler claims the gesture, which is the difference between "back does
	 * nothing" and "back exits".
	 */
	inner class AndroidBackInterface {
		@JavascriptInterface fun moveTaskToBack() = moveTaskToBack(true)
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		enableEdgeToEdge()
		// Must run before any keyring call. android-native-keyring-store reads
		// ndk_context::android_context(), a thread-local initialised only by this
		// JNI entry point. Without it every keyring access on a spawn_blocking
		// thread panics "android context was not initialized", which tauri-macros'
		// stop_unwind turns into a SIGABRT.
		Keyring.initializeNdkContext(applicationContext)
		createNotificationChannel()
		// Hand this install's FCM token to the server so release pushes have a
		// recipient. onNewToken alone is NOT enough: it only fires when the token
		// is first issued or ROTATED, so an install that launched once and kept
		// its token would never be registered at all. No-op if no token yet.
		FcmMessagingService.registerIfKnown(applicationContext)
		super.onCreate(savedInstanceState)

		// Hide the app's snapshot from the recents/multitasker switcher, where chat
		// text, profile photos and precise location would otherwise sit exposed.
		// Deliberately NOT WindowManager.LayoutParams.FLAG_SECURE: that would also
		// block screenshots and screen recording, which the operator requires to
		// work. This is the narrower API-33+ control.
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
			setRecentsScreenshotEnabled(false)
		}

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
			imeVisibleNow = isImeVisible

			// The WebView is a sibling of the decor content, so the system IME
			// inset has to be applied as a bottom margin on it. Done in px: the
			// listener supplies px and the view is laid out in px.
			val bottomMargin = if (isImeVisible) ime.bottom else 0
			webViewRef?.let { wv ->
				(wv.layoutParams as? ViewGroup.MarginLayoutParams)?.let { params ->
					if (params.bottomMargin != bottomMargin) {
						params.bottomMargin = bottomMargin
						wv.layoutParams = params
					}
				}
			}

			// Ask the frontend to re-read the insets rather than pushing values
			// across; it owns the CSS-variable bookkeeping.
			webViewRef?.evaluateJavascript("window.__reapplyInsets?.()", null)

			ViewCompat.onApplyWindowInsets(view, insets)
		}
	}

	override fun onWebViewCreate(webView: WebView) {
		super.onWebViewCreate(webView)
		webViewRef = webView
		webView.addJavascriptInterface(InsetsInterface(), "__AndroidInsets")
		webView.addJavascriptInterface(AndroidBackInterface(), "__AndroidBack")
		// Discreet app icon. Without this the settings toggle gates itself off
		// and the feature is unreachable with no error anywhere.
		webView.addJavascriptInterface(DiscreetModeInterface(), "__DiscreetMode")
	}

	override fun onDestroy() {
		// P1-007: the interfaces are held by the WebView, but the Kotlin-side
		// references outlive it if not dropped. Clearing here means a recreated
		// WebView cannot dispatch into a destroyed Activity.
		webViewRef = null
		super.onDestroy()
	}

	/**
	 * Give the WebView first refusal on the back gesture.
	 *
	 * `android-native-bridge.ts` installs `window.__AndroidOnBackGesture`, which
	 * returns true when a handler claimed the gesture. The result is stringified
	 * into the WebView, so compare against "true" rather than a boolean.
	 */
	override fun onBackPressed() {
		webViewRef?.evaluateJavascript(
			"try { window.__AndroidOnBackGesture?.() } catch (error) { console.error(error); true; }".trimIndent()
		) { result ->
			if (result == "true") {
				super.onBackPressed()
			}
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

	/**
	 * Discreet icon toggle — restored 2026-10-11.
	 *
	 * Both `activity-alias` entries had been removed from the manifest while
	 * `DiscreetIconSetting.svelte` was left in place. That component sets
	 * `available` only when this bridge exists, and renders nothing at all
	 * otherwise — so with the bridge gone the setting silently disappeared from
	 * the app rather than reporting itself unavailable.
	 *
	 * The alias names here MUST match the manifest, or the toggle flips
	 * something that does not exist and the home-screen icon never changes.
	 */
	inner class DiscreetModeInterface {
		private val pm: PackageManager get() = applicationContext.packageManager

		@JavascriptInterface
		fun isDiscreet(): Boolean = pm.getComponentEnabledSetting(
			ComponentName(applicationContext, "$packageName.WeatherAlias"),
		) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED

		/**
		 * Must disable the OTHER alias alongside enabling this one. Android
		 * offers the user every enabled launcher entry, so leaving the main
		 * alias on would put two icons on the home screen and the feature would
		 * half-work rather than switch.
		 */
		@JavascriptInterface
		fun setDiscreet(discreet: Boolean) {
			val weather = ComponentName(applicationContext, "$packageName.WeatherAlias")
			val main = ComponentName(applicationContext, "$packageName.MainAlias")
			val target = if (discreet) weather else main
			val other = if (discreet) main else weather
			// Component name order matters: every alias for a target activity has
			// to be set in one call or the launcher can cache a mixed state.
			pm.setComponentEnabledSetting(
				other,
				PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
				PackageManager.DONT_KILL_APP,
			)
			pm.setComponentEnabledSetting(
				target,
				PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
				PackageManager.DONT_KILL_APP,
			)
		}
	}
}

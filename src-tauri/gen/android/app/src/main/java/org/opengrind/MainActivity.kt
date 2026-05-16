package org.opengrind

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

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        Keyring.initializeNdkContext(applicationContext)
        super.onCreate(savedInstanceState)

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
    }
}

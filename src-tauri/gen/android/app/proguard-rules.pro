# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ---------------------------------------------------------------------------
# REQUIRED: keep the @JavascriptInterface bridges.
#
# The release build type runs R8 (isMinifyEnabled = true in build.gradle.kts),
# and MainActivity registers three interfaces that JavaScript reaches BY NAME
# ONLY, via WebView.addJavascriptInterface (MainActivity.kt:205-207):
#
#   __AndroidInsets     -> insets top/bottom/left/right + edge-to-edge insets
#   __DiscreetMode      -> the weather-icon alias / discreet app mode
#   __BackgroundService -> the keep-alive foreground service handshake
#
# Nothing in Rust, Kotlin or JS references these members by their Kotlin symbol
# name, so R8 sees no call sites and would strip or rename them. The symptom is
# silent: the app builds, installs and launches, and only the bridged features
# break (missing insets, no discreet mode, no background service). The only
# @JavascriptInterface keep rule in the Tauri consumer rules
# (generated/proguard-wry.pro:21-25) is scoped to the single class
# org.opengrind.Ipc, so it covers none of these three.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# The interfaces themselves are instantiated directly in MainActivity (R8 sees
# those call sites, so the classes survive), but keep their names so the bridge
# stays greppable in logcat and in any future WebView-side lookup.
-keepnames class org.opengrind.MainActivity$*

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
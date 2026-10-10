package com.grindrx.app

import android.content.Context
import android.content.SharedPreferences

/**
 * Holder for the Firebase Cloud Messaging registration token.
 *
 * The token is written by [FcmMessagingService] whenever Firebase issues or
 * rotates it, and read from Rust via the `fcm_token` Tauri command. It is
 * deliberately kept in SharedPreferences rather than the keyring: the token is
 * not a user secret, it changes on rotation, and routing it through the
 * Android Keystore would reintroduce the DecryptionFailure failure mode if the
 * lock screen changes.
 *
 * `exclude` rules in res/xml/data_extraction_rules.xml already keep it out of
 * cloud backup and device-to-device transfer.
 */
object FcmTokenStore {
    private const val PREFS = "grindrx_fcm"
    private const val KEY_TOKEN = "registration_token"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun set(context: Context, token: String) {
        prefs(context).edit().putString(KEY_TOKEN, token).apply()
    }

    fun get(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_TOKEN).apply()
    }
}
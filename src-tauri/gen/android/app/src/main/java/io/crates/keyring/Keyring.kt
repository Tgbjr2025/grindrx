package io.crates.keyring

import android.content.Context

class Keyring {
    companion object {
        init {
            System.loadLibrary("open_grind_lib")
        }

        external fun initializeNdkContext(context: Context)
    }
}

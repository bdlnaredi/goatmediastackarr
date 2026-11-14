package com.bdlnaredi.goatstack

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bdlnaredi.goatstack.data.Phase
import com.bdlnaredi.goatstack.ui.GoatRoot
import com.bdlnaredi.goatstack.ui.theme.GoatTheme

// A FragmentActivity (still a ComponentActivity) so the fingerprint/face prompt can be shown over it.
class MainActivity : androidx.fragment.app.FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val state = (application as GoatApp).state
        installSplashScreen().setKeepOnScreenCondition { state.phase.value is Phase.Starting }
        super.onCreate(savedInstanceState)
        state.openLink(intent?.getStringExtra("link"))
        enableEdgeToEdge()
        setContent {
            val theme by state.theme.collectAsStateWithLifecycle()
            val prefs by state.prefs.collectAsStateWithLifecycle()
            GoatTheme(theme, prefs.style) { GoatRoot(state) }
        }
    }

    // Away for more than a minute (or the app opened again from the launcher): the PIN, if there is one.
    override fun onStop() { super.onStop(); (application as GoatApp).state.wentAway() }
    override fun onStart() { super.onStart(); (application as GoatApp).state.cameBack() }

    // A notification tapped while the app is already open.
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        (application as GoatApp).state.openLink(intent.getStringExtra("link"))
    }
}

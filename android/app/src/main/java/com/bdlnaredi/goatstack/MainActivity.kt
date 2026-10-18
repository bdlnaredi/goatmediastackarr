package com.bdlnaredi.goatstack

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bdlnaredi.goatstack.data.Phase
import com.bdlnaredi.goatstack.ui.GoatRoot
import com.bdlnaredi.goatstack.ui.theme.GoatTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val state = (application as GoatApp).state
        installSplashScreen().setKeepOnScreenCondition { state.phase.value is Phase.Starting }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val theme by state.theme.collectAsStateWithLifecycle()
            GoatTheme(theme) { GoatRoot(state) }
        }
    }
}

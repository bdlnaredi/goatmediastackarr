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
        state.share(sharedFrom(intent))
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
        (application as GoatApp).state.share(sharedFrom(intent))
    }

    /** What another app shared or opened with this one: a link or text, a magnet link, or a .torrent file. */
    private fun sharedFrom(i: android.content.Intent?): com.bdlnaredi.goatstack.data.Shared? {
        if (i == null) return null
        val stream: android.net.Uri? = when (i.action) {
            android.content.Intent.ACTION_SEND -> if (android.os.Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(android.content.Intent.EXTRA_STREAM, android.net.Uri::class.java)
                else @Suppress("DEPRECATION") i.getParcelableExtra(android.content.Intent.EXTRA_STREAM)
            android.content.Intent.ACTION_VIEW -> i.data?.takeIf { it.scheme == "content" || it.scheme == "file" }
            else -> null
        }
        if (stream != null) return try {
            val bytes = contentResolver.openInputStream(stream)?.use { s -> s.readNBytesCompat(2_000_001) } ?: return null
            if (com.bdlnaredi.goatstack.data.Shared.isTorrent(bytes)) com.bdlnaredi.goatstack.data.Shared.TorrentFile(stream.lastPathSegment?.substringAfterLast('/')?.takeIf { it.endsWith(".torrent") } ?: "shared.torrent", bytes)
            else com.bdlnaredi.goatstack.data.Shared.Unknown("That file is not a .torrent file.")
        } catch (_: Exception) { com.bdlnaredi.goatstack.data.Shared.Unknown("The app could not read that file.") }
        return when (i.action) {
            android.content.Intent.ACTION_SEND -> com.bdlnaredi.goatstack.data.Shared.parse(listOfNotNull(i.getStringExtra(android.content.Intent.EXTRA_TEXT), i.getStringExtra(android.content.Intent.EXTRA_SUBJECT)).joinToString(" "))
            android.content.Intent.ACTION_VIEW -> com.bdlnaredi.goatstack.data.Shared.parse(i.dataString)
            else -> null
        }
    }

    private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(16384)
        while (out.size() < max) { val n = read(buf); if (n < 0) break; out.write(buf, 0, n) }
        return out.toByteArray()
    }
}

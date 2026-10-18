package com.bdlnaredi.goatstack

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bdlnaredi.goatstack.data.AppState
import com.bdlnaredi.goatstack.data.Phase
import com.bdlnaredi.goatstack.data.Store
import com.bdlnaredi.goatstack.ui.GoatRoot
import com.bdlnaredi.goatstack.ui.Tuning
import com.bdlnaredi.goatstack.ui.theme.GoatTheme
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Opens every main screen against a pretend server and photographs it. A screen that crashes, or that cannot
 * read what the server sends, fails here. The pictures land in build/outputs/roborazzi when recording.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h880dp-xxhdpi")
class ScreensTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: MockWebServer
    private lateinit var fake: FakeServer
    private lateinit var state: AppState

    @Before fun start() {
        Tuning.still = true
        server = MockWebServer()
        fake = FakeServer(server)
        server.dispatcher = fake
        server.start()
        val store = Store(ApplicationProvider.getApplicationContext())
        runBlocking { store.setServer("") }
        state = AppState(store)
    }

    @After fun stop() { server.shutdown() }

    private fun show() {
        compose.setContent {
            val t by state.theme.collectAsStateWithLifecycle()
            GoatTheme(t) { GoatRoot(state) }
        }
    }

    private fun waitFor(text: String, timeout: Long = 20_000) {
        try {
            compose.waitUntil(timeout) { compose.onAllNodesWithText(text, substring = true, ignoreCase = true).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: Throwable) {
            // Say what was on screen instead, so a failure explains itself.
            val seen = compose.onAllNodes(androidx.compose.ui.test.isRoot()).fetchSemanticsNodes().flatMap { root ->
                fun texts(n: androidx.compose.ui.semantics.SemanticsNode): List<String> =
                    n.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.Text) { emptyList() }.map { t -> t.text } + n.children.flatMap { texts(it) }
                texts(root)
            }
            runCatching { shot("zz-failed-waiting-for-${text.replace(Regex("[^A-Za-z0-9]+"), "-")}") }
            throw AssertionError("Waited for \"$text\". On screen: ${seen.take(40)}. Server calls: ${fake.calls.takeLast(12)}", e)
        }
    }

    /** Lets pictures arrive from the pretend server before the photo is taken. */
    private fun settle(ms: Long = 1500) {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) { compose.mainClock.advanceTimeBy(100); Thread.sleep(50) }
        compose.waitForIdle()
    }

    private fun shot(name: String) { settle(); compose.onRoot().captureRoboImage("build/outputs/roborazzi/$name.png") }

    private fun tap(text: String) {
        compose.onAllNodes(hasText(text) and hasClickAction()).onFirst().performClick()
        compose.waitForIdle()
    }

    private fun back() { compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }; compose.waitForIdle() }

    private fun connect() {
        val err = runBlocking { state.connect(server.url("/").toString()) }
        assertTrue("connecting failed: $err", err == null)
    }

    @Test fun signInScreens() {
        fake.signedIn = false
        show()
        waitFor("Server address")
        shot("01-server")
        connect()
        waitFor("Sign in with Plex")
        shot("02-sign-in")
    }

    @Test fun mainScreens() {
        connect()
        assertTrue(state.phase.value is Phase.Ready)
        show()
        waitFor("Playing now")
        shot("03-home")

        tap("Discover"); waitFor("Trending"); waitFor("Quiet Orbit"); shot("04-discover")
        tap("Library"); waitFor("Your shows"); waitFor("Paper Moon"); shot("05-library")
        compose.onAllNodesWithText("Paper Moon").onFirst().performClick(); waitFor("Monitored"); waitFor("Search now"); shot("06-show")
        back()
        tap("Downloads"); waitFor("Downloading"); shot("07-downloads")
        tap("More"); waitFor("Go to"); shot("08-more")
        tap("Requests"); waitFor("Waiting for approval"); shot("09-requests"); back()
        tap("Upcoming"); waitFor("Being downloaded"); shot("10-upcoming"); back()
        tap("Stack"); waitFor("VPN connected"); shot("11-stack"); back()
        tap("Settings"); waitFor("Appearance"); shot("12-settings")
        tap("Paper"); settle(500); shot("13-settings-paper")
        back(); tap("Home"); waitFor("Playing now"); shot("14-home-paper")
        for (t in listOf("midnight", "aurora", "ember")) {
            compose.runOnUiThread { state.setTheme(t) }; compose.waitForIdle(); shot("15-home-$t")
        }

        // Every call the screens made was one the server knows.
        val unknown = fake.calls.filter { c -> listOf("/api/", "/img/").none { c.contains(it) } }
        assertTrue("unexpected calls: $unknown", unknown.isEmpty())
    }
}

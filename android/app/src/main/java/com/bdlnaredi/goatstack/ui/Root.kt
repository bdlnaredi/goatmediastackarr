package com.bdlnaredi.goatstack.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.bdlnaredi.goatstack.data.AppState
import com.bdlnaredi.goatstack.data.Me
import com.bdlnaredi.goatstack.data.Phase
import com.bdlnaredi.goatstack.data.User
import com.bdlnaredi.goatstack.ui.screens.DetailScreen
import com.bdlnaredi.goatstack.ui.screens.DiscoverScreen
import com.bdlnaredi.goatstack.ui.screens.DownloadsScreen
import com.bdlnaredi.goatstack.ui.screens.HomeScreen
import com.bdlnaredi.goatstack.ui.screens.LibraryScreen
import com.bdlnaredi.goatstack.ui.screens.LoginScreen
import com.bdlnaredi.goatstack.ui.screens.MoreScreen
import com.bdlnaredi.goatstack.ui.screens.OfflineScreen
import com.bdlnaredi.goatstack.ui.screens.RequestsScreen
import com.bdlnaredi.goatstack.ui.screens.SearchScreen
import com.bdlnaredi.goatstack.ui.screens.ServerScreen
import com.bdlnaredi.goatstack.ui.screens.SettingsScreen
import com.bdlnaredi.goatstack.ui.screens.StackScreen
import com.bdlnaredi.goatstack.ui.screens.UpcomingScreen
import com.bdlnaredi.goatstack.ui.theme.LocalGoat

/** Everything a screen needs: the server connection, who is signed in, and a way to move around. */
class Ctx(val app: AppState, val me: Me, val user: User, val nav: NavHostController) {
    val api get() = app.api
    fun go(route: String) = nav.navigate(route) { launchSingleTop = true }
    fun back() { nav.popBackStack() }
    fun item(sid: String, kind: String, id: Long) = go("item/$sid/$kind/$id")
}

val LocalCtx = staticCompositionLocalOf<Ctx> { error("No context") }

@Composable
fun GoatRoot(state: AppState) {
    val phase by state.phase.collectAsStateWithLifecycle()
    val g = LocalGoat.current
    Box(Modifier.fillMaxSize().background(g.bg)) {
        AnimatedContent(targetState = phase, transitionSpec = { fadeIn() togetherWith fadeOut() },
            contentKey = { it::class }, label = "phase") { p ->
            when (p) {
                is Phase.Starting -> Box(Modifier.fillMaxSize())
                is Phase.NeedServer -> ServerScreen(state)
                is Phase.NeedLogin -> LoginScreen(state, p.me)
                is Phase.Offline -> OfflineScreen(state, p.message)
                is Phase.Ready -> MainShell(state, p.me, p.user)
            }
        }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("home", "Home", Icons.Rounded.Home),
    Tab("discover", "Discover", Icons.Rounded.Explore),
    Tab("library", "Library", Icons.Rounded.GridView),
    Tab("downloads", "Downloads", Icons.Rounded.Download),
    Tab("more", "More", Icons.Rounded.MoreHoriz),
)

@Composable
private fun MainShell(state: AppState, me: Me, user: User) {
    val nav = rememberNavController()
    val ctx = Ctx(state, me, user, nav)
    val g = LocalGoat.current
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "home"
    val showBar = TABS.any { it.route == route }
    CompositionLocalProvider(LocalCtx provides ctx) {
        Scaffold(
            containerColor = g.bg,
            bottomBar = {
                if (showBar) NavigationBar(containerColor = g.surface, tonalElevation = androidx.compose.ui.unit.Dp(0f)) {
                    TABS.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = {
                                nav.navigate(t.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true; restoreState = true
                                }
                            },
                            icon = { Icon(t.icon, contentDescription = t.label) },
                            label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = g.onPrimary, indicatorColor = g.primary, selectedTextColor = g.primary,
                                unselectedIconColor = g.muted, unselectedTextColor = g.muted,
                            ),
                        )
                    }
                }
            },
        ) { pad ->
            NavHost(nav, startDestination = "home", modifier = Modifier.padding(pad)) {
                composable("home") { HomeScreen() }
                composable("discover") { DiscoverScreen() }
                composable("library") { LibraryScreen() }
                composable("downloads") { DownloadsScreen() }
                composable("more") { MoreScreen() }
                composable("search") { SearchScreen() }
                composable("requests") { RequestsScreen() }
                composable("upcoming") { UpcomingScreen() }
                composable("stack") { StackScreen() }
                composable("settings") { SettingsScreen() }
                composable(
                    "item/{sid}/{kind}/{id}",
                    arguments = listOf(navArgument("sid") { type = NavType.StringType }, navArgument("kind") { type = NavType.StringType }, navArgument("id") { type = NavType.LongType }),
                ) { e ->
                    val a = e.arguments!!
                    DetailScreen(a.getString("sid").orEmpty(), a.getString("kind").orEmpty(), a.getLong("id"))
                }
            }
        }
    }
}

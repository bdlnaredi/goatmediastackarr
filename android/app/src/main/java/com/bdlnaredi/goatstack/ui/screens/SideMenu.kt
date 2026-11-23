package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Book
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.tr
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat

/**
 * The side menu (☰ at the top left of the main pages, or a swipe from the left edge): the apps of the stack first,
 * each opening its own page in the app, then every other page, and Settings last.
 */
@Composable
fun SideMenu(route: String, close: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val uri = LocalUriHandler.current
    val admin = ctx.user.admin
    val apps = services().mapNotNull { s -> appDest(s, admin)?.let { s to it } }
    val groups = moreGroups().map { (name, list) -> name to list.filter { it.title != "Settings" } }.filter { it.second.isNotEmpty() }
    val pick = { go: () -> Unit -> close(); go() }
    LazyColumn(Modifier.fillMaxHeight().testTag("menu"), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(Modifier.fillMaxWidth().clickable { pick { ctx.profile() } }.padding(horizontal = 20.dp, vertical = 18.dp),
                verticalAlignment = Alignment.CenterVertically) {
                com.bdlnaredi.goatstack.ui.Avatar(ctx.user.avatar, ctx.user.name, 48.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(ctx.user.name, style = MaterialTheme.typography.titleMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(tr("Go to any page"), style = MaterialTheme.typography.bodySmall, color = g.muted)
                }
            }
        }
        if (apps.isNotEmpty()) {
            item(key = "hApps") { SideHeader("Apps") }
            apps.forEach { (s, d) ->
                item(key = "a${s.id}") {
                    SideRow(d.icon, s.name, d.text, on = false) {
                        pick {
                            when (d.go) {
                                "library", "downloads" -> { ctx.app.openService.value = s.id; ctx.tab(d.go) }
                                "web" -> runCatching { uri.openUri(if (s.managed) ctx.api.base.trimEnd('/') + "/engines/${s.type}/" else s.url) }
                                else -> ctx.go(d.go)
                            }
                        }
                    }
                }
            }
        }
        groups.forEach { (name, list) ->
            item(key = "h$name") { SideHeader(name) }
            list.forEach { d -> item(key = "d$name${d.title}") { SideRow(d.icon, d.title, d.text, on = false) { pick(d.go) } } }
        }
        item(key = "settings") {
            Box(Modifier.padding(top = 10.dp).fillMaxWidth().height(1.dp).background(g.line))
            SideRow(Icons.Rounded.Settings, "Settings", "Style, theme, account, devices", on = route == "settings") { pick { ctx.go("settings") } }
        }
    }
}

/** What an app of the stack opens: one of the app's pages (a route), its library or downloads, or its own web page. */
private data class AppDest(val icon: ImageVector, val text: String, val go: String)

private fun appDest(s: Service, admin: Boolean): AppDest? = when (s.type) {
    "sonarr" -> AppDest(Icons.Rounded.Tv, "Your shows", "library")
    "radarr" -> AppDest(Icons.Rounded.Movie, "Your movies", "library")
    in TORRENT_CLIENTS -> AppDest(Icons.Rounded.Download, "Its torrents", "downloads")
    "sabnzbd" -> AppDest(Icons.Rounded.Dns, "Its Usenet downloads", "downloads")
    "prowlarr" -> if (admin) AppDest(Icons.Rounded.TravelExplore, "The sites it searches", "indexers") else null
    "lidarr" -> AppDest(Icons.Rounded.LibraryMusic, "Your artists", "music")
    "bazarr" -> AppDest(Icons.Rounded.Subtitles, "Missing subtitles", "subtitles")
    "tautulli" -> AppDest(Icons.Rounded.Insights, "What gets watched", "stats")
    "seerr" -> AppDest(Icons.Rounded.Inbox, "What people asked for", "requests")
    "unraid" -> if (admin) AppDest(Icons.Rounded.Storage, "Array, disks, containers", "unraid") else null
    // The rest: their own web page (signing in to GoatMediaStackarr in the browser once, for the apps inside it).
    else -> if (!admin) null else AppDest(when (s.type) {
        "plex", "jellyfin" -> Icons.Rounded.PlayCircle
        "readarr" -> Icons.Rounded.Book
        "jackett" -> Icons.Rounded.TravelExplore
        else -> Icons.Rounded.Apps
    }, "Opens its own page", "web")
}

@Composable
private fun SideHeader(title: String) {
    val st = com.bdlnaredi.goatstack.ui.theme.LocalStyle.current
    Text(tr(title).let { if (st.capsSections) it.uppercase() else it }, style = MaterialTheme.typography.labelLarge, color = LocalGoat.current.primary,
        fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 24.dp, end = 20.dp, top = 16.dp, bottom = 4.dp))
}

@Composable
private fun SideRow(icon: ImageVector, title: String, text: String, on: Boolean, onClick: () -> Unit) {
    val g = LocalGoat.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 1.dp).clip(RoundedCornerShape(14.dp))
        .background(if (on) g.primary.copy(alpha = 0.14f) else androidx.compose.ui.graphics.Color.Transparent)
        .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(g.primary.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = g.primary, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(tr(title), style = MaterialTheme.typography.bodyLarge, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(tr(text), style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

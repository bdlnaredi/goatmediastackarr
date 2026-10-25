package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.MoveDown
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.RssFeed
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SyncAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bdlnaredi.goatstack.BuildConfig
import com.bdlnaredi.goatstack.data.GoatStatus
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Dot
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PageTitle
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.GoatPalette
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import com.bdlnaredi.goatstack.ui.theme.Themes
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ---------- Stack: the apps inside the container ----------

private val ENGINE_NOTES = mapOf(
    "sonarr" to "Shows", "radarr" to "Movies", "lidarr" to "Music", "prowlarr" to "Indexers", "bazarr" to "Subtitles",
    "qbittorrent" to "Torrents", "rutorrent" to "Torrents · page on port 8090", "deluge" to "Torrents · page on port 8112", "sabnzbd" to "Usenet", "jellyfin" to "Media server", "plex" to "Media server",
    "seerr" to "Requests", "tautulli" to "Plex statistics", "flaresolverr" to "Cloudflare helper",
)

@Composable
fun StackScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var busy by remember { mutableStateOf<String?>(null) }
    var stopping by remember { mutableStateOf<com.bdlnaredi.goatstack.data.Engine?>(null) }
    val data = rememberLoad { ctx.api.get<GoatStatus>("/api/goat/status") }
    AutoRefresh(8000) { data.reload() }

    fun run(label: String, what: String, path: String, body: kotlinx.serialization.json.JsonObject) {
        busy = what
        scope.launch {
            try { ctx.api.send("POST", path, body); toast(label); data.reload() } catch (e: Exception) { toast(e.message ?: "That did not work") }
            busy = null
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.statusBarsPadding().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { ctx.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text) }
            PageTitle("Stack", "The apps inside GoatMediaStackarr", Modifier.weight(1f))
        }
        if (!ctx.user.admin || !ctx.me.goat) { EmptyState(Icons.Rounded.Shield, "Admins only", "Only an admin can see and restart the apps inside the container."); return@Column }
        LoadView(data) { st ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    val up = st.vpn.state == "up"
                    GoatCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(44.dp).clip(CircleShape).background((if (!st.vpn.enabled) g.muted else if (up) g.good else g.bad).copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.Shield, null, tint = if (!st.vpn.enabled) g.muted else if (up) g.good else g.bad)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(if (!st.vpn.enabled) "VPN off" else if (up) "VPN connected" else "VPN not connected", style = MaterialTheme.typography.titleMedium, color = g.text)
                                Text(when {
                                    !st.vpn.enabled -> "The download apps use your own connection."
                                    up -> listOf(st.vpn.country, st.vpn.ip, if (st.vpn.port.isNotEmpty()) "port ${st.vpn.port}" else "").filter { it.isNotEmpty() }.joinToString(" · ")
                                    else -> st.vpn.message.ifEmpty { "The download apps are kept offline until it connects." }
                                }, style = MaterialTheme.typography.bodySmall, color = g.muted)
                            }
                        }
                        if (st.vpn.enabled) {
                            Spacer(Modifier.height(12.dp))
                            GhostButton(if (busy == "vpn") "Reconnecting…" else "Reconnect the VPN", icon = Icons.Rounded.SyncAlt, enabled = busy == null, modifier = Modifier.fillMaxWidth(),
                                onClick = { run("Reconnecting the VPN", "vpn", "/api/goat/apply-vpn", buildJsonObject { }) })
                        }
                    }
                }
                item { SectionTitle("Apps", Modifier.padding(top = 6.dp)) }
                st.engines.forEach { e ->
                    item(key = e.key) {
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Dot(if (e.stopped) g.muted else when (e.ok) { true -> g.good; false -> g.bad; null -> g.muted }, 11.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(e.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    Text(if (e.stopped) "Stopped. Tap Start to run it again; a container restart also starts it." else listOf(ENGINE_NOTES[e.key] ?: e.key, e.version).filter { it.isNotEmpty() }.joinToString(" · "),
                                        style = MaterialTheme.typography.labelSmall, color = if (e.stopped) g.warn else g.muted)
                                }
                                if (busy == e.key) CircularProgressIndicator(Modifier.size(20.dp), color = g.primary, strokeWidth = 2.dp)
                                else if (e.stopped) IconButton(enabled = busy == null, onClick = { run("Starting ${e.name}", e.key, "/api/goat/start", buildJsonObject { put("engine", e.key) }) }) {
                                    Icon(Icons.Rounded.PlayArrow, "Start ${e.name}", tint = g.good)
                                }
                                else {
                                    IconButton(enabled = busy == null, onClick = { run("Restarting ${e.name}", e.key, "/api/goat/restart", buildJsonObject { put("engine", e.key) }) }) {
                                        Icon(Icons.Rounded.RestartAlt, "Restart ${e.name}", tint = g.muted)
                                    }
                                    IconButton(enabled = busy == null, onClick = { stopping = e }) { Icon(Icons.Rounded.Stop, "Stop ${e.name}", tint = g.bad) }
                                }
                            }
                        }
                    }
                }
                val steps = st.wired?.steps.orEmpty()
                if (steps.isNotEmpty()) {
                    item { SectionTitle("Connections", Modifier.padding(top = 6.dp)) }
                    item {
                        GoatCard(Modifier.fillMaxWidth()) {
                            steps.forEach { (k, v) ->
                                Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
                                    Icon(if (v.ok) Icons.Rounded.Check else Icons.Rounded.Hub, null, tint = if (v.ok) g.good else g.bad, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(10.dp))
                                    Column {
                                        Text(k.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyMedium, color = g.text)
                                        if (!v.ok && v.error != null) Text(v.error, style = MaterialTheme.typography.bodySmall, color = g.muted)
                                    }
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            GhostButton(if (st.wired?.running == true) "Connecting…" else "Connect the apps again", icon = Icons.Rounded.Hub, enabled = busy == null && st.wired?.running != true,
                                modifier = Modifier.fillMaxWidth(), onClick = { run("Connecting the apps again", "wire", "/api/goat/rewire", buildJsonObject { }) })
                        }
                    }
                }
                st.counts?.let { c ->
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                            c.indexers?.let { Badge("$it indexer${if (it == 1) "" else "s"}", if (it > 0) g.good else g.warn) }
                            c.newsServers?.let { Badge("$it news server${if (it == 1) "" else "s"}", if (it > 0) g.good else g.muted) }
                        }
                    }
                }
            }
        }
        stopping?.let { e ->
            Confirm("Stop ${e.name}?", "It stays stopped until you start it again or the container restarts. Anything that needs it (requests, downloads) waits.", "Stop", danger = true,
                onYes = { stopping = null; run("Stopping ${e.name}", e.key, "/api/goat/stop", buildJsonObject { put("engine", e.key) }) }, onNo = { stopping = null })
        }
    }
}

// ---------- More ----------

@Composable
private fun MenuRow(icon: ImageVector, title: String, text: String, onClick: () -> Unit) {
    val g = LocalGoat.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(g.primary.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = g.primary)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = g.text)
            Text(text, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = g.muted)
    }
}

/** One page in the More grid: an icon, its name and a line about it. */
private data class Dest(val icon: ImageVector, val title: String, val text: String, val go: () -> Unit)

@Composable
private fun DestTile(d: Dest, modifier: Modifier) {
    val g = LocalGoat.current
    val st = com.bdlnaredi.goatstack.ui.theme.LocalStyle.current
    val shape = RoundedCornerShape(st.corner)
    Column(
        modifier.clip(shape).background(g.card.copy(alpha = st.cardAlpha))
            .then(if (st.border) Modifier.border(1.dp, g.line.copy(alpha = 0.7f), shape) else Modifier)
            .clickable(onClick = d.go).padding((12 * st.density).dp),
    ) {
        Box(Modifier.size(if (st.density < 0.9f) 32.dp else 40.dp).clip(RoundedCornerShape(st.buttonCorner)).background(g.primary.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(d.icon, null, tint = g.primary, modifier = Modifier.size(if (st.density < 0.9f) 18.dp else 22.dp))
        }
        Spacer(Modifier.height((8 * st.density).dp))
        Text(com.bdlnaredi.goatstack.data.tr(d.title), style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(com.bdlnaredi.goatstack.data.tr(d.text), style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Every other page, grouped the same way as the web page's menu: Watch, Requests, Downloads, Server, and You.
 * The bottom bar keeps Home, Discover, Library and Downloads one tap away.
 */
@Composable
fun MoreScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val svcs = services()
    val has = { t: String -> svcs.any { it.type == t } }
    val admin = ctx.user.admin
    val groups = listOf(
        "Watch" to listOfNotNull(
            if (ctx.user.kids == null) Dest(Icons.Rounded.Search, "Search", "Find a show or movie") { ctx.go("search") } else null,
            if (ctx.user.kids == null) Dest(Icons.Rounded.Bookmark, "Watchlist", "What you want to watch") { ctx.go("watchlist") } else null,
            Dest(Icons.Rounded.CalendarMonth, "Upcoming", "New episodes and releases") { ctx.go("upcoming") },
            if (has("lidarr")) Dest(Icons.Rounded.LibraryMusic, "Music", "Your artists, from Lidarr") { ctx.go("music") } else null,
            if (has("tautulli")) Dest(Icons.Rounded.Insights, "Stats", "What gets watched") { ctx.go("stats") } else null,
        ),
        "Requests" to listOfNotNull(
            Dest(Icons.Rounded.Inbox, "Requests", if (admin) "Approve what people asked for" else "What you asked for") { ctx.go("requests") },
            if (has("sonarr") || has("radarr")) Dest(Icons.Rounded.Search, "Wanted", "Still being looked for") { ctx.go("wanted") } else null,
        ),
        "Downloads" to listOfNotNull(
            if (has("qbittorrent")) Dest(Icons.Rounded.RssFeed, "RSS", "Feeds and auto-download rules") { ctx.go("rss") } else null,
            if (admin && has("qbittorrent")) Dest(Icons.Rounded.Language, "Trackers", "Search or browse trackers") { ctx.go("trackers") } else null,
            if (admin && has("prowlarr")) Dest(Icons.Rounded.TravelExplore, "Indexers", "The sites Prowlarr searches") { ctx.go("indexers") } else null,
            if (admin && has("sabnzbd")) Dest(Icons.Rounded.Dns, "Usenet servers", "Your news servers") { ctx.go("newsservers") } else null,
            if (has("bazarr")) Dest(Icons.Rounded.Subtitles, "Subtitles", "Missing subtitles") { ctx.go("subtitles") } else null,
        ),
        "Server" to if (!admin) emptyList() else listOfNotNull(
            if (ctx.me.goat) Dest(Icons.Rounded.Shield, "Stack", "VPN, apps and logins") { ctx.go("stack") } else null,
            Dest(Icons.Rounded.HealthAndSafety, "Health", "Problems and disk space") { ctx.go("health") },
            if (has("unraid")) Dest(Icons.Rounded.Storage, "Unraid", "Array, disks, containers") { ctx.go("unraid") } else null,
            Dest(Icons.Rounded.Group, "Users", "Who can sign in") { ctx.go("users") },
            if (ctx.me.goat) Dest(Icons.Rounded.MoveDown, "Bring in your setup", "From the apps you use now") { ctx.go("import") } else null,
        ),
        "You" to listOf(
            Dest(Icons.Rounded.Person, "Profile", "Picture, space and watch time") { ctx.profile() },
            Dest(Icons.Rounded.Settings, "Settings", "Style, theme, account, devices") { ctx.go("settings") },
            Dest(Icons.Rounded.AutoAwesome, "What's new", "Changes in each version") { ctx.go("whatsnew") },
        ),
    ).filter { it.second.isNotEmpty() }
    LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { PageTitle("More", "Go to any page") }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), onClick = { ctx.profile() }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    com.bdlnaredi.goatstack.ui.Avatar(ctx.user.avatar, ctx.user.name, 52.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(ctx.user.name, style = MaterialTheme.typography.titleMedium, color = g.text)
                        Text((if (admin) "Admin" else "Member") + (ctx.user.plex?.let { " · Plex: ${it.name}" } ?: ""), style = MaterialTheme.typography.bodySmall, color = g.muted)
                    }
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = g.muted)
                }
            }
        }
        groups.forEach { (name, list) ->
            item(key = "h$name") { SectionTitle(name, Modifier.padding(top = 8.dp)) }
            list.chunked(3).forEachIndexed { i, row ->
                item(key = "r$name$i") {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { d -> DestTile(d, Modifier.weight(1f).height(124.dp)) }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}


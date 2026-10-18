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
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.RestartAlt
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
    "qbittorrent" to "Torrents", "sabnzbd" to "Usenet", "jellyfin" to "Media server", "plex" to "Media server",
    "seerr" to "Requests", "tautulli" to "Plex statistics", "flaresolverr" to "Cloudflare helper",
)

@Composable
fun StackScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var busy by remember { mutableStateOf<String?>(null) }
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
                                Dot(when (e.ok) { true -> g.good; false -> g.bad; null -> g.muted }, 11.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(e.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    Text(ENGINE_NOTES[e.key] ?: e.key, style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                                if (busy == e.key) CircularProgressIndicator(Modifier.size(20.dp), color = g.primary, strokeWidth = 2.dp)
                                else IconButton(enabled = busy == null, onClick = { run("Restarting ${e.name}", e.key, "/api/goat/restart", buildJsonObject { put("engine", e.key) }) }) {
                                    Icon(Icons.Rounded.RestartAlt, "Restart ${e.name}", tint = g.muted)
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

@Composable
fun MoreScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { PageTitle("More") }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(52.dp).clip(CircleShape).background(Brush.linearGradient(listOf(g.primary, g.accent))), contentAlignment = Alignment.Center) {
                        Text(ctx.user.name.take(1).uppercase(), style = MaterialTheme.typography.headlineSmall, color = g.onPrimary)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(ctx.user.name, style = MaterialTheme.typography.titleMedium, color = g.text)
                        Text((if (ctx.user.admin) "Admin" else "Member") + (ctx.user.plex?.let { " · Plex: ${it.name}" } ?: ""), style = MaterialTheme.typography.bodySmall, color = g.muted)
                    }
                }
            }
        }
        item { SectionTitle("Go to", Modifier.padding(top = 8.dp)) }
        item {
            Column(Modifier.padding(horizontal = 8.dp)) {
                MenuRow(Icons.Rounded.Search, "Search", "Find a show or movie to request or add") { ctx.go("search") }
                MenuRow(Icons.Rounded.Inbox, "Requests", if (ctx.user.admin) "Approve what people asked for" else "See what you asked for") { ctx.go("requests") }
                MenuRow(Icons.Rounded.CalendarMonth, "Upcoming", "New episodes and releases") { ctx.go("upcoming") }
                if (ctx.user.admin && ctx.me.goat) MenuRow(Icons.Rounded.Shield, "Stack", "VPN, apps and connections") { ctx.go("stack") }
                MenuRow(Icons.Rounded.Settings, "Settings", "Appearance, account and server") { ctx.go("settings") }
            }
        }
    }
}

// ---------- Settings ----------

@Composable
private fun ThemeCard(p: GoatPalette, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val g = LocalGoat.current
    val shape = RoundedCornerShape(20.dp)
    Column(modifier.clip(shape).border(if (selected) 2.dp else 1.dp, if (selected) g.primary else g.line, shape).clickable(onClick = onClick)) {
        // A tiny picture of the theme: its background, a card, a poster row and its highlight colour.
        Box(Modifier.fillMaxWidth().height(96.dp).background(p.bg).padding(10.dp)) {
            Column {
                Box(Modifier.width(56.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.text.copy(alpha = 0.85f)))
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    repeat(3) { i -> Box(Modifier.width(22.dp).height(32.dp).clip(RoundedCornerShape(5.dp)).background(if (i == 0) p.primary else p.card)) }
                }
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.card)) {
                    Box(Modifier.fillMaxWidth(0.6f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.primary))
                }
            }
            if (selected) Box(Modifier.align(Alignment.TopEnd).size(22.dp).clip(CircleShape).background(p.primary), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Check, null, tint = p.onPrimary, modifier = Modifier.size(15.dp))
            }
        }
        Column(Modifier.fillMaxWidth().background(g.card).padding(10.dp)) {
            Text(p.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1)
            Text(p.blurb, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SettingsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val theme by ctx.app.theme.collectAsStateWithLifecycle()
    var signOut by remember { mutableStateOf(false) }
    val themes = Themes.all.filter { !it.dynamic || android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Row(Modifier.statusBarsPadding().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { ctx.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text) }
                PageTitle("Settings", null, Modifier.weight(1f))
            }
        }
        item {
            SectionTitle("Appearance", trailing = { Icon(Icons.Rounded.Palette, null, tint = g.primary, modifier = Modifier.size(18.dp)) })
        }
        themes.chunked(2).forEach { pair ->
            item(key = "t" + pair.first().id) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { p -> ThemeCard(p, p.id == theme, Modifier.weight(1f)) { ctx.app.setTheme(p.id) } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        item { SectionTitle("Account", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                InfoLine(Icons.Rounded.Person, "Signed in as", ctx.user.name + if (ctx.user.admin) " (admin)" else "")
                ctx.user.plex?.let { InfoLine(Icons.Rounded.Person, "Plex account", it.name) }
                Spacer(Modifier.height(12.dp))
                GhostButton("Sign out", icon = Icons.AutoMirrored.Rounded.Logout, color = g.bad, modifier = Modifier.fillMaxWidth(), onClick = { signOut = true })
            }
        }
        item { SectionTitle("Server", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                InfoLine(Icons.Rounded.Dns, "Address", ctx.app.server)
                InfoLine(Icons.Rounded.Dns, "Version", ctx.me.version + if (ctx.me.goat) " · GoatMediaStackarr" else "")
                Spacer(Modifier.height(12.dp))
                GhostButton("Use a different server", icon = Icons.Rounded.SyncAlt, modifier = Modifier.fillMaxWidth(), onClick = { ctx.app.forgetServer() })
            }
        }
        item {
            Text("GoatStack app ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.fillMaxWidth().padding(24.dp))
        }
    }
    if (signOut) Confirm("Sign out?", "You will need to sign in again on this phone.", "Sign out", danger = true, onYes = { signOut = false; ctx.app.logout() }, onNo = { signOut = false })
}

@Composable
private fun InfoLine(icon: ImageVector, label: String, value: String) {
    val g = LocalGoat.current
    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = g.muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = g.muted, modifier = Modifier.width(110.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

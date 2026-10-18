package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.NetworkCheck
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.AppHealth
import com.bdlnaredi.goatstack.data.Chart
import com.bdlnaredi.goatstack.data.IndexerList
import com.bdlnaredi.goatstack.data.IndexerTest
import com.bdlnaredi.goatstack.data.NewsServer
import com.bdlnaredi.goatstack.data.ServerTest
import com.bdlnaredi.goatstack.data.Stats
import com.bdlnaredi.goatstack.data.Unraid
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.Dot
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.StatTile
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// ---------- Health: problems the apps report, disk space, stuck downloads ----------

@Composable
fun HealthScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad { ctx.api.get<List<AppHealth>>("/api/libhealth") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Health", "What the apps report")
        LoadView(data) { apps ->
            val problems = apps.sumOf { it.issues.size + it.queue.size + (if (it.ok) 0 else 1) }
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    GoatCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (problems == 0) Icons.Rounded.CheckCircle else Icons.Rounded.Warning, null, tint = if (problems == 0) g.good else g.warn, modifier = Modifier.size(30.dp))
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(if (problems == 0) "Everything looks healthy" else "$problems thing${if (problems == 1) "" else "s"} to look at", style = MaterialTheme.typography.titleMedium, color = g.text)
                                Text("${apps.size} apps checked", style = MaterialTheme.typography.bodySmall, color = g.muted)
                            }
                        }
                    }
                }
                val disks = apps.flatMap { it.disks }.distinctBy { it.path }
                if (disks.isNotEmpty()) {
                    item { SectionTitle("Disk space", Modifier.padding(top = 4.dp)) }
                    item {
                        GoatCard(Modifier.fillMaxWidth()) {
                            disks.forEachIndexed { i, d ->
                                if (i > 0) Spacer(Modifier.height(12.dp))
                                val used = if (d.total > 0) 1f - d.free.toFloat() / d.total else 0f
                                Row { Text(d.path, style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${Format.bytes(d.free)} free", style = MaterialTheme.typography.labelMedium, color = g.muted) }
                                Spacer(Modifier.height(6.dp))
                                Bar(used, color = if (used > 0.9f) g.bad else if (used > 0.8f) g.warn else g.primary)
                            }
                        }
                    }
                }
                apps.forEach { a ->
                    item(key = a.id) {
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Dot(if (!a.ok) g.bad else if (a.issues.isEmpty() && a.queue.isEmpty()) g.good else g.warn, 11.dp)
                                Spacer(Modifier.width(10.dp))
                                Text(a.name, style = MaterialTheme.typography.titleSmall, color = g.text, modifier = Modifier.weight(1f))
                                a.missing?.let { if (it > 0) Badge("$it missing", g.warn) }
                            }
                            if (!a.ok) Text(a.error ?: "Not answering", style = MaterialTheme.typography.bodySmall, color = g.bad, modifier = Modifier.padding(top = 6.dp))
                            a.issues.forEach { iss ->
                                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.Top) {
                                    Icon(if (iss.level == "bad") Icons.Rounded.Error else Icons.Rounded.Warning, null, tint = if (iss.level == "bad") g.bad else g.warn, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(8.dp)); Text(iss.text, style = MaterialTheme.typography.bodySmall, color = g.text)
                                }
                            }
                            a.queue.forEach { q ->
                                Column(Modifier.padding(top = 8.dp)) {
                                    Text(q.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(q.message, style = MaterialTheme.typography.labelSmall, color = g.warn)
                                }
                            }
                            if (a.ok && a.issues.isEmpty() && a.queue.isEmpty()) Text("No problems", style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
    }
}

// ---------- Indexers (Prowlarr) ----------

@Composable
fun IndexersScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val pr = services().firstOrNull { it.type == "prowlarr" }
    val results = remember { mutableStateMapOf<Int, IndexerTest>() }
    var testing by remember { mutableStateOf<Int?>(null) }
    var removing by remember { mutableStateOf<com.bdlnaredi.goatstack.data.Indexer?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Indexers", "The sites Prowlarr searches")
        if (pr == null) { EmptyState(Icons.Rounded.TravelExplore, "No Prowlarr", "Indexers appear here when Prowlarr is running."); return@Column }
        val data = rememberLoad(pr.id) { ctx.api.get<IndexerList>("/api/prowlarr/${pr.id}/indexers") }
        LoadView(data) { l ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (l.health.isNotEmpty()) item {
                    GoatCard(Modifier.fillMaxWidth()) { l.health.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = g.warn) } }
                }
                if (l.indexers.isEmpty()) item {
                    EmptyState(Icons.Rounded.TravelExplore, "No indexers yet", "Add the sites you use on the web page (Indexers) or in Prowlarr. Sonarr, Radarr and Lidarr get them automatically.")
                } else item {
                    GhostButton(if (testing == -1) "Testing all…" else "Test all", icon = Icons.Rounded.NetworkCheck, enabled = testing == null, modifier = Modifier.fillMaxWidth(), onClick = {
                        testing = -1
                        scope.launch {
                            try { ctx.api.post<List<IndexerTest>>("/api/prowlarr/${pr.id}/indexers/all/test").forEach { results[it.id] = it }; toast("Tested") }
                            catch (e: Exception) { toast(e.message ?: "Could not test") }
                            testing = null
                        }
                    })
                }
                items(l.indexers, key = { it.id }) { x ->
                    val t = results[x.id]
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Dot(when { t != null -> if (t.ok) g.good else g.bad; x.status == "ok" -> g.good; x.status == "failing" -> g.bad; else -> g.muted }, 11.dp)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(x.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(listOf(x.protocol.replaceFirstChar { it.uppercase() }, when (x.status) { "disabled" -> "Turned off"; "failing" -> "Failing, paused for now"; else -> "Working" }, "priority ${x.priority}").joinToString(" · "),
                                    style = MaterialTheme.typography.labelSmall, color = g.muted)
                                if (t != null && !t.ok && t.error.isNotEmpty()) Text(t.error, style = MaterialTheme.typography.labelSmall, color = g.bad)
                            }
                            TextButton(enabled = testing == null, onClick = {
                                testing = x.id
                                scope.launch {
                                    try { val r = ctx.api.post<IndexerTest>("/api/prowlarr/${pr.id}/indexers/${x.id}/test"); results[x.id] = r.copy(id = x.id); toast(if (r.ok) "${x.name} works" else "${x.name} failed") }
                                    catch (e: Exception) { toast(e.message ?: "Could not test") }
                                    testing = null
                                }
                            }) { Text(if (testing == x.id) "…" else "Test", color = g.primary) }
                            if (ctx.user.admin) IconButton(onClick = { removing = x }) { Icon(Icons.Rounded.Delete, "Remove", tint = g.muted) }
                        }
                    }
                }
            }
        }
        removing?.let { x ->
            Confirm("Remove ${x.name}?", "It is taken out of Prowlarr, and Sonarr, Radarr and Lidarr stop using it.", "Remove", danger = true,
                onYes = { removing = null; scope.launch { try { ctx.api.send("DELETE", "/api/prowlarr/${pr.id}/indexers/${x.id}"); toast("Removed"); data.reload() } catch (e: Exception) { toast(e.message ?: "Could not remove it") } } },
                onNo = { removing = null })
        }
    }
}

// ---------- Usenet servers (SABnzbd) ----------

@Composable
fun NewsServersScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val sab = services().firstOrNull { it.type == "sabnzbd" }
    var edit by remember { mutableStateOf<NewsServer?>(null) }
    var removing by remember { mutableStateOf<NewsServer?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Usenet servers", "Your provider's news servers in SABnzbd") {
            if (sab != null && ctx.user.admin) IconButton(onClick = { edit = NewsServer(port = 563, ssl = true, connections = 8, enable = true) }) { Icon(Icons.Rounded.Add, "Add a server", tint = g.primary) }
        }
        if (sab == null || !ctx.user.admin) { EmptyState(Icons.Rounded.Dns, if (sab == null) "No SABnzbd" else "Admins only", if (sab == null) "Usenet servers appear here when SABnzbd is running." else "Only an admin can change usenet servers."); return@Column }
        val data = rememberLoad(sab.id) { ctx.api.get<List<NewsServer>>("/api/sab/${sab.id}/servers") }
        LoadView(data) { list ->
            if (list.isEmpty()) EmptyState(Icons.Rounded.Dns, "No news server yet", "Add the server from your usenet provider's welcome email, then usenet downloads can start.") {
                GhostButton("Add a server", icon = Icons.Rounded.Add, onClick = { edit = NewsServer(port = 563, ssl = true, connections = 8, enable = true) })
            }
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(list, key = { it.name }) { s ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp, onClick = { edit = s }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Dot(if (s.enable) g.good else g.muted, 11.dp)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(s.displayname.ifEmpty { s.host }, style = MaterialTheme.typography.titleSmall, color = g.text)
                                Text("${s.host}:${s.port}${if (s.ssl) " · SSL" else ""} · ${s.connections} connections", style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                            IconButton(onClick = { removing = s }) { Icon(Icons.Rounded.Delete, "Remove", tint = g.muted) }
                        }
                    }
                }
            }
        }
        edit?.let { s -> ServerDialog(sab.id, s, onDone = { saved -> edit = null; if (saved) data.reload() }) }
        removing?.let { s ->
            Confirm("Remove ${s.displayname.ifEmpty { s.host }}?", "SABnzbd stops using this server.", "Remove", danger = true,
                onYes = { removing = null; scope.launch { try { ctx.api.send("DELETE", "/api/sab/${sab.id}/servers/${s.name}"); toast("Removed"); data.reload() } catch (e: Exception) { toast(e.message ?: "Could not remove it") } } },
                onNo = { removing = null })
        }
    }
}

@Composable
private fun ServerDialog(sid: String, s: NewsServer, onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val isNew = s.name.isEmpty()
    var host by remember { mutableStateOf(s.host) }
    var port by remember { mutableStateOf(if (s.port > 0) s.port.toString() else "563") }
    var ssl by remember { mutableStateOf(s.ssl) }
    var user by remember { mutableStateOf(s.username) }
    var pass by remember { mutableStateOf("") }
    var conns by remember { mutableStateOf(if (s.connections > 0) s.connections.toString() else "8") }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun body() = buildJsonObject {
        if (!isNew) put("name", s.name)
        put("host", host.trim()); put("port", port.toIntOrNull() ?: 563); put("ssl", ssl); put("username", user.trim()); put("password", pass)
        put("connections", conns.toIntOrNull() ?: 8); put("enable", true)
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text(if (isNew) "Add a news server" else "Change ${s.displayname.ifEmpty { s.host }}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GoatField(host, { host = it }, "Server address", Icons.Rounded.Dns, keyboard = KeyboardType.Uri)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GoatField(port, { port = it.filter(Char::isDigit) }, "Port", Icons.Rounded.NetworkCheck, keyboard = KeyboardType.Number, modifier = Modifier.weight(1f))
                    GoatField(conns, { conns = it.filter(Char::isDigit) }, "Connections", Icons.Rounded.Insights, keyboard = KeyboardType.Number, modifier = Modifier.weight(1f))
                }
                CheckLine("Use SSL (encrypted, usually port 563)", ssl) { ssl = it; if (it && port == "119") port = "563"; if (!it && port == "563") port = "119" }
                GoatField(user, { user = it }, "Username", Icons.Rounded.Person)
                GoatField(pass, { pass = it }, if (isNew || !s.hasPassword) "Password" else "Password (blank keeps the saved one)", Icons.Rounded.Lock, password = true)
                note?.let { Text(it, color = if (it.startsWith("✓")) g.good else g.bad, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Row {
                TextButton(enabled = !busy && host.isNotBlank(), onClick = {
                    busy = true; note = null
                    scope.launch {
                        try { val t = ctx.api.post<ServerTest>("/api/sab/$sid/servers/test", body()); note = (if (t.ok) "✓ " else "✗ ") + t.message } catch (e: Exception) { note = "✗ " + (e.message ?: "Test failed") }
                        busy = false
                    }
                }) { Text("Test", color = g.accent) }
                TextButton(enabled = !busy && host.isNotBlank() && (pass.isNotEmpty() || !isNew), onClick = {
                    busy = true; note = null
                    scope.launch {
                        try { ctx.api.send("POST", "/api/sab/$sid/servers", body()); onDone(true) } catch (e: Exception) { note = "✗ " + (e.message ?: "Could not save"); busy = false }
                    }
                }) { Text("Save", color = g.primary) }
            }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

// ---------- Stats (Tautulli) ----------

@Composable
private fun Bars(chart: Chart?, modifier: Modifier = Modifier) {
    val g = LocalGoat.current
    val values = chart?.totals.orEmpty()
    if (values.isEmpty()) return
    val max = (values.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
    Canvas(modifier.fillMaxWidth().height(120.dp)) {
        val gap = 3.dp.toPx()
        val w = (size.width - gap * (values.size - 1)) / values.size
        values.forEachIndexed { i, v ->
            val h = (v / max).toFloat() * size.height
            drawRoundRect(color = if (v > 0) g.primary else g.line, topLeft = Offset(i * (w + gap), size.height - h.coerceAtLeast(2f)),
                size = Size(w.coerceAtLeast(1f), h.coerceAtLeast(2f)), cornerRadius = CornerRadius(4.dp.toPx()))
        }
    }
}

@Composable
fun StatsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val taut = services().firstOrNull { it.type == "tautulli" }
    var days by rememberSaveable { mutableStateOf(30) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Stats", "What gets watched, from Tautulli")
        if (taut == null) { EmptyState(Icons.Rounded.Insights, "No Tautulli", "Viewing statistics appear here when Tautulli is set up."); return@Column }
        ChoiceRow(listOf(7 to "7 days", 30 to "30 days", 90 to "90 days"), days, { days = it })
        val data = rememberLoad(taut.id, days) { ctx.api.get<Stats>("/api/tautulli/${taut.id}/stats?days=$days") }
        val img = { p: String -> if (p.isBlank()) null else "${ctx.api.base}/api/tautulli/${taut.id}/img?p=${com.bdlnaredi.goatstack.data.Api.enc(p)}" }
        LoadView(data) { s ->
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("Plays", s.totals.plays.toString(), Modifier.weight(1f), Icons.Rounded.PlayArrow)
                        StatTile("Watched", "${s.totals.seconds / 3600} h", Modifier.weight(1f), Icons.Rounded.Insights, tint = g.accent)
                    }
                }
                if ((s.byDate?.totals ?: emptyList()).isNotEmpty()) item {
                    GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        Text("Plays per day", style = MaterialTheme.typography.labelMedium, color = g.muted)
                        Spacer(Modifier.height(10.dp))
                        Bars(s.byDate)
                    }
                }
                listOf("Top movies" to s.movies, "Top shows" to s.tv).forEach { (title, list) ->
                    if (list.isNotEmpty()) {
                        item { SectionTitle(title, Modifier.padding(top = 6.dp)) }
                        item {
                            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                items(list) { m ->
                                    Column(Modifier.width(104.dp)) {
                                        Poster(img(m.thumb), m.title, Modifier.fillMaxWidth())
                                        Spacer(Modifier.height(6.dp))
                                        Text(m.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text("${m.plays} play${if (m.plays == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = g.muted)
                                    }
                                }
                            }
                        }
                    }
                }
                if (s.users.isNotEmpty()) {
                    item { SectionTitle("Who watches most", Modifier.padding(top = 6.dp)) }
                    item {
                        GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            val top = s.users.maxOf { it.plays }.coerceAtLeast(1)
                            s.users.forEachIndexed { i, u ->
                                if (i > 0) Spacer(Modifier.height(10.dp))
                                Row { Text(u.title, style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f)); Text("${u.plays} · ${u.seconds / 3600} h", style = MaterialTheme.typography.labelMedium, color = g.muted) }
                                Spacer(Modifier.height(4.dp)); Bar(u.plays.toFloat() / top, color = g.accent, height = 5.dp)
                            }
                        }
                    }
                }
                if (s.history.isNotEmpty()) {
                    item { SectionTitle("Recently watched", Modifier.padding(top = 6.dp)) }
                    items(s.history) { h ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Poster(img(h.thumb), h.title, Modifier.width(40.dp), corner = 8.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(h.title, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${h.user} · ${h.player} · ${Format.ago(h.at)}", style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text("${h.pct}%", style = MaterialTheme.typography.labelMedium, color = if (h.pct >= 90) g.good else g.muted)
                        }
                    }
                }
            }
        }
    }
}

// ---------- Unraid ----------

@Composable
fun UnraidScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val ur = services().firstOrNull { it.type == "unraid" }
    var busy by remember { mutableStateOf<String?>(null) }
    var stopping by remember { mutableStateOf<com.bdlnaredi.goatstack.data.Container?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Unraid", ur?.name)
        if (ur == null) { EmptyState(Icons.Rounded.Storage, "No Unraid", "Add your Unraid server on the web page (Settings → Apps) to see it here."); return@Column }
        val data = rememberLoad(ur.id) { ctx.api.get<Unraid>("/api/unraid/${ur.id}") }
        fun act(c: com.bdlnaredi.goatstack.data.Container, action: String) {
            busy = c.id
            scope.launch {
                try { ctx.api.send("POST", "/api/unraid/${ur.id}/docker", buildJsonObject { put("id", c.id); put("action", action) }); toast(when (action) { "start" -> "Started"; "stop" -> "Stopped"; else -> "Restarted" } + " ${c.name}"); data.reload() }
                catch (e: Exception) { toast(e.message ?: "That did not work") }
                busy = null
            }
        }
        LoadView(data) { u ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    GoatCard(Modifier.fillMaxWidth()) {
                        Text(u.host.ifEmpty { ur.name }, style = MaterialTheme.typography.titleLarge, color = g.text)
                        Text(listOfNotNull(u.cpuInfo?.brand?.ifEmpty { null }, u.uptime.ifEmpty { null }?.let { "up $it" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Spacer(Modifier.height(10.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Badge("Array ${u.arrayState.lowercase().ifEmpty { "unknown" }}", if (u.arrayState.equals("started", true)) g.good else g.warn)
                            Badge("${u.containers.count { it.running }} of ${u.containers.size} containers running", g.accent)
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile("CPU", "${u.cpu.toInt()}%", Modifier.weight(1f), Icons.Rounded.Memory)
                        StatTile("Memory", "${u.mem.toInt()}%", Modifier.weight(1f), Icons.Rounded.Memory, tint = g.accent)
                        StatTile("Array", if (u.total > 0) "${(u.used * 100 / u.total)}%" else "–", Modifier.weight(1f), Icons.Rounded.Storage, tint = g.good)
                    }
                }
                if (u.total > 0) item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("${Format.bytes(u.used * 1024)} of ${Format.bytes(u.total * 1024)} used", style = MaterialTheme.typography.bodyMedium, color = g.text)
                        Spacer(Modifier.height(8.dp)); Bar(u.used.toFloat() / u.total)
                    }
                }
                if (u.disks.isNotEmpty()) {
                    item { SectionTitle("Disks", Modifier.padding(top = 4.dp)) }
                    item {
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            u.disks.forEach { d ->
                                val t = d.temp?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }.orEmpty()
                                Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Dot(if (d.status.contains("OK", true)) g.good else g.warn, 9.dp); Spacer(Modifier.width(10.dp))
                                    Text(d.name, style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f))
                                    Text(listOf(d.role, if (t.isNotEmpty() && t != "null" && t != "*") "$t °C" else "").filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = g.muted)
                                }
                            }
                        }
                    }
                }
                item { SectionTitle("Containers", Modifier.padding(top = 4.dp)) }
                items(u.containers.sortedWith(compareBy({ !it.running }, { it.name.lowercase() })), key = { it.id }) { c ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Dot(if (c.running) g.good else g.muted, 10.dp); Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(c.state.lowercase(), style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                            if (ctx.user.admin) {
                                if (busy == c.id) Text("…", color = g.muted)
                                else if (c.running) {
                                    IconButton(onClick = { act(c, "restart") }) { Icon(Icons.Rounded.RestartAlt, "Restart", tint = g.muted) }
                                    IconButton(onClick = { stopping = c }) { Icon(Icons.Rounded.Stop, "Stop", tint = g.bad) }
                                } else IconButton(onClick = { act(c, "start") }) { Icon(Icons.Rounded.PlayArrow, "Start", tint = g.good) }
                            }
                        }
                    }
                }
                if (u.errors.isNotEmpty()) item { Text(u.errors.joinToString("\n"), style = MaterialTheme.typography.bodySmall, color = g.bad) }
            }
        }
        stopping?.let { c -> Confirm("Stop ${c.name}?", "Whatever it runs is offline until you start it again.", "Stop", danger = true, onYes = { stopping = null; act(c, "stop") }, onNo = { stopping = null }) }
    }
}

package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.ImportJob
import com.bdlnaredi.goatstack.data.ImportPlan
import com.bdlnaredi.goatstack.data.Profile2
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.Tuning
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ---------- Users ----------

@Composable
fun UsersScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Profile2?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Users", "Who can sign in") {
            if (ctx.user.admin) IconButton(onClick = { adding = true }) { Icon(Icons.Rounded.PersonAdd, "Add a profile", tint = g.primary) }
        }
        if (!ctx.user.admin) { EmptyState(Icons.Rounded.Group, "Admins only", "Only an admin can see and add profiles."); return@Column }
        val data = rememberLoad { ctx.api.get<List<Profile2>>("/api/users") }
        LoadView(data) { list ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "streaming") { StreamingOverview() }
                items(list, key = { it.id }) { u ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp, onClick = { ctx.profile(u.id) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            com.bdlnaredi.goatstack.ui.Avatar(u.avatar, u.name, 42.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(u.name + if (u.id == ctx.user.id) " (you)" else "", style = MaterialTheme.typography.titleSmall, color = g.text)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                                    Badge(if (u.role == "admin") "Admin" else "Member", if (u.role == "admin") g.primary else g.muted)
                                    if (u.plex != null) Badge("Plex", g.warn)
                                    if (u.twofa) Badge("Two-step", g.good)
                                    if (u.dataLimit > 0) Badge("${u.dataLimit} GB disk", g.accent)
                                    u.streamLimit?.let { Badge(if (it > 0) "${com.bdlnaredi.goatstack.ui.Format.limit(it)}/month" else "Unlimited streaming", g.good) }
                                }
                            }
                            if (u.id != ctx.user.id) IconButton(onClick = { removing = u }) { Icon(Icons.Rounded.Delete, "Delete", tint = g.muted) }
                        }
                    }
                }
                item { Text("Tap a profile to see what it uses and to set its space limit. Which apps it sees is set on the web page under Settings → Users.", style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 6.dp)) }
            }
        }
        if (adding) AddUser { ok -> adding = false; if (ok) data.reload() }
        removing?.let { u ->
            Confirm("Delete ${u.name}?", "They are signed out everywhere and can no longer sign in.", "Delete", danger = true,
                onYes = { removing = null; scope.launch { try { ctx.api.send("DELETE", "/api/users/${u.id}"); toast("Deleted"); data.reload() } catch (e: Exception) { toast(e.message ?: "Could not delete") } } },
                onNo = { removing = null })
        }
    }
}

@Composable
private fun AddUser(onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var admin by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text("Add a profile") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GoatField(name, { name = it }, "Name", Icons.Rounded.Person)
                GoatField(pass, { pass = it }, "Password (8 or more characters)", Icons.Rounded.Lock, password = true)
                CheckLine("Admin (can change everything)", admin) { admin = it }
                error?.let { Text(it, color = g.bad, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && name.isNotBlank() && pass.length >= 8, onClick = {
                busy = true; error = null
                scope.launch {
                    try { ctx.api.send("POST", "/api/users", buildJsonObject { put("name", name.trim()); put("password", pass); put("role", if (admin) "admin" else "user") }); onDone(true) }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text("Add", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

// ---------- Bringing in an existing setup ----------

private val KINDS = listOf("prowlarr" to "Prowlarr", "sonarr" to "Sonarr", "radarr" to "Radarr", "lidarr" to "Lidarr")
private val LABEL = mapOf("prowlarr" to "indexers", "sonarr" to "shows", "radarr" to "movies", "lidarr" to "artists")

@Composable
fun ImportScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var kind by rememberSaveable { mutableStateOf("prowlarr") }
    var url by rememberSaveable { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var plan by remember { mutableStateOf<ImportPlan?>(null) }
    val folders = remember { mutableStateListOf<String>() }
    var settings by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<ImportJob?>(null) }

    // A job that is running (started here or on the web page) is followed until it ends.
    LaunchedEffect(Unit) {
        while (true) {
            try { val j = ctx.api.get<ImportJob>("/api/goat/import"); job = if (j.state == "idle") null else j } catch (_: Exception) { }
            if (Tuning.still || job?.state != "running") break
            delay(2000)
        }
    }
    LaunchedEffect(job?.state) {
        while (job?.state == "running" && !Tuning.still) {
            delay(2000)
            try { job = ctx.api.get<ImportJob>("/api/goat/import") } catch (_: Exception) { }
        }
    }

    Column(Modifier.fillMaxSize()) {
        BackPage("Bring in your setup", "From the Sonarr, Radarr, Lidarr or Prowlarr you use now")
        if (!ctx.user.admin || !ctx.me.goat) { EmptyState(Icons.Rounded.Shield, "Admins only", "Only an admin can bring in an existing setup."); return@Column }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            job?.let { j ->
                GoatCard(Modifier.fillMaxWidth().padding(16.dp)) {
                    Text(when (j.state) { "running" -> if (j.phase == "profiles") "Copying quality profiles and custom formats…" else "Bringing in ${LABEL[j.kind] ?: j.kind}…"; "done" -> "Finished ${LABEL[j.kind] ?: j.kind}"; else -> "Stopped" },
                        style = MaterialTheme.typography.titleMedium, color = g.text)
                    Spacer(Modifier.height(8.dp))
                    Bar(if (j.total > 0) j.done.toFloat() / j.total else 0f)
                    Spacer(Modifier.height(6.dp))
                    Text("${j.added} added, ${j.skipped} already there" + (if (j.failed.isNotEmpty()) ", ${j.failed.size} could not be added" else "") + (j.error?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, color = g.muted)
                    j.failed.take(8).forEach { f -> Text("• ${f.name ?: "?"}: ${f.error}", style = MaterialTheme.typography.labelSmall, color = g.bad) }
                    if (j.state == "done" && j.kind != "prowlarr") Text("The built-in app now scans those folders and finds the files already there. That can take a while.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 6.dp))
                }
            }
            SectionTitle("1. The old app")
            ChoiceRow(KINDS, kind, { kind = it; plan = null })
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GoatField(url, { url = it; plan = null }, "Its address, like http://192.168.1.10:8989", Icons.Rounded.Dns, keyboard = KeyboardType.Uri)
                GoatField(key, { key = it; plan = null }, "Its API key (Settings → General in that app)", Icons.Rounded.Key)
                error?.let { Text(it, color = g.bad, style = MaterialTheme.typography.bodySmall) }
                PrimaryButton(if (busy && plan == null) "Checking…" else "Check", enabled = !busy && url.isNotBlank() && key.length >= 8, modifier = Modifier.fillMaxWidth(), onClick = {
                    busy = true; error = null
                    scope.launch {
                        try {
                            val p = ctx.api.post<ImportPlan>("/api/goat/import/check", buildJsonObject { put("kind", kind); put("url", url.trim()); put("apiKey", key.trim()) })
                            folders.clear(); folders.addAll(p.suggest.map { it.getOrNull(1).orEmpty() }); plan = p
                        } catch (e: Exception) { error = e.message }
                        busy = false
                    }
                })
            }
            plan?.let { p ->
                SectionTitle("2. What comes across")
                GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Text("${p.total} ${LABEL[p.kind] ?: "items"}", style = MaterialTheme.typography.headlineSmall, color = g.text)
                    Text("${p.already} already here, ${p.todo} to bring in.", style = MaterialTheme.typography.bodyMedium, color = g.muted)
                    if (p.kind != "prowlarr" && p.suggest.isNotEmpty()) {
                        Spacer(Modifier.height(14.dp))
                        Text("Where are these folders inside GoatMediaStackarr?", style = MaterialTheme.typography.titleSmall, color = g.text)
                        Text("Your media folder here is ${p.newRoots.firstOrNull() ?: "/media"}.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        p.suggest.forEachIndexed { i, pair ->
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(pair.getOrNull(0).orEmpty(), style = MaterialTheme.typography.labelLarge, color = g.text, modifier = Modifier.weight(0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, tint = g.muted, modifier = Modifier.padding(horizontal = 6.dp).size(16.dp))
                                GoatField(folders.getOrElse(i) { "" }, { v -> if (i < folders.size) folders[i] = v }, "Folder here", Icons.Rounded.Dns, modifier = Modifier.weight(1.2f))
                            }
                        }
                    }
                    p.settings?.let { s ->
                        if (p.kind != "prowlarr" && s.profiles.isNotEmpty()) {
                            Spacer(Modifier.height(12.dp))
                            CheckLine("Also bring in ${s.profiles.size} quality profiles" + (if (s.formats > 0) ", ${s.formats} custom formats" else "") + ", delay and release profiles and file naming", settings) { settings = it }
                            Text("Ones with the same name here are replaced by yours. Tags are always kept.", style = MaterialTheme.typography.labelSmall, color = g.muted)
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                    PrimaryButton(if (busy) "Starting…" else "Bring in ${p.todo} ${LABEL[p.kind] ?: "items"}", enabled = !busy && p.todo > 0 && job?.state != "running", modifier = Modifier.fillMaxWidth(), onClick = {
                        busy = true; error = null
                        scope.launch {
                            try {
                                job = ctx.api.post<ImportJob>("/api/goat/import/start", buildJsonObject {
                                    put("kind", p.kind); put("url", url.trim()); put("apiKey", key.trim()); put("settings", settings)
                                    put("map", JsonArray(p.suggest.mapIndexedNotNull { i, pair ->
                                        val to = folders.getOrElse(i) { "" }.trim()
                                        if (to.isEmpty()) null else JsonArray(listOf(JsonPrimitive(pair.getOrNull(0).orEmpty()), JsonPrimitive(to)))
                                    }))
                                })
                                toast("Started"); plan = null
                            } catch (e: Exception) { error = e.message }
                            busy = false
                        }
                    })
                    Text("Nothing is downloaded or searched for, and the old app is only read from.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}

/** Streaming this month for everyone, and the default monthly limit (with "only outside the home"). */
@Composable
private fun StreamingOverview() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val data = rememberLoad { ctx.api.get<com.bdlnaredi.goatstack.data.StreamAll>("/api/streaming") }
    val d = data.value ?: return
    var text by remember(d) { mutableStateOf(if (d.defaultGb > 0) d.defaultGb.toString().removeSuffix(".0") else "0") }
    var wan by remember(d) { mutableStateOf(d.wanOnly) }
    var busy by remember { mutableStateOf(false) }
    GoatCard(Modifier.fillMaxWidth()) {
        Text("Streaming in ${com.bdlnaredi.goatstack.ui.Format.month(d.month)}", style = MaterialTheme.typography.titleSmall, color = g.text)
        Text("From Plex and Jellyfin. Admins are never limited; accounts that match no profile are counted but not limited.", style = MaterialTheme.typography.bodySmall, color = g.muted)
        Spacer(Modifier.height(10.dp))
        val shown = d.users.filter { it.bytes > 0 }.take(6)
        if (shown.isEmpty()) Text("Nobody has streamed this month yet.", style = MaterialTheme.typography.bodySmall, color = g.muted)
        shown.forEach { r ->
            val lim = (r.limitGb * 1e9).toLong()
            Column(Modifier.padding(vertical = 4.dp)) {
                Row {
                    Text(r.name + if (r.profile) "" else " (no profile)", style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f))
                    Text(com.bdlnaredi.goatstack.ui.Format.gb(r.bytes) + if (lim > 0) " / ${com.bdlnaredi.goatstack.ui.Format.limit(r.limitGb)}" else "", style = MaterialTheme.typography.labelMedium, color = if (lim in 1..r.bytes) g.bad else g.muted)
                }
                if (lim > 0) { val f = (r.bytes.toDouble() / lim).toFloat().coerceIn(0f, 1f); com.bdlnaredi.goatstack.ui.Bar(f, color = if (f >= 1f) g.bad else if (f >= 0.8f) g.warn else g.primary, height = 4.dp) }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            GoatField(text, { v -> text = v.filter { it.isDigit() || it == '.' }.take(9) }, "Default GB a month (0 = none)", Icons.Rounded.Wifi, Modifier.weight(1f),
                keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal, ime = androidx.compose.ui.text.input.ImeAction.Done)
            Spacer(Modifier.width(10.dp))
            com.bdlnaredi.goatstack.ui.GhostButton(if (busy) "Saving…" else "Save", enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        ctx.api.send("PUT", "/api/streaming", buildJsonObject { put("defaultGb", text.toDoubleOrNull() ?: 0.0); put("wanOnly", wan) })
                        toast("Saved"); data.reload()
                    } catch (e: Exception) { toast(e.message ?: "That did not work") }
                    busy = false
                }
            })
        }
        CheckLine("Only count streams from outside the home", wan) { wan = it }
    }
}

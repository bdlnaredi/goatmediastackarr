package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.QbList
import com.bdlnaredi.goatstack.data.QbCategory
import com.bdlnaredi.goatstack.data.QbMeta
import com.bdlnaredi.goatstack.data.SabQueue
import com.bdlnaredi.goatstack.data.Torrent
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PageTitle
import com.bdlnaredi.goatstack.ui.StatTile
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val FILTERS = listOf("active" to "Active", "all" to "All", "done" to "Finished", "paused" to "Paused")

@Composable
fun DownloadsScreen() {
    val svcs = services()
    val qbs = svcs.filter { it.type == "qbittorrent" }
    val sabs = svcs.filter { it.type == "sabnzbd" }
    val kinds = buildList { qbs.forEach { add(it.id to it.name) }; sabs.forEach { add(it.id to it.name) } }
    var sel by rememberSaveable { mutableStateOf(kinds.firstOrNull()?.first ?: "") }
    val cur = svcs.firstOrNull { it.id == sel } ?: svcs.firstOrNull { it.type == "qbittorrent" || it.type == "sabnzbd" }
    val g = LocalGoat.current

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        PageTitle("Downloads", cur?.name)
        if (cur == null) { EmptyState(Icons.Rounded.Download, "No download apps", "Your profile has no qBittorrent or SABnzbd to show."); return@Column }
        if (kinds.size > 1) { ChoiceRow(kinds, cur.id, { sel = it }); Spacer(Modifier.height(8.dp)) }
        if (cur.type == "qbittorrent") Torrents(cur.id) else Usenet(cur.id)
    }
}

/** Asks again every [ms] while the screen is open, keeping what is shown until the new answer arrives. */
@Composable
fun AutoRefresh(ms: Long, reload: () -> Unit) {
    LaunchedEffect(ms) { if (!com.bdlnaredi.goatstack.ui.Tuning.still) while (true) { delay(ms); reload() } }
}

@Composable
private fun Torrents(sid: String) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var filter by rememberSaveable { mutableStateOf("active") }
    var deleting by remember { mutableStateOf<Torrent?>(null) }
    var withFiles by remember { mutableStateOf(false) }
    var cat by rememberSaveable { mutableStateOf<String?>(null) }
    var managing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf<Torrent?>(null) }
    val data = rememberLoad(sid) { ctx.api.get<QbList>("/api/qb/$sid/list") }
    val meta = rememberLoad(sid) { ctx.api.get<QbMeta>("/api/qb/$sid/meta") }
    AutoRefresh(ctx.prefs.refreshMs) { data.reload() }
    val canControl = ctx.user.can("control")
    val cats = meta.value?.categories.orEmpty()

    fun act(action: String, hashes: Any, ok: String, files: Boolean = false) {
        scope.launch {
            try {
                ctx.api.send("POST", "/api/qb/$sid/act", buildJsonObject {
                    put("action", action); if (hashes is String) put("hashes", hashes) else put("hash", (hashes as Torrent).hash)
                    if (files) put("files", true)
                })
                toast(ok)
            } catch (e: Exception) { toast(e.message ?: "That did not work") }
        }
    }

    LoadView(data) { q ->
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Down", Format.speed(q.dl), Modifier.weight(1f), Icons.Rounded.ArrowDownward)
            StatTile("Up", Format.speed(q.ul), Modifier.weight(1f), Icons.Rounded.ArrowUpward, tint = g.accent)
        }
        Spacer(Modifier.height(10.dp))
        ChoiceRow(FILTERS, filter, { filter = it })
        if (cats.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            ChoiceRow(listOf<Pair<String?, String>>(null to "Every category") + cats.map { it.name to it.name } + listOf("" to "No category"), cat, { cat = it })
        }
        if (canControl || ctx.user.can("add") || ctx.user.admin) Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canControl) {
                GhostButton("Pause all", icon = Icons.Rounded.Pause, modifier = Modifier.weight(1f), onClick = { act("pause", "all", "Paused everything") })
                GhostButton("Resume all", icon = Icons.Rounded.PlayArrow, modifier = Modifier.weight(1f), onClick = { act("resume", "all", "Resumed everything") })
            }
        }
        if (ctx.user.can("add") || ctx.user.admin) Row(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ctx.user.can("add")) GhostButton("Add a link", icon = Icons.Rounded.Add, modifier = Modifier.weight(1f), onClick = { adding = true })
            if (ctx.user.admin) GhostButton("Categories", icon = Icons.Rounded.Folder, modifier = Modifier.weight(1f), onClick = { managing = true })
        }
        val list = q.torrents.filter { cat == null || it.category == cat }.filter {
            when (filter) {
                "active" -> !it.paused && (!it.done || it.dlspeed > 0 || it.upspeed > 0)
                "done" -> it.done
                "paused" -> it.paused
                else -> true
            }
        }.sortedByDescending { it.added }
        if (list.isEmpty()) EmptyState(Icons.Rounded.Download, "Nothing here", if (filter == "active") "No downloads are running right now." else "No downloads match.")
        else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(list, key = { it.hash }) { t ->
                var menu by remember { mutableStateOf(false) }
                GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                    Row(verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text(t.name, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.height(6.dp))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                val st = Format.torrentState(t.state)
                                Badge(st, when (st) { "Downloading" -> g.primary; "Seeding", "Finished" -> g.good; "Problem" -> g.bad; else -> g.muted })
                                if (t.category.isNotEmpty()) Badge(t.category, g.accent)
                            }
                        }
                        if (canControl) Column {
                            IconButton(onClick = { menu = true }) { Icon(if (t.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, "Actions", tint = g.text) }
                            DropdownMenu(menu, { menu = false }) {
                                DropdownMenuItem(text = { Text(if (t.paused) "Resume" else "Pause") }, leadingIcon = { Icon(if (t.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, null) },
                                    onClick = { menu = false; act(if (t.paused) "resume" else "pause", t, if (t.paused) "Resumed" else "Paused") })
                                DropdownMenuItem(text = { Text("Force start") }, leadingIcon = { Icon(Icons.Rounded.Bolt, null) }, onClick = { menu = false; act("force", t, "Started") })
                                DropdownMenuItem(text = { Text("Check files") }, leadingIcon = { Icon(Icons.Rounded.Refresh, null) }, onClick = { menu = false; act("recheck", t, "Checking") })
                                DropdownMenuItem(text = { Text("Category…") }, leadingIcon = { Icon(Icons.Rounded.Folder, null) }, onClick = { menu = false; moving = t })
                                if (ctx.user.can("remove")) DropdownMenuItem(text = { Text("Remove", color = g.bad) }, leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = g.bad) },
                                    onClick = { menu = false; withFiles = false; if (ctx.prefs.confirmRemove) deleting = t else act("delete", t, "Removed") })
                            }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Bar(t.progress.toFloat(), color = if (t.done) g.good else g.primary)
                    Spacer(Modifier.height(6.dp))
                    Text(buildList {
                        add(Format.percent(t.progress)); add(Format.bytes(t.size))
                        if (t.dlspeed > 0) add("↓ " + Format.speed(t.dlspeed))
                        if (t.upspeed > 0) add("↑ " + Format.speed(t.upspeed))
                        if (!t.done && !t.paused) add(Format.eta(t.eta) + " left")
                        if (t.done) add("ratio %.2f".format(t.ratio))
                    }.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = g.muted)
                }
            }
        }
    }
    if (managing) CategoriesDialog(sid, meta.value ?: QbMeta(), onChanged = { meta.reload() }) { managing = false }
    if (adding) AddLinkDialog(sid, cats) { ok -> adding = false; if (ok) data.reload() }
    moving?.let { t ->
        PickCategory(t.category, cats, onPick = { c -> moving = null; scope.launch {
            try { ctx.api.send("POST", "/api/qb/$sid/act", buildJsonObject { put("action", "category"); put("hash", t.hash); put("value", c) }); toast(if (c.isEmpty()) "Category removed" else "Moved to $c"); data.reload() }
            catch (e: Exception) { toast(e.message ?: "That did not work") }
        } }, onClose = { moving = null })
    }
    deleting?.let { t ->
        Confirm("Remove this download?", t.name, "Remove", danger = true,
            extra = { CheckLine("Also delete the downloaded files", withFiles, danger = true) { withFiles = it } },
            onYes = { deleting = null; act("delete", t, "Removed", files = withFiles) }, onNo = { deleting = null })
    }
}

@Composable
private fun Usenet(sid: String) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val data = rememberLoad(sid) { ctx.api.get<SabQueue>("/api/sab/$sid/queue") }
    AutoRefresh(3000) { data.reload() }
    LoadView(data) { q ->
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Speed", Format.speed(q.speed.toLong()), Modifier.weight(1f), Icons.Rounded.ArrowDownward)
            StatTile("Left", q.left ?: "–", Modifier.weight(1f), tint = g.accent)
            StatTile("Time", q.timeleft ?: "–", Modifier.weight(1f), tint = g.good)
        }
        if (ctx.user.can("control")) {
            Spacer(Modifier.height(10.dp))
            GhostButton(if (q.paused) "Resume usenet" else "Pause usenet", icon = if (q.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), onClick = {
                    scope.launch {
                        try { ctx.api.send("POST", "/api/sab/$sid/act", buildJsonObject { put("op", if (q.paused) "resume" else "pause") }); toast(if (q.paused) "Resumed" else "Paused") }
                        catch (e: Exception) { toast(e.message ?: "That did not work") }
                    }
                })
        }
        if (q.jobs.isEmpty()) EmptyState(Icons.Rounded.Download, "The queue is empty", "Nothing is downloading from usenet right now.")
        else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(q.jobs) { j ->
                GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                    Text(j.name, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(8.dp))
                    Bar((j.pct / 100).toFloat(), color = g.accent)
                    Spacer(Modifier.height(6.dp))
                    Text(listOfNotNull("${j.pct.toInt()}%", j.size, j.left?.let { "$it left" }).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = g.muted)
                }
            }
        }
    }
}


/** Categories (each with its own folder) and tags in qBittorrent. Admins only, same as on the web page. */
@Composable
private fun CategoriesDialog(sid: String, meta: QbMeta, onChanged: () -> Unit, onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf("") }
    var tag by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // What is shown, updated right away so a new category appears without waiting for qBittorrent to be asked again.
    val cats = remember(meta) { androidx.compose.runtime.mutableStateListOf<QbCategory>().apply { addAll(meta.categories) } }
    val tags = remember(meta) { androidx.compose.runtime.mutableStateListOf<String>().apply { addAll(meta.tags) } }

    fun post(kind: String, op: String, n: String, path: String = "", done: () -> Unit) {
        busy = true; error = null
        scope.launch {
            try {
                ctx.api.send("POST", "/api/qb/$sid/$kind", buildJsonObject { put("op", op); put("name", n); if (path.isNotBlank()) put("path", path) })
                done(); onChanged()
            } catch (e: Exception) { error = e.message ?: "That did not work" }
            busy = false
        }
    }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose, containerColor = g.surface,
        title = { Text("Categories and tags") },
        text = {
            Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                Text("A category keeps downloads apart and can save them to their own folder.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                Spacer(Modifier.height(10.dp))
                if (cats.isEmpty()) Text("No categories yet.", color = g.muted)
                cats.forEach { c ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Rounded.Folder, null, tint = g.primary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, style = MaterialTheme.typography.bodyMedium, color = g.text)
                            Text(c.path.ifBlank { "Default folder" }, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        IconButton(enabled = !busy, onClick = { post("cat", "remove", c.name) { cats.remove(c) } }) { Icon(Icons.Rounded.Close, "Remove ${c.name}", tint = g.muted) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                GoatField(name, { name = it }, "New category", Icons.Rounded.Folder)
                Spacer(Modifier.height(6.dp))
                GoatField(folder, { folder = it }, "Its folder (optional)", Icons.Rounded.Folder, ime = androidx.compose.ui.text.input.ImeAction.Done)
                Spacer(Modifier.height(8.dp))
                GhostButton(if (busy) "Saving…" else "Add category", icon = Icons.Rounded.Add, enabled = !busy && name.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                    val n = name.trim(); val f = folder.trim()
                    post("cat", "create", n, f) { cats.add(QbCategory(n, f)); name = ""; folder = "" }
                })
                Spacer(Modifier.height(16.dp))
                Text("Tags", style = MaterialTheme.typography.titleSmall, color = g.text)
                Spacer(Modifier.height(6.dp))
                if (tags.isEmpty()) Text("No tags yet.", color = g.muted)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    tags.forEach { t ->
                        androidx.compose.material3.InputChip(selected = false, onClick = { if (!busy) post("tag", "remove", t) { tags.remove(t) } }, label = { Text(t) },
                            trailingIcon = { Icon(Icons.Rounded.Close, "Remove $t", modifier = Modifier.size(16.dp)) })
                    }
                }
                Spacer(Modifier.height(6.dp))
                GoatField(tag, { tag = it }, "New tag", Icons.Rounded.Sell, ime = androidx.compose.ui.text.input.ImeAction.Done)
                Spacer(Modifier.height(8.dp))
                GhostButton("Add tag", icon = Icons.Rounded.Add, enabled = !busy && tag.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                    val n = tag.trim(); post("tag", "create", n) { if (n !in tags) tags.add(n); tag = "" }
                })
                if (error != null) { Spacer(Modifier.height(10.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onClose) { Text("Done", color = g.primary) } },
    )
}

@Composable
private fun PickCategory(current: String, cats: List<QbCategory>, onPick: (String) -> Unit, onClose: () -> Unit) {
    val g = LocalGoat.current
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose, containerColor = g.surface,
        title = { Text("Move to a category") },
        text = {
            Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                (listOf("" to "No category") + cats.map { it.name to it.name }).forEach { (v, label) ->
                    Row(Modifier.fillMaxWidth().clickable { onPick(v) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(selected = v == current, onClick = { onPick(v) })
                        Text(label, color = g.text)
                    }
                }
                if (cats.isEmpty()) Text("There are no categories yet. An admin can add them with Categories.", style = MaterialTheme.typography.bodySmall, color = g.muted)
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onClose) { Text("Cancel", color = g.muted) } },
    )
}

/** Add downloads by magnet link (admins may also paste torrent web addresses), into a category if wanted. */
@Composable
private fun AddLinkDialog(sid: String, cats: List<QbCategory>, onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var links by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf("") }
    var paused by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text("Add a download") },
        text = {
            Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                androidx.compose.material3.OutlinedTextField(links, { links = it }, label = { Text("Magnet links, one per line") }, minLines = 3, modifier = Modifier.fillMaxWidth(),
                    leadingIcon = { Icon(Icons.Rounded.Link, null) })
                if (cats.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("Category", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf("" to "None") + cats.map { it.name to it.name }).forEach { (v, label) ->
                            androidx.compose.material3.FilterChip(selected = cat == v, onClick = { cat = v }, label = { Text(label) },
                                colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                        }
                    }
                }
                CheckLine("Add paused", paused) { paused = it }
                if (error != null) { Spacer(Modifier.height(8.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(enabled = !busy && links.isNotBlank(), onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("POST", "/api/torrent/add", buildJsonObject { put("sid", sid); put("url", links.trim()); if (cat.isNotEmpty()) put("category", cat); if (paused) put("paused", true) })
                        toast("Added"); onDone(true)
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Adding…" else "Add", color = g.primary) }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

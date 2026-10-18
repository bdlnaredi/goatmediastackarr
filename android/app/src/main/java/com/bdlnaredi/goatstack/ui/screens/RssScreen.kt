package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RssFeed
import androidx.compose.material.icons.automirrored.rounded.Rule
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.QbMeta
import com.bdlnaredi.goatstack.data.RssArticle
import com.bdlnaredi.goatstack.data.RssFeed
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Auto-download rules exactly as qBittorrent keeps them, so a change sends back everything it did not touch. */
@Serializable private data class RssRules(val rules: List<JsonObject> = emptyList(), val feeds: List<RssFeedRef> = emptyList())
@Serializable private data class RssFeedRef(val path: String = "", val url: String = "")

private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull.orEmpty()
private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false

/**
 * qBittorrent's RSS reader: the newest articles from every feed (download one with a tap), the feeds themselves,
 * and the rules that download matching articles by themselves. Feeds and rules are changed by admins only.
 */
@Composable
fun RssScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val qbs = services().filter { it.type == "qbittorrent" }
    var sel by rememberSaveable { mutableStateOf(qbs.firstOrNull()?.id ?: "") }
    val cur = qbs.firstOrNull { it.id == sel } ?: qbs.firstOrNull()
    var tab by rememberSaveable { mutableStateOf("articles") }
    var adding by remember { mutableStateOf(false) }
    var newRule by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val toast = toaster()

    Column(Modifier.fillMaxSize()) {
        BackPage("RSS", cur?.name ?: "Feeds and auto-downloads") {
            if (cur != null) IconButton(onClick = {
                scope.launch {
                    try { ctx.api.send("POST", "/api/rss/${cur.id}/refresh", buildJsonObject { put("path", "") }); toast("Checking every feed for new articles") }
                    catch (e: Exception) { toast(e.message ?: "That did not work") }
                }
            }) { Icon(Icons.Rounded.Refresh, "Check the feeds now", tint = g.text) }
            if (cur != null && ctx.user.admin) IconButton(onClick = { if (tab == "rules") newRule = true else adding = true }) {
                Icon(Icons.Rounded.Add, if (tab == "rules") "New rule" else "Add a feed", tint = g.primary)
            }
        }
        if (cur == null) { EmptyState(Icons.Rounded.RssFeed, "No qBittorrent", "RSS feeds are read by qBittorrent, and your profile has none to show."); return@Column }
        if (qbs.size > 1) { ChoiceRow(qbs.map { it.id to it.name }, cur.id, { sel = it }); Spacer(Modifier.height(8.dp)) }
        ChoiceRow(listOf("articles" to "Articles", "feeds" to "Feeds", "rules" to "Rules"), tab, { tab = it })
        Spacer(Modifier.height(8.dp))
        val feeds = rememberLoad(cur.id, adding) { ctx.api.get<List<RssFeed>>("/api/rss/${cur.id}/feeds") }
        when (tab) {
            "feeds" -> Feeds(cur.id, feeds.value, feeds.reload) { adding = true }
            "rules" -> Rules(cur.id, newRule) { newRule = false }
            else -> Articles(cur.id, feeds.value.orEmpty())
        }
    }
    if (adding && cur != null) AddFeed(cur.id) { ok -> adding = false; if (ok) toast("Feed added. Its articles arrive in a moment.") }
}

@Composable
private fun Articles(sid: String, feeds: List<RssFeed>) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var feed by rememberSaveable { mutableStateOf("") }
    var unreadOnly by rememberSaveable { mutableStateOf(false) }
    var open by remember { mutableStateOf<RssArticle?>(null) }
    val data = rememberLoad(sid, feed) { ctx.api.get<List<RssArticle>>("/api/rss/$sid/articles" + if (feed.isNotEmpty()) "?feed=${com.bdlnaredi.goatstack.data.Api.enc(feed)}" else "") }
    val readNow = remember { androidx.compose.runtime.mutableStateMapOf<String, Boolean>() }
    val names = feeds.associate { it.path to it.name }

    if (feeds.isEmpty()) {
        EmptyState(Icons.Rounded.RssFeed, "No feeds yet", if (ctx.user.admin) "Add a feed with + above. Its newest articles show here, ready to download." else "An admin has not added any RSS feeds yet.")
        return
    }
    ChoiceRow(listOf("" to "Every feed") + feeds.map { it.path to (if (it.unread > 0) "${it.name} · ${it.unread}" else it.name) }, feed, { feed = it })
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        CheckLine("Only unread", unreadOnly) { unreadOnly = it }
        Spacer(Modifier.weight(1f))
        TextButton(onClick = {
            scope.launch {
                try {
                    (if (feed.isEmpty()) feeds.map { it.path } else listOf(feed)).forEach { ctx.api.send("POST", "/api/rss/$sid/read", buildJsonObject { put("path", it) }) }
                    toast("Marked as read"); data.reload()
                } catch (e: Exception) { toast(e.message ?: "That did not work") }
            }
        }) { Icon(Icons.Rounded.DoneAll, null, tint = g.primary, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("All read", color = g.primary) }
    }
    LoadView(data) { all ->
        val list = all.filter { !unreadOnly || !(it.read || readNow[it.id] == true) }
        if (list.isEmpty()) EmptyState(Icons.Rounded.RssFeed, "Nothing new", if (unreadOnly) "Every article has been read." else "These feeds have no articles yet.")
        else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(list, key = { it.feed + "/" + it.id }) { a ->
                val read = a.read || readNow[a.id] == true
                GoatCard(Modifier.fillMaxWidth(), padding = 12.dp, onClick = { open = a }) {
                    Text(a.title, style = MaterialTheme.typography.bodyMedium, color = if (read) g.muted else g.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!read) Badge("New", g.primary)
                        Text(listOf(names[a.feed] ?: a.feed, Format.ago(Format.parseMillis(a.date))).filter { it.isNotEmpty() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
    open?.let { a ->
        GrabArticle(sid, a, onRead = { readNow[a.id] = true }) { open = null }
    }
}

/** One article: download it (into a category, if wanted) or just mark it read. */
@Composable
private fun GrabArticle(sid: String, a: RssArticle, onRead: () -> Unit, onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val meta = rememberLoad(sid) { ctx.api.get<QbMeta>("/api/qb/$sid/meta") }
    var cat by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text("Download this?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(a.title, color = g.text)
                val cats = meta.value?.categories.orEmpty()
                if (cats.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text("Category", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf("" to "None") + cats.map { it.name to it.name }).forEach { (v, label) ->
                            FilterChip(selected = cat == v, onClick = { cat = v }, label = { Text(label) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                        }
                    }
                }
                if (!ctx.user.can("add")) { Spacer(Modifier.height(8.dp)); Text("Your profile cannot add downloads.", color = g.muted) }
                if (error != null) { Spacer(Modifier.height(8.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && ctx.user.can("add"), onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("POST", "/api/rss/download", buildJsonObject { put("sid", sid); put("feed", a.feed); put("id", a.id); if (cat.isNotEmpty()) put("category", cat) })
                        onRead(); toast("Added to downloads"); onClose()
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Icon(Icons.Rounded.Download, null, tint = g.primary, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text(if (busy) "Adding…" else "Download", color = g.primary) }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = {
                scope.launch {
                    try { ctx.api.send("POST", "/api/rss/$sid/read", buildJsonObject { put("path", a.feed); put("id", a.id) }); onRead() } catch (_: Exception) { }
                    onClose()
                }
            }) { Text("Mark read", color = g.muted) }
        },
    )
}

@Composable
private fun Feeds(sid: String, feeds: List<RssFeed>?, reload: () -> Unit, onAdd: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var removing by remember { mutableStateOf<RssFeed?>(null) }
    if (feeds == null) return
    if (feeds.isEmpty()) {
        if (ctx.user.admin) EmptyState(Icons.Rounded.RssFeed, "No feeds yet", "Add the RSS address your tracker or site gives you.",
            action = { GhostButton("Add a feed", icon = Icons.Rounded.Add, onClick = onAdd) })
        else EmptyState(Icons.Rounded.RssFeed, "No feeds yet", "An admin has not added any RSS feeds yet.")
        return
    }
    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(feeds, key = { it.path }) { f ->
            GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (f.error) Icons.Rounded.Warning else Icons.Rounded.RssFeed, null, tint = if (f.error) g.bad else g.primary)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(f.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (f.error) "Could not be read the last time it was checked" else "${f.total} articles · ${f.unread} unread", style = MaterialTheme.typography.bodySmall, color = if (f.error) g.bad else g.muted)
                        Text(f.url, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = {
                        scope.launch {
                            try { ctx.api.send("POST", "/api/rss/$sid/refresh", buildJsonObject { put("path", f.path) }); toast("Checking ${f.name}") } catch (e: Exception) { toast(e.message ?: "That did not work") }
                        }
                    }) { Icon(Icons.Rounded.Refresh, "Check ${f.name} now", tint = g.muted) }
                    if (ctx.user.admin) IconButton(onClick = { removing = f }) { Icon(Icons.Rounded.Delete, "Remove ${f.name}", tint = g.muted) }
                }
            }
        }
    }
    removing?.let { f ->
        Confirm("Remove ${f.name}?", "qBittorrent stops reading this feed. Downloads already added are kept.", "Remove", danger = true,
            onYes = { removing = null; scope.launch { try { ctx.api.send("POST", "/api/rss/$sid/feed", buildJsonObject { put("op", "remove"); put("path", f.path) }); toast("Removed"); reload() } catch (e: Exception) { toast(e.message ?: "Could not remove it") } } },
            onNo = { removing = null })
    }
}

@Composable
private fun AddFeed(sid: String, onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text("Add an RSS feed") },
        text = {
            Column {
                GoatField(url, { url = it }, "Feed address (https://…)", Icons.Rounded.Link, keyboard = androidx.compose.ui.text.input.KeyboardType.Uri)
                Spacer(Modifier.height(8.dp))
                GoatField(name, { name = it }, "Name (optional)", Icons.Rounded.RssFeed, ime = ImeAction.Done)
                if (error != null) { Spacer(Modifier.height(8.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && url.isNotBlank(), onClick = {
                busy = true; error = null
                scope.launch {
                    try { ctx.api.send("POST", "/api/rss/$sid/feed", buildJsonObject { put("op", "add"); put("url", url.trim()); if (name.isNotBlank()) put("path", name.trim()) }); onDone(true) }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Adding…" else "Add", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

@Composable
private fun Rules(sid: String, creating: Boolean, onCreated: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val data = rememberLoad(sid, creating) { ctx.api.get<RssRules>("/api/rss/$sid/rules") }
    var removing by remember { mutableStateOf<String?>(null) }
    val flipped = remember { androidx.compose.runtime.mutableStateMapOf<String, Boolean>() }

    fun save(name: String, rule: JsonObject, ok: String) {
        scope.launch {
            try { ctx.api.send("POST", "/api/rss/$sid/rule", buildJsonObject { put("op", "set"); put("name", name); put("rule", rule) }); toast(ok) }
            catch (e: Exception) { toast(e.message ?: "That did not work"); flipped.remove(name) }
        }
    }

    LoadView(data) { r ->
        if (r.rules.isEmpty()) EmptyState(Icons.AutoMirrored.Rounded.Rule, "No rules yet", if (ctx.user.admin) "A rule downloads new articles that match some words, by itself. Add one with + above." else "An admin has not made any auto-download rules.")
        else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(r.rules, key = { it.str("name") }) { rule ->
                val name = rule.str("name")
                val on = flipped[name] ?: rule.bool("enabled")
                GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(name, style = MaterialTheme.typography.titleSmall, color = g.text)
                            val must = rule.str("mustContain"); val not = rule.str("mustNotContain")
                            Text(listOf(if (must.isNotBlank()) "has \"$must\"" else "everything", if (not.isNotBlank()) "not \"$not\"" else "").filter { it.isNotEmpty() }.joinToString(", "),
                                style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            val cat = rule.str("assignedCategory"); val last = rule.str("lastMatch")
                            if (cat.isNotBlank() || last.isNotBlank()) Text(listOf(if (cat.isNotBlank()) "into $cat" else "", if (last.isNotBlank()) "last match $last" else "").filter { it.isNotEmpty() }.joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall, color = g.muted)
                        }
                        if (ctx.user.admin) {
                            Switch(on, { v -> flipped[name] = v; save(name, JsonObject(rule + ("enabled" to JsonPrimitive(v))), if (v) "Rule on" else "Rule off") },
                                colors = SwitchDefaults.colors(checkedTrackColor = g.primary, checkedThumbColor = g.onPrimary))
                            IconButton(onClick = { removing = name }) { Icon(Icons.Rounded.Delete, "Remove $name", tint = g.muted) }
                        } else Badge(if (on) "On" else "Off", if (on) g.good else g.muted)
                    }
                }
            }
        }
        if (creating) NewRule(sid, r.feeds) { ok -> onCreated(); if (ok) { toast("Rule saved"); data.reload() } }
    }
    removing?.let { n ->
        Confirm("Remove the rule $n?", "Nothing new is downloaded by it. Downloads it already added are kept.", "Remove", danger = true,
            onYes = { removing = null; scope.launch { try { ctx.api.send("POST", "/api/rss/$sid/rule", buildJsonObject { put("op", "remove"); put("name", n) }); toast("Removed"); data.reload() } catch (e: Exception) { toast(e.message ?: "Could not remove it") } } },
            onNo = { removing = null })
    }
}

@Composable
private fun NewRule(sid: String, feeds: List<RssFeedRef>, onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val meta = rememberLoad(sid) { ctx.api.get<QbMeta>("/api/qb/$sid/meta") }
    var name by remember { mutableStateOf("") }
    var must by remember { mutableStateOf("") }
    var not by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text("New auto-download rule") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("New articles in every feed that match are downloaded by themselves.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                Spacer(Modifier.height(10.dp))
                GoatField(name, { name = it }, "Rule name", Icons.AutoMirrored.Rounded.Rule)
                Spacer(Modifier.height(6.dp))
                GoatField(must, { must = it }, "Must contain (e.g. 1080p)", Icons.Rounded.Add)
                Spacer(Modifier.height(6.dp))
                GoatField(not, { not = it }, "Must not contain (optional)", Icons.Rounded.Delete, ime = ImeAction.Done)
                val cats = meta.value?.categories.orEmpty()
                if (cats.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("Category", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf("" to "None") + cats.map { it.name to it.name }).forEach { (v, label) ->
                            FilterChip(selected = cat == v, onClick = { cat = v }, label = { Text(label) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                        }
                    }
                }
                if (feeds.isEmpty()) { Spacer(Modifier.height(8.dp)); Text("Add a feed first, or the rule has nothing to read.", color = g.warn) }
                if (error != null) { Spacer(Modifier.height(8.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && name.isNotBlank(), onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("POST", "/api/rss/$sid/rule", buildJsonObject {
                            put("op", "set"); put("name", name.trim())
                            put("rule", buildJsonObject {
                                put("enabled", true); put("mustContain", must.trim()); put("mustNotContain", not.trim()); put("smartFilter", true)
                                put("affectedFeeds", JsonArray(feeds.map { JsonPrimitive(it.url) })); if (cat.isNotEmpty()) put("assignedCategory", cat)
                            })
                        })
                        onDone(true)
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Saving…" else "Save", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

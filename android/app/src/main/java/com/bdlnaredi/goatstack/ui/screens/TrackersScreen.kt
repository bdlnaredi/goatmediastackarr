package com.bdlnaredi.goatstack.ui.screens

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.OpenReply
import com.bdlnaredi.goatstack.data.QbMeta
import com.bdlnaredi.goatstack.data.SiteInfo
import com.bdlnaredi.goatstack.data.TrackerHit
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Trackers: search them through Prowlarr and send a result to qBittorrent, or browse a tracker's own website (through
 * the VPN if chosen) in the phone's browser; its download and magnet buttons send straight to qBittorrent. Admins only.
 */
@Composable
fun TrackersScreen() {
    val ctx = LocalCtx.current
    var tab by rememberSaveable { mutableStateOf("search") }
    var adding by remember { mutableStateOf(false) }
    val g = LocalGoat.current
    Column(Modifier.fillMaxSize()) {
        BackPage("Trackers", "Search them, or browse their websites") {
            if (tab == "sites" && ctx.user.admin) IconButton(onClick = { adding = true }) { Icon(Icons.Rounded.Add, "Add a website", tint = g.primary) }
        }
        if (!ctx.user.admin) { EmptyState(Icons.Rounded.Language, "Admins only", "Tracker accounts belong to the server's admin."); return@Column }
        ChoiceRow(listOf("search" to "Search", "sites" to "Websites"), tab, { tab = it })
        Spacer(Modifier.height(8.dp))
        if (tab == "search") TrackerSearch() else Websites(adding) { adding = false }
    }
}

/** Opens a link the server made (a site browser page) in the phone's browser. */
@Composable
private fun opener(): (suspend () -> String?) -> Unit {
    val ctx = LocalCtx.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    return { make -> scope.launch { try { make()?.let { u -> uri.openUri(if (u.startsWith("/")) ctx.api.base + u else u) } } catch (e: Exception) { toast(e.message ?: "Could not open it") } } }
}

@Composable
private fun TrackerSearch() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val open = opener()
    var term by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("") }
    var cat by rememberSaveable { mutableStateOf("") }
    val qbs = services().firstOrNull { it.type == "qbittorrent" }
    val meta = rememberLoad(qbs?.id) { qbs?.let { ctx.api.get<QbMeta>("/api/qb/${it.id}/meta") } }
    val added = remember { androidx.compose.runtime.mutableStateListOf<String>() }

    GoatField(term, { term = it }, "Movie or show, e.g. Dune 2021 2160p", Icons.Rounded.Search, ime = ImeAction.Search, onDone = { query = term.trim() }, modifier = Modifier.padding(horizontal = 16.dp))
    Spacer(Modifier.height(8.dp))
    ChoiceRow(listOf("" to "Everything", "movie" to "Movies", "tv" to "Shows"), type, { type = it })
    val cats = meta.value?.categories.orEmpty()
    if (cats.isNotEmpty()) { Spacer(Modifier.height(8.dp)); ChoiceRow(listOf("" to "No category") + cats.map { it.name to "Into ${it.name}" }, cat, { cat = it }) }
    Spacer(Modifier.height(8.dp))
    if (query.isEmpty()) { EmptyState(Icons.Rounded.Search, "Search your trackers", "Finds releases on the trackers you added to Prowlarr. Download sends one to qBittorrent; Page opens the tracker's page for it."); return }
    val res = rememberLoad(query, type) { ctx.api.get<List<TrackerHit>>("/api/trackers/search?q=${com.bdlnaredi.goatstack.data.Api.enc(query)}&type=$type") }
    LoadView(res) { hits ->
        if (hits.isEmpty()) EmptyState(Icons.Rounded.Search, "Nothing found", "Try fewer words, or another spelling.")
        else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(hits, key = { it.id }) { h ->
                GoatCard(Modifier.fillMaxWidth(), padding = 12.dp) {
                    Text(h.title, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Badge(h.indexer, g.accent)
                        Text("${Format.disk(h.size)} · ${h.seeders} seeding · ${h.leechers} getting", style = MaterialTheme.typography.labelSmall, color = g.muted)
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (h.info.isNotEmpty()) GhostButton("Page", icon = Icons.AutoMirrored.Rounded.OpenInNew, modifier = Modifier.weight(1f), onClick = {
                            open { ctx.api.post<OpenReply>("/api/sites/open-url", buildJsonObject { put("url", h.info) }).url }
                        })
                        val done = h.id in added
                        GhostButton(if (done) "Added" else "Download", icon = Icons.Rounded.Download, color = if (done) g.good else g.primary, enabled = !done, modifier = Modifier.weight(1f), onClick = {
                            scope.launch {
                                try { ctx.api.send("POST", "/api/trackers/grab", buildJsonObject { put("id", h.id); put("category", cat) }); added.add(h.id); toast("Added to qBittorrent") }
                                catch (e: Exception) { toast(e.message ?: "That did not work") }
                            }
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun Websites(adding: Boolean, onAdded: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val open = opener()
    val data = rememberLoad(adding) { ctx.api.get<List<SiteInfo>>("/api/sites") }
    var removing by remember { mutableStateOf<SiteInfo?>(null) }
    LoadView(data) { list ->
        if (list.isEmpty()) EmptyState(Icons.Rounded.Language, "No websites yet", "Add a tracker's website with + above. You can choose whether it goes through the VPN.")
        else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("Pages open in your phone's browser through the server. Sign in to each site once; its download and magnet buttons send to qBittorrent.", style = MaterialTheme.typography.bodySmall, color = g.muted) }
            items(list, key = { it.id }) { x ->
                GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(x.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                            Text(x.url, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                                Badge(if (x.vpn) "Through the VPN" else "Without the VPN", if (x.vpn) g.good else g.warn)
                                if (x.signedIn) Badge("Signed in", g.primary)
                                if (x.category.isNotEmpty()) Badge(x.category, g.accent)
                            }
                        }
                        IconButton(onClick = { removing = x }) { Icon(Icons.Rounded.Delete, "Remove ${x.name}", tint = g.muted) }
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("Open", { open { ctx.api.post<OpenReply>("/api/sites/${x.id}/open").url } }, Modifier.weight(1f), icon = Icons.AutoMirrored.Rounded.OpenInNew)
                        if (x.signedIn) GhostButton("Sign out", icon = Icons.AutoMirrored.Rounded.Logout, modifier = Modifier.weight(1f), onClick = {
                            scope.launch { try { ctx.api.send("POST", "/api/sites/${x.id}/signout"); toast("Signed out of ${x.name}"); data.reload() } catch (e: Exception) { toast(e.message ?: "That did not work") } }
                        })
                    }
                }
            }
        }
    }
    if (adding) AddSite { ok -> onAdded(); if (ok) data.reload() }
    removing?.let { x ->
        Confirm("Remove ${x.name}?", "Its sign-in is forgotten. Downloads already added are kept.", "Remove", danger = true,
            onYes = { removing = null; scope.launch { try { ctx.api.send("DELETE", "/api/sites/${x.id}"); data.reload() } catch (e: Exception) { toast(e.message ?: "Could not remove it") } } },
            onNo = { removing = null })
    }
}

@Composable
private fun AddSite(onDone: (Boolean) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var vpn by remember { mutableStateOf(true) }
    var cat by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val qbs = services().firstOrNull { it.type == "qbittorrent" }
    val meta = rememberLoad(qbs?.id) { qbs?.let { ctx.api.get<QbMeta>("/api/qb/${it.id}/meta") } }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) }, containerColor = g.surface,
        title = { Text("Add a tracker website") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                GoatField(name, { name = it }, "Name, e.g. IPTorrents", Icons.Rounded.Language)
                Spacer(Modifier.height(6.dp))
                GoatField(url, { url = it }, "Address, e.g. https://iptorrents.com", Icons.Rounded.Link, keyboard = KeyboardType.Uri, ime = ImeAction.Done)
                Spacer(Modifier.height(10.dp))
                ChoiceRow(listOf(true to "Through the VPN", false to "Without the VPN"), vpn, { vpn = it })
                Text(if (vpn) "The site sees the VPN's address. If the VPN is down, the site does not open." else "The site sees your home address. Use this if the site does not allow VPNs.",
                    style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 6.dp))
                val cats = meta.value?.categories.orEmpty()
                if (cats.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("Its downloads go into", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf("" to "No category") + cats.map { it.name to it.name }).forEach { (v, label) ->
                            FilterChip(selected = cat == v, onClick = { cat = v }, label = { Text(label) }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                        }
                    }
                }
                if (error != null) { Spacer(Modifier.height(8.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && url.isNotBlank(), onClick = {
                busy = true; error = null
                scope.launch {
                    try { ctx.api.send("POST", "/api/sites", buildJsonObject { put("name", name.trim()); put("url", url.trim()); put("vpn", vpn); put("category", cat) }); onDone(true) }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Adding…" else "Add", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

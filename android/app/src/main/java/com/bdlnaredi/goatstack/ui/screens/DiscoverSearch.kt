package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
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
import com.bdlnaredi.goatstack.data.DiscoverItem
import com.bdlnaredi.goatstack.data.Folder
import com.bdlnaredi.goatstack.data.LookupHit
import com.bdlnaredi.goatstack.data.LookupReply
import com.bdlnaredi.goatstack.data.Profile
import com.bdlnaredi.goatstack.data.SeerrHit
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PageTitle
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ---------- Discover: trending and popular from TMDB, Trakt or TheTVDB ----------

private val LIST_NAMES = mapOf("trending" to "Trending", "popular" to "Popular", "anticipated" to "Coming soon")
private val SOURCE_NAMES = mapOf("tmdb" to "TMDB", "trakt" to "Trakt", "tvdb" to "TheTVDB")

@Composable
fun DiscoverScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val sources = ctx.user.lists.sources
    var src by rememberSaveable { mutableStateOf(sources.firstOrNull() ?: "tmdb") }
    var kind by rememberSaveable { mutableStateOf("movie") }
    var list by rememberSaveable { mutableStateOf("trending") }
    val lists = (if (src == "tvdb") listOf("popular", "anticipated") else listOf("trending", "popular", "anticipated"))
        .filterNot { src == "tvdb" && kind == "movie" && it == "anticipated" }
    val cur = if (list in lists) list else lists.first()

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        PageTitle("Discover", "What everyone is watching", actions = {
            IconButton(onClick = { ctx.go("search") }) { Icon(Icons.Rounded.Search, "Search", tint = g.text) }
        })
        if (sources.isEmpty()) {
            EmptyState(Icons.Rounded.Explore, "Discover is not set up", "An admin can add a free TMDB or Trakt key on the web page under Settings → Discover lists. Until then, use Search to find things.")
            return@Column
        }
        if (sources.size > 1) { ChoiceRow(sources.map { it to (SOURCE_NAMES[it] ?: it) }, src, { src = it }); Spacer(Modifier.height(8.dp)) }
        ChoiceRow(listOf("movie" to "Movies", "tv" to "Shows"), kind, { kind = it })
        Spacer(Modifier.height(8.dp))
        ChoiceRow(lists.map { it to (LIST_NAMES[it] ?: it) }, cur, { list = it })
        Spacer(Modifier.height(8.dp))
        val items = rememberLoad(src, kind, cur) { ctx.api.get<List<DiscoverItem>>("/api/discover?src=$src&list=$cur&kind=$kind") }
        LoadView(items) { all ->
            LazyVerticalGrid(GridCells.Adaptive((ctx.prefs.posterDp + 4).dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(all) { d ->
                    Column(Modifier.clickable {
                        if (d.tmdb > 0) ctx.title(d.mediaType, d.tmdb)
                        else ctx.go("search")
                    }) {
                        Poster(d.poster, d.title, Modifier.fillMaxWidth())
                        Spacer(Modifier.height(6.dp))
                        Text(d.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(d.year, style = MaterialTheme.typography.labelSmall, color = g.muted)
                            if (d.rating > 0) {
                                Spacer(Modifier.width(6.dp)); Icon(Icons.Rounded.Star, null, tint = g.primary, modifier = Modifier.width(12.dp))
                                Text(" %.1f".format(d.rating), style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------- Search: request through Seerr, or add straight to Sonarr / Radarr ----------

@Composable
fun SearchScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val svcs = services()
    val seerr = svcs.firstOrNull { it.type == "seerr" }
    val arrs = svcs.filter { it.type == "sonarr" || it.type == "radarr" }
    val canAdd = ctx.user.can("add") && arrs.isNotEmpty()
    var mode by rememberSaveable { mutableStateOf(if (seerr != null) "request" else "add") }
    var term by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var arr by rememberSaveable { mutableStateOf(arrs.firstOrNull()?.id ?: "") }
    var ask by remember { mutableStateOf<Ask?>(null) }
    var adding by remember { mutableStateOf<Pair<LookupHit, LookupReply>?>(null) }
    val toast = toaster()

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.padding(start = 4.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { ctx.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text) }
            GoatField(term, { term = it }, "Search shows and movies", Icons.Rounded.Search, ime = ImeAction.Search, onDone = { query = term.trim() }, modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        val modes = buildList { if (seerr != null) add("request" to "Request"); if (canAdd) add("add" to "Add to library") }
        if (modes.size > 1) { ChoiceRow(modes, mode, { mode = it }); Spacer(Modifier.height(8.dp)) }
        if (mode == "add" && arrs.size > 1) { ChoiceRow(arrs.map { it.id to it.name }, arr, { arr = it }); Spacer(Modifier.height(8.dp)) }

        when {
            modes.isEmpty() -> EmptyState(Icons.Rounded.Search, "Nothing to search with", "This server has no Seerr for requests, and your profile cannot add to the library.")
            query.isEmpty() -> EmptyState(Icons.Rounded.Search, "Find something to watch", if (mode == "request") "Ask for a show or movie. It is downloaded and appears in your library." else "Add a show or movie straight to Sonarr or Radarr. It is searched for right away.")
            mode == "request" && seerr != null -> {
                val res = rememberLoad(query, seerr.id) { ctx.api.get<List<SeerrHit>>("/api/seerr/search?sid=${seerr.id}&term=${com.bdlnaredi.goatstack.data.Api.enc(query)}") }
                LoadView(res) { hits ->
                    if (hits.isEmpty()) EmptyState(Icons.Rounded.Search, "No results", "Try another spelling or the original title.")
                    else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(hits) { h -> SeerrRow(h, onOpen = { ctx.title(h.mediaType, h.id) }) { ask = Ask(h.mediaType, h.id, h.title, h.year, h.poster) } }
                    }
                }
            }
            else -> {
                val res = rememberLoad(query, arr) { ctx.api.get<LookupReply>("/api/search?sid=$arr&term=${com.bdlnaredi.goatstack.data.Api.enc(query)}") }
                LoadView(res) { r ->
                    if (r.results.isEmpty()) EmptyState(Icons.Rounded.Search, "No results", "Try another spelling or the original title.")
                    else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(r.results) { h ->
                            val tmdb = (h.raw["tmdbId"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L
                            val kind = if (arrs.firstOrNull { it.id == arr }?.type == "sonarr") "tv" else "movie"
                            ResultRow(h.poster, h.title, if (h.year > 0) h.year.toString() else "", h.overview.orEmpty(),
                                badge = if (h.added) "In your library" else null, action = if (h.added) null else "Add",
                                onOpen = if (tmdb > 0) ({ ctx.title(kind, tmdb) }) else null) { adding = h to r }
                        }
                    }
                }
            }
        }
    }
    ask?.let { a -> RequestDialog(a) { msg -> ask = null; if (msg != null) toast(msg) } }
    adding?.let { (h, r) ->
        AddDialog(arrs.firstOrNull { it.id == arr }, h, r.folders, r.profiles) { msg -> adding = null; if (msg != null) toast(msg) }
    }
}

@Composable
private fun SeerrRow(h: SeerrHit, onOpen: () -> Unit, onAsk: () -> Unit) {
    // Seerr's media status: 5 = available, 4 = partly available, 2/3 = requested or processing.
    val (badge, can) = when (h.status) {
        5 -> "Available" to false
        4 -> "Partly available" to true
        2, 3 -> "Requested" to false
        else -> null to true
    }
    ResultRow(h.poster, h.title, listOf(if (h.mediaType == "tv") "Show" else "Movie", h.year).filter { it.isNotEmpty() }.joinToString(" · "),
        h.overview.orEmpty(), badge = badge, action = if (can) "Request" else null, onOpen = onOpen, onAction = onAsk)
}

@Composable
fun ResultRow(poster: String?, title: String, meta: String, overview: String, badge: String? = null, action: String? = null, onOpen: (() -> Unit)? = null, onAction: () -> Unit = {}) {
    val g = LocalGoat.current
    GoatCard(Modifier.fillMaxWidth(), padding = 12.dp, onClick = onOpen ?: if (action != null) onAction else null) {
        Row {
            Poster(poster, title, Modifier.width(78.dp), corner = 12.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelMedium, color = g.muted)
                Spacer(Modifier.height(6.dp))
                Text(overview, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (badge != null) Badge(badge, if (action == null) g.good else g.warn)
                    Spacer(Modifier.weight(1f))
                    if (action != null) TextButton(onClick = onAction) {
                        Icon(if (action == "Add") Icons.Rounded.Add else Icons.Rounded.Check, null, tint = g.primary)
                        Spacer(Modifier.width(4.dp)); Text(action, color = g.primary)
                    }
                }
            }
        }
    }
}

@Composable
private fun <T> Picker(label: String, options: List<T>, selected: T?, name: (T) -> String, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = selected?.let(name) ?: "", onValueChange = {}, readOnly = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { o -> DropdownMenuItem(text = { Text(name(o)) }, onClick = { onPick(o); open = false }) }
        }
    }
}

@Composable
private fun AddDialog(svc: Service?, h: LookupHit, folders: List<Folder>, profiles: List<Profile>, onDone: (String?) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    var folder by remember { mutableStateOf(folders.firstOrNull()) }
    var profile by remember { mutableStateOf(profiles.firstOrNull()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone(null) }, containerColor = g.surface,
        title = { Text("Add ${h.title}") },
        text = {
            Column {
                Text("It is added to ${svc?.name ?: "the library"} and searched for right away.", color = g.muted)
                Spacer(Modifier.height(14.dp))
                Picker("Quality", profiles, profile, { it.name }) { profile = it }
                Spacer(Modifier.height(10.dp))
                Picker("Folder", folders, folder, { it.path }) { folder = it }
                if (error != null) { Spacer(Modifier.height(10.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && svc != null && folder != null && profile != null, onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("POST", "/api/add", buildJsonObject {
                            put("sid", svc!!.id); put("item", h.raw); put("rootFolderPath", folder!!.path); put("qualityProfileId", profile!!.id)
                        })
                        onDone("Added. Searching for it now.")
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Adding…" else "Add", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone(null) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

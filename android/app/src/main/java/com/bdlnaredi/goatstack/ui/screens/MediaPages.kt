package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Subtitles
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Api
import com.bdlnaredi.goatstack.data.LookupHit
import com.bdlnaredi.goatstack.data.MusicLibrary
import com.bdlnaredi.goatstack.data.MusicLookup
import com.bdlnaredi.goatstack.data.Profile
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.SubLang
import com.bdlnaredi.goatstack.data.SubResult
import com.bdlnaredi.goatstack.data.SubsWanted
import com.bdlnaredi.goatstack.data.WantedPage
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PageTitle
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The header of a page opened from More: a back arrow and the serif title. */
@Composable
fun BackPage(title: String, subtitle: String? = null, actions: @Composable () -> Unit = {}) {
    val ctx = LocalCtx.current
    Row(Modifier.statusBarsPadding().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { ctx.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = LocalGoat.current.text) }
        PageTitle(title, subtitle, Modifier.weight(1f)) { actions() }
    }
}

// ---------- Wanted: what Sonarr and Radarr are still looking for ----------

@Composable
fun WantedScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val arrs = services().filter { it.type == "sonarr" || it.type == "radarr" }
    var sid by rememberSaveable { mutableStateOf(arrs.firstOrNull()?.id ?: "") }
    val cur = arrs.firstOrNull { it.id == sid } ?: arrs.firstOrNull()
    var kind by rememberSaveable { mutableStateOf("missing") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Wanted", "Still being looked for")
        if (cur == null) { EmptyState(Icons.Rounded.Search, "Nothing to show", "Your profile has no Sonarr or Radarr."); return@Column }
        if (arrs.size > 1) { ChoiceRow(arrs.map { it.id to it.name }, cur.id, { sid = it }); Spacer(Modifier.height(8.dp)) }
        ChoiceRow(listOf("missing" to "Missing", "cutoff" to "Could be better"), kind, { kind = it })
        val data = rememberLoad(cur.id, kind) { ctx.api.get<WantedPage>("/api/wanted?sid=${cur.id}&kind=$kind&page=1") }
        LoadView(data) { w ->
            if (w.items.isEmpty()) EmptyState(Icons.Rounded.CheckCircle, if (kind == "missing") "Nothing missing" else "Everything is at its best quality",
                if (kind == "missing") "Everything ${if (cur.type == "sonarr") "that has aired" else "that is out"} is downloaded." else "No file is waiting for an upgrade.")
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("${w.total} in total" + if (w.total > w.items.size) ", newest ${w.items.size} shown" else "", style = MaterialTheme.typography.labelMedium, color = g.muted) }
                items(w.items, key = { it.id }) { x ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 12.dp, onClick = if (cur.type == "radarr") ({ ctx.item(cur.id, "movie", x.id) }) else null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Poster(x.poster, x.title, Modifier.width(52.dp), corner = 10.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(x.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(x.sub, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                x.date?.let { if (it.isNotEmpty()) Text(Format.day(it), style = MaterialTheme.typography.labelSmall, color = g.primary) }
                            }
                            // Interactive search: see every release for it and pick one.
                            if (ctx.user.can("add")) IconButton(onClick = { ctx.releases(cur.id, x.id, if (cur.type == "sonarr") "${x.title} · ${x.sub}" else x.title) }) {
                                Icon(Icons.Rounded.Search, "Choose a release", tint = g.primary)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------- Subtitles: what Bazarr is missing ----------

@Composable
fun SubtitlesScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val bz = services().firstOrNull { it.type == "bazarr" }
    var busy by remember { mutableStateOf<Long?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Subtitles", "Missing subtitles, from Bazarr")
        if (bz == null) { EmptyState(Icons.Rounded.Subtitles, "No Bazarr", "Subtitles appear here when Bazarr is running."); return@Column }
        val data = rememberLoad(bz.id) { ctx.api.get<SubsWanted>("/api/bazarr/${bz.id}/wanted") }
        fun find(kind: String, id: Long, seriesId: Long, langs: List<SubLang>) {
            busy = id
            scope.launch {
                try {
                    val r = ctx.api.post<SubResult>("/api/bazarr/${bz.id}/search", buildJsonObject {
                        put("kind", kind); put("id", id); put("seriesId", seriesId)
                        put("langs", JsonArray(langs.map { l -> buildJsonObject { put("code", l.code); put("forced", l.forced); put("hi", l.hi) } }))
                    })
                    toast("Found ${r.found} of ${r.of}"); data.reload()
                } catch (e: Exception) { toast(e.message ?: "Nothing found") }
                busy = null
            }
        }
        LoadView(data) { w ->
            if (w.episodes.isEmpty() && w.movies.isEmpty()) EmptyState(Icons.Rounded.CheckCircle, "No subtitles missing", "Every show and movie has the subtitles you asked Bazarr for.")
            else LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                if (w.movies.isNotEmpty()) {
                    item { SectionTitle("Movies") }
                    items(w.movies, key = { "m" + it.id }) { m -> SubRow(m.title, "", m.missing, busy == m.id, ctx.user.can("control")) { find("movie", m.id, 0, m.missing) } }
                }
                if (w.episodes.isNotEmpty()) {
                    item { SectionTitle("Episodes") }
                    items(w.episodes, key = { "e" + it.id }) { e -> SubRow(e.title, listOf(e.ep, e.name).filter { it.isNotEmpty() }.joinToString(" · "), e.missing, busy == e.id, ctx.user.can("control")) { find("episode", e.id, e.seriesId, e.missing) } }
                }
            }
        }
    }
}

@Composable
private fun SubRow(title: String, sub: String, missing: List<SubLang>, busy: Boolean, can: Boolean, onFind: () -> Unit) {
    val g = LocalGoat.current
    GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp), padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    missing.forEach { Badge(it.name + (if (it.forced) " (forced)" else "") + (if (it.hi) " (HI)" else ""), g.warn) }
                }
            }
            if (can) TextButton(onClick = onFind, enabled = !busy) { Text(if (busy) "Looking…" else "Find", color = g.primary) }
        }
    }
}

// ---------- Music: Lidarr ----------

@Composable
fun MusicScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val lid = services().firstOrNull { it.type == "lidarr" }
    var adding by remember { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Music", "Your artists, from Lidarr") {
            if (lid != null && ctx.user.can("add")) IconButton(onClick = { adding = true }) { Icon(Icons.Rounded.Add, "Add an artist", tint = g.primary) }
        }
        if (lid == null) { EmptyState(Icons.Rounded.LibraryMusic, "No Lidarr", "Music appears here when Lidarr is running."); return@Column }
        GoatField(filter, { filter = it }, "Find an artist", Icons.Rounded.Search, ime = ImeAction.Search, modifier = Modifier.padding(horizontal = 16.dp))
        val data = rememberLoad(lid.id) { ctx.api.get<MusicLibrary>("/api/media/${lid.id}/library") }
        LoadView(data) { lib ->
            val f = filter.trim().lowercase()
            val shown = lib.items.filter { f.isEmpty() || it.title.lowercase().contains(f) }.sortedBy { it.title.lowercase() }
            if (shown.isEmpty()) EmptyState(Icons.Rounded.LibraryMusic, "No artists", if (lib.items.isEmpty()) "Add an artist with the + button." else "No artist matches.")
            else LazyVerticalGrid(GridCells.Adaptive(108.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(shown, key = { it.id }) { a ->
                    Column {
                        Box { Poster(a.poster, a.title, Modifier.fillMaxWidth(), ratio = 1f) }
                        Spacer(Modifier.height(6.dp))
                        Text(a.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${a.count} album${if (a.count == 1) "" else "s"} · ${a.have}/${a.total} tracks", style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1)
                    }
                }
            }
        }
    }
    if (adding && lid != null) AddArtist(lid) { msg -> adding = false; if (msg != null) { /* the list refreshes next time it opens */ } }
}

@Composable
private fun AddArtist(lid: Service, onDone: (String?) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var term by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { onDone(null) }, containerColor = g.surface,
        title = { Text("Add an artist") },
        text = {
            Column {
                GoatField(term, { term = it }, "Artist name", Icons.Rounded.Search, ime = ImeAction.Search, onDone = { query = term.trim() })
                if (query.isNotEmpty()) {
                    val res = rememberLoad(query) { ctx.api.get<MusicLookup>("/api/media/${lid.id}/search?term=${Api.enc(query)}") }
                    LoadView(res) { r ->
                        Column(Modifier.padding(top = 10.dp)) {
                            if (r.results.isEmpty()) Text("No artist found.", color = g.muted)
                            r.results.take(6).forEach { h: LookupHit ->
                                Row(Modifier.fillMaxWidth().clickable(enabled = !h.added && !busy) {
                                    busy = true
                                    scope.launch {
                                        try {
                                            val prof: Profile? = r.profiles.firstOrNull(); val meta: Profile? = r.meta.firstOrNull()
                                            ctx.api.send("POST", "/api/media/${lid.id}/add", buildJsonObject {
                                                put("item", h.raw); put("rootFolderPath", r.folders.firstOrNull()?.path ?: ""); put("qualityProfileId", prof?.id ?: 1); put("metadataProfileId", meta?.id ?: 1)
                                            })
                                            toast("Added ${h.title}. Searching for its albums."); onDone("ok")
                                        } catch (e: Exception) { toast(e.message ?: "Could not add it"); busy = false }
                                    }
                                }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Poster(h.poster, h.title, Modifier.width(44.dp), corner = 8.dp, ratio = 1f)
                                    Spacer(Modifier.width(10.dp))
                                    Text(h.title, color = g.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(if (h.added) "Added" else "Add", color = if (h.added) g.muted else g.primary, style = MaterialTheme.typography.labelLarge)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { query = term.trim() }) { Text("Search", color = g.primary) } },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Close", color = g.muted) } },
    )
}

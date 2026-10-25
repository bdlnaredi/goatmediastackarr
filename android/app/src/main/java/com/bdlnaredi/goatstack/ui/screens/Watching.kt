package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Collections
import androidx.compose.material.icons.rounded.Download
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.ForYou
import com.bdlnaredi.goatstack.data.Heal
import com.bdlnaredi.goatstack.data.MediaCard
import com.bdlnaredi.goatstack.data.TitleCollection
import com.bdlnaredi.goatstack.data.TitleEpisode
import com.bdlnaredi.goatstack.data.TitleInfo
import com.bdlnaredi.goatstack.data.WatchAdd
import com.bdlnaredi.goatstack.data.WatchItem
import com.bdlnaredi.goatstack.data.Watchlist
import com.bdlnaredi.goatstack.data.CollAsk
import com.bdlnaredi.goatstack.data.MediaRequest
import com.bdlnaredi.goatstack.data.tr
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.Load
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LoadingBlock
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// ---------- Watchlist: what each person wants to watch. They get a message when it lands. ----------

/** Puts a title on the watchlist or takes it off. Says what happened, in words (and whether it was also requested). */
suspend fun watchToggle(api: com.bdlnaredi.goatstack.data.Api, t: TitleInfo, on: Boolean): String {
    if (!on) { api.send("DELETE", "/api/watchlist/${t.type}/${t.id}"); return tr("Taken off your watchlist") }
    val r = api.post<WatchAdd>("/api/watchlist", buildJsonObject {
        put("type", t.type); put("id", t.id); put("title", t.title); put("year", t.year); put("poster", t.poster)
    })
    val q = r.requested
    return when {
        q is JsonPrimitive && q.contentOrNull == "approved" -> tr("Added, and requested")
        q is JsonPrimitive && q.contentOrNull == "pending" -> tr("Added, and sent for approval")
        q is JsonObject -> (q["error"]?.jsonPrimitive?.contentOrNull ?: tr("Added to your watchlist"))
        else -> tr("Added to your watchlist")
    }
}

@Composable
fun WatchlistScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val toast = toaster()
    val scope = rememberCoroutineScope()
    val data = rememberLoad { ctx.api.get<Watchlist>("/api/watchlist") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Watchlist", "What you want to watch")
        LoadView(data, Modifier.padding(16.dp)) { w ->
            if (w.items.isEmpty()) EmptyState(Icons.Rounded.BookmarkBorder, "Nothing on your watchlist yet",
                "Open any movie or show and tap Watchlist. You get a message when it is in the library.")
            else LazyVerticalGrid(GridCells.Adaptive(ctx.prefs.posterDp.dp), Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    val here = w.items.count { it.inLib }
                    Text("${w.items.size} · ${tr("in the library")}: $here", style = MaterialTheme.typography.bodySmall, color = g.muted)
                }
                items(w.items, key = { "${it.type}${it.id}" }) { x ->
                    WatchTile(x, onRemove = {
                        scope.launch {
                            try { ctx.api.send("DELETE", "/api/watchlist/${x.type}/${x.id}"); data.reload() } catch (e: Exception) { toast(e.message ?: "") }
                        }
                    })
                }
            }
        }
    }
}

@Composable
private fun WatchTile(x: WatchItem, onRemove: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val (label, color) = when {
        x.inLib -> "Ready to watch" to g.good
        x.request == "pending" -> "Waiting for approval" to g.warn
        x.request.isNotEmpty() && x.request != "declined" || x.wanted -> "On its way" to g.accent
        else -> "Not asked for yet" to g.muted
    }
    Column(Modifier.clip(RoundedCornerShape(14.dp)).clickable { ctx.title(x.type, x.id) }) {
        Box {
            Poster(x.poster, x.title, Modifier.fillMaxWidth(), corner = 14.dp)
            IconButton(onClick = onRemove, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(30.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f))) {
                Icon(Icons.Rounded.Close, tr("Take off"), tint = Color.White, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(x.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(tr(label), style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}

/** The watchlist button on a title page. */
@Composable
fun WatchButton(t: TitleInfo, modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    val toast = toaster()
    val scope = rememberCoroutineScope()
    var on by remember(t.type, t.id) { mutableStateOf(t.watch) }
    var busy by remember { mutableStateOf(false) }
    GhostButton(if (on) "On your watchlist" else "Watchlist", icon = if (on) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, modifier = modifier, enabled = !busy,
        color = if (on) LocalGoat.current.primary else LocalGoat.current.text, onClick = {
            busy = true
            scope.launch {
                try { val msg = watchToggle(ctx.api, t, !on); on = !on; toast(msg) } catch (e: Exception) { toast(e.message ?: "") }
                busy = false
            }
        })
}

// ---------- Collections: every film in a franchise, which are here, and asking for the rest ----------

@Composable
fun CollectionButton(t: TitleInfo, modifier: Modifier = Modifier) {
    val c = t.collection ?: return
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    GoatCard(modifier.fillMaxWidth(), onClick = { ctx.go("collection/${c.id}") }, padding = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (c.poster.isNotEmpty()) { Poster(c.poster, c.name, Modifier.width(44.dp), corner = 8.dp); Spacer(Modifier.width(12.dp)) }
            else { Icon(Icons.Rounded.Collections, null, tint = g.primary); Spacer(Modifier.width(12.dp)) }
            Column(Modifier.weight(1f)) {
                Text(tr("Part of"), style = MaterialTheme.typography.labelSmall, color = g.muted)
                Text(c.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
fun CollectionScreen(id: Long) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val toast = toaster()
    val scope = rememberCoroutineScope()
    val data = rememberLoad(id) { ctx.api.get<TitleCollection>("/api/collection?id=$id") }
    var busy by remember { mutableStateOf(false) }
    when (val st = data.state) {
        is Load.Loading -> Column(Modifier.fillMaxSize()) { BackPage("Collection"); LoadingBlock(Modifier.padding(16.dp)) }
        is Load.Failed -> Column(Modifier.fillMaxSize()) {
            BackPage("Collection")
            EmptyState(Icons.Rounded.Collections, "Could not open this", st.message, action = { GhostButton("Try again", onClick = data.reload) })
        }
        is Load.Done -> {
            val c = st.value
            val have = c.parts.count { it.inLib || it.available == 5 }
            val missing = c.parts.count { !it.inLib && it.available < 2 && !it.requested }
            Box(Modifier.fillMaxSize()) {
                com.bdlnaredi.goatstack.ui.PageBackground(c.backdrop.ifEmpty { c.poster })
                LazyVerticalGrid(GridCells.Adaptive(108.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column {
                            IconButton(onClick = { ctx.back() }, modifier = Modifier.statusBarsPadding().padding(top = 8.dp).clip(CircleShape).background(g.bg.copy(alpha = 0.6f))) {
                                Icon(Icons.AutoMirrored.Rounded.ArrowBack, tr("Back"), tint = g.text)
                            }
                            Text(c.name, style = MaterialTheme.typography.headlineSmall, color = g.text)
                            Text("$have / ${c.parts.size} · ${tr("in the library")}", style = MaterialTheme.typography.labelMedium, color = g.muted)
                            if (c.overview.isNotBlank()) Text(c.overview, style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.85f), modifier = Modifier.padding(top = 10.dp))
                            if (missing > 0 && c.seerr.isNotEmpty() && ctx.user.can("request")) PrimaryButton("Request the missing ones", enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 14.dp), onClick = {
                                busy = true
                                scope.launch {
                                    try {
                                        val r = ctx.api.post<CollAsk>("/api/collection/$id/request")
                                        toast(if (r.errors.isNotEmpty()) r.errors.first() else "${tr("Requested")}: ${r.asked}")
                                        data.reload()
                                    } catch (e: Exception) { toast(e.message ?: "") }
                                    busy = false
                                }
                            })
                        }
                    }
                    items(c.parts, key = { it.id }) { x ->
                        MediaPoster(MediaCard(type = "movie", id = x.id, title = x.title, year = x.year, poster = x.poster, rating = x.rating,
                            available = if (x.requested && x.available < 2) 2 else x.available, inLib = x.inLib))
                    }
                }
            }
        }
    }
}

// ---------- "Because you watched …" on Home ----------

@Composable
fun ForYouRows() {
    val ctx = LocalCtx.current
    val data = rememberLoad { ctx.api.get<ForYou>("/api/foryou") }
    val rows = data.value?.rows.orEmpty()
    rows.forEach { r ->
        SectionTitle(tr("Because you watched") + " " + r.because.title)
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(r.items, key = { "${it.type}${it.id}" }) { x -> MediaPoster(x, Modifier.width(112.dp)) }
        }
    }
}

// ---------- Missing episodes on a show's page: each can be asked for on its own ----------

@Composable
fun MissingEpisodes(t: TitleInfo, modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val toast = toaster()
    val scope = rememberCoroutineScope()
    if (t.type != "tv" || !ctx.user.can("request")) return
    val data = rememberLoad(t.id) { runCatching { ctx.api.get<List<TitleEpisode>>("/api/title/episodes?id=${t.id}") }.getOrDefault(emptyList()) }
    val miss = data.value.orEmpty().filter { !it.has }
    if (miss.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    var asked by remember { mutableStateOf(setOf<String>()) }
    Column(modifier) {
        SectionTitle(tr("Missing episodes") + " · ${miss.size}", trailing = {
            Text(tr(if (open) "Hide" else "Show"), color = g.primary, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable { open = !open })
        })
        if (open) miss.groupBy { it.season }.forEach { (season, eps) ->
            Text("${tr("Season")} $season", style = MaterialTheme.typography.labelLarge, color = g.muted, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 4.dp))
            eps.forEach { e ->
                val k = "${e.season}:${e.num}"
                GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 3.dp), padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("S%02dE%02d".format(e.season, e.num) + (if (e.title.isNotBlank()) " · ${e.title}" else ""), style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (e.date.isNotBlank()) Text(Format.day(e.date), style = MaterialTheme.typography.labelSmall, color = g.muted)
                        }
                        when {
                            e.asked || k in asked -> Badge("Asked for", g.accent)
                            e.monitored && !e.aired -> Badge("Coming", g.muted)
                            else -> IconButton(onClick = {
                                scope.launch {
                                    try {
                                        val r = ctx.api.post<MediaRequest>("/api/requests/episode", buildJsonObject { put("tmdb", t.id); put("season", e.season); put("episode", e.num); put("poster", t.poster) })
                                        asked = asked + k; toast(tr(if (r.status == "approved") "Requested" else "Sent for approval"))
                                    } catch (x: Exception) { toast(x.message ?: "") }
                                }
                            }) { Icon(Icons.Rounded.Download, tr("Ask for this episode"), tint = g.primary) }
                        }
                    }
                }
            }
        }
    }
}

// ---------- Fixed by itself: the self-healing list on the Health page ----------

@Composable
fun HealCard(modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad { ctx.api.get<Heal>("/api/heal") }
    val h = data.value ?: return
    GoatCard(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.AutoFixHigh, null, tint = if (h.cfg.on) g.good else g.muted)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(tr("Fix problems by itself"), style = MaterialTheme.typography.titleSmall, color = g.text)
                Text(tr(if (h.cfg.on) "On" else "Off"), style = MaterialTheme.typography.labelSmall, color = g.muted)
            }
        }
        if (h.log.isEmpty()) Text(tr("Nothing needed fixing yet."), style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 8.dp))
        h.log.take(12).forEach { e ->
            Spacer(Modifier.height(10.dp))
            Text(e.title, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${e.app} · ${e.what} · ${Format.ago(e.at)}", style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

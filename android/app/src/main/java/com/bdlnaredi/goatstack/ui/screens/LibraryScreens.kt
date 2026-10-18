package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.LibItem
import com.bdlnaredi.goatstack.data.SeriesDetail
import com.bdlnaredi.goatstack.ui.Backdrop
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.Ctx
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The last library list each app sent, so opening an item does not download the whole list again. */
object LibCache {
    val lists = HashMap<String, List<LibItem>>()
    suspend fun get(ctx: Ctx, sid: String, fresh: Boolean = false): List<LibItem> {
        if (!fresh) lists[sid]?.let { return it }
        return ctx.api.get<List<LibItem>>("/api/library?sid=$sid").also { lists[sid] = it }
    }
}

private val SORTS = listOf("added" to "Newest", "title" to "A–Z", "missing" to "Missing", "size" to "Biggest")

@Composable
fun LibraryScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val libs = services().filter { it.type == "sonarr" || it.type == "radarr" }
    var sid by rememberSaveable { mutableStateOf(ctx.app.lastLibrary) }
    val cur = libs.firstOrNull { it.id == sid } ?: libs.firstOrNull()
    var filter by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("added") }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        PageTitle("Library", cur?.let { if (it.type == "sonarr") "Your shows" else "Your movies" })
        if (cur == null) {
            EmptyState(Icons.Rounded.GridView, "No library here", "Your profile has no Sonarr or Radarr to show. Ask an admin for access.")
            return@Column
        }
        if (libs.size > 1) {
            ChoiceRow(libs.map { it.id to it.name }, cur.id, { sid = it; ctx.app.rememberLibrary(it) })
            Spacer(Modifier.height(10.dp))
        }
        GoatField(filter, { filter = it }, "Find in ${cur.name}", Icons.Rounded.Search, ime = ImeAction.Search, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        ChoiceRow(SORTS, sort, { sort = it })
        val data = rememberLoad(cur.id) { LibCache.get(ctx, cur.id, fresh = true) }
        LoadView(data) { all ->
            val f = filter.trim().lowercase()
            val shown = all.filter { f.isEmpty() || it.title.lowercase().contains(f) }.let { l ->
                when (sort) {
                    "title" -> l.sortedBy { it.title.lowercase().removePrefix("the ") }
                    "missing" -> l.sortedByDescending { it.missing }
                    "size" -> l.sortedByDescending { it.size }
                    else -> l.sortedByDescending { it.added }
                }
            }
            if (shown.isEmpty()) EmptyState(Icons.Rounded.Search, "Nothing found", if (all.isEmpty()) "This library is empty so far." else "No title matches \"$filter\".")
            else LazyVerticalGrid(GridCells.Adaptive(ctx.prefs.posterDp.dp), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(shown, key = { it.id }) { x ->
                    Column(Modifier.clickable { ctx.item(cur.id, if (cur.type == "sonarr") "tv" else "movie", x.id) }) {
                        Box {
                            Poster(x.poster, x.title, Modifier.fillMaxWidth())
                            if (x.missing > 0) Badge(if (cur.type == "sonarr") "${x.missing} missing" else "Missing", g.bad, Modifier.align(Alignment.TopEnd).padding(6.dp), filled = true)
                            else if (x.total > 0 && x.have >= x.total) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(22.dp).clip(CircleShape).background(g.good), contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.CheckCircle, null, tint = g.bg, modifier = Modifier.size(16.dp))
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(x.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(listOf(if (x.year > 0) x.year.toString() else "", if (x.size > 0) Format.bytes(x.size) else "").filter { it.isNotEmpty() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = g.muted)
                    }
                }
            }
        }
    }
}

@Composable
fun DetailScreen(sid: String, kind: String, id: Long) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val tv = kind == "tv"
    val item = rememberLoad(sid, id) { LibCache.get(ctx, sid).firstOrNull { it.id == id } ?: LibCache.get(ctx, sid, fresh = true).first { it.id == id } }
    val series = rememberLoad(sid, id, tv) { if (tv) ctx.api.get<SeriesDetail>("/api/series/$sid/$id") else null }
    var monitored by remember { mutableStateOf<Boolean?>(null) }
    var remove by remember { mutableStateOf(false) }
    var withFiles by remember { mutableStateOf(false) }
    val open = remember { mutableStateMapOf<Int, Boolean>() }
    val seasonMon = remember { mutableStateMapOf<Int, Boolean>() }
    val openEp = remember { mutableStateMapOf<Long, Boolean>() }

    fun act(ok: String, block: suspend () -> Unit) { scope.launch { try { block(); toast(ok) } catch (e: Exception) { toast(e.message ?: "That did not work") } } }

    LoadView(item) { x ->
        val mon = monitored ?: x.monitored
        Box(Modifier.fillMaxSize()) {
        com.bdlnaredi.goatstack.ui.PageBackground(ctx.api.abs(x.fanart) ?: x.poster)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Backdrop(ctx.api.abs(x.fanart) ?: x.poster, height = 300.dp, overPicture = true) {
                    IconButton(onClick = { ctx.back() }, modifier = Modifier.statusBarsPadding().padding(8.dp).clip(CircleShape).background(g.bg.copy(alpha = 0.6f))) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text)
                    }
                }
            }
            item {
                Row(Modifier.padding(horizontal = 20.dp).offset(y = (-90).dp)) {
                    Poster(x.poster, x.title, Modifier.width(118.dp), corner = 14.dp)
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f).padding(top = 40.dp)) {
                        Text(x.title, style = MaterialTheme.typography.headlineSmall, color = g.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(listOf(if (x.year > 0) "${x.year}" else "", x.cert, if (x.runtime > 0) "${x.runtime} min" else "", x.maker).filter { it.isNotBlank() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelMedium, color = g.muted)
                        if (x.rating > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Star, null, tint = g.primary, modifier = Modifier.size(15.dp)); Text(" %.1f".format(x.rating), style = MaterialTheme.typography.labelMedium, color = g.text)
                        }
                    }
                }
            }
            item {
                Column(Modifier.padding(horizontal = 20.dp).offset(y = (-70).dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (tv) Badge("${x.have} of ${x.total} episodes", if (x.have >= x.total && x.total > 0) g.good else g.warn)
                        else Badge(if (x.have > 0) "Downloaded" else if (mon) "Wanted" else "Not wanted", if (x.have > 0) g.good else g.warn)
                        if (x.size > 0) Badge(Format.bytes(x.size), g.accent)
                        if (x.profile.isNotEmpty()) Badge(x.profile, g.primary)
                        x.genres.take(3).forEach { Badge(it, g.muted) }
                    }
                    Spacer(Modifier.height(14.dp))
                    Text(x.overview, style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.85f))
                    if (tv && x.next.isNotEmpty()) { Spacer(Modifier.height(10.dp)); Text("Next episode: ${Format.day(x.next)} ${Format.time(x.next)}", style = MaterialTheme.typography.labelLarge, color = g.primary) }
                    Spacer(Modifier.height(16.dp))
                    if (ctx.user.can("add")) {
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (mon) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, null, tint = g.primary)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("Monitored", style = MaterialTheme.typography.titleSmall, color = g.text)
                                    Text(if (mon) "New and missing ${if (tv) "episodes" else "copies"} are downloaded" else "Nothing new is downloaded", style = MaterialTheme.typography.bodySmall, color = g.muted)
                                }
                                Switch(mon, { v -> monitored = v; act(if (v) "Now monitored" else "No longer monitored") {
                                    ctx.api.send("POST", "/api/monitor", buildJsonObject { put("sid", sid); put("kind", if (tv) "series" else "movie"); put("id", id); put("monitored", v) })
                                } }, colors = SwitchDefaults.colors(checkedTrackColor = g.primary, checkedThumbColor = g.onPrimary))
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            GhostButton("Search now", icon = Icons.Rounded.Search, modifier = Modifier.weight(1f), onClick = {
                                act("Searching for it") { ctx.api.send("POST", "/api/bulk", buildJsonObject { put("sid", sid); put("action", "search"); put("ids", JsonArray(listOf(JsonPrimitive(id)))) }) }
                            })
                            if (ctx.user.admin) GhostButton("Remove", icon = Icons.Rounded.Delete, color = g.bad, modifier = Modifier.weight(1f), onClick = { remove = true })
                        }
                    }
                }
            }
            val sd = series.value
            if (tv && sd != null) {
                item { SectionTitle("Seasons", Modifier.offset(y = (-60).dp)) }
                sd.seasons.filter { it.n > 0 }.sortedByDescending { it.n }.forEach { s ->
                    item(key = "s${s.n}") {
                        val eps = sd.episodes.filter { it.season == s.n }
                        val have = eps.count { it.has }
                        val aired = eps.count { it.aired }
                        val sMon = seasonMon[s.n] ?: s.monitored
                        val isOpen = open[s.n] == true
                        GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp).offset(y = (-60).dp), padding = 14.dp, onClick = { open[s.n] = !isOpen }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Season ${s.n}", style = MaterialTheme.typography.titleSmall, color = g.text)
                                    Text("$have of ${eps.size} episodes" + (if (aired < eps.size) " · ${eps.size - aired} still to air" else ""), style = MaterialTheme.typography.bodySmall, color = g.muted)
                                }
                                if (ctx.user.can("add")) Switch(sMon, { v -> seasonMon[s.n] = v; act(if (v) "Season ${s.n} monitored" else "Season ${s.n} not monitored") {
                                    ctx.api.send("POST", "/api/monitor", buildJsonObject { put("sid", sid); put("kind", "season"); put("id", id); put("season", s.n); put("monitored", v) })
                                } }, colors = SwitchDefaults.colors(checkedTrackColor = g.primary, checkedThumbColor = g.onPrimary))
                                Icon(if (isOpen) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, null, tint = g.muted)
                            }
                            Spacer(Modifier.height(8.dp))
                            Bar(if (eps.isEmpty()) 0f else have.toFloat() / eps.size, color = if (have == eps.size) g.good else g.primary, height = 4.dp)
                            if (isOpen) {
                                Spacer(Modifier.height(8.dp))
                                eps.sortedBy { it.num }.forEach { e ->
                                    val epOpen = openEp[e.id] == true
                                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { openEp[e.id] = !epOpen }.padding(vertical = 7.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(if (e.has) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked, null,
                                                tint = if (e.has) g.good else if (e.aired && e.monitored) g.bad else g.muted, modifier = Modifier.size(18.dp))
                                            Spacer(Modifier.width(10.dp))
                                            Column(Modifier.weight(1f)) {
                                                Text("${e.num}. ${e.title.ifEmpty { "Episode ${e.num}" }}", style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = if (epOpen) 3 else 1, overflow = TextOverflow.Ellipsis)
                                                Text(listOf(if (e.date.isNotEmpty()) Format.day(e.date) else "", if (e.runtime > 0) "${e.runtime} min" else "", e.quality, if (e.size > 0) Format.bytes(e.size) else "").filter { it.isNotEmpty() }.joinToString(" · "),
                                                    style = MaterialTheme.typography.labelSmall, color = g.muted)
                                            }
                                        }
                                        // The episode's story: a short preview, all of it once tapped. "Hide spoilers" keeps it closed until tapped.
                                        if (e.overview.isNotBlank() && (epOpen || !ctx.prefs.spoilers)) Text(e.overview, style = MaterialTheme.typography.bodySmall, color = g.text.copy(alpha = 0.75f),
                                            maxLines = if (epOpen) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 28.dp, top = 4.dp))
                                        else if (e.overview.isBlank() && epOpen) Text("No description for this episode yet.", style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(start = 28.dp, top = 4.dp))
                                        if (epOpen && ctx.user.can("add") && !e.has && e.aired) Row(Modifier.padding(start = 20.dp, top = 2.dp)) {
                                            androidx.compose.material3.TextButton(onClick = {
                                                act("Searching for episode ${e.num}") { ctx.api.send("POST", "/api/auto", buildJsonObject { put("sid", sid); put("id", e.id); put("scope", "episode") }) }
                                            }) { Icon(Icons.Rounded.Search, null, tint = g.primary, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Search for this episode", color = g.primary) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        }
        if (remove) Confirm(
            "Remove ${x.title}?", "It is taken out of ${if (tv) "Sonarr" else "Radarr"} and will not be downloaded again.", "Remove", danger = true,
            extra = { CheckLine("Also delete its files from the disk", withFiles, danger = true) { withFiles = it } },
            onYes = {
                remove = false
                scope.launch {
                    try {
                        ctx.api.send("DELETE", "/api/library/$sid/$id?files=${if (withFiles) 1 else 0}")
                        LibCache.lists.remove(sid); toast("Removed"); ctx.back()
                    } catch (e: Exception) { toast(e.message ?: "Could not remove it") }
                }
            },
            onNo = { remove = false },
        )
    }
}

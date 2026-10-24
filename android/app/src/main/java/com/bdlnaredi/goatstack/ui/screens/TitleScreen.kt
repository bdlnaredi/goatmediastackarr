package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.TitleInfo
import com.bdlnaredi.goatstack.ui.Backdrop
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Load
import com.bdlnaredi.goatstack.ui.LoadingBlock
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat

/**
 * The page for one movie or show, opened from Discover, Search, Requests and Home: its picture, story, cast,
 * seasons and trailer, with a button to request it (or to open it in the library when it is already there).
 */
@Composable
fun TitleScreen(type: String, id: Long) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val toast = toaster()
    val data = rememberLoad(type, id) { ctx.api.get<TitleInfo>("/api/title?type=$type&id=$id") }
    var ask by remember { mutableStateOf<Ask?>(null) }
    var requested by remember { mutableStateOf(false) }

    when (val st = data.state) {
        is Load.Loading -> Column(Modifier.fillMaxSize()) { TopBack(); LoadingBlock(Modifier.padding(16.dp)) }
        is Load.Failed -> Column(Modifier.fillMaxSize()) {
            TopBack()
            EmptyState(Icons.Rounded.Movie, "Could not open this", st.message, action = { GhostButton("Try again", onClick = data.reload) })
        }
        is Load.Done -> TitleBody(st.value, requested, onAsk = { t -> ask = Ask(t.type, t.id, t.title, t.year, t.poster) })
    }
    ask?.let { a -> RequestDialog(a) { msg -> ask = null; if (msg != null) { requested = true; toast(msg) } } }
}

@Composable
private fun TopBack() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    IconButton(onClick = { ctx.back() }, modifier = Modifier.statusBarsPadding().padding(8.dp)) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text) }
}

/** What Seerr says about the title, in words: 5 available, 4 partly, 2 and 3 asked for or being fetched. */
private fun availability(t: TitleInfo, requested: Boolean): Pair<String, Boolean>? = when {
    t.available == 5 -> "Available to watch" to true
    t.available == 4 -> "Partly available" to false
    requested || t.available in 2..3 || t.request != null -> (when (t.request?.stage) {
        "declined" -> "Request declined"; "pending" -> "Waiting for approval"; else -> "Requested"
    }) to false
    t.library != null -> "In your library" to true
    else -> null
}

@Composable
private fun TitleBody(t: TitleInfo, requested: Boolean, onAsk: (TitleInfo) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val uri = LocalUriHandler.current
    val state = availability(t, requested)
    val canAsk = t.seerr.isNotEmpty() && t.library == null && ctx.user.can("request") && t.available != 5 && !requested && t.request?.stage.let { it == null || it == "declined" }

    Box(Modifier.fillMaxSize()) {
    com.bdlnaredi.goatstack.ui.PageBackground(t.backdrop.ifEmpty { t.poster })
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Backdrop(t.backdrop.ifEmpty { t.poster }, height = 280.dp, overPicture = true) {
                IconButton(onClick = { ctx.back() }, modifier = Modifier.statusBarsPadding().padding(8.dp).clip(CircleShape).background(g.bg.copy(alpha = 0.6f))) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text)
                }
            }
        }
        item {
            Row(Modifier.padding(horizontal = 20.dp).offset(y = (-86).dp)) {
                Poster(t.poster, t.title, Modifier.width(118.dp), corner = 14.dp)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f).padding(top = 40.dp)) {
                    Text(t.title, style = MaterialTheme.typography.headlineSmall, color = g.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Text(listOf(if (t.type == "tv") "Show" else "Movie", t.year, if (t.runtime > 0) "${t.runtime} min" else "", t.studio).filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium, color = g.muted)
                    if (t.rating > 0) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                        Icon(Icons.Rounded.Star, null, tint = g.primary, modifier = Modifier.size(15.dp)); Text(" %.1f".format(t.rating), style = MaterialTheme.typography.labelMedium, color = g.text)
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 20.dp).offset(y = (-66).dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state?.let { (text, good) -> Badge(text, if (good) g.good else g.warn) }
                    t.genres.take(4).forEach { Badge(it, g.muted) }
                }
                if (t.tagline.isNotBlank()) { Spacer(Modifier.height(12.dp)); Text(t.tagline, style = MaterialTheme.typography.titleSmall, fontStyle = FontStyle.Italic, color = g.primary) }
                Spacer(Modifier.height(12.dp))
                Text(t.overview.ifBlank { "No story written for this one yet." }, style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.85f))
                Spacer(Modifier.height(16.dp))
                if (canAsk) PrimaryButton(if (t.request?.stage == "declined") "Ask again" else "Request", { onAsk(t) }, Modifier.fillMaxWidth(), icon = Icons.Rounded.Check)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 10.dp)) {
                    t.library?.let { l -> GhostButton("Open in library", icon = Icons.Rounded.GridView, modifier = Modifier.weight(1f), onClick = { ctx.item(l.sid, l.kind, l.id) }) }
                    if (t.trailer.isNotEmpty()) GhostButton("Trailer", icon = Icons.Rounded.PlayCircle, modifier = Modifier.weight(1f), onClick = {
                        runCatching { uri.openUri("https://www.youtube.com/watch?v=${t.trailer}") }
                    })
                }
                if (t.seerr.isEmpty() && t.library == null) Text("Requests need Seerr, and it is not set up on this server.", style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 8.dp))
            }
        }
        if (t.seasons.isNotEmpty()) {
            item { SectionTitle("Seasons", Modifier.offset(y = (-50).dp)) }
            items(t.seasons, key = { "s${it.n}" }) { s ->
                GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).offset(y = (-50).dp), padding = 14.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(s.name.ifBlank { "Season ${s.n}" }, style = MaterialTheme.typography.titleSmall, color = g.text)
                            Text(listOf("${s.episodes} episode${if (s.episodes == 1) "" else "s"}", s.date.take(4)).filter { it.isNotBlank() }.joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = g.muted)
                        }
                        Text("${s.n}", style = MaterialTheme.typography.headlineSmall, color = g.line)
                    }
                }
            }
        }
        if (t.cast.isNotEmpty()) item { CastRow(t.cast, Modifier.offset(y = (-40).dp)) }
        if (t.similar.isNotEmpty()) item { MoreLikeThis(t.similar, Modifier.offset(y = (-34).dp)) }
        if (t.date.isNotEmpty() || t.status.isNotEmpty()) item {
            Text(listOf(t.status, if (t.date.isNotEmpty()) (if (t.type == "tv") "First aired " else "Released ") + Format.day(t.date) else "").filter { it.isNotBlank() }.joinToString(" · "),
                style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(horizontal = 20.dp).offset(y = (-30).dp))
        }
    }
    }
}

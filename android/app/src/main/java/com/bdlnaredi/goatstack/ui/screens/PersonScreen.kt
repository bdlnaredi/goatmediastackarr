package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.CastMember
import com.bdlnaredi.goatstack.data.MediaCard
import com.bdlnaredi.goatstack.data.PersonInfo
import com.bdlnaredi.goatstack.data.TitleInfo
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.Load
import com.bdlnaredi.goatstack.ui.LoadingBlock
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The cast as round pictures. Tapping someone opens their page with everything they were in. */
@Composable
fun CastRow(cast: List<CastMember>, modifier: Modifier = Modifier) {
    if (cast.isEmpty()) return
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    Column(modifier) {
        SectionTitle("Cast")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(cast) { c ->
                Column(
                    Modifier.width(88.dp).clip(RoundedCornerShape(14.dp)).clickable(enabled = c.id > 0) { ctx.person(c.id) }.padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.size(76.dp).clip(CircleShape)) { Poster(c.photo, c.name, Modifier.fillMaxSize(), corner = 38.dp, ratio = 1f) }
                    Spacer(Modifier.height(6.dp))
                    Text(c.name, style = MaterialTheme.typography.labelMedium, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    if (c.role.isNotBlank()) Text(c.role, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

/** A poster for a movie or show, with a mark when it is already in the library or asked for. */
@Composable
fun MediaPoster(x: MediaCard, modifier: Modifier = Modifier, showRole: Boolean = false) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    Column(modifier.clip(RoundedCornerShape(14.dp)).clickable { ctx.title(x.type, x.id) }) {
        Box {
            Poster(x.poster, x.title, Modifier.fillMaxWidth(), corner = 14.dp)
            val mark = when { x.available == 5 -> "Available"; x.inLib -> "In library"; x.available in 2..4 -> "Requested"; else -> null }
            if (mark != null) Text(mark, style = MaterialTheme.typography.labelSmall, color = if (mark == "Requested") g.text else g.onPrimary,
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).clip(RoundedCornerShape(50))
                    .background(if (mark == "Requested") Color.Black.copy(alpha = 0.7f) else g.good).padding(horizontal = 8.dp, vertical = 3.dp))
            if (x.rating > 0) Row(Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f)).padding(horizontal = 7.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Star, null, tint = g.primary, modifier = Modifier.size(12.dp)); Text(" %.1f".format(x.rating), style = MaterialTheme.typography.labelSmall, color = Color.White)
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(x.title, style = MaterialTheme.typography.labelLarge, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOf(x.year.ifBlank { "Coming" }, if (x.type == "tv") "Show" else "Movie").joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = g.muted)
        if (showRole && x.role.isNotBlank()) Text(x.role, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** "More like this": a sideways row of posters that open their own title page. */
@Composable
fun MoreLikeThis(items: List<MediaCard>, modifier: Modifier = Modifier) {
    if (items.isEmpty()) return
    Column(modifier) {
        SectionTitle("More like this")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(items, key = { "${it.type}${it.id}" }) { x -> MediaPoster(x, Modifier.width(112.dp)) }
        }
    }
}

/** The cast and "More like this" for a library item, looked up by its TMDB number. Shows nothing until it arrives. */
@Composable
fun TitleExtras(type: String, tmdb: Long, modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    if (tmdb <= 0) return
    val data = rememberLoad(type, tmdb) { ctx.api.get<TitleInfo>("/api/title?type=$type&id=$tmdb") }
    val t = (data.state as? Load.Done)?.value ?: return
    Column(modifier) {
        CastRow(t.cast)
        if (t.cast.isNotEmpty() && t.similar.isNotEmpty()) Spacer(Modifier.height(8.dp))
        MoreLikeThis(t.similar)
    }
}

private fun nice(d: String): String = runCatching { LocalDate.parse(d.take(10)).format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault())) }.getOrDefault(d)
private fun age(born: String, died: String): Int? = runCatching {
    Period.between(LocalDate.parse(born.take(10)), if (died.isNotBlank()) LocalDate.parse(died.take(10)) else LocalDate.now()).years
}.getOrNull()

/** One actor or film maker: who they are, then everything they were in. Any title opens its page, where it can be requested. */
@Composable
fun PersonScreen(id: Long) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad(id) { ctx.api.get<PersonInfo>("/api/person?id=$id") }
    var show by rememberSaveable { androidx.compose.runtime.mutableStateOf("all") }
    var more by rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
    val back: @Composable () -> Unit = {
        IconButton(onClick = { ctx.back() }, modifier = Modifier.statusBarsPadding().padding(8.dp).clip(CircleShape).background(g.bg.copy(alpha = 0.6f))) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = g.text)
        }
    }
    when (val st = data.state) {
        is Load.Loading -> Column(Modifier.fillMaxSize()) { back(); LoadingBlock(Modifier.padding(16.dp)) }
        is Load.Failed -> Column(Modifier.fillMaxSize()) {
            back(); EmptyState(Icons.Rounded.Person, "Could not open this", st.message, action = { GhostButton("Try again", onClick = data.reload) })
        }
        is Load.Done -> {
            val p = st.value
            val list = p.credits.filter { show == "all" || (show == "lib" && (it.inLib || it.available == 5)) || it.type == show }
            Box(Modifier.fillMaxSize()) {
                com.bdlnaredi.goatstack.ui.PageBackground(p.photo)
                LazyVerticalGrid(GridCells.Adaptive(108.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(start = 0.dp)) { back() } }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row {
                            Poster(p.photo, p.name, Modifier.width(118.dp), corner = 14.dp)
                            Spacer(Modifier.width(16.dp))
                            Column(Modifier.weight(1f).padding(top = 8.dp)) {
                                Text(p.name, style = MaterialTheme.typography.headlineSmall, color = g.text)
                                if (p.known.isNotBlank()) Text(p.known, style = MaterialTheme.typography.labelLarge, color = g.primary)
                                if (p.born.isNotBlank()) Text("Born ${nice(p.born)}" + (if (p.died.isBlank()) age(p.born, "")?.let { " ($it)" }.orEmpty() else ""), style = MaterialTheme.typography.bodySmall, color = g.muted)
                                if (p.died.isNotBlank()) Text("Died ${nice(p.died)}" + (age(p.born, p.died)?.let { " ($it)" }.orEmpty()), style = MaterialTheme.typography.bodySmall, color = g.muted)
                                if (p.place.isNotBlank()) Text(p.place, style = MaterialTheme.typography.bodySmall, color = g.muted)
                            }
                        }
                    }
                    if (p.bio.isNotBlank()) item(span = { GridItemSpan(maxLineSpan) }) {
                        Column {
                            Text(p.bio, style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.85f), maxLines = if (more) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                            if (p.bio.length > 300) TextButton(onClick = { more = !more }) { Text(if (more) "Show less" else "Read more", color = g.primary) }
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column {
                            SectionTitle("Filmography (${p.credits.size})", Modifier.padding(start = 0.dp))
                            val n = { k: String -> p.credits.count { k == "all" || (k == "lib" && (it.inLib || it.available == 5)) || it.type == k } }
                            ChoiceRow(listOf("all" to "All ${n("all")}", "movie" to "Movies ${n("movie")}", "tv" to "Shows ${n("tv")}", "lib" to "In your library ${n("lib")}"),
                                show, { show = it }, Modifier.padding(horizontal = 0.dp))
                        }
                    }
                    if (list.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("Nothing to show here.", color = g.muted, modifier = Modifier.padding(8.dp)) }
                    items(list, key = { "${it.type}${it.id}" }) { x -> MediaPoster(x, showRole = true) }
                }
            }
        }
    }
}


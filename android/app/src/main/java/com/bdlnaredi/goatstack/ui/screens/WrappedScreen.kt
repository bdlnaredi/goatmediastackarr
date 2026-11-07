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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bdlnaredi.goatstack.data.WrapTop
import com.bdlnaredi.goatstack.data.Wrapped
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import java.util.Calendar

/** The year the review is for: this one from November on, otherwise last year. */
fun wrapYear(): Int { val c = Calendar.getInstance(); return if (c.get(Calendar.MONTH) >= Calendar.NOVEMBER) c.get(Calendar.YEAR) else c.get(Calendar.YEAR) - 1 }

/** Year in review: hours, top shows and movies, the longest binge and the requests. Admins can switch to anyone, or everyone. */
@Composable
fun WrappedScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    var year by remember { mutableIntStateOf(wrapYear()) }
    var who by remember { mutableStateOf(ctx.user.id) }
    val data = rememberLoad("wrapped", year, who) { ctx.api.get<Wrapped>("/api/wrapped?year=$year&uid=$who") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Year in review")
        LoadView(data) { d ->
            val w = d.watch
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    val now = Calendar.getInstance().get(Calendar.YEAR)
                    ChoiceRow((0..3).map { (now - it) to "${now - it}" }, year, { year = it })
                    d.people?.let { p -> Spacer(Modifier.height(6.dp)); ChoiceRow(listOf("all" to "Everyone") + p.map { it.id to it.name }, who, { who = it }) }
                }
                item {
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Brush.linearGradient(listOf(g.primary.copy(alpha = 0.35f), g.accent.copy(alpha = 0.22f)))).padding(20.dp)) {
                        Column {
                            Text("${d.year} IN REVIEW", style = MaterialTheme.typography.labelMedium, color = g.primary, fontWeight = FontWeight.Bold)
                            Text(if (who == "all") "Everyone on this server" else d.name, style = MaterialTheme.typography.headlineSmall, color = g.text)
                            Spacer(Modifier.height(12.dp))
                            if (w != null) Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Big("${w.seconds / 3600}", "hours", Modifier.weight(1f)); Big("${w.episodes}", "episodes", Modifier.weight(1f)); Big("${w.movies}", "movies", Modifier.weight(1f))
                            } else Text(d.note.ifEmpty { "Nothing watched yet this year." }, color = g.muted)
                        }
                    }
                }
                if (w != null) {
                    val facts = listOfNotNull(
                        w.day.takeIf { it.isNotEmpty() }?.let { (if (who == "all") "The busiest night was $it" else "Your night was $it") + (w.hour?.let { h -> ", mostly around %02d:00".format(h) } ?: "") + "." },
                        w.binge?.let { "Longest binge: ${it.episodes} episodes of ${it.title} on ${it.date}." },
                        w.first?.let { "It started with ${it.title} on ${it.date}." },
                        w.devices.takeIf { it.isNotEmpty() }?.let { "Watched most on ${it.joinToString(", ")}." })
                    if (facts.isNotEmpty()) item { GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) { facts.forEach { Text(it, color = g.text, modifier = Modifier.padding(vertical = 3.dp)) } } }
                    if (w.topShows.isNotEmpty()) item { TopRow("Top shows", w.topShows, d.sid) }
                    if (w.topMovies.isNotEmpty()) item { TopRow("Top movies", w.topMovies, d.sid) }
                    w.people?.takeIf { it.isNotEmpty() }?.let { p -> item { GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("Who watched the most", style = MaterialTheme.typography.titleSmall, color = g.text)
                        p.forEachIndexed { i, x -> Row(Modifier.padding(top = 6.dp)) { Text("${i + 1}. ${x.title}", color = g.text, modifier = Modifier.weight(1f)); Text("${x.seconds / 3600} h", color = g.muted) } }
                    } } }
                }
                item {
                    val r = d.requests
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("Requests", style = MaterialTheme.typography.titleSmall, color = g.text)
                        Text(if (r.made > 0) "${r.made} request${if (r.made == 1) "" else "s"} (${r.movies} movies, ${r.shows} shows), ${r.ready} ready to watch." else "No requests this year.", color = g.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun Big(n: String, label: String, modifier: Modifier) {
    val g = LocalGoat.current
    Column(modifier) { Text(n, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = g.text); Text(label, style = MaterialTheme.typography.labelSmall, color = g.muted) }
}

@Composable
private fun TopRow(title: String, list: List<WrapTop>, sid: String) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    Column {
        Text(title, style = MaterialTheme.typography.titleMedium, color = g.text)
        Spacer(Modifier.height(8.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(list) { x ->
                Column(Modifier.width(104.dp)) {
                    Poster(if (sid.isNotEmpty()) ctx.api.mediaImage(sid, "tautulli", x.thumb) else null, x.title, Modifier.fillMaxWidth(), corner = 12.dp)
                    Spacer(Modifier.height(4.dp))
                    Text(x.title, style = MaterialTheme.typography.labelLarge, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (x.seconds >= 3600) "${x.seconds / 3600} h" else "${x.seconds / 60} min", style = MaterialTheme.typography.labelSmall, color = g.muted)
                }
            }
        }
    }
}

package com.bdlnaredi.goatstack.ui.screens

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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.MediaRequest
import com.bdlnaredi.goatstack.data.Upcoming
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
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch

/** What a request's stage means, in words. */
fun stageText(s: String): String = when (s) {
    "pending" -> "Waiting for approval"
    "approved" -> "Approved"
    "searching" -> "Searching"
    "downloading" -> "Downloading"
    "available", "done" -> "Ready to watch"
    "partial" -> "Partly available"
    "declined" -> "Declined"
    "failed" -> "Problem"
    else -> s.replaceFirstChar { it.uppercase() }
}

@Composable
fun stageColor(s: String): Color {
    val g = LocalGoat.current
    return when (s) {
        "available", "done" -> g.good
        "declined", "failed" -> g.bad
        "pending" -> g.warn
        else -> g.primary
    }
}

@Composable
private fun BackTitle(title: String, subtitle: String?, actions: @Composable () -> Unit = {}) {
    val ctx = LocalCtx.current
    Row(Modifier.statusBarsPadding().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { ctx.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = LocalGoat.current.text) }
        PageTitle(title, subtitle, Modifier.weight(1f).padding(start = 0.dp)) { actions() }
    }
}

@Composable
fun RequestsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var show by rememberSaveable { mutableStateOf("all") }
    val data = rememberLoad { ctx.api.get<List<MediaRequest>>("/api/requests") }
    Column(Modifier.fillMaxSize()) {
        BackTitle("Requests", if (ctx.user.admin) "Everyone's requests" else "What you asked for") {
            IconButton(onClick = { ctx.go("search") }) { Icon(Icons.Rounded.Add, "New request", tint = g.primary) }
        }
        ChoiceRow(listOf("all" to "All", "pending" to "Waiting", "approved" to "Approved", "declined" to "Declined"), show, { show = it })
        Spacer(Modifier.height(6.dp))
        LoadView(data) { all ->
            val list = all.filter { show == "all" || it.status == show }
            if (list.isEmpty()) EmptyState(Icons.Rounded.Inbox, "No requests", "Ask for a show or movie from Search or Discover.") {
                GhostButton("Search", onClick = { ctx.go("search") })
            }
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(list, key = { it.id }) { r ->
                    val stage = r.stage.ifEmpty { r.status }
                    GoatCard(Modifier.fillMaxWidth(), padding = 12.dp, onClick = if (r.mediaId > 0) ({ ctx.title(r.mediaType, r.mediaId) }) else null) {
                        Row {
                            Poster(r.poster, r.title, Modifier.width(64.dp), corner = 10.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(r.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(listOf(if (r.mediaType == "tv") "Show" else "Movie", r.year, if (r.seasons.isNotEmpty()) "seasons ${r.seasons.joinToString(", ")}" else "").filter { it.isNotEmpty() }.joinToString(" · "),
                                    style = MaterialTheme.typography.labelMedium, color = g.muted)
                                Text("${r.user} · ${Format.ago(r.at)}", style = MaterialTheme.typography.labelSmall, color = g.muted)
                                Spacer(Modifier.height(8.dp))
                                Badge(stageText(stage), stageColor(stage))
                            }
                        }
                        if (ctx.user.admin && r.status == "pending") {
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                listOf("approve" to "Approve", "decline" to "Decline").forEach { (a, label) ->
                                    GhostButton(label, icon = if (a == "approve") Icons.Rounded.Check else Icons.Rounded.Close, color = if (a == "approve") g.good else g.bad,
                                        modifier = Modifier.weight(1f), onClick = {
                                            scope.launch {
                                                try { ctx.api.send("POST", "/api/requests/${r.id}/$a"); toast(if (a == "approve") "Approved" else "Declined"); data.reload() }
                                                catch (e: Exception) { toast(e.message ?: "That did not work") }
                                            }
                                        })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun UpcomingScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad { ctx.api.get<Upcoming>("/api/upcoming") }
    Column(Modifier.fillMaxSize()) {
        BackTitle("Upcoming", "The next two weeks")
        LoadView(data) { u ->
            if (u.calendar.isEmpty() && u.queue.isEmpty()) EmptyState(Icons.Rounded.CalendarMonth, "Nothing coming up", "New episodes and movie releases you follow appear here.")
            else LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                if (u.queue.isNotEmpty()) {
                    item { SectionTitle("Being downloaded") }
                    items(u.queue) { q ->
                        GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp), padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Poster(q.poster, q.title, Modifier.width(48.dp), corner = 8.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(q.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(q.sub, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.height(6.dp))
                                    Bar(q.progress.toFloat(), height = 4.dp)
                                    Text(listOfNotNull(Format.percent(q.progress), q.timeleft?.let { "$it left" }, q.status.ifEmpty { null }).joinToString(" · "),
                                        style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                            }
                        }
                    }
                }
                u.calendar.groupBy { Format.day(it.date) }.forEach { (day, list) ->
                    item(key = "d$day") { SectionTitle(day) }
                    items(list) { c ->
                        GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp), padding = 12.dp,
                            // Movies open their page; for shows the calendar only knows the episode, not the show.
                            onClick = if (c.sub == "Movie release") ({ ctx.item(c.sid, "movie", c.id) }) else null) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Poster(c.poster, c.title, Modifier.width(54.dp), corner = 10.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(c.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(c.sub, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                                val t = Format.time(c.date)
                                if (t.isNotEmpty()) Text(t, style = MaterialTheme.typography.labelLarge, color = g.primary)
                            }
                        }
                    }
                }
                if (u.errors.isNotEmpty()) item {
                    Text(u.errors.joinToString("\n"), style = MaterialTheme.typography.bodySmall, color = g.bad, modifier = Modifier.padding(20.dp))
                }
            }
        }
    }
}

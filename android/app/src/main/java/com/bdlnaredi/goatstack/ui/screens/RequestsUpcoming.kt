package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import com.bdlnaredi.goatstack.ui.LoadingBlock
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
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
    "pending" -> "Requested"
    "approved" -> "Approved"
    "searching" -> "Approved, looking for a download"
    "downloading" -> "Downloading"
    "importing" -> "Copying to the library"
    "library" -> "In the library, waiting for Plex"
    "available", "done" -> "Available"
    "partial" -> "Partly available"
    "declined" -> "Declined"
    "failed" -> "Download failed"
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
                                Badge(stageText(stage) + (if (stage == "downloading" && r.progress != null) " ${(r.progress * 100).toInt()}%" else "") + (if (stage == "available" && r.where.isNotEmpty()) " on ${r.where}" else ""), stageColor(stage))
                                if (stage == "pending") Text("Waiting for an admin", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 4.dp))
                                if (stage == "downloading" && r.progress != null) {
                                    Spacer(Modifier.height(8.dp))
                                    Bar(r.progress.toFloat(), height = 4.dp)
                                    if (r.eta.isNotEmpty()) Text("${r.eta} left" + if (r.paused) ", paused" else "", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 4.dp))
                                }
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
    var view by rememberSaveable { mutableStateOf("list") }
    var month by rememberSaveable { mutableStateOf(java.time.YearMonth.now().toString()) }
    val ym = java.time.YearMonth.parse(month)
    // The list shows the next two weeks; the month view asks for the whole month shown.
    val data = rememberLoad(view, month) {
        if (view == "list") ctx.api.get<Upcoming>("/api/upcoming")
        else ctx.api.get<Upcoming>("/api/upcoming?from=${ym.atDay(1)}T00:00:00&to=${ym.plusMonths(1).atDay(1)}T00:00:00")
    }
    Column(Modifier.fillMaxSize()) {
        BackTitle("Upcoming", if (view == "list") "The next two weeks" else "Month by month")
        ChoiceRow(listOf("list" to "List", "month" to "Calendar"), view, { view = it })
        Spacer(Modifier.height(6.dp))
        if (view == "month") { MonthView(ym, data.value, { month = it.toString() }); return@Column }
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
                    items(list) { c -> CalCard(c) }
                }
                if (u.errors.isNotEmpty()) item {
                    Text(u.errors.joinToString("\n"), style = MaterialTheme.typography.bodySmall, color = g.bad, modifier = Modifier.padding(20.dp))
                }
            }
        }
    }
}

@Composable
private fun CalCard(c: com.bdlnaredi.goatstack.data.CalItem) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
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

/** A month as a grid of days. Days with something coming have dots (one per item, up to three); tap a day to see what. */
@Composable
private fun MonthView(ym: java.time.YearMonth, u: Upcoming?, onMonth: (java.time.YearMonth) -> Unit) {
    val g = LocalGoat.current
    val today = java.time.LocalDate.now()
    var picked by rememberSaveable(ym.toString()) { mutableStateOf(if (java.time.YearMonth.from(today) == ym) today.dayOfMonth else 1) }
    val byDay = (u?.calendar ?: emptyList()).groupBy { Format.localDate(it.date) }
    val first = ym.atDay(1)
    val lead = (first.dayOfWeek.value + 6) % 7 // Monday first
    val days = ym.lengthOfMonth()
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onMonth(ym.minusMonths(1)) }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Previous month", tint = g.text) }
                Text(ym.format(java.time.format.DateTimeFormatter.ofPattern("MMMM yyyy", java.util.Locale.getDefault())), style = MaterialTheme.typography.titleMedium, color = g.text,
                    modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick = { onMonth(ym.plusMonths(1)) }) { Icon(Icons.AutoMirrored.Rounded.ArrowForward, "Next month", tint = g.text) }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 12.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = g.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
                }
                Spacer(Modifier.height(4.dp))
                val cells = lead + days
                for (w in 0 until (cells + 6) / 7) Row(Modifier.fillMaxWidth()) {
                    for (c in 0 until 7) {
                        val n = w * 7 + c - lead + 1
                        if (n < 1 || n > days) { Spacer(Modifier.weight(1f).height(52.dp)); continue }
                        val d = ym.atDay(n)
                        val list = byDay[d].orEmpty()
                        val on = n == picked
                        Column(Modifier.weight(1f).height(52.dp).padding(2.dp).clip(RoundedCornerShape(12.dp))
                            .background(if (on) g.primary.copy(alpha = 0.22f) else if (d == today) g.card else Color.Transparent)
                            .clickable { picked = n }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            Text("$n", style = MaterialTheme.typography.bodyMedium, color = if (d == today) g.primary else g.text,
                                fontWeight = if (d == today || on) androidx.compose.ui.text.font.FontWeight.Bold else null)
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                list.take(3).forEach { x -> Box(Modifier.size(5.dp).clip(CircleShape).background(if (x.sub == "Movie release") g.accent else g.primary)) }
                            }
                        }
                    }
                }
            }
        }
        if (u == null) item { LoadingBlock(rows = 2) }
        else {
            val d = ym.atDay(picked.coerceIn(1, days))
            val list = byDay[d].orEmpty()
            item { SectionTitle(Format.day(d.toString())) }
            if (list.isEmpty()) item { Text("Nothing on this day.", style = MaterialTheme.typography.bodyMedium, color = g.muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
            items(list) { c -> CalCard(c) }
            if (u.errors.isNotEmpty()) item { Text(u.errors.joinToString("\n"), style = MaterialTheme.typography.bodySmall, color = g.bad, modifier = Modifier.padding(20.dp)) }
        }
    }
}

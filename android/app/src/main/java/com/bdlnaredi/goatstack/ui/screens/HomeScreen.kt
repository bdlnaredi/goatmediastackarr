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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.GoatStatus
import com.bdlnaredi.goatstack.data.Live
import com.bdlnaredi.goatstack.data.MediaRequest
import com.bdlnaredi.goatstack.data.Upcoming
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.Dot
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.StatTile
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import java.time.LocalTime

@Composable
fun HomeScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val svcs = services()
    var live by remember { mutableStateOf<Live?>(null) }
    LaunchedEffect(Unit) { ctx.api.live().collect { live = it } }
    val upcoming = rememberLoad { ctx.api.get<Upcoming>("/api/upcoming") }
    val requests = rememberLoad { ctx.api.get<List<MediaRequest>>("/api/requests") }
    val stack = rememberLoad(ctx.user.admin) { if (ctx.user.admin && ctx.me.goat) ctx.api.get<GoatStatus>("/api/goat/status") else null }

    val l = live
    val dl = (l?.qb?.values?.sumOf { it.dl } ?: 0L) + (l?.sab?.values?.sumOf { it.speed.toLong() } ?: 0L)
    val ul = l?.qb?.values?.sumOf { it.ul } ?: 0L
    val active = (l?.qb?.values?.sumOf { it.active } ?: 0) + (l?.sab?.values?.sumOf { it.slots } ?: 0)
    val playing = l?.plex?.flatMap { (sid, list) -> list.map { sid to it } }.orEmpty()
    val healthy = l?.health?.values?.count { it } ?: 0
    val known = l?.health?.size ?: 0

    val feed = rememberLoad { ctx.api.get<com.bdlnaredi.goatstack.data.Feed>("/api/notifications") }
    val unread = feed.value?.let { f -> f.items.count { it.id > f.read } } ?: 0
    val upd by ctx.app.updates.collectAsStateWithLifecycle()
    val prefs by ctx.app.prefs.collectAsStateWithLifecycle()

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(g.primary.copy(alpha = 0.20f), g.bg)))) {
                Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp, vertical = 18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(greeting(), style = MaterialTheme.typography.labelLarge, color = g.primary)
                            Text(ctx.user.name, style = MaterialTheme.typography.displaySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Box {
                            IconButton(onClick = { ctx.go("notifications") }, modifier = Modifier.size(48.dp).clip(CircleShape).background(g.card)) {
                                Icon(Icons.Rounded.Notifications, if (unread > 0) "$unread new notifications" else "Notifications", tint = g.text)
                            }
                            if (unread > 0) Box(Modifier.align(Alignment.TopEnd).size(18.dp).clip(CircleShape).background(g.bad), contentAlignment = Alignment.Center) {
                                Text(if (unread > 9) "9+" else "$unread", style = MaterialTheme.typography.labelSmall, color = androidx.compose.ui.graphics.Color.White)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        if (ctx.user.kids == null) IconButton(onClick = { ctx.go("search") }, modifier = Modifier.size(48.dp).clip(CircleShape).background(g.card)) {
                            Icon(Icons.Rounded.Search, "Search", tint = g.text)
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(if (known == 0) g.muted else if (healthy == known) g.good else g.warn)
                        Spacer(Modifier.width(8.dp))
                        Text(if (known == 0) "Checking your apps…" else if (healthy == known) "All $known apps are running" else "${known - healthy} of $known apps need a look",
                            style = MaterialTheme.typography.bodyMedium, color = g.muted)
                    }
                    stack.value?.let { st ->
                        if (st.vpn.enabled) {
                            Spacer(Modifier.height(6.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.Shield, null, tint = if (st.vpn.state == "up") g.good else g.bad, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (st.vpn.state == "up") "VPN connected" + (if (st.vpn.country.isNotEmpty()) " · ${st.vpn.country}" else "") else "VPN not connected: download apps are offline",
                                    style = MaterialTheme.typography.bodyMedium, color = g.muted)
                            }
                        }
                    }
                }
            }
        }
        upd?.let { u ->
            val appOld = u.apk.isNotEmpty() && com.bdlnaredi.goatstack.data.Versions.newer(u.latest, com.bdlnaredi.goatstack.BuildConfig.VERSION_NAME)
            if ((appOld || u.serverUpdate) && prefs.dismissedUpdate != u.latest) item(key = "update") {
                UpdateCard(u, appOld) { ctx.app.setPrefs(prefs.copy(dismissedUpdate = u.latest)) }
            }
        }
        item {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile("Download", Format.speed(dl), Modifier.weight(1f), Icons.Rounded.ArrowDownward)
                StatTile("Upload", Format.speed(ul), Modifier.weight(1f), Icons.Rounded.ArrowUpward, tint = g.accent)
                StatTile("Active", active.toString(), Modifier.weight(0.8f), Icons.Rounded.Layers, tint = g.good)
            }
        }
        item {
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickAction("Requests", Icons.Rounded.Inbox, Modifier.weight(1f)) { ctx.go("requests") }
                QuickAction("Upcoming", Icons.Rounded.CalendarMonth, Modifier.weight(1f)) { ctx.go("upcoming") }
                if (ctx.user.admin && ctx.me.goat) QuickAction("Stack", Icons.Rounded.Shield, Modifier.weight(1f)) { ctx.go("stack") }
                else if (ctx.user.kids == null) QuickAction("Watchlist", Icons.Rounded.Bookmark, Modifier.weight(1f)) { ctx.go("watchlist") }
            }
        }

        if (playing.isNotEmpty()) {
            item { SectionTitle("Playing now") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(playing) { (sid, p) ->
                        val type = svcs.firstOrNull { it.id == sid }?.type ?: "plex"
                        GoatCard(Modifier.width(260.dp), padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Poster(ctx.api.mediaImage(sid, type, p.thumb), p.title, Modifier.width(56.dp), corner = 10.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(p.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(p.sub, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.height(4.dp))
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Rounded.PlayCircle, null, tint = g.primary, modifier = Modifier.size(14.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("${p.user} · ${p.device}", style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            Bar(p.progress.toFloat(), height = 4.dp)
                        }
                    }
                }
            }
        }

        val tops = l?.qb?.values?.flatMap { it.top }.orEmpty().take(5)
        val jobs = l?.sab?.values?.flatMap { it.jobs }.orEmpty().take(3)
        if (tops.isNotEmpty() || jobs.isNotEmpty()) {
            item { SectionTitle("Downloading", trailing = { Text(com.bdlnaredi.goatstack.data.tr("See all"), color = g.primary, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable { ctx.go("downloads") }) }) }
            item {
                GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    tops.forEachIndexed { i, t ->
                        if (i > 0) Spacer(Modifier.height(14.dp))
                        Text(t.name, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.height(6.dp))
                        Bar(t.progress.toFloat())
                        Spacer(Modifier.height(4.dp))
                        Text("${Format.percent(t.progress)} · ${Format.speed(t.speed)} · ${Format.eta(t.eta)} left", style = MaterialTheme.typography.labelSmall, color = g.muted)
                    }
                    jobs.forEachIndexed { i, j ->
                        if (i > 0 || tops.isNotEmpty()) Spacer(Modifier.height(14.dp))
                        Text(j.name, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.height(6.dp))
                        Bar((j.pct / 100).toFloat(), color = g.accent)
                        Spacer(Modifier.height(4.dp))
                        Text("Usenet · ${j.pct.toInt()}%", style = MaterialTheme.typography.labelSmall, color = g.muted)
                    }
                }
            }
        }

        val cal = upcoming.value?.calendar.orEmpty()
        if (cal.isNotEmpty()) {
            item { SectionTitle("Coming up", trailing = { Text(com.bdlnaredi.goatstack.data.tr("Calendar"), color = g.primary, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable { ctx.go("upcoming") }) }) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(cal.take(12)) { c ->
                        Column(Modifier.width(118.dp)) {
                            Poster(c.poster, c.title, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(6.dp))
                            Text(Format.day(c.date), style = MaterialTheme.typography.labelMedium, color = g.primary)
                            Text(c.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(c.sub, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }

        item(key = "foryou") { Column { ForYouRows() } }

        val reqs = requests.value.orEmpty()
        val waiting = reqs.filter { it.status == "pending" }
        if (reqs.isNotEmpty()) {
            item { SectionTitle(if (ctx.user.admin && waiting.isNotEmpty()) "Requests waiting for you" else "Latest requests",
                trailing = { Text(com.bdlnaredi.goatstack.data.tr("All"), color = g.primary, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clickable { ctx.go("requests") }) }) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items((if (ctx.user.admin && waiting.isNotEmpty()) waiting else reqs).take(10)) { r ->
                        Column(Modifier.width(104.dp).clickable { if (r.mediaId > 0) ctx.title(r.mediaType, r.mediaId) else ctx.go("requests") }) {
                            Poster(r.poster, r.title, Modifier.fillMaxWidth())
                            Spacer(Modifier.height(6.dp))
                            Text(r.title, style = MaterialTheme.typography.bodySmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(stageText(r.stage.ifEmpty { r.status }), style = MaterialTheme.typography.labelSmall, color = stageColor(r.stage.ifEmpty { r.status }))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickAction(label: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    val g = LocalGoat.current
    Column(
        modifier.clip(RoundedCornerShape(18.dp)).background(g.card).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = g.primary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(6.dp))
        Text(com.bdlnaredi.goatstack.data.tr(label), style = MaterialTheme.typography.labelLarge, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun greeting(): String = com.bdlnaredi.goatstack.data.tr(when (LocalTime.now().hour) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    in 17..21 -> "Good evening"
    else -> "Hello, night owl"
})

/** "A new version is out": get the new app, and (for admins) a reminder to update the container. */
@Composable
private fun UpdateCard(u: com.bdlnaredi.goatstack.data.Updates, appOld: Boolean, onLater: () -> Unit) {
    val g = LocalGoat.current
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    com.bdlnaredi.goatstack.ui.GoatCard(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.SystemUpdate, null, tint = g.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Version ${u.latest} is out", style = MaterialTheme.typography.titleSmall, color = g.text)
                if (appOld) Text("A newer GoatStack app is ready. You have ${com.bdlnaredi.goatstack.BuildConfig.VERSION_NAME}.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                if (u.serverUpdate) Text("The server has ${u.server}. On Unraid, open the Docker tab and click Update on GoatMediaStackarr.", style = MaterialTheme.typography.bodySmall, color = g.muted)
            }
        }
        // What the new version changes, from its release notes.
        val notes = releaseNotes(u.notes)
        if (notes.isNotEmpty()) {
            var all by remember { mutableStateOf(false) }
            Spacer(Modifier.height(10.dp))
            Text(com.bdlnaredi.goatstack.data.tr("What's new"), style = MaterialTheme.typography.labelLarge, color = g.primary)
            (if (all) notes else notes.take(2)).forEach { n ->
                Row(Modifier.padding(top = 4.dp)) {
                    Text("•", style = MaterialTheme.typography.bodySmall, color = g.primary, modifier = Modifier.width(14.dp))
                    Text(n, style = MaterialTheme.typography.bodySmall, color = g.text.copy(alpha = 0.85f), maxLines = if (all) 8 else 3, overflow = TextOverflow.Ellipsis)
                }
            }
            if (notes.size > 2) Text(com.bdlnaredi.goatstack.data.tr(if (all) "Show less" else "Show all") + if (all) "" else " (${notes.size})", style = MaterialTheme.typography.labelLarge, color = g.primary,
                modifier = Modifier.padding(top = 6.dp).clickable { all = !all })
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (appOld) com.bdlnaredi.goatstack.ui.PrimaryButton("Get the new app", { runCatching { uri.openUri(u.apk) } }, Modifier.weight(1f))
            else if (u.url.isNotEmpty()) com.bdlnaredi.goatstack.ui.GhostButton("What is new", onClick = { runCatching { uri.openUri(u.url) } }, modifier = Modifier.weight(1f))
            com.bdlnaredi.goatstack.ui.GhostButton("Later", onClick = onLater, color = g.muted, modifier = Modifier.weight(1f))
        }
    }
}

/** The points of a release's notes (its "- " lines), without the Markdown marks. */
fun releaseNotes(md: String): List<String> = md.lines().map { it.trim() }.filter { it.startsWith("- ") || it.startsWith("* ") }
    .map { it.drop(2).replace(Regex("""\*\*([^*]+)\*\*"""), "$1").replace(Regex("""\*([^*]+)\*"""), "$1").replace(Regex("""`([^`]+)`"""), "$1")
        .replace(Regex("""\[([^\]]+)]\([^)]*\)"""), "$1").trim() }.filter { it.isNotEmpty() }.take(20)

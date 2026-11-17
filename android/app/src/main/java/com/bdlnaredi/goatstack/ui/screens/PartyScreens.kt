package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.PartyFound
import com.bdlnaredi.goatstack.data.PartyHit
import com.bdlnaredi.goatstack.data.PartyList
import com.bdlnaredi.goatstack.data.PartyMade
import com.bdlnaredi.goatstack.data.PartyPeople
import com.bdlnaredi.goatstack.data.PartyView
import com.bdlnaredi.goatstack.ui.Dot
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** When a party starts, in words. */
internal fun partyWhen(at: Long, now: Long = System.currentTimeMillis()): String {
    val m = Math.round((at - now) / 60000.0)
    return when {
        m <= 0 -> "now"
        m < 60 -> "in $m min"
        else -> java.text.SimpleDateFormat("EEE HH:mm", java.util.Locale.getDefault()).format(java.util.Date(at))
    }
}

/** Where a party's title opens: Plex's or Jellyfin's own page for it. */
internal fun partyLink(v: PartyView, server: String): String {
    // The built-in Plex and Jellyfin listen on their own ports of the same machine; others have their own address.
    val host = runCatching { java.net.URI(server) }.getOrNull()
    val own = { port: Int -> if (host?.host == null) "" else "${host.scheme ?: "http"}://${host.host}:$port/" }
    val base = when {
        v.app == "plex" && v.managed -> own(32400) + "web/"
        v.app == "plex" -> "https://app.plex.tv/desktop/"
        v.managed -> own(8096)
        else -> v.url.trimEnd('/') + "/"
    }
    return if (v.app == "plex") (if (v.machine.isEmpty()) "" else "$base#!/server/${v.machine}/details?key=" + java.net.URLEncoder.encode("/library/metadata/${v.key}", "UTF-8"))
    else "${base}web/index.html#/details?id=${v.key}" + if (v.server.isNotEmpty()) "&serverId=${v.server}" else ""
}

/** Watch together: the parties you are in, and a new one (a title, a time, who to invite). */
@Composable
fun PartiesScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val apps = services().filter { it.type == "plex" || it.type == "jellyfin" }
    var sid by remember { mutableStateOf(apps.firstOrNull()?.id ?: "") }
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<PartyHit>>(emptyList()) }
    var pick by remember { mutableStateOf<PartyHit?>(null) }
    var start by remember { mutableIntStateOf(0) }
    var chosen by remember { mutableStateOf(setOf<String>()) }
    var busy by remember { mutableStateOf(false) }
    val mine = rememberLoad("parties") { ctx.api.get<PartyList>("/api/party") }
    val people = rememberLoad("party-people", sid) { if (sid.isEmpty()) PartyPeople() else ctx.api.get<PartyPeople>("/api/party/people?sid=$sid") }
    LaunchedEffect(sid, q) {
        if (q.trim().length < 2 || sid.isEmpty()) { hits = emptyList(); return@LaunchedEffect }
        delay(350)
        hits = try { ctx.api.get<PartyFound>("/api/party/find?sid=$sid&q=" + java.net.URLEncoder.encode(q.trim(), "UTF-8")).items.filter { it.kind != "show" } } catch (_: Exception) { emptyList() }
    }
    Column(Modifier.fillMaxSize()) {
        BackPage("Watch together", "A title, a time, and friends")
        if (apps.isEmpty()) { EmptyState(Icons.Rounded.Groups, "No Plex or Jellyfin", "Connect Plex or Jellyfin to watch together."); return@Column }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val list = mine.value?.parties.orEmpty()
            if (list.isNotEmpty()) {
                item { SectionTitle("Coming up and on now") }
                items(list, key = { it.id }) { x ->
                    GoatCard(Modifier.fillMaxWidth().clickable { ctx.go("party/${x.id}") }, padding = 14.dp) {
                        Text(x.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                        Text(listOfNotNull(x.sub.ifEmpty { null }, partyWhen(x.at), if (x.mine) "you host" else "${x.host} hosts").joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = g.muted)
                    }
                }
            }
            item { SectionTitle("Start one") }
            item {
                GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                    if (apps.size > 1) Chips(apps.map { it.id to it.name }, sid) { sid = it; pick = null; chosen = emptySet() }
                    if (pick == null) {
                        GoatField(q, { q = it }, "Find a movie or episode", Icons.Rounded.Search, Modifier.fillMaxWidth())
                        hits.forEach { h ->
                            Column(Modifier.fillMaxWidth().clickable { pick = h; q = "" }.padding(vertical = 8.dp)) {
                                Text(h.title, style = MaterialTheme.typography.bodyMedium, color = g.text)
                                if (h.sub.isNotEmpty()) Text(h.sub, style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                        }
                        if (q.trim().length >= 2 && hits.isEmpty()) Text("Nothing found yet. For a show, search for the episode name.", style = MaterialTheme.typography.labelSmall, color = g.muted)
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(pick!!.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                                if (pick!!.sub.isNotEmpty()) Text(pick!!.sub, style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                            TextButton(onClick = { pick = null }) { Text("Change", color = g.primary) }
                        }
                        Spacer(Modifier.height(8.dp))
                        Text("Start", style = MaterialTheme.typography.labelLarge, color = g.muted)
                        Chips(listOf("0" to "Now", "15" to "In 15 min", "30" to "In 30 min", "60" to "In an hour"), start.toString()) { start = it.toInt() }
                        Spacer(Modifier.height(8.dp))
                        Text("Invite", style = MaterialTheme.typography.labelLarge, color = g.muted)
                        val ppl = people.value?.people.orEmpty()
                        if (ppl.isEmpty()) Text("Nobody else can open this app yet.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            ppl.forEach { u ->
                                FilterChip(selected = u.id in chosen, onClick = { chosen = if (u.id in chosen) chosen - u.id else chosen + u.id }, label = { Text(u.name) },
                                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton(if (busy) "Inviting…" else "Invite them", enabled = !busy && chosen.isNotEmpty(), modifier = Modifier.fillMaxWidth(), onClick = {
                            val h = pick ?: return@PrimaryButton
                            busy = true
                            scope.launch {
                                try {
                                    val r = ctx.api.post<PartyMade>("/api/party", buildJsonObject {
                                        put("sid", sid); put("key", h.key); put("kind", h.kind); put("title", h.title); put("sub", h.sub); put("thumb", h.thumb)
                                        put("at", System.currentTimeMillis() + start * 60_000L); putJsonArray("invite") { chosen.forEach { add(it) } }
                                    })
                                    toast("Invited. They get a notification.")
                                    pick = null; chosen = emptySet(); ctx.go("party/${r.id}")
                                } catch (e: Exception) { toast(e.message ?: "That did not work") }
                                busy = false
                            }
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun Chips(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) {
    val g = LocalGoat.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        opts.forEach { (v, l) ->
            FilterChip(selected = sel == v, onClick = { pick(v) }, label = { Text(l) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
        }
    }
}

/** One watch party: when it starts, Open in Plex or Jellyfin, and who is watching and how far from the host. */
@Composable
fun PartyScreen(id: String) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var v by remember { mutableStateOf<PartyView?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) {
        while (true) {
            try { v = ctx.api.get<PartyView>("/api/party/$id"); err = null } catch (e: Exception) { err = e.message ?: "This watch party has ended"; if (v == null) break }
            delay(4000)
        }
    }
    Column(Modifier.fillMaxSize()) {
        BackPage("Watch together", v?.appName)
        val x = v
        if (x == null) { if (err != null) EmptyState(Icons.Rounded.Groups, "Not here", err!!); return@Column }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                GoatCard(Modifier.fillMaxWidth(), padding = 16.dp) {
                    Text(x.title, style = MaterialTheme.typography.titleLarge, color = g.text)
                    if (x.sub.isNotEmpty()) Text(x.sub, style = MaterialTheme.typography.bodyMedium, color = g.muted)
                    Spacer(Modifier.height(8.dp))
                    Text(if (x.at > System.currentTimeMillis()) "Starts ${partyWhen(x.at)}" else "Started · ${x.hostName} hosts", style = MaterialTheme.typography.titleMedium, color = g.primary)
                    val link = partyLink(x, ctx.app.server)
                    if (link.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton(if (x.app == "plex") "Open in Plex" else "Open in Jellyfin", icon = Icons.Rounded.PlayArrow, modifier = Modifier.fillMaxWidth(), onClick = { runCatching { uri.openUri(link) } })
                    }
                }
            }
            item { SectionTitle("Who is watching") }
            items(x.people, key = { it.id }) { p ->
                GoatCard(Modifier.fillMaxWidth(), padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(if (!p.watching) g.muted else if (p.state == "paused") g.warn else g.good, 10.dp); Spacer(Modifier.width(10.dp))
                        Text(p.name + if (p.host) " (host)" else "", style = MaterialTheme.typography.titleSmall, color = g.text, modifier = Modifier.weight(1f))
                        Text(partyStatus(p.watching, p.state, p.offset, p.behind), style = MaterialTheme.typography.labelMedium, color = g.muted)
                    }
                }
            }
            item { Text("To line up, pause or skip in your own player until you are in step with the host. This page looks again every few seconds.", style = MaterialTheme.typography.labelSmall, color = g.muted) }
            if (x.people.firstOrNull { it.host }?.id == ctx.user.id || ctx.user.admin) item {
                GhostButton("Call it off", color = g.bad, modifier = Modifier.fillMaxWidth(), onClick = {
                    scope.launch { try { ctx.api.send("DELETE", "/api/party/$id"); toast("Called off. The others are told."); ctx.back() } catch (e: Exception) { toast(e.message ?: "That did not work") } }
                })
            }
        }
    }
}

/** "12:04 · 3 s behind", "not watching it yet", "paused · 40:10 · in step". */
internal fun partyStatus(watching: Boolean, state: String, offset: Long, behind: Int?): String {
    if (!watching) return "not watching it yet"
    val s = offset / 1000
    val t = (if (s >= 3600) "${s / 3600}:" else "") + "%02d:%02d".format((s / 60) % 60, s % 60)
    val step = when { behind == null -> ""; kotlin.math.abs(behind) <= 3 -> " · in step"; behind > 0 -> " · $behind s behind"; else -> " · ${-behind} s ahead" }
    return (if (state == "paused") "paused · " else "") + t + step
}

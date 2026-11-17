package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.QbMeta
import com.bdlnaredi.goatstack.data.Shared
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** What was shared to the app: a title page opens straight away; magnet links and .torrent files are added here. */
@Composable
fun SharedHandler(s: Shared, onDone: () -> Unit) {
    val ctx = LocalCtx.current
    val toast = toaster()
    when (s) {
        is Shared.Title -> LaunchedEffect(s) { onDone(); ctx.title(s.type, s.id) }
        is Shared.Imdb -> LaunchedEffect(s) {
            try { val r = ctx.api.get<com.bdlnaredi.goatstack.data.Resolved>("/api/resolve?imdb=${s.id}"); onDone(); ctx.title(r.type, r.id) }
            catch (e: Exception) { onDone(); toast(e.message ?: "Could not find that title") }
        }
        is Shared.Unknown -> LaunchedEffect(s) { onDone(); toast(if (s.text.endsWith(".")) s.text else "Nothing to open in that: share a magnet link, a .torrent file, or an IMDb or TMDB page.") }
        is Shared.Links, is Shared.TorrentFile -> AddSharedDialog(s, onDone)
    }
}

@Composable
private fun AddSharedDialog(s: Shared, onDone: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val toast = toaster()
    val scope = rememberCoroutineScope()
    val clients = services().filter { it.type in TORRENT_CLIENTS }
    // The links a member may add are magnet links; torrent web addresses only for admins (as on the Downloads page).
    val links = (s as? Shared.Links)?.urls.orEmpty().filter { it.startsWith("magnet:", true) || ctx.user.admin }
    val why = when {
        !ctx.user.can("add") -> "Your profile cannot add downloads."
        clients.isEmpty() -> "There is no torrent app to add it to."
        s is Shared.Links && links.isEmpty() -> "Only admins can add torrent web addresses. Share a magnet link instead."
        else -> null
    }
    if (why != null) { LaunchedEffect(s) { onDone(); toast(why) }; return }
    var sid by remember { mutableStateOf(clients.first().id) }
    var cats by remember { mutableStateOf<List<String>>(emptyList()) }
    var cat by remember { mutableStateOf("") }
    var paused by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(sid) { cat = ""; cats = try { ctx.api.get<QbMeta>("/api/qb/$sid/meta").categories.map { it.name } } catch (_: Exception) { emptyList() } }
    val what = when (s) {
        is Shared.TorrentFile -> s.name
        else -> if (links.size == 1) Regex("""[?&]dn=([^&]+)""").find(links[0])?.groupValues?.get(1)?.let { java.net.URLDecoder.decode(it, "UTF-8") } ?: links[0].take(80) else "${links.size} links"
    }
    @Composable fun chips(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) = FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        opts.forEach { (v, l) ->
            FilterChip(selected = sel == v, onClick = { pick(v) }, label = { Text(l) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDone() }, containerColor = g.surface,
        title = { Text("Add a download") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(what, style = MaterialTheme.typography.bodyMedium, color = g.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                if (clients.size > 1) {
                    Spacer(Modifier.height(10.dp)); Text("Add to", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    chips(clients.map { it.id to it.name }, sid) { sid = it }
                }
                if (cats.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp)); Text("Category", style = MaterialTheme.typography.labelLarge, color = g.muted)
                    chips(listOf("" to "None") + cats.map { it to it }, cat) { cat = it }
                }
                CheckLine("Add paused", paused) { paused = it }
                error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        if (s is Shared.TorrentFile) ctx.api.send("POST", "/api/torrent/upload", buildJsonObject {
                            put("sid", sid); if (cat.isNotEmpty()) put("category", cat); if (paused) put("paused", true)
                            putJsonArray("files") { addJsonObject { put("name", s.name); put("data", android.util.Base64.encodeToString(s.bytes, android.util.Base64.NO_WRAP)) } }
                        })
                        else ctx.api.send("POST", "/api/torrent/add", buildJsonObject { put("sid", sid); put("url", links.joinToString("\n")); if (cat.isNotEmpty()) put("category", cat); if (paused) put("paused", true) })
                        toast("Added to ${clients.firstOrNull { it.id == sid }?.name ?: "downloads"}"); onDone(); ctx.go("downloads")
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Adding…" else "Add", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = { onDone() }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

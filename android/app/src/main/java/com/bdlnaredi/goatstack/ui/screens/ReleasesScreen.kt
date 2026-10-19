package com.bdlnaredi.goatstack.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Release
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LoadingBlock
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Interactive search: every release your indexers have for one movie or episode, and you pick which one to download.
 * [id] is the Radarr movie or the Sonarr episode.
 */
@Composable
fun ReleasesScreen(sid: String, id: Long, title: String) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val uri = LocalUriHandler.current
    val sent = remember { mutableStateMapOf<String, String>() } // guid -> "sending" | "sent"
    val data = rememberLoad(sid, id) { ctx.api.get<List<Release>>("/api/releases?sid=$sid&id=$id") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Choose a release", title)
        LoadView(data, loading = {
            Column(Modifier.fillMaxWidth()) {
                Text("Searching your indexers, this can take up to a minute…", style = MaterialTheme.typography.bodyMedium, color = g.muted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                LoadingBlock()
            }
        }) { list ->
            if (list.isEmpty()) EmptyState(Icons.Rounded.Search, "No releases found", "None of your indexers has this right now. Try again later, or add more indexers in Prowlarr.")
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("${list.size} found. The best matches for your quality settings are first; ones Sonarr or Radarr would not pick say why.", style = MaterialTheme.typography.labelMedium, color = g.muted) }
                itemsIndexed(list, key = { i, r -> "$i${r.guid}" }) { _, r ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text(r.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                        Spacer(Modifier.height(8.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Badge(if (r.langs.isEmpty()) "Language unknown" else r.langs.joinToString(", "), g.accent)
                            if (r.quality.isNotEmpty()) Badge(r.quality, g.primary)
                            if (r.protocol.isNotEmpty()) Badge(if (r.protocol == "usenet") "Usenet" else "Torrent", g.muted)
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(listOf(Format.bytes(r.size), if (r.protocol == "usenet") "" else "${r.seeders} seeders" + if (r.leechers > 0) ", ${r.leechers} leechers" else "",
                            r.indexer, r.group, "${r.age}d old").filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = g.muted)
                        if (r.rejected) Text(r.why.ifEmpty { "Would not be picked automatically" }, style = MaterialTheme.typography.bodySmall, color = g.bad)
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            val st = sent[r.guid]
                            PrimaryButton(when (st) { "sending" -> "Sending…"; "sent" -> "Sent to downloader"; else -> "Download" }, {
                                sent[r.guid] = "sending"
                                scope.launch {
                                    try { ctx.api.send("POST", "/api/grab", buildJsonObject { put("sid", sid); put("guid", r.guid); put("indexerId", r.indexerId) }); sent[r.guid] = "sent"; toast("Sent to the downloader") }
                                    catch (e: Exception) { sent.remove(r.guid); toast(e.message ?: "Could not send it") }
                                }
                            }, Modifier.weight(1f), enabled = st == null, icon = Icons.Rounded.Download)
                            if (r.link.isNotEmpty()) GhostButton("Page", { try { uri.openUri(r.link) } catch (_: Exception) { toast("Could not open the page") } }, icon = Icons.AutoMirrored.Rounded.OpenInNew)
                        }
                    }
                }
            }
        }
    }
}

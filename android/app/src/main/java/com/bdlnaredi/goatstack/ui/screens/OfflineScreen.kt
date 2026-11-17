package com.bdlnaredi.goatstack.ui.screens

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.OfflineLink
import com.bdlnaredi.goatstack.data.PartyFound
import com.bdlnaredi.goatstack.data.PartyHit
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/** Where saved videos live: the app's own folder (no permission needed; gone if the app is removed). */
internal fun offlineDir(ctx: Context): File = File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "GoatStack").apply { mkdirs() }

private val QUALITY = listOf("480" to "480p · small", "720" to "720p", "1080" to "1080p", "orig" to "Original")

/** Offline: movies and episodes saved on the phone, for a flight or a train. Plex or Jellyfin makes a smaller copy. */
@Composable
fun OfflineScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val apps = services().filter { it.type == "plex" || it.type == "jellyfin" }
    var sid by remember { mutableStateOf(apps.firstOrNull()?.id ?: "") }
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<PartyHit>>(emptyList()) }
    var pick by remember { mutableStateOf<PartyHit?>(null) }
    var quality by remember { mutableStateOf("720") }
    var again by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    val files = remember(again) { offlineDir(context).listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() }.orEmpty() }
    LaunchedEffect(sid, q) {
        if (q.trim().length < 2 || sid.isEmpty()) { hits = emptyList(); return@LaunchedEffect }
        delay(350)
        hits = try { ctx.api.get<PartyFound>("/api/party/find?sid=$sid&q=" + java.net.URLEncoder.encode(q.trim(), "UTF-8")).items.filter { it.kind != "show" } } catch (_: Exception) { emptyList() }
    }
    // Downloads still going show as files that are growing; look again now and then.
    LaunchedEffect(Unit) { while (true) { delay(5000); again++ } }
    Column(Modifier.fillMaxSize()) {
        BackPage("Offline", "Saved on this phone")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (apps.isNotEmpty()) {
                item { SectionTitle("Save something") }
                item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        if (apps.size > 1) Pills(apps.map { it.id to it.name }, sid) { sid = it; pick = null }
                        val p = pick
                        if (p == null) {
                            GoatField(q, { q = it }, "Find a movie or episode", Icons.Rounded.Search, Modifier.fillMaxWidth())
                            hits.forEach { h ->
                                Column(Modifier.fillMaxWidth().clickable { pick = h; q = "" }.padding(vertical = 8.dp)) {
                                    Text(h.title, style = MaterialTheme.typography.bodyMedium, color = g.text)
                                    if (h.sub.isNotEmpty()) Text(h.sub, style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                            }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(p.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    if (p.sub.isNotEmpty()) Text(p.sub, style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                                TextButton(onClick = { pick = null }) { Text("Change", color = g.primary) }
                            }
                            Spacer(Modifier.height(6.dp))
                            Pills(QUALITY, quality) { quality = it }
                            Text(if (quality == "orig") "The file as it is on the server: best picture, but large." else "Made smaller by ${apps.firstOrNull { it.id == sid }?.name ?: "the server"} while it downloads. About ${mbPerHour(quality)} an hour.",
                                style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(vertical = 6.dp))
                            PrimaryButton(if (busy) "Starting…" else "Save to this phone", icon = Icons.Rounded.DownloadForOffline, enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                                busy = true
                                scope.launch {
                                    try {
                                        val r = ctx.api.post<OfflineLink>("/api/offline", buildJsonObject { put("sid", sid); put("key", p.key); put("title", p.title); put("sub", p.sub); put("q", quality) })
                                        val name = r.name.replace(Regex("[^\\w .()-]"), "_") + "." + (r.ext.ifEmpty { "mkv" })
                                        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                                        dm.enqueue(DownloadManager.Request(Uri.parse(ctx.app.server.trimEnd('/') + r.url))
                                            .setTitle(r.name).setDescription("Saving for offline")
                                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, "GoatStack/$name"))
                                        toast("Saving. It shows in your notifications, and here when done.")
                                        pick = null; again++
                                    } catch (e: Exception) { toast(e.message ?: "That did not work") }
                                    busy = false
                                }
                            })
                        }
                    }
                }
            }
            item { SectionTitle("On this phone") }
            if (files.isEmpty()) item { EmptyState(Icons.Rounded.DownloadForOffline, "Nothing saved yet", "Save a movie or episode to watch it without the internet.") }
            items(files, key = { it.name }) { f ->
                GoatCard(Modifier.fillMaxWidth(), padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(f.nameWithoutExtension, style = MaterialTheme.typography.titleSmall, color = g.text)
                            Text(Format.bytes(f.length()), style = MaterialTheme.typography.labelSmall, color = g.muted)
                        }
                        IconButton(onClick = { play(context, f) { toast(it) } }) { Icon(Icons.Rounded.PlayArrow, "Play ${f.nameWithoutExtension}", tint = g.primary) }
                        IconButton(onClick = { f.delete(); again++; toast("Deleted from this phone") }) { Icon(Icons.Rounded.Delete, "Delete ${f.nameWithoutExtension}", tint = g.muted) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Pills(opts: List<Pair<String, String>>, sel: String, pick: (String) -> Unit) {
    val g = LocalGoat.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        opts.forEach { (v, l) ->
            FilterChip(selected = sel == v, onClick = { pick(v) }, label = { Text(l) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
        }
    }
}

/** Roughly how much an hour takes at each size. */
internal fun mbPerHour(q: String) = when (q) { "480" -> "0.7 GB"; "720" -> "1.4 GB"; "1080" -> "3.6 GB"; else -> "" }

/** Opens a saved video in the phone's video player. */
private fun play(ctx: Context, f: File, fail: (String) -> Unit) {
    try {
        val uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".offline", f)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, if (f.extension == "mp4") "video/mp4" else "video/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) { fail("No video player on this phone can open it") }
}

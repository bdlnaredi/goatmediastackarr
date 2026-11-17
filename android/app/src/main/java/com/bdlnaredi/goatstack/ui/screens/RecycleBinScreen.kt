package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.BinItem
import com.bdlnaredi.goatstack.data.BinList
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val KEEP = listOf("0" to "Off", "1" to "1 day", "3" to "3 days", "7" to "7 days", "14" to "14 days", "30" to "30 days")
private val KINDS = mapOf("torrent" to "Torrent", "title" to "Movie or show", "files" to "File")

/** The recycle bin: what was deleted lately, to put back or delete for good (admins). */
@Composable
fun RecycleBinScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var again by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<BinItem?>(null) }
    var emptying by remember { mutableStateOf(false) }
    val data = rememberLoad("bin", again) { ctx.api.get<BinList>("/api/bin") }
    fun run(id: String, what: suspend () -> Unit) {
        busy = id
        scope.launch { try { what(); again++ } catch (e: Exception) { toast(e.message ?: "That did not work") }; busy = null }
    }
    Column(Modifier.fillMaxSize()) {
        BackPage("Recycle bin", "What was deleted lately, to put back")
        LoadView(data) { d ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "keep") {
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("Keep deleted things for", style = MaterialTheme.typography.titleSmall, color = g.text)
                        Spacer(Modifier.height(6.dp))
                        ChoiceRow(KEEP, d.days.toString(), { v ->
                            run("days") { ctx.api.send("PUT", "/api/bin", buildJsonObject { put("days", v.toInt()) }); toast(if (v == "0") "Recycle bin turned off" else "Saved") }
                        }, Modifier.fillMaxWidth())
                        Spacer(Modifier.height(6.dp))
                        Text(if (d.days > 0) "Torrents deleted with their files, files deleted from a title, titles removed with their files and duplicate copies wait here first. They still take up space until they go."
                            else "Off: deleting removes files straight away.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        if (d.items.isNotEmpty()) {
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("${d.items.size} item${if (d.items.size == 1) "" else "s"} · ${Format.bytes(d.total)}", style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f))
                                GhostButton("Empty", icon = Icons.Rounded.Delete, onClick = { emptying = true })
                            }
                        }
                    }
                }
                if (d.items.isEmpty() && d.days > 0) item(key = "none") { EmptyState(Icons.Rounded.Delete, "Empty", "Nothing was deleted lately.") }
                items(d.items, key = { it.id }) { x ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text(x.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                        Text(listOfNotNull(KINDS[x.kind] ?: "File", x.app.ifBlank { null }, Format.bytes(x.size) + if (x.files > 1) " in ${x.files} files" else "").joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Text("Deleted " + Format.ago(x.at) + (if (x.by.isNotBlank()) " by ${x.by}" else "") + " · " + left(x.until), style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Spacer(Modifier.height(8.dp))
                        Row {
                            GhostButton(if (busy == x.id) "Putting back…" else "Put back", icon = Icons.Rounded.Restore, enabled = busy == null, onClick = {
                                run(x.id) {
                                    ctx.api.send("POST", "/api/bin/${x.id}/restore", buildJsonObject { })
                                    toast(when (x.kind) { "torrent" -> "Put back, and added to qBittorrent again"; "title" -> "Put back in the library"; else -> "Put back" })
                                }
                            })
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = { ask = x }, enabled = busy == null) { Text("Delete now", color = g.bad) }
                        }
                    }
                }
            }
            ask?.let { x ->
                AlertDialog(onDismissRequest = { ask = null }, containerColor = g.surface,
                    title = { Text("Delete for good?") }, text = { Text("\"${x.name}\" (${Format.bytes(x.size)}) is deleted and cannot be put back.") },
                    confirmButton = { TextButton(onClick = { ask = null; run(x.id) { ctx.api.send("DELETE", "/api/bin/${x.id}"); toast(Format.bytes(x.size) + " freed") } }) { Text("Delete", color = g.bad) } },
                    dismissButton = { TextButton(onClick = { ask = null }) { Text("Cancel", color = g.muted) } })
            }
            if (emptying) AlertDialog(onDismissRequest = { emptying = false }, containerColor = g.surface,
                title = { Text("Empty the recycle bin?") }, text = { Text("Everything in it (${Format.bytes(d.total)}) is deleted for good.") },
                confirmButton = { TextButton(onClick = { emptying = false; run("all") { ctx.api.send("DELETE", "/api/bin"); toast(Format.bytes(d.total) + " freed") } }) { Text("Empty", color = g.bad) } },
                dismissButton = { TextButton(onClick = { emptying = false }) { Text("Cancel", color = g.muted) } })
        }
    }
}

private fun left(until: Long): String {
    val days = Math.ceil((until - System.currentTimeMillis()) / 86_400_000.0).toInt()
    return if (days <= 1) "goes for good within a day" else "goes for good in $days days"
}

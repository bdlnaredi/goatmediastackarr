package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.HighQuality
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.UpgApp
import com.bdlnaredi.goatstack.data.UpgList
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

/** Upgrades (admins): what is below the quality its profile wants, and a search for better copies. */
@Composable
fun UpgradesScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val data = rememberLoad("upgrades") { ctx.api.get<UpgList>("/api/upgrades") }
    var asked by remember { mutableStateOf<UpgApp?>(null) }
    var searched by remember { mutableStateOf(setOf<String>()) }
    fun search(sid: String, id: Long?) {
        scope.launch {
            try {
                ctx.api.send("POST", "/api/upgrades/search", buildJsonObject { put("sid", sid); if (id != null) putJsonArray("ids") { add(id) } })
                searched = searched + (if (id == null) "all:$sid" else "$sid:$id")
                toast("Searching. Better copies replace the old ones as they come in.")
            } catch (e: Exception) { toast(e.message ?: "That did not work") }
        }
    }
    Column(Modifier.fillMaxSize()) {
        BackPage("Upgrades", "Below the quality their profile wants")
        LoadView(data) { d ->
            val total = d.apps.sumOf { it.total }
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (total == 0) item { EmptyState(Icons.Rounded.HighQuality, "Nothing to upgrade", "Everything is at the quality its profile wants.") }
                for (a in d.apps.filter { it.total > 0 || it.error.isNotEmpty() }) {
                    item(key = "h" + a.sid) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            SectionTitle("${a.name} · ${a.total}", Modifier.weight(1f))
                            if (a.total > 0) GhostButton(if ("all:${a.sid}" in searched) "Searching…" else "Search all", icon = Icons.Rounded.Search, enabled = "all:${a.sid}" !in searched, onClick = { asked = a })
                        }
                        if (a.error.isNotEmpty()) Text(a.error, color = g.bad, style = MaterialTheme.typography.bodySmall)
                    }
                    items(a.items, key = { a.sid + ":" + it.id }) { i ->
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(i.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    if (i.sub.isNotEmpty()) Text(i.sub, style = MaterialTheme.typography.bodySmall, color = g.muted)
                                    Text(listOfNotNull("Has ${i.quality.ifEmpty { "?" }}", if (i.size > 0) Format.bytes(i.size) else null, i.wants.ifEmpty { null }?.let { "profile $it" }).joinToString(" · "),
                                        style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                                val done = "${a.sid}:${i.id}" in searched || "all:${a.sid}" in searched
                                TextButton(enabled = !done, onClick = { search(a.sid, i.id) }) { Text(if (done) "Searching…" else "Search", color = if (done) g.muted else g.primary) }
                            }
                        }
                    }
                    if (a.total > a.items.size) item(key = "m" + a.sid) { Text("…and ${a.total - a.items.size} more", style = MaterialTheme.typography.labelSmall, color = g.muted) }
                }
                item { Spacer(Modifier.height(4.dp)) }
            }
        }
    }
    asked?.let { a ->
        AlertDialog(onDismissRequest = { asked = null }, containerColor = g.surface,
            title = { Text("Search all ${a.total}?") }, text = { Text("Each one in ${a.name} is searched on your indexers. Better copies replace the old ones as they come in.") },
            confirmButton = { TextButton(onClick = { asked = null; search(a.sid, null) }) { Text("Search", color = g.primary) } },
            dismissButton = { TextButton(onClick = { asked = null }) { Text("Cancel", color = g.muted) } })
    }
}

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.PlaylistAdd
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.bdlnaredi.goatstack.data.FollowList
import com.bdlnaredi.goatstack.data.FollowMade
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val SITE = mapOf("imdb" to "IMDb", "letterboxd" to "Letterboxd", "trakt" to "Trakt")

/** Lists you follow: an IMDb, Letterboxd or Trakt list; what is added to it is requested, a few a week. */
@Composable
fun FollowsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var again by remember { mutableIntStateOf(0) }
    var url by remember { mutableStateOf("") }
    var perWeek by remember { mutableIntStateOf(5) }
    var all by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val data = rememberLoad("follows", again) { ctx.api.get<FollowList>("/api/follows") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Lists you follow", "New titles on them are requested")
        LoadView(data) { d ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("Paste an IMDb, Letterboxd or Trakt list (or watchlist). What is added to it is requested for you, with the same approval as your own requests.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Spacer(Modifier.height(8.dp))
                        GoatField(url, { url = it.trim() }, "https://www.imdb.com/list/ls…", Icons.Rounded.Link, Modifier.fillMaxWidth())
                        Spacer(Modifier.height(8.dp))
                        Text("At most a week", style = MaterialTheme.typography.labelLarge, color = g.muted)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(1, 3, 5, 10, 20).forEach { n ->
                                FilterChip(selected = perWeek == n, onClick = { perWeek = n }, label = { Text("$n") },
                                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                            }
                        }
                        CheckLine("Also what is on it now", all) { all = it }
                        PrimaryButton(if (busy) "Following…" else "Follow", icon = Icons.Rounded.PlaylistAdd, enabled = !busy && url.startsWith("http"), modifier = Modifier.fillMaxWidth(), onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    val r = ctx.api.post<FollowMade>("/api/follows", buildJsonObject { put("url", url); put("perWeek", perWeek); put("fromNow", !all) })
                                    toast(r.error.ifEmpty { "Following ${r.name} (${r.count} titles)" }); url = ""; again++
                                } catch (e: Exception) { toast(e.message ?: "That did not work") }
                                busy = false
                            }
                        })
                    }
                }
                if (d.follows.isEmpty()) item { EmptyState(Icons.Rounded.PlaylistAdd, "No lists yet", "Follow a list and its new titles are asked for you.") }
                else item { SectionTitle("Following") }
                items(d.follows, key = { it.id }) { f ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(f.name.ifEmpty { f.url }, style = MaterialTheme.typography.titleSmall, color = g.text)
                                Text(listOfNotNull(SITE[f.kind] ?: f.kind, if (f.mine) null else f.who, "${f.count} titles", "${f.week} of ${f.perWeek} this week").joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = g.muted)
                                if (f.error.isNotEmpty()) Text(f.error, style = MaterialTheme.typography.labelSmall, color = g.bad)
                                if (f.recent.isNotEmpty()) Text("Lately: " + f.recent.joinToString(", ") { it.title }, style = MaterialTheme.typography.labelSmall, color = g.muted)
                            }
                            TextButton(onClick = { scope.launch { try { ctx.api.send("POST", "/api/follows/${f.id}/sync"); toast("Checked"); again++ } catch (e: Exception) { toast(e.message ?: "That did not work") } } }) { Text("Check", color = g.primary) }
                            IconButton(onClick = { scope.launch { try { ctx.api.send("DELETE", "/api/follows/${f.id}"); toast("No longer followed"); again++ } catch (e: Exception) { toast(e.message ?: "That did not work") } } }) {
                                Icon(Icons.Rounded.Delete, "Stop following", tint = g.muted) }
                        }
                    }
                }
            }
        }
    }
}

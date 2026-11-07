package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.bdlnaredi.goatstack.data.ImportLook
import com.bdlnaredi.goatstack.data.ImportResult
import com.bdlnaredi.goatstack.data.LibItem
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Import a finished torrent into the library by hand: what Sonarr or Radarr make of each file, and you say what it is. */
@Composable
fun ImportDialog(qb: String, hash: String, name: String, onDone: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val look = rememberLoad("import", hash) { ctx.api.get<ImportLook>("/api/import/look?qb=$qb&hash=$hash") }
    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        GoatCard(Modifier.fillMaxWidth().padding(12.dp), padding = 16.dp) {
            Text("Import to library", style = MaterialTheme.typography.titleLarge, color = g.text)
            Text(name, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2)
            Spacer(Modifier.height(10.dp))
            LoadView(look) { d ->
                val apps = d.apps.filter { it.files.isNotEmpty() }
                if (apps.isEmpty()) { Text("Neither Sonarr nor Radarr found a video file they could import here.", color = g.muted); return@LoadView }
                var ai by remember { mutableStateOf(0) }
                val a = apps[ai.coerceIn(0, apps.size - 1)]
                val tv = a.type == "sonarr"
                val lib = rememberLoad("implib", a.sid) { runCatching { ctx.api.get<List<LibItem>>("/api/library?sid=${a.sid}") }.getOrDefault(emptyList()) }
                val first = a.files.firstOrNull { it.match != null }?.match
                var query by remember(a.sid) { mutableStateOf(first?.title ?: "") }
                var picked by remember(a.sid) { mutableStateOf(first?.id ?: 0L) }
                val on = remember(a.sid) { mutableStateMapOf<Int, Boolean>().apply { a.files.forEachIndexed { i, f -> put(i, f.why.none { it.contains("sample", true) }) } } }
                val season = remember(a.sid) { mutableStateMapOf<Int, String>().apply { a.files.forEachIndexed { i, f -> put(i, (f.season ?: f.episodes.firstOrNull()?.season)?.toString() ?: "") } } }
                val eps = remember(a.sid) { mutableStateMapOf<Int, String>().apply { a.files.forEachIndexed { i, f -> put(i, f.episodes.joinToString(", ") { it.num.toString() }) } } }
                var move by remember { mutableStateOf(false) }
                var busy by remember { mutableStateOf(false) }
                Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                    if (apps.size > 1) ChoiceRow(apps.mapIndexed { i, x -> i to x.name }, ai, { ai = it })
                    OutlinedTextField(query, { query = it; picked = 0 }, label = { Text(if (tv) "Show" else "Movie") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    val hits = lib.value.orEmpty().filter { query.length >= 2 && it.title.contains(query, true) && it.id != picked }.take(6)
                    hits.forEach { x -> Text("${x.title}${if (x.year > 0) " (${x.year})" else ""}", color = g.primary, modifier = Modifier.fillMaxWidth().clickable { query = x.title; picked = x.id }.padding(vertical = 8.dp)) }
                    if (picked > 0) Text("✓ In ${a.name}", style = MaterialTheme.typography.labelSmall, color = g.good)
                    a.files.forEachIndexed { i, f ->
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.Top) {
                            Checkbox(on[i] == true, { on[i] = it }, colors = CheckboxDefaults.colors(checkedColor = g.primary, checkmarkColor = g.onPrimary))
                            Column(Modifier.weight(1f)) {
                                Text(f.name, style = MaterialTheme.typography.bodySmall, color = g.text)
                                Text(Format.bytes(f.size) + if (f.q.isNotEmpty()) " · ${f.q}" else "", style = MaterialTheme.typography.labelSmall, color = g.muted)
                                if (f.why.isNotEmpty()) Text(f.why.joinToString("; "), style = MaterialTheme.typography.labelSmall, color = g.warn)
                                if (tv) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(season[i] ?: "", { season[i] = it.filter(Char::isDigit).take(3) }, label = { Text("Season") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(100.dp))
                                    OutlinedTextField(eps[i] ?: "", { eps[i] = it }, label = { Text("Episode") }, singleLine = true, modifier = Modifier.width(140.dp))
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    ChoiceRow(listOf(false to "Copy (keeps seeding)", true to "Move"), move, { move = it })
                }
                Spacer(Modifier.height(10.dp))
                PrimaryButton(if (busy) "Importing…" else "Import", {
                    val target = picked.takeIf { it > 0 } ?: lib.value.orEmpty().firstOrNull { it.title.equals(query.trim(), true) }?.id ?: 0L
                    if (target <= 0) { toast("Pick the ${if (tv) "show" else "movie"} from the list (it has to be in ${a.name} already)"); return@PrimaryButton }
                    val files = a.files.withIndex().filter { on[it.index] == true }
                    if (files.isEmpty()) { toast("Tick at least one file"); return@PrimaryButton }
                    busy = true
                    scope.launch {
                        try {
                            val r = ctx.api.post<ImportResult>("/api/import", buildJsonObject {
                                put("sid", a.sid); put("mode", if (move) "move" else "copy"); put("hash", hash); put("name", name)
                                put("files", JsonArray(files.map { (i, f) -> buildJsonObject {
                                    put("path", f.path); put("id", target); f.quality?.let { put("quality", it) }; put("languages", JsonArray(f.languages)); put("releaseGroup", f.releaseGroup)
                                    if (tv) { put("season", season[i]?.toIntOrNull() ?: -1); put("episodes", JsonArray((eps[i] ?: "").split(',', ' ').mapNotNull { it.trim().toIntOrNull() }.map { JsonPrimitive(it) })) }
                                } }))
                            })
                            toast("${r.imported} file${if (r.imported == 1) "" else "s"} sent to ${a.name} to import"); onDone()
                        } catch (e: Exception) { toast(e.message ?: "Could not import it") }
                        busy = false
                    }
                }, Modifier.fillMaxWidth())
            }
        }
    }
}

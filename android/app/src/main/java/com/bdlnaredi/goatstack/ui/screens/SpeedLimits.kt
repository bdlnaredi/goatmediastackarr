package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.CatLimit
import com.bdlnaredi.goatstack.data.CatLimits
import com.bdlnaredi.goatstack.data.QbPrefs
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

private val DAY_NAMES = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val HHMM = Regex("^([01]?\\d|2[0-3]):[0-5]\\d$")

/** When a category's limit applies, in words ("22:00–07:00, Mon–Fri"). */
fun limitWhen(l: CatLimit): String {
    val d = l.days.takeIf { it.isNotEmpty() && it.size < 7 }?.sorted()
    val days = when { d == null -> ""; d == listOf(1, 2, 3, 4, 5) -> "Mon–Fri"; d == listOf(0, 6) -> "weekends"; else -> d.joinToString(" ") { DAY_NAMES[it] } }
    return listOf(if (l.from.isNotEmpty()) "${l.from}–${l.to}" else "", days).filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { "all the time" }
}

/** One category's limit while it is being changed (text fields keep what is typed). */
private class CatEdit(l: CatLimit) {
    var dl by mutableStateOf(if (l.dl > 0) l.dl.toString() else "")
    var up by mutableStateOf(if (l.up > 0) l.up.toString() else "")
    var from by mutableStateOf(l.from)
    var to by mutableStateOf(l.to)
    val days = mutableStateMapOf<Int, Boolean>().apply { for (i in 0..6) put(i, l.days.isEmpty() || i in l.days) }
}

/** Downloads → Speed limits: qBittorrent's own limits, and one per category (optionally at some hours and days only). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SpeedLimitsDialog(sid: String, categories: List<String>, onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var dl by remember { mutableStateOf("") }
    var up by remember { mutableStateOf("") }
    var altDl by remember { mutableStateOf("") }
    var altUp by remember { mutableStateOf("") }
    val edits = remember { mutableStateMapOf<String, CatEdit>() }
    var now by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var open by remember { mutableStateOf<String?>(null) }
    val kb = { v: Int -> if (v > 0) v.toString() else "" }
    val digits = { s: String -> s.filter { it.isDigit() }.take(7) }

    LaunchedEffect(sid) {
        try {
            val p = ctx.api.get<QbPrefs>("/api/qb/$sid/prefs")
            dl = kb(p.dl); up = kb(p.up); altDl = kb(p.altDl); altUp = kb(p.altUp)
            val c = try { ctx.api.get<CatLimits>("/api/qb/$sid/catlimits") } catch (_: Exception) { CatLimits() }
            now = c.now
            for (name in (categories + c.limits.keys).distinct().sorted()) edits[name] = CatEdit(c.limits[name] ?: CatLimit())
            loaded = true
        } catch (e: Exception) { error = e.message ?: "Could not read the limits" }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text("Speed limits") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!loaded && error == null) Text("Reading the limits…", color = g.muted)
                if (loaded) {
                    Text("In KB/s; empty or 0 is no limit. The alternative limits apply while alternative speeds are on.", color = g.muted, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GoatField(dl, { dl = digits(it) }, "Download", Icons.Rounded.ArrowDownward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                        GoatField(up, { up = digits(it) }, "Upload", Icons.Rounded.ArrowUpward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GoatField(altDl, { altDl = digits(it) }, "Alt. download", Icons.Rounded.ArrowDownward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                        GoatField(altUp, { altUp = digits(it) }, "Alt. upload", Icons.Rounded.ArrowUpward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text("Per category", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = g.text)
                    Text("A limit for all of a category's torrents together, shared among the ones moving data and checked every minute. It can be for some hours and days only (times are the server's).",
                        color = g.muted, style = MaterialTheme.typography.bodySmall)
                    if (edits.isEmpty()) Text("No categories yet. Add them under Categories.", color = g.muted)
                    for (name in edits.keys.sorted()) {
                        val e = edits[name]!!
                        val lim = CatLimit(e.dl.toIntOrNull() ?: 0, e.up.toIntOrNull() ?: 0, e.from, e.to, e.days.filterValues { it }.keys.toList())
                        val summary = if (lim.dl > 0 || lim.up > 0) "↓ ${if (lim.dl > 0) "${lim.dl} KB/s" else "no limit"} · ↑ ${if (lim.up > 0) "${lim.up} KB/s" else "no limit"} · ${limitWhen(lim)}" +
                            (if (now[name] == false) " (not now)" else "") else "No speed limit"
                        HorizontalDivider(color = g.line)
                        TextButton(onClick = { open = if (open == name) null else name }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(name, color = g.text, fontWeight = FontWeight.SemiBold)
                                Text(summary, color = if (lim.dl > 0 || lim.up > 0) g.primary else g.muted, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                        if (open == name) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GoatField(e.dl, { e.dl = digits(it) }, "Download", Icons.Rounded.ArrowDownward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                                GoatField(e.up, { e.up = digits(it) }, "Upload", Icons.Rounded.ArrowUpward, Modifier.weight(1f), keyboard = KeyboardType.Number)
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GoatField(e.from, { e.from = it.filter { c -> c.isDigit() || c == ':' }.take(5) }, "From (21:00)", Icons.Rounded.Schedule, Modifier.weight(1f), keyboard = KeyboardType.Number)
                                GoatField(e.to, { e.to = it.filter { c -> c.isDigit() || c == ':' }.take(5) }, "To (07:00)", Icons.Rounded.Schedule, Modifier.weight(1f), keyboard = KeyboardType.Number)
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                for (i in 0..6) FilterChip(selected = e.days[i] == true, onClick = { e.days[i] = e.days[i] != true }, label = { Text(DAY_NAMES[i]) })
                            }
                        }
                    }
                }
                if (error != null) Text(error!!, color = g.bad)
            }
        },
        confirmButton = {
            TextButton(enabled = loaded && !busy, onClick = {
                // Checked here first, so nothing is half saved.
                for ((name, e) in edits) {
                    if (e.from.isNotEmpty() != e.to.isNotEmpty() || (e.from.isNotEmpty() && (!HHMM.matches(e.from) || !HHMM.matches(e.to)))) { error = "$name: give From and To as hours like 21:00, or leave both empty"; open = name; return@TextButton }
                    if (e.days.values.none { it }) { error = "$name: pick at least one day"; open = name; return@TextButton }
                }
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("POST", "/api/qb/$sid/prefs", buildJsonObject {
                            put("dl", dl.toIntOrNull() ?: 0); put("up", up.toIntOrNull() ?: 0); put("altDl", altDl.toIntOrNull() ?: 0); put("altUp", altUp.toIntOrNull() ?: 0)
                        })
                        ctx.api.send("PUT", "/api/qb/$sid/catlimits", buildJsonObject {
                            putJsonObject("limits") {
                                for ((name, e) in edits) putJsonObject(name) {
                                    put("dl", e.dl.toIntOrNull() ?: 0); put("up", e.up.toIntOrNull() ?: 0)
                                    if (e.from.isNotEmpty()) { put("from", e.from.padStart(5, '0')); put("to", e.to.padStart(5, '0')) }
                                    val on = e.days.filterValues { it }.keys.sorted()
                                    if (on.size < 7) put("days", buildJsonArray { on.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                                }
                            }
                        })
                        toast("Speed limits saved"); onClose()
                    } catch (x: Exception) { error = x.message ?: "That did not work"; busy = false }
                }
            }) { Text(if (busy) "Saving…" else "Save", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

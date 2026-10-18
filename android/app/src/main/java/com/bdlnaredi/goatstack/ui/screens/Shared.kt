package com.bdlnaredi.goatstack.ui.screens

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.SeerrSeasons
import com.bdlnaredi.goatstack.ui.Ctx
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun services(): List<Service> {
    val s by LocalCtx.current.app.services.collectAsStateWithLifecycle()
    return s
}

@Composable
fun toaster(): (String) -> Unit {
    val c = LocalContext.current
    return { msg -> Toast.makeText(c, msg, Toast.LENGTH_SHORT).show() }
}

/** What to ask for: a movie, or a show with all or some seasons. */
data class Ask(val mediaType: String, val mediaId: Long, val title: String, val year: String, val poster: String)

/** Sends a request through the server (which applies the profile's request limit and approval rules). */
suspend fun sendRequest(ctx: Ctx, seerr: Service, a: Ask, seasons: List<Int>): String {
    val r = ctx.api.post<com.bdlnaredi.goatstack.data.MediaRequest>("/api/requests", buildJsonObject {
        put("sid", seerr.id); put("mediaType", a.mediaType); put("mediaId", a.mediaId); put("title", a.title); put("year", a.year); put("poster", a.poster)
        if (seasons.isNotEmpty()) put("seasons", JsonArray(seasons.map { JsonPrimitive(it) }))
    })
    return if (r.status == "approved") "Requested. It is on its way." else "Requested. An admin will look at it."
}

/**
 * Asks to confirm a request. For a show it first reads the seasons from Seerr, so you can pick all or some.
 * Calls [onDone] with a message when the request was sent, or null when it was cancelled.
 */
@Composable
fun RequestDialog(a: Ask, onDone: (String?) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val seerr = services().firstOrNull { it.type == "seerr" }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var seasons by remember { mutableStateOf<List<Int>?>(null) }
    val picked = remember { mutableStateListOf<Int>() }
    var all by remember { mutableStateOf(true) }

    LaunchedEffect(a.mediaId) {
        if (a.mediaType == "tv" && seerr != null) {
            seasons = try { ctx.api.get<SeerrSeasons>("/api/seerr/tv?sid=${seerr.id}&id=${a.mediaId}").seasons.map { it.n } } catch (_: Exception) { emptyList() }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDone(null) },
        containerColor = g.surface,
        title = { Text("Request ${a.title}", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                when {
                    seerr == null -> Text("Requests need Seerr, and it is not set up on this server yet.", color = g.muted)
                    !ctx.user.can("request") -> Text("Your profile cannot make requests. Ask an admin.", color = g.muted)
                    a.mediaType == "tv" -> {
                        val list = seasons
                        if (list == null) Text("Reading the seasons…", color = g.muted)
                        else {
                            Row(Modifier.fillMaxWidth().clickable { all = !all }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(all, { all = it }, colors = CheckboxDefaults.colors(checkedColor = g.primary))
                                Text("Every season, and new ones as they come", color = g.text)
                            }
                            if (!all && list.isNotEmpty()) {
                                Spacer(Modifier.height(8.dp))
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    list.forEach { n ->
                                        val on = n in picked
                                        FilterChip(selected = on, onClick = { if (on) picked.remove(n) else picked.add(n) }, label = { Text("Season $n") },
                                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = g.primary, selectedLabelColor = g.onPrimary))
                                    }
                                }
                            }
                        }
                    }
                    else -> Text(if (ctx.user.admin || ctx.user.autoApprove) "It will be added and searched for right away." else "An admin will approve it first.", color = g.muted)
                }
                if (error != null) { Spacer(Modifier.height(10.dp)); Text(error!!, color = g.bad) }
            }
        },
        confirmButton = {
            val ok = seerr != null && ctx.user.can("request") && (a.mediaType != "tv" || seasons != null) && (all || picked.isNotEmpty() || a.mediaType != "tv")
            TextButton(enabled = ok && !busy, onClick = {
                busy = true; error = null
                scope.launch {
                    try { onDone(sendRequest(ctx, seerr!!, a, if (a.mediaType == "tv" && !all) picked.sorted() else emptyList())) }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Sending…" else "Request", color = if (ok) g.primary else g.muted) }
        },
        dismissButton = { TextButton(onClick = { onDone(null) }, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

/** A plain "are you sure" dialog, red when [danger]. */
@Composable
fun Confirm(title: String, text: String, yes: String, danger: Boolean = false, extra: (@Composable () -> Unit)? = null, onYes: () -> Unit, onNo: () -> Unit) {
    val g = LocalGoat.current
    AlertDialog(
        onDismissRequest = onNo, containerColor = g.surface,
        title = { Text(title) },
        text = { Column { Text(text, color = g.muted); if (extra != null) { Spacer(Modifier.height(10.dp)); extra() } } },
        confirmButton = { TextButton(onClick = onYes) { Text(yes, color = if (danger) g.bad else g.primary) } },
        dismissButton = { TextButton(onClick = onNo) { Text("Cancel", color = g.muted) } },
    )
}

@Composable
fun CheckLine(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val g = LocalGoat.current
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange, colors = CheckboxDefaults.colors(checkedColor = g.bad))
        Spacer(Modifier.width(4.dp))
        Text(text, color = g.text)
    }
}

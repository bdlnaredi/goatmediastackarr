package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ClosedCaption
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.SubLang
import com.bdlnaredi.goatstack.data.TitleSubs
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Subtitles for one title (Bazarr): which languages it gets, what it has, what is missing, and a search for the rest. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SubsCard(sid: String, id: Long, kind: String, modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    if (ctx.app.services.value.none { it.type == "bazarr" }) return
    val subs = rememberLoad("subs", sid, id, kind) { runCatching { ctx.api.get<TitleSubs>("/api/subs?sid=$sid&id=$id&kind=$kind") }.getOrNull() }
    val d = subs.value ?: return
    var busy by remember { mutableStateOf(false) }
    val tag = { l: SubLang -> (l.name.ifEmpty { l.code }) + (if (l.forced) " (forced)" else "") + (if (l.hi) " (SDH)" else "") }
    GoatCard(modifier.fillMaxWidth(), padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.ClosedCaption, null, tint = g.primary, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp))
            Text("Subtitles", style = MaterialTheme.typography.titleSmall, color = g.text)
        }
        if (!d.known) { Text("${d.bazarr} has not picked this up yet.", style = MaterialTheme.typography.bodySmall, color = g.muted); return@GoatCard }
        Spacer(Modifier.height(8.dp))
        if (ctx.user.can("add")) ChoiceRow(listOf<Pair<Int?, String>>(null to "None") + d.profiles.map { it.id to it.name }, d.profile, { p ->
            scope.launch {
                try { ctx.api.send("PUT", "/api/subs", buildJsonObject { put("sid", sid); put("id", id); put("kind", kind); if (p == null) put("profile", JsonNull) else put("profile", p) }); toast("Saved"); subs.reload() }
                catch (e: Exception) { toast(e.message ?: "Could not save it") }
            }
        })
        else Text("Languages: " + (d.profiles.firstOrNull { it.id == d.profile }?.name ?: "None"), style = MaterialTheme.typography.bodySmall, color = g.muted)
        if (kind == "episode") Text("The languages are set for the whole show.", style = MaterialTheme.typography.labelSmall, color = g.muted)
        if (d.have.isNotEmpty() || d.missing.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                d.have.forEach { Badge(tag(it), g.good) }
                d.missing.forEach { Badge(tag(it) + " missing", g.bad) }
            }
        }
        d.missingEps?.let { n -> Spacer(Modifier.height(6.dp)); Text(if (n > 0) "$n episode${if (n == 1) " is" else "s are"} missing subtitles" else if (d.profile != null) "Every episode has its subtitles" else "No subtitles are fetched for this show", style = MaterialTheme.typography.bodySmall, color = g.muted) }
        val missing = if (kind == "series") (d.missingEps ?: 0) > 0 else d.missing.isNotEmpty()
        if (ctx.user.can("control") && d.profile != null && missing) {
            Spacer(Modifier.height(10.dp))
            GhostButton(if (busy) "Searching…" else "Find subtitles", enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true
                scope.launch {
                    try { ctx.api.send("POST", "/api/subs/find", buildJsonObject { put("sid", sid); put("id", id); put("kind", kind) }); toast("${d.bazarr} is looking for the missing subtitles"); delay(if (kind == "series") 8000 else 2500); subs.reload() }
                    catch (e: Exception) { toast(e.message ?: "Could not search") }
                    busy = false
                }
            })
        }
    }
}

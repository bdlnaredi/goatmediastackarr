package com.bdlnaredi.goatstack.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.SugList
import com.bdlnaredi.goatstack.data.Suggestion
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val KINDS = listOf("feature" to "Idea", "bug" to "Problem", "other" to "Other")
private val STATES = mapOf("new" to "New", "sent" to "On GitHub", "done" to "Done", "declined" to "Not planned")

/**
 * Suggestions: anyone can suggest something for GoatMediaStackarr or report a problem, and vote for others' (most
 * wanted first). Admins send them on to the project's GitHub Issues: in one tap with a token saved on the web page,
 * or by opening GitHub's new-issue page already filled in.
 */
@Composable
fun SuggestionsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val admin = ctx.user.role == "admin"
    var again by remember { mutableIntStateOf(0) }
    var kind by remember { mutableStateOf("feature") }
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("open") }
    val list = rememberLoad("suggestions", again) { ctx.api.get<SugList>("/api/suggestions") }
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    fun act(what: suspend () -> Unit) = scope.launch { try { what(); again++ } catch (e: Exception) { toast(e.message ?: "Could not do that") } }

    Column(Modifier.fillMaxSize()) {
        BackPage("Suggestions", "Ideas and problems to fix")
        LoadView(list) { d ->
            val shown = d.items.filter { filter == "all" || (filter == "open") == (it.status == "new") }
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 16.dp) {
                        Text("Suggest something", style = MaterialTheme.typography.titleSmall, color = g.text)
                        Spacer(Modifier.height(8.dp))
                        ChoiceRow(KINDS, kind, { kind = it })
                        OutlinedTextField(title, { title = it.take(120) }, label = { Text("In a few words") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                        OutlinedTextField(body, { body = it.take(4000) }, label = { Text("More about it (optional)") }, minLines = 3, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                        error?.let { Text(it, color = g.bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                        if (!admin) Text("The admin can send it on to the project on GitHub." + if (d.names) " Your name goes with it." else " Your name is not shown there.",
                            style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 6.dp))
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton(if (busy) "Sending…" else "Suggest", icon = Icons.Rounded.Lightbulb, enabled = !busy && title.trim().length >= 4, modifier = Modifier.fillMaxWidth(), onClick = {
                            busy = true; error = null
                            scope.launch {
                                try {
                                    ctx.api.post<JsonObject>("/api/suggestions", buildJsonObject { put("title", title.trim()); put("body", body.trim()); put("kind", kind) })
                                    toast("Thanks! Suggestion sent"); title = ""; body = ""; filter = "open"; again++
                                } catch (e: Exception) { error = e.message }
                                busy = false
                            }
                        })
                    }
                }
                item {
                    Column {
                        Text("${d.items.size} ${if (d.items.size == 1) "suggestion" else "suggestions"}, ${d.items.count { it.status == "new" }} new" +
                            if (admin) " · " + if (d.token) "sent to ${d.repo} in one tap" else "no token: opens GitHub filled in" else "",
                            style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(bottom = 6.dp))
                        ChoiceRow(listOf("open" to "New", "done" to "Sent and done", "all" to "All"), filter, { filter = it })
                    }
                }
                if (shown.isEmpty()) item { Text(if (filter == "open") "No new suggestions." else "Nothing here yet.", color = g.muted, modifier = Modifier.padding(8.dp)) }
                items(shown, key = { it.id }) { x ->
                    SuggestionCard(x, admin, d.token,
                        vote = { act { ctx.api.post<JsonObject>("/api/suggestions/${x.id}/vote") } },
                        github = {
                            if (d.token) act { val r = ctx.api.post<Suggestion>("/api/suggestions/${x.id}/github"); toast("Opened #${r.issue?.number ?: ""} on GitHub") }
                            else act { open(ctx.api.get<SugLink>("/api/suggestions/${x.id}/link").url); toast("Submit it on GitHub, then mark it as sent") }
                        },
                        status = { s -> act { ctx.api.send("PUT", "/api/suggestions/${x.id}", buildJsonObject { put("status", s) }) } },
                        remove = { act { ctx.api.send("DELETE", "/api/suggestions/${x.id}"); toast("Removed") } },
                        openIssue = { x.issue?.url?.let { open(it) } })
                }
            }
        }
    }
}

@kotlinx.serialization.Serializable private data class SugLink(val url: String = "")

@Composable
private fun SuggestionCard(x: Suggestion, admin: Boolean, token: Boolean, vote: () -> Unit, github: () -> Unit, status: (String) -> Unit, remove: () -> Unit, openIssue: () -> Unit) {
    val g = LocalGoat.current
    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
        Row(verticalAlignment = Alignment.Top) {
            Column(
                Modifier.width(52.dp).clip(RoundedCornerShape(12.dp)).background(if (x.voted) g.primary else g.line.copy(alpha = 0.5f)).clickable(onClick = vote).padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Rounded.KeyboardArrowUp, contentDescription = if (x.voted) "Take back your vote" else "I want this too", tint = if (x.voted) g.onPrimary else g.muted, modifier = Modifier.size(22.dp))
                Text("${x.votes}", style = MaterialTheme.typography.titleSmall, color = if (x.voted) g.onPrimary else g.text)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Badge(KINDS.firstOrNull { it.first == x.kind }?.second ?: "Idea", when (x.kind) { "bug" -> g.bad; "feature" -> g.accent; else -> g.muted })
                    if (x.status != "new") Badge(STATES[x.status] ?: x.status, if (x.status == "declined") g.bad else g.good)
                }
                Text(x.title, style = MaterialTheme.typography.titleSmall, color = g.text, modifier = Modifier.padding(top = 4.dp))
                if (x.body.isNotBlank()) Text(x.body, style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.9f), modifier = Modifier.padding(top = 4.dp))
                Text(listOfNotNull(x.user, Format.ago(x.at)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = g.muted, modifier = Modifier.padding(top = 4.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    x.issue?.let { TextButton(onClick = openIssue) { Text("#${it.number} on GitHub", color = g.primary) } }
                    if (admin && x.issue == null) TextButton(onClick = github) { Text(if (token) "Send to GitHub" else "Open on GitHub", color = g.primary) }
                    if (admin && x.status == "new" && !token) TextButton(onClick = { status("sent") }) { Text("Mark as sent", color = g.text) }
                    if (admin && x.status != "new") TextButton(onClick = { status(if (x.status == "done") "sent" else "done") }) { Text(if (x.status == "done") "Not done" else "Done", color = g.text) }
                    if (admin && x.status == "new") TextButton(onClick = { status("declined") }) { Text("Not planned", color = g.muted) }
                    if (x.mine || admin) TextButton(onClick = remove) { Text("Remove", color = g.bad) }
                }
            }
        }
    }
}

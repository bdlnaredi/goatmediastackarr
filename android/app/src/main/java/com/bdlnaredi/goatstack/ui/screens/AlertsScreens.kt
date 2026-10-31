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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.AlertsInfo
import com.bdlnaredi.goatstack.data.ChatCode
import com.bdlnaredi.goatstack.data.ChatState
import com.bdlnaredi.goatstack.data.Newsletters
import com.bdlnaredi.goatstack.data.SendResult
import com.bdlnaredi.goatstack.data.WarnFixed
import com.bdlnaredi.goatstack.data.Warning
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val FIX_NAMES = mapOf("indexers" to "Test indexers again", "clients" to "Test download clients", "recheck" to "Check again", "restart" to "Restart it")

/** Every app's warnings in one list (Health page), errors first, each with what can be done about it from here. */
@Composable
fun NeedsAttention(modifier: Modifier = Modifier) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val uri = LocalUriHandler.current
    var again by remember { mutableStateOf(0) }
    val busy = remember { mutableStateMapOf<Int, Boolean>() }
    val data = rememberLoad("warnings", again) { ctx.api.get<List<Warning>>("/api/warnings") }
    GoatCard(modifier.fillMaxWidth()) {
        Text("Needs attention", style = MaterialTheme.typography.titleMedium, color = g.text)
        LoadView(data) { l ->
            if (l.isEmpty()) Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.CheckCircle, null, tint = g.good, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                Text("No app reports a problem.", style = MaterialTheme.typography.bodyMedium, color = g.muted)
            }
            l.forEachIndexed { i, w ->
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Rounded.Warning, null, tint = if (w.level == "bad") g.bad else g.warn, modifier = Modifier.size(18.dp).padding(top = 2.dp)); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(w.app, style = MaterialTheme.typography.labelLarge, color = g.text)
                        Text(w.text, style = MaterialTheme.typography.bodySmall, color = g.text.copy(alpha = 0.85f))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (w.fix.isNotEmpty()) androidx.compose.material3.TextButton(enabled = busy[i] != true, onClick = {
                                busy[i] = true
                                scope.launch {
                                    try { val r = ctx.api.post<WarnFixed>("/api/warnings/fix", buildJsonObject { put("sid", w.sid); put("fix", w.fix) }); toast(r.done.ifEmpty { "Done" }); kotlinx.coroutines.delay(4000); again++ }
                                    catch (e: Exception) { toast(e.message ?: "That did not work") }
                                    busy[i] = false
                                }
                            }) { Icon(Icons.Rounded.Build, null, tint = g.primary, modifier = Modifier.size(15.dp)); Spacer(Modifier.width(4.dp)); Text(FIX_NAMES[w.fix] ?: "Fix", color = g.primary) }
                            if (w.wiki.isNotEmpty()) androidx.compose.material3.TextButton(onClick = { runCatching { uri.openUri(w.wiki) } }) { Text("What this means", color = g.muted) }
                        }
                    }
                }
            }
        }
    }
}

/** Alerts: what each channel is told about, and the newsletters (send now, on or off). Text and conditions are on the web page. */
@Composable
fun AlertsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var tab by rememberSaveable { mutableStateOf("ch") }
    var again by remember { mutableStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        BackPage("Alerts", "Channels, triggers and newsletters")
        ChoiceRow(listOf("ch" to "Channels and triggers", "nl" to "Newsletters"), tab, { tab = it }, Modifier.padding(bottom = 8.dp))
        if (tab == "ch") {
            val data = rememberLoad("alerts", again) { ctx.api.get<AlertsInfo>("/api/alerts") }
            LoadView(data) { a ->
                val ticked = remember(a) { mutableStateMapOf<String, Boolean>().apply { a.channels.forEach { c -> c.events.forEach { put(c.id + "|" + it, true) } } } }
                if (a.channels.isEmpty()) EmptyState(Icons.Rounded.Forum, "No channels yet", "Add one on the web page (Settings → Alerts) to get messages in Discord, Telegram, by email and more.")
                else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { Text("Tick what each channel is told about. Its own words for a trigger and its conditions are set on the web page.", style = MaterialTheme.typography.bodySmall, color = g.muted) }
                    items(a.channels, key = { it.id }) { c ->
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(c.name.ifEmpty { c.type }, style = MaterialTheme.typography.titleSmall, color = g.text, modifier = Modifier.weight(1f))
                                if (c.conds.isNotEmpty()) Badge("${c.conds.size} condition${if (c.conds.size == 1) "" else "s"}", g.accent)
                                androidx.compose.material3.TextButton(onClick = {
                                    scope.launch { try { val r = ctx.api.post<SendResult>("/api/alerts/test", buildJsonObject { put("id", c.id) }); toast(if (r.results.firstOrNull()?.ok == true) "Test message sent" else r.results.firstOrNull()?.error ?: "Failed") } catch (e: Exception) { toast(e.message ?: "Failed") } }
                                }) { Text("Test", color = g.primary) }
                            }
                            a.events.groupBy { a.meta[it]?.group ?: "Other" }.forEach { (grp, keys) ->
                                Text(grp.uppercase(), style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 8.dp))
                                keys.forEach { k ->
                                    val on = ticked[c.id + "|" + k] == true
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Checkbox(on, { v ->
                                            ticked[c.id + "|" + k] = v
                                            val ev = a.events.filter { ticked[c.id + "|" + it] == true }
                                            scope.launch {
                                                try { ctx.api.send("PUT", "/api/alerts/channels/${c.id}", buildJsonObject { put("type", c.type); put("events", JsonArray(ev.map { JsonPrimitive(it) })) }) }
                                                catch (e: Exception) { ticked[c.id + "|" + k] = !v; toast(e.message ?: "Could not save") }
                                            }
                                        }, colors = CheckboxDefaults.colors(checkedColor = g.primary, checkmarkColor = g.onPrimary))
                                        Text(a.meta[k]?.name ?: k, style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f))
                                        if (c.tpl.containsKey(k)) Badge("own text", g.muted)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            val data = rememberLoad("newsletters", again) { ctx.api.get<Newsletters>("/api/newsletters") }
            LoadView(data) { d ->
                if (d.list.isEmpty()) EmptyState(Icons.AutoMirrored.Rounded.Send, "No newsletters yet", "Make one on the web page (Settings → Alerts → Newsletters): its own schedule, time frame, libraries and who gets it.")
                else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(d.list, key = { it.id }) { n ->
                        var on by remember(n.id, n.on) { mutableStateOf(n.on) }
                        var sending by remember { mutableStateOf(false) }
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(n.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    val wd = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
                                    val hh = n.hour.toString().padStart(2, '0') + ":00"
                                    Text((when (n.every) { "day" -> "Every day at $hh"; "week" -> "Every ${wd.getOrElse(n.day) { "" }} at $hh"; else -> "Day ${n.day} of each month at $hh" }) + " · last ${n.days} days",
                                        style = MaterialTheme.typography.bodySmall, color = g.muted)
                                    if (on && n.next > 0) Text("Next: " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(n.next)), style = MaterialTheme.typography.labelSmall, color = g.muted)
                                }
                                Switch(on, { v -> on = v; scope.launch { try { ctx.api.send("PUT", "/api/newsletters/${n.id}", buildJsonObject { put("on", v) }) } catch (e: Exception) { on = !v; toast(e.message ?: "Could not save") } } },
                                    colors = SwitchDefaults.colors(checkedTrackColor = g.primary, checkedThumbColor = g.onPrimary))
                            }
                            Spacer(Modifier.height(8.dp))
                            GhostButton(if (sending) "Sending…" else "Send it now", icon = Icons.AutoMirrored.Rounded.Send, enabled = !sending, modifier = Modifier.fillMaxWidth(), onClick = {
                                sending = true
                                scope.launch {
                                    try { val r = ctx.api.post<SendResult>("/api/newsletters/${n.id}/send"); toast(if (r.empty) "Nothing new to send" else "Sent to ${r.sent}" + if (r.errors.isNotEmpty()) ", ${r.errors.size} failed" else ""); again++ }
                                    catch (e: Exception) { toast(e.message ?: "Could not send it") }
                                    sending = false
                                }
                            })
                        }
                    }
                }
            }
        }
    }
}

/** Telegram and Discord: link this profile to a chat to ask for things there and hear back there. */
@Composable
fun ChatAppsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var again by remember { mutableStateOf(0) }
    var code by remember { mutableStateOf<ChatCode?>(null) }
    val data = rememberLoad("chats", again) { ctx.api.get<ChatState>("/api/me/chats") }
    Column(Modifier.fillMaxSize()) {
        BackPage("Chat apps", "Ask for movies and shows from Telegram or Discord")
        LoadView(data) { d ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (d.bots.telegram.isEmpty() && d.bots.discord.isEmpty()) item { EmptyState(Icons.Rounded.Forum, "Not set up yet", "An admin turns on the Telegram or Discord bot on the web page (Settings → Alerts).") }
                listOf(Triple("telegram", "Telegram", d.bots.telegram), Triple("discord", "Discord", d.bots.discord)).filter { it.third.isNotEmpty() || (if (it.first == "telegram") d.telegram else d.discord) }.forEach { (k, n, bot) ->
                    item(key = k) {
                        val linked = if (k == "telegram") d.telegram else d.discord
                        GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(n, style = MaterialTheme.typography.titleSmall, color = g.text)
                                    if (bot.isNotEmpty() && bot != "on") Text(bot, style = MaterialTheme.typography.bodySmall, color = g.muted)
                                }
                                if (linked) {
                                    Badge("Linked", g.good)
                                    androidx.compose.material3.IconButton(onClick = { scope.launch { try { ctx.api.send("DELETE", "/api/me/chats/$k"); again++ } catch (e: Exception) { toast(e.message ?: "Failed") } } }) { Icon(Icons.Rounded.LinkOff, "Unlink", tint = g.bad) }
                                } else Badge("Not linked", g.muted)
                            }
                        }
                    }
                }
                if (d.bots.telegram.isNotEmpty() || d.bots.discord.isNotEmpty()) item {
                    PrimaryButton("Get a link code", { scope.launch { try { code = ctx.api.post<ChatCode>("/api/me/chats/code") } catch (e: Exception) { toast(e.message ?: "Failed") } } }, Modifier.fillMaxWidth(), icon = Icons.Rounded.Key)
                }
                code?.let { c -> item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Text("Send this to the bot (works once, for ${c.minutes} minutes):", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Text("/link ${c.code}", style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace), color = g.text, modifier = Modifier.padding(vertical = 8.dp))
                        if (d.bots.telegram.isNotEmpty()) Text("Telegram: open a chat with ${d.bots.telegram} and send it.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                        if (d.bots.discord.isNotEmpty()) Text("Discord: type /link in a server the bot is in and paste the code.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                    }
                } }
                item { SectionTitle("How it works", Modifier.padding(top = 4.dp)) }
                item { Text("Send the name of a movie or show to the bot, pick it from the posters and tap Request. It counts as your own request, and you hear in the chat when it is approved and ready.", style = MaterialTheme.typography.bodySmall, color = g.muted) }
            }
        }
    }
}

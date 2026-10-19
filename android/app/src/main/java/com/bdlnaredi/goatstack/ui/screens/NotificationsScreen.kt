package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Feed
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun kindIcon(kind: String): Pair<ImageVector, Color> {
    val g = LocalGoat.current
    return when (kind) {
        "ready" -> Icons.Rounded.CheckCircle to g.good
        "reqstatus" -> Icons.Rounded.CloudDone to g.primary
        "request" -> Icons.Rounded.Inbox to g.warn
        "report" -> Icons.Rounded.Flag to g.bad
        "download" -> Icons.Rounded.Download to g.accent
        "problem" -> Icons.Rounded.Warning to g.bad
        "stream" -> Icons.Rounded.Wifi to g.warn
        "update" -> Icons.Rounded.SystemUpdate to g.primary
        else -> Icons.Rounded.Notifications to g.muted
    }
}

/** Everything the server told this person, newest first. Tapping one opens its page; new ones are marked. */
@Composable
fun NotificationsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad { ctx.api.get<Feed>("/api/notifications") }
    var readUpTo by remember { mutableLongStateOf(-1L) }
    // Opening the list marks everything as read on the server (the dots stay until you leave).
    LaunchedEffect(data.value?.last) {
        val f = data.value ?: return@LaunchedEffect
        if (readUpTo < 0) readUpTo = f.read
        if (f.last > f.read) try { ctx.api.send("POST", "/api/notifications/read", buildJsonObject { put("upTo", f.last) }) } catch (_: Exception) { }
    }
    Column(Modifier.fillMaxSize()) {
        BackPage("Notifications", null) {
            IconButton(onClick = { ctx.go("settings") }) { Icon(Icons.Rounded.Notifications, "Notification settings", tint = g.text) }
        }
        LoadView(data) { f ->
            if (f.items.isEmpty()) EmptyState(Icons.Rounded.Notifications, "Nothing yet", "When something you asked for is ready, or something needs you, it shows here and on your phone.")
            else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(f.items, key = { it.id }) { x ->
                    val (icon, tint) = kindIcon(x.kind)
                    val new = readUpTo >= 0 && x.id > readUpTo
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp, onClick = if (x.link.isNotEmpty()) ({ ctx.openLink(x.link) }) else null) {
                        Row(verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp)) }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(x.title, style = MaterialTheme.typography.titleSmall, color = g.text)
                                if (x.body.isNotBlank()) Text(x.body, style = MaterialTheme.typography.bodySmall, color = g.muted)
                                Text(Format.ago(x.at), style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 4.dp))
                            }
                            if (new) Box(Modifier.padding(top = 4.dp).size(9.dp).clip(CircleShape).background(g.primary))
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.DoneAll, null, tint = g.muted, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("All read", style = MaterialTheme.typography.labelMedium, color = g.muted)
                    }
                }
            }
        }
    }
}

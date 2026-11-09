package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bdlnaredi.goatstack.data.LogLines
import com.bdlnaredi.goatstack.data.LogSources
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Logs (admins): what every app is writing. The apps of the stack from their own log files, the apps added under
 * Settings → Apps through their APIs. One app or all together, newest at the bottom; Follow asks again every 5 seconds.
 */
@Composable
fun LogsScreen(start: String = "all") {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    var src by rememberSaveable { mutableStateOf(start) }
    var level by rememberSaveable { mutableStateOf("") }
    var follow by rememberSaveable { mutableStateOf(true) }
    var sources by remember { mutableStateOf<LogSources?>(null) }
    var data by remember { mutableStateOf<LogLines?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var pick by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    LaunchedEffect(Unit) { try { sources = ctx.api.get<LogSources>("/api/logs/sources") } catch (e: Exception) { error = e.message } }
    LaunchedEffect(src, level, follow) {
        while (true) {
            try {
                val d = ctx.api.get<LogLines>("/api/logs?src=${com.bdlnaredi.goatstack.data.Api.enc(src)}&lines=300" + if (level.isNotEmpty()) "&level=$level" else "")
                val atEnd = data == null || !list.canScrollForward
                data = d; error = null
                if (atEnd && d.lines.isNotEmpty()) list.scrollToItem(d.lines.size - 1)
            } catch (e: Exception) { error = e.message }
            if (!follow || com.bdlnaredi.goatstack.ui.Tuning.still) break
            delay(5000)
        }
    }
    val names = sources?.sources?.associate { it.id to it.name } ?: emptyMap()
    val time = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }

    Column(Modifier.fillMaxSize()) {
        BackPage("Logs", "What every app is writing")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                OutlinedButton(onClick = { pick = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (src == "all") "All apps together" else names[src] ?: src, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Icon(Icons.Rounded.ArrowDropDown, contentDescription = null)
                }
                DropdownMenu(pick, { pick = false }) {
                    DropdownMenuItem(text = { Text("All apps together") }, onClick = { src = "all"; pick = false; data = null })
                    sources?.sources?.forEach { s ->
                        DropdownMenuItem(text = { Text(s.name + if (s.kind == "stack") "" else "  ·  added") }, onClick = { src = s.id; pick = false; data = null })
                    }
                }
            }
            Text("Follow", style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.padding(start = 12.dp, end = 6.dp))
            Switch(follow, { follow = it })
        }
        ChoiceRow(listOf("" to "Everything", "error,warn" to "Problems", "error" to "Errors"), level, { level = it; data = null })
        val d = data
        val note = listOfNotNull(error, d?.failed?.takeIf { it.isNotEmpty() }?.joinToString("; ") { "${it.name} did not answer" }).joinToString(" · ")
        if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.bodySmall, color = g.bad, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        Box(Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, bottom = 12.dp, top = 6.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFF0D0F14))) {
            if (d != null && d.lines.isEmpty()) Text(if (level.isEmpty()) "No lines yet." else "No lines match.", color = Color(0xFF8A93A6), modifier = Modifier.padding(16.dp))
            LazyColumn(state = list, contentPadding = PaddingValues(vertical = 8.dp)) {
                items(d?.lines ?: emptyList()) { l ->
                    val color = when (l.level) { "error" -> Color(0xFFFF8A8A); "warn" -> Color(0xFFFFCC66); "debug" -> Color(0xFF8A93A6); else -> Color(0xFFD6DAE3) }
                    Column(Modifier.fillMaxWidth().background(if (l.level == "error") Color(0x14FF4D4F) else Color.Transparent).padding(horizontal = 12.dp, vertical = 3.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (l.t > 0) time.format(Date(l.t)) else "", color = Color(0xFF7B8496), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
                            if (src == "all") Text(names[l.src] ?: l.src, color = Color(0xFFB9C6FF), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            if (l.level != "info") Text(when (l.level) { "error" -> "Error"; "warn" -> "Warning"; else -> "Debug" }, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Text(l.msg, color = color, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp)
                    }
                }
            }
        }
    }
}

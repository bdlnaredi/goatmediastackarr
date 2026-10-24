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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Changelog
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The changelog's own small markup: **bold**, *slanted*, `code` and [links](https://…) (shown as their words). */
fun changeText(t: String): AnnotatedString = buildAnnotatedString {
    val re = Regex("""\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)]\((https?://[^\s)]+)\)""")
    var at = 0
    for (m in re.findAll(t)) {
        append(t.substring(at, m.range.first))
        val (b, i, c, l) = m.destructured
        when {
            b.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(b) }
            i.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(i) }
            c.isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(c) }
            else -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(l) }
        }
        at = m.range.last + 1
    }
    append(t.substring(at))
}

/** What changed in each version of GoatMediaStackarr, newest first. Opens by itself once after the server is updated. */
@Composable
fun WhatsNewScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad(Unit) { ctx.api.get<Changelog>("/api/changelog") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item { BackPage("What's new", if (ctx.me.version.isNotBlank()) "You are on ${ctx.me.version}" else null) }
        item {
            LoadView(data, Modifier.padding(16.dp)) { c ->
                if (c.versions.isEmpty()) EmptyState(Icons.Rounded.AutoAwesome, "Nothing listed", "This server has no list of changes.")
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    c.versions.forEach { v ->
                        GoatCard(Modifier.fillMaxWidth()) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(if (v.next) "Coming next" else "v${v.version}", style = MaterialTheme.typography.titleLarge, color = g.text)
                                if (v.current) Badge("Your version", g.primary)
                                if (v.next) Badge("Not released yet", g.muted)
                                Spacer(Modifier.weight(1f))
                                if (v.date.isNotBlank()) Text(runCatching { LocalDate.parse(v.date).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())) }.getOrDefault(v.date),
                                    style = MaterialTheme.typography.labelMedium, color = g.muted)
                            }
                            v.items.forEach { t ->
                                Row(Modifier.padding(top = 10.dp)) {
                                    Box(Modifier.padding(top = 7.dp).size(6.dp).clip(CircleShape).background(g.primary))
                                    Spacer(Modifier.width(10.dp))
                                    Text(changeText(t), style = MaterialTheme.typography.bodyMedium, color = g.text.copy(alpha = 0.9f))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

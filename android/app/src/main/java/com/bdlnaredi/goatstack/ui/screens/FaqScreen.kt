package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Quiz
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import com.bdlnaredi.goatstack.data.Faq
import com.bdlnaredi.goatstack.data.FaqBlock
import com.bdlnaredi.goatstack.data.FaqItem
import com.bdlnaredi.goatstack.data.tr
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat

/** The FAQ's small markup: **bold**, *slanted*, `code` and [links](…) (shown as their words). */
private fun faqText(t: String): AnnotatedString = buildAnnotatedString {
    val re = Regex("""\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)]\(([^)\s]+)\)""")
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

private fun FaqItem.words(): String = (listOf(q) + blocks.flatMap { b -> listOf(b.text) + b.items.flatMap { listOf(it.text) + it.sub } }).joinToString(" ").lowercase()

/** The FAQ (docs/FAQ.md on the server): the questions only, in sections; a question opens its answer under it. */
@Composable
fun FaqScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val data = rememberLoad(Unit) { ctx.api.get<Faq>("/api/faq") }
    var q by rememberSaveable { mutableStateOf("") }
    val open = remember { mutableStateMapOf<String, Boolean>() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item { BackPage("FAQ", "Tap a question for its answer") }
        item {
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text(tr("Search the questions")) },
                leadingIcon = { Icon(Icons.Rounded.Search, null) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
        }
        item {
            LoadView(data, Modifier.padding(16.dp)) { f ->
                val words = q.trim().lowercase()
                val secs = f.sections.map { s -> s to s.items.filter { x -> words.isEmpty() || x.words().contains(words) } }.filter { it.second.isNotEmpty() }
                if (secs.isEmpty()) EmptyState(Icons.Rounded.Quiz, if (words.isEmpty()) "No questions here" else "No question matches", if (words.isEmpty()) "This server has no FAQ." else "Try other words, or look in Logs → Problems.")
                Column(Modifier.padding(horizontal = 16.dp)) {
                    secs.forEach { (s, items) ->
                        Text(tr(s.title), style = MaterialTheme.typography.titleMedium, color = g.primary, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 20.dp, bottom = 4.dp))
                        items.forEach { qa ->
                            val key = s.id + "/" + qa.q
                            val isOpen = open[key] == true
                            Column(Modifier.fillMaxWidth()) {
                                Row(Modifier.fillMaxWidth().clickable { open[key] = !isOpen }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(faqText(qa.q), style = MaterialTheme.typography.bodyLarge, color = if (isOpen) g.primary else g.text, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                    Spacer(Modifier.width(8.dp))
                                    Icon(if (isOpen) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, if (isOpen) "Close" else "Open", tint = if (isOpen) g.primary else g.muted)
                                }
                                AnimatedVisibility(isOpen) { Column(Modifier.padding(bottom = 12.dp)) { qa.blocks.forEach { b -> FaqBlockView(b) } } }
                                Box(Modifier.fillMaxWidth().height(1.dp).background(g.muted.copy(alpha = 0.2f)))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FaqBlockView(b: FaqBlock) {
    val g = LocalGoat.current
    val body = MaterialTheme.typography.bodyMedium
    if (b.t == "p") { Text(faqText(b.text), style = body, color = g.text.copy(alpha = 0.9f), modifier = Modifier.padding(bottom = 8.dp)); return }
    b.items.forEachIndexed { n, li ->
        Row(Modifier.padding(bottom = 6.dp)) {
            if (b.t == "ol") Text("${n + 1}.", style = body, color = g.primary, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
            else Box(Modifier.padding(top = 7.dp, end = 10.dp).size(6.dp).clip(CircleShape).background(g.primary))
            Column(Modifier.weight(1f)) {
                Text(faqText(li.text), style = body, color = g.text.copy(alpha = 0.9f))
                li.sub.forEach { s ->
                    Row(Modifier.padding(top = 4.dp)) {
                        Box(Modifier.padding(top = 7.dp, end = 10.dp).size(5.dp).clip(CircleShape).background(g.muted))
                        Text(faqText(s), style = body, color = g.text.copy(alpha = 0.85f))
                    }
                }
            }
        }
    }
}

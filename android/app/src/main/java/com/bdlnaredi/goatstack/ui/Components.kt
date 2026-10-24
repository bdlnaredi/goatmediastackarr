package com.bdlnaredi.goatstack.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import com.bdlnaredi.goatstack.ui.theme.LocalStyle

// ---------- Loading data ----------

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Done<T>(val value: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

class Loader<T>(val state: Load<T>, val reload: () -> Unit) {
    val value: T? get() = (state as? Load.Done<T>)?.value
}

/** Runs [block] when the screen opens (and again on reload or when [key] changes), keeping the last good answer while reloading. */
@Composable
fun <T> rememberLoad(vararg key: Any?, block: suspend () -> T): Loader<T> {
    var tick by remember { mutableIntStateOf(0) }
    var state by remember(*key) { mutableStateOf<Load<T>>(Load.Loading) }
    LaunchedEffect(tick, *key) {
        state = try { Load.Done(block()) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) {
            if (state is Load.Done) state else Load.Failed(e.message ?: "Something went wrong")
        }
    }
    return Loader(state) { tick++ }
}

@Composable
fun <T> LoadView(l: Loader<T>, modifier: Modifier = Modifier, loading: @Composable () -> Unit = { LoadingBlock() }, content: @Composable (T) -> Unit) {
    when (val s = l.state) {
        is Load.Loading -> Box(modifier) { loading() }
        is Load.Failed -> ErrorPanel(s.message, modifier, onRetry = l.reload)
        is Load.Done -> content(s.value)
    }
}

// ---------- Surfaces ----------

@Composable
fun GoatCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    val g = LocalGoat.current
    val st = LocalStyle.current
    val shape = RoundedCornerShape(st.corner)
    Column(
        modifier
            .clip(shape)
            .background(g.card.copy(alpha = g.card.alpha * st.cardAlpha))
            .then(if (st.border) Modifier.border(1.dp, if (st.cardAlpha < 1f) Color.White.copy(alpha = if (g.dark) 0.12f else 0.5f) else g.line.copy(alpha = 0.7f), shape) else Modifier)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding * st.density),
        content = content,
    )
}

/** The big serif title at the top of each page. */
@Composable
fun PageTitle(title: String, subtitle: String? = null, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = LocalGoat.current.muted)
        }
        actions()
    }
}

@Composable
fun SectionTitle(title: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    val st = LocalStyle.current
    Row(modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = (10 * st.density).dp), verticalAlignment = Alignment.CenterVertically) {
        if (st.capsSections) Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = LocalGoat.current.primary, modifier = Modifier.weight(1f))
        else Text(title, style = MaterialTheme.typography.titleLarge.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold), color = LocalGoat.current.text, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
fun Badge(text: String, color: Color, modifier: Modifier = Modifier, filled: Boolean = false) {
    Box(
        modifier.clip(RoundedCornerShape(50)).background(if (filled) color else color.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = if (filled) Color.Black.copy(alpha = 0.85f) else color, maxLines = 1)
    }
}

@Composable
fun Dot(color: Color, size: Dp = 9.dp) { Box(Modifier.size(size).clip(CircleShape).background(color)) }

@Composable
fun Bar(fraction: Float, modifier: Modifier = Modifier, color: Color = LocalGoat.current.primary, height: Dp = 6.dp) {
    val g = LocalGoat.current
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(50)).background(g.line.copy(alpha = 0.6f))) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(height).clip(RoundedCornerShape(50)).background(color))
    }
}

/** A poster with a soft placeholder (the title's first letter) while it loads or when there is none. */
@Composable
fun Poster(url: String?, title: String, modifier: Modifier = Modifier, corner: Dp = 16.dp, ratio: Float = 2f / 3f) {
    val g = LocalGoat.current
    val st = LocalStyle.current
    // Round pictures (ratio 1, such as the cast) stay round; posters follow the style's corners.
    val shape = RoundedCornerShape(if (ratio == 1f) corner else minOf(corner, st.posterCorner))
    Box(modifier.aspectRatio(ratio).clip(shape).background(Brush.linearGradient(listOf(g.card, g.line)))) {
        val ph: @Composable () -> Unit = {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(title.take(1).uppercase(), style = MaterialTheme.typography.headlineMedium, color = g.muted)
            }
        }
        if (url.isNullOrBlank()) ph()
        else SubcomposeAsyncImage(model = url, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
            loading = { ph() }, error = { ph() })
    }
}

/** A wide picture with a fade into the page, for the top of detail pages and the home screen. */
@Composable
fun Backdrop(url: String?, modifier: Modifier = Modifier, height: Dp = 260.dp, overPicture: Boolean = false, content: @Composable BoxScope.() -> Unit = {}) {
    val g = LocalGoat.current
    Box(modifier.fillMaxWidth().height(height * LocalStyle.current.heroScale)) {
        if (!url.isNullOrBlank()) SubcomposeAsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(g.primary.copy(alpha = 0.35f), g.accent.copy(alpha = 0.18f), g.bg))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, g.bg.copy(alpha = 0.45f), if (overPicture) g.bg.copy(alpha = 0.55f) else g.bg))))
        content()
    }
}

// ---------- States ----------

@Composable
fun LoadingBlock(modifier: Modifier = Modifier, rows: Int = 4) {
    val g = LocalGoat.current
    val a = if (Tuning.still) 0.5f else {
        val t = rememberInfiniteTransition(label = "shimmer")
        t.animateFloat(0.35f, 0.75f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a").value
    }
    Column(modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(rows) { i ->
            Box(Modifier.fillMaxWidth(if (i % 2 == 0) 1f else 0.7f).height(if (i == 0) 120.dp else 56.dp).clip(RoundedCornerShape(18.dp)).background(g.card.copy(alpha = a)))
        }
    }
}

@Composable
fun ErrorPanel(message: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    val g = LocalGoat.current
    GoatCard(modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.CloudOff, null, tint = g.bad)
            Spacer(Modifier.width(10.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, color = g.text, modifier = Modifier.weight(1f))
        }
        if (onRetry != null) {
            Spacer(Modifier.height(12.dp))
            FilledTonalButton(onClick = onRetry) { Icon(Icons.Rounded.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Try again") }
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    val g = LocalGoat.current
    Column(modifier.fillMaxWidth().padding(36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(g.primary.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = g.primary, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = g.text, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = g.muted, textAlign = TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(14.dp)); action() }
    }
}

// ---------- Small pieces ----------

@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, icon: ImageVector? = null, tint: Color = LocalGoat.current.primary) {
    val g = LocalGoat.current
    GoatCard(modifier, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
            Text(label, style = MaterialTheme.typography.labelMedium, color = g.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(6.dp))
        Text(value, style = MaterialTheme.typography.titleMedium, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    val st = LocalStyle.current
    Button(onClick = onClick, enabled = enabled, modifier = modifier.height(if (st.density < 0.9f) 44.dp else 52.dp), shape = RoundedCornerShape(st.buttonCorner),
        contentPadding = PaddingValues(horizontal = 20.dp)) {
        if (icon != null) { Icon(icon, null, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, color: Color = LocalGoat.current.text, enabled: Boolean = true) {
    val st = LocalStyle.current
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.height(if (st.density < 0.9f) 40.dp else 48.dp), shape = RoundedCornerShape(st.buttonCorner),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color)) {
        if (icon != null) { Icon(icon, null, modifier = Modifier.size(19.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

/** A row of choices where one is picked, as pill-shaped chips. */
@Composable
fun <T> ChoiceRow(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val g = LocalGoat.current
    androidx.compose.foundation.lazy.LazyRow(modifier, contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options.size) { i ->
            val (v, label) = options[i]
            val on = v == selected
            Box(
                Modifier.clip(RoundedCornerShape(50)).background(if (on) g.primary else g.card)
                    .border(1.dp, if (on) g.primary else g.line, RoundedCornerShape(50))
                    .clickable { onSelect(v) }.padding(horizontal = 16.dp, vertical = 9.dp),
            ) { Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) g.onPrimary else g.text) }
        }
    }
}

/** A round profile picture, or the first letter of the name on the theme's colours when there is none. */
@Composable
fun Avatar(url: String, name: String, size: Dp, modifier: Modifier = Modifier) {
    val g = LocalGoat.current
    val ctx = LocalCtx.current
    Box(modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(g.primary, g.accent))), contentAlignment = Alignment.Center) {
        val letter: @Composable () -> Unit = {
            Text(name.take(1).uppercase(), style = if (size >= 64.dp) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.titleMedium, color = g.onPrimary)
        }
        val full = ctx.api.abs(url)
        if (full == null) letter()
        else SubcomposeAsyncImage(model = full, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(), loading = { letter() }, error = { letter() })
    }
}

/** A faded picture of the title filling the whole page behind its content (fixed, it does not scroll). */
@Composable
fun PageBackground(url: String?) {
    val g = LocalGoat.current
    if (url.isNullOrBlank()) return
    Box(Modifier.fillMaxSize()) {
        val st = LocalStyle.current
        // Glass shows more of the picture through its see-through cards; Dashboard and Compact keep pages calm.
        val a = when (st.id) { "glass" -> 0.5f; "cinema" -> 0.36f; "compact" -> 0.14f; else -> 0.2f }
        SubcomposeAsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, alpha = a, modifier = Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to g.bg.copy(alpha = 0.25f), 0.45f to g.bg.copy(alpha = 0.7f), 1f to g.bg.copy(alpha = 0.95f))))
    }
}

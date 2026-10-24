package com.bdlnaredi.goatstack.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** One look for the app. Besides Material's colours it carries a few of its own, for heroes, badges and status. */
@Immutable
data class GoatPalette(
    val id: String,
    val name: String,
    val blurb: String,
    val dark: Boolean,
    val bg: Color,
    val surface: Color,
    val card: Color,
    val line: Color,
    val text: Color,
    val muted: Color,
    val primary: Color,
    val onPrimary: Color,
    val accent: Color,
    val good: Color = Color(0xFF34D399),
    val warn: Color = Color(0xFFFBBF24),
    val bad: Color = Color(0xFFF87171),
    val dynamic: Boolean = false,
)

object Themes {
    val all = listOf(
        GoatPalette("goat", "G.O.A.T. Gold", "Navy and gold, like the logo", true,
            bg = Color(0xFF0B1020), surface = Color(0xFF111934), card = Color(0xFF172241), line = Color(0xFF26335A),
            text = Color(0xFFEEF1F8), muted = Color(0xFF8C96B2), primary = Color(0xFFE8B84A), onPrimary = Color(0xFF1C1405), accent = Color(0xFF6F9BFF)),
        GoatPalette("midnight", "Midnight", "True black for OLED screens, teal highlights", true,
            bg = Color(0xFF000000), surface = Color(0xFF0A0A0B), card = Color(0xFF141416), line = Color(0xFF242428),
            text = Color(0xFFF4F4F5), muted = Color(0xFF8E8E96), primary = Color(0xFF2DD4BF), onPrimary = Color(0xFF00201C), accent = Color(0xFF60A5FA)),
        GoatPalette("ember", "Ember", "Warm charcoal with orange glow", true,
            bg = Color(0xFF140D0A), surface = Color(0xFF1C130F), card = Color(0xFF281B15), line = Color(0xFF3A2A21),
            text = Color(0xFFF8EEE8), muted = Color(0xFFA8928A), primary = Color(0xFFFF7A3D), onPrimary = Color(0xFF2A0E00), accent = Color(0xFFFFC14D)),
        GoatPalette("aurora", "Aurora", "Deep violet with cyan lights", true,
            bg = Color(0xFF0C0A1D), surface = Color(0xFF141130), card = Color(0xFF1D193F), line = Color(0xFF2E2860),
            text = Color(0xFFF1EEFF), muted = Color(0xFF9A94C4), primary = Color(0xFFA78BFA), onPrimary = Color(0xFF1A0B45), accent = Color(0xFF22D3EE)),
        GoatPalette("forest", "Forest", "Dark green, calm and easy on the eyes", true,
            bg = Color(0xFF0A130F), surface = Color(0xFF101C16), card = Color(0xFF16261E), line = Color(0xFF223A2E),
            text = Color(0xFFEAF5EF), muted = Color(0xFF8CA89A), primary = Color(0xFF4ADE80), onPrimary = Color(0xFF032611), accent = Color(0xFFFACC15)),
        GoatPalette("paper", "Paper", "Light and warm, with deep gold", false,
            bg = Color(0xFFF6F1E7), surface = Color(0xFFFFFCF6), card = Color(0xFFFFFFFF), line = Color(0xFFE6DDCB),
            text = Color(0xFF1D1A15), muted = Color(0xFF6F675A), primary = Color(0xFFA8760F), onPrimary = Color(0xFFFFFFFF), accent = Color(0xFF2F5BD3),
            good = Color(0xFF15803D), warn = Color(0xFFB45309), bad = Color(0xFFDC2626)),
        GoatPalette("glacier", "Glacier", "Crisp white and blue", false,
            bg = Color(0xFFEEF3F9), surface = Color(0xFFF8FAFD), card = Color(0xFFFFFFFF), line = Color(0xFFD9E2EE),
            text = Color(0xFF0F172A), muted = Color(0xFF5B6B82), primary = Color(0xFF2563EB), onPrimary = Color(0xFFFFFFFF), accent = Color(0xFF0EA5E9),
            good = Color(0xFF15803D), warn = Color(0xFFB45309), bad = Color(0xFFDC2626)),
        GoatPalette("you", "Material You", "Colours from your wallpaper (Android 12 and newer)", true,
            bg = Color(0xFF111318), surface = Color(0xFF191C22), card = Color(0xFF20242B), line = Color(0xFF30343C),
            text = Color(0xFFE2E2E9), muted = Color(0xFF9097A3), primary = Color(0xFFADC6FF), onPrimary = Color(0xFF002E69), accent = Color(0xFFBFC6DC), dynamic = true),
    )

    fun byId(id: String): GoatPalette = all.firstOrNull { it.id == id } ?: all.first()
}

val LocalGoat = staticCompositionLocalOf { Themes.all.first() }

/** The display face: a serif for big titles gives the app its "hall of fame" feel; everything else stays plain. */
private val Display = FontFamily.Serif

private fun typography(st: GoatStyle = Styles.byId("glass")): Typography {
    val base = Typography()
    val f = st.display
    val w = st.displayWeight
    val k = st.titleScale
    val tight = if (st.display == Display) 0f else -0.6f
    return base.copy(
        displaySmall = TextStyle(fontFamily = f, fontWeight = w, fontSize = (34 * k).sp, lineHeight = (40 * k).sp, letterSpacing = (-0.5f + tight).sp),
        headlineMedium = TextStyle(fontFamily = f, fontWeight = w, fontSize = (28 * k).sp, lineHeight = (34 * k).sp, letterSpacing = tight.sp),
        headlineSmall = TextStyle(fontFamily = f, fontWeight = w, fontSize = (23 * k).sp, lineHeight = (29 * k).sp, letterSpacing = (tight / 2).sp),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.2.sp),
        labelSmall = base.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
    )
}

private fun schemeOf(p: GoatPalette): ColorScheme =
    if (p.dark) darkColorScheme(
        primary = p.primary, onPrimary = p.onPrimary, secondary = p.accent, onSecondary = p.bg, tertiary = p.accent,
        background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
        surfaceVariant = p.card, onSurfaceVariant = p.muted, surfaceContainer = p.card, surfaceContainerHigh = p.card,
        surfaceContainerHighest = p.line, surfaceContainerLow = p.surface, surfaceContainerLowest = p.bg,
        outline = p.line, outlineVariant = p.line, error = p.bad, primaryContainer = p.primary.copy(alpha = 0.18f), onPrimaryContainer = p.primary,
        secondaryContainer = p.primary.copy(alpha = 0.18f), onSecondaryContainer = p.text,
    ) else lightColorScheme(
        primary = p.primary, onPrimary = p.onPrimary, secondary = p.accent, onSecondary = Color.White, tertiary = p.accent,
        background = p.bg, onBackground = p.text, surface = p.surface, onSurface = p.text,
        surfaceVariant = p.card, onSurfaceVariant = p.muted, surfaceContainer = p.card, surfaceContainerHigh = p.card,
        surfaceContainerHighest = p.line, surfaceContainerLow = p.surface, surfaceContainerLowest = p.bg,
        outline = p.line, outlineVariant = p.line, error = p.bad, primaryContainer = p.primary.copy(alpha = 0.14f), onPrimaryContainer = p.primary,
        secondaryContainer = p.primary.copy(alpha = 0.14f), onSecondaryContainer = p.text,
    )

@Composable
fun GoatTheme(themeId: String, styleId: String = "cinema", content: @Composable () -> Unit) {
    val style = Styles.byId(styleId)
    var palette = Themes.byId(themeId).styled(style)
    var scheme = schemeOf(palette)
    if (palette.dynamic) {
        val ctx = LocalContext.current
        val dark = isSystemInDarkTheme()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val d = if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
            scheme = d
            palette = palette.copy(
                dark = dark, bg = d.background, surface = d.surface, card = d.surfaceContainerHigh, line = d.outlineVariant,
                text = d.onSurface, muted = d.onSurfaceVariant, primary = d.primary, onPrimary = d.onPrimary, accent = d.tertiary,
            )
        } else {
            palette = Themes.all.first().styled(style); scheme = schemeOf(palette)
        }
    }
    CompositionLocalProvider(LocalGoat provides palette, LocalStyle provides style) {
        MaterialTheme(colorScheme = scheme, typography = typography(style), content = content)
    }
}

package com.bdlnaredi.goatstack.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The look of the app, separate from its colours (the theme): shapes, surfaces, density and how much artwork shows.
 * The same four styles as the web page (Appearance → Style). Every style works with every theme.
 */
@Immutable
data class GoatStyle(
    val id: String,
    val name: String,
    val blurb: String,
    /** Corners of cards and panels. */
    val corner: Dp,
    /** Corners of posters (round pictures such as the cast stay round). */
    val posterCorner: Dp,
    /** Corners of buttons and fields. */
    val buttonCorner: Dp,
    /** How solid cards are: 1 is solid, lower lets the picture behind the page show through. */
    val cardAlpha: Float,
    /** Cards have a thin outline. */
    val border: Boolean,
    /** Space inside cards and between things: 1 is normal, lower is tighter. */
    val density: Float,
    /** The face for big titles. */
    val display: FontFamily,
    val displayWeight: FontWeight,
    /** Size of big titles compared with normal. */
    val titleScale: Float,
    /** Section titles in capitals (small) or as plain bold headings. */
    val capsSections: Boolean,
    /** The bottom bar floats as a rounded pill above the page. */
    val floatingBar: Boolean,
    /** Height of the big pictures at the top of pages compared with normal. */
    val heroScale: Float,
    /** How dark the page behind everything gets in dark themes (0 keeps the theme's own colour, 1 is black). */
    val darken: Float,
)

object Styles {
    val all = listOf(
        GoatStyle("cinema", "Cinema", "Dark and poster-first, like a streaming app",
            corner = 14.dp, posterCorner = 10.dp, buttonCorner = 10.dp, cardAlpha = 0.9f, border = false, density = 1f,
            display = FontFamily.SansSerif, displayWeight = FontWeight.Black, titleScale = 1.12f, capsSections = false,
            floatingBar = false, heroScale = 1.2f, darken = 0.55f),
        GoatStyle("dash", "Dashboard", "Clean cards and clear lists, information first",
            corner = 10.dp, posterCorner = 8.dp, buttonCorner = 10.dp, cardAlpha = 1f, border = true, density = 0.95f,
            display = FontFamily.SansSerif, displayWeight = FontWeight.Bold, titleScale = 0.92f, capsSections = true,
            floatingBar = false, heroScale = 0.85f, darken = 0f),
        GoatStyle("glass", "Glass", "Frosted panels over the artwork, soft and rounded",
            corner = 24.dp, posterCorner = 18.dp, buttonCorner = 18.dp, cardAlpha = 0.62f, border = true, density = 1.05f,
            display = FontFamily.Serif, displayWeight = FontWeight.Bold, titleScale = 1f, capsSections = true,
            floatingBar = true, heroScale = 1f, darken = 0f),
        GoatStyle("compact", "Compact", "Flat and tight: more on every screen",
            corner = 6.dp, posterCorner = 6.dp, buttonCorner = 6.dp, cardAlpha = 1f, border = true, density = 0.7f,
            display = FontFamily.SansSerif, displayWeight = FontWeight.SemiBold, titleScale = 0.84f, capsSections = true,
            floatingBar = false, heroScale = 0.72f, darken = 0f),
    )

    fun byId(id: String): GoatStyle = all.firstOrNull { it.id == id } ?: all.first()
}

val LocalStyle = staticCompositionLocalOf { Styles.all.first() }

/** The theme's colours as this style wants them: Cinema takes dark themes nearly to black, so posters stand out. */
fun GoatPalette.styled(s: GoatStyle): GoatPalette {
    if (!dark || s.darken <= 0f) return this
    val k = s.darken
    return copy(
        bg = lerp(bg, Color.Black, k), surface = lerp(surface, Color(0xFF08080A), k * 0.85f),
        card = lerp(card, Color(0xFF141418), k * 0.7f), line = lerp(line, Color(0xFF232329), k * 0.6f),
    )
}

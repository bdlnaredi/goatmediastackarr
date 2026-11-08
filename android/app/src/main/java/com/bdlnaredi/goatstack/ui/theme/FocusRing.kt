package com.bdlnaredi.goatstack.ui.theme

import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.material3.ripple
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DelegatingNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * What every tappable thing shows when pressed: the usual ripple, plus a ring in the theme's colour while it has the
 * focus. On a phone nothing has the focus, so it looks the same as before; on Android TV (or with a keyboard) the ring
 * shows where the remote's D-pad is, on cards, posters, buttons and rows alike.
 */
class FocusRing(private val color: Color) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = Node(interactionSource, color)
    override fun equals(other: Any?) = other is FocusRing && other.color == color
    override fun hashCode() = color.hashCode()

    private class Node(private val src: InteractionSource, private val color: Color) : DelegatingNode(), DrawModifierNode {
        private var focused = false
        init { delegate(ripple().create(src)) }

        override fun onAttach() {
            coroutineScope.launch {
                var n = 0
                src.interactions.collect { i ->
                    when (i) { is FocusInteraction.Focus -> n++; is FocusInteraction.Unfocus -> n = (n - 1).coerceAtLeast(0) }
                    if (focused != (n > 0)) { focused = n > 0; invalidateDraw() }
                }
            }
        }

        override fun ContentDrawScope.draw() {
            drawContent()
            if (focused) {
                val w = 3.dp.toPx()
                drawRoundRect(color.copy(alpha = 0.18f), cornerRadius = CornerRadius(14.dp.toPx()))
                drawRoundRect(color, topLeft = androidx.compose.ui.geometry.Offset(w / 2, w / 2), size = androidx.compose.ui.geometry.Size(size.width - w, size.height - w),
                    cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(w))
            }
        }
    }
}

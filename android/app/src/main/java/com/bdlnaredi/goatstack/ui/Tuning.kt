package com.bdlnaredi.goatstack.ui

/**
 * Switches for the screenshot tests: with [still] on, nothing animates or polls forever, so a screen can be
 * photographed once it has settled. Always off in the app itself.
 */
object Tuning {
    @Volatile var still: Boolean = false
}

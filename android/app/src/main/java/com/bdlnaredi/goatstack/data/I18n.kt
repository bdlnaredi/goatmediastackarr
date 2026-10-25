package com.bdlnaredi.goatstack.data

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale

/**
 * The app in other languages: the same word lists as the web page (ui/public/lang, copied into the app's assets),
 * keyed by the English text. Anything not in the list stays in English.
 */
object I18n {
    /** The languages there are, with their own names. "" follows the phone. */
    val LANGS = listOf("" to "Phone's language", "en" to "English", "hi" to "हिन्दी", "es" to "Español", "de" to "Deutsch", "fr" to "Français")
    private val HAVE = setOf("hi", "es", "de", "fr")

    @Volatile private var map: Map<String, String> = emptyMap()
    @Volatile var lang: String = "en"
        private set

    /** The language a choice means on this phone ("" is the phone's own, when there is a list for it). */
    fun resolve(choice: String): String = choice.ifEmpty { Locale.getDefault().language }.takeIf { it in HAVE } ?: "en"

    fun load(ctx: Context, choice: String) {
        val code = resolve(choice)
        if (code == lang && (code == "en" || map.isNotEmpty())) return
        lang = code
        map = if (code == "en") emptyMap() else runCatching {
            val text = ctx.assets.open("lang/$code.json").bufferedReader().use { it.readText() }
            Json.parseToJsonElement(text).jsonObject.mapValues { it.value.jsonPrimitive.content }
        }.getOrDefault(emptyMap())
    }

    fun t(s: String): String = if (s.isEmpty()) s else map[s] ?: s
}

/** The text in the chosen language, or as it is when there is no word for it. */
fun tr(s: String): String = I18n.t(s)

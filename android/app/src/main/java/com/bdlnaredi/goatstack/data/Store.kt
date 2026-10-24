package com.bdlnaredi.goatstack.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** One settings file for the whole app; opening it twice in one process is not allowed. */
private object Files {
    @Volatile private var ds: DataStore<Preferences>? = null
    fun of(ctx: Context): DataStore<Preferences> = ds ?: synchronized(this) {
        ds ?: PreferenceDataStoreFactory.create { ctx.applicationContext.preferencesDataStoreFile("goat") }.also { ds = it }
    }
}
private val Context.store: DataStore<Preferences> get() = Files.of(this)

/** What the app keeps on this phone: the server's address, the sign-in, and the chosen look. All private to the app. */
class Store(private val ctx: Context) {
    private val kServer = stringPreferencesKey("server")
    private val kSid = stringPreferencesKey("sid")
    private val kTheme = stringPreferencesKey("theme")
    private val kLibrary = stringPreferencesKey("library")
    private val kPrefs = stringPreferencesKey("prefs")
    private val kFeed = stringPreferencesKey("feedLast")
    private val kUpd = stringPreferencesKey("notifiedUpdate")

    data class Saved(val server: String, val sid: String?, val theme: String, val library: String, val prefs: Prefs = Prefs())

    private fun read(p: Preferences) = Saved(p[kServer].orEmpty(), p[kSid], p[kTheme] ?: "goat", p[kLibrary].orEmpty(), Prefs.parse(p[kPrefs].orEmpty()))

    val saved: Flow<Saved> = ctx.store.data.map(::read)
    suspend fun load(): Saved = read(ctx.store.data.first())

    suspend fun setServer(v: String) = ctx.store.edit { it[kServer] = v; it.remove(kSid) }
    suspend fun setSid(v: String?) = ctx.store.edit { if (v == null) it.remove(kSid) else it[kSid] = v }
    suspend fun setTheme(v: String) = ctx.store.edit { it[kTheme] = v }
    suspend fun setLibrary(v: String) = ctx.store.edit { it[kLibrary] = v }
    suspend fun setPrefs(v: Prefs) = ctx.store.edit { it[kPrefs] = v.text() }
    /** The newest notification this phone has already shown (kept apart from Prefs, as the background check writes it). */
    suspend fun feedLast(): Long = ctx.store.data.first()[kFeed]?.toLongOrNull() ?: -1L
    suspend fun setFeedLast(v: Long) = ctx.store.edit { it[kFeed] = v.toString() }
    suspend fun notifiedUpdate(): String = ctx.store.data.first()[kUpd].orEmpty()
    suspend fun setNotifiedUpdate(v: String) = ctx.store.edit { it[kUpd] = v }
}

/** The choices on the Settings page that only change this phone. Kept as "key=value" lines so new ones can be added freely. */
data class Prefs(
    val start: String = "home",
    val posters: String = "normal",
    val refresh: String = "normal",
    val spoilers: Boolean = false,
    val confirmRemove: Boolean = true,
    val dismissedUpdate: String = "",
    val notify: Boolean = true,
    val kinds: String = DEFAULT_KINDS,
    val every: Int = 15,
    val askedNotify: Boolean = false,
    /** The look: cinema, dash, glass or compact (the same four as the web page). */
    val style: String = "cinema",
    /** The server version whose "What's new" was last seen. */
    val seenVersion: String = "",
) {
    fun wants(kind: String) = notify && (kind == "test" || kind in kinds.split(','))
    /** How wide a poster is in the grids. */
    val posterDp get() = when (posters) { "small" -> 88; "large" -> 140; else -> 108 }
    /** How often the downloads list asks again, in milliseconds. */
    val refreshMs get() = when (refresh) { "fast" -> 1500L; "slow" -> 6000L; else -> 2500L }

    fun text() = "start=$start\nposters=$posters\nrefresh=$refresh\nspoilers=$spoilers\nconfirmRemove=$confirmRemove\ndismissedUpdate=$dismissedUpdate\nnotify=$notify\nkinds=$kinds\nevery=$every\naskedNotify=$askedNotify\nstyle=$style\nseenVersion=$seenVersion"

    companion object {
        val STARTS = listOf("home", "discover", "library", "downloads")
        val STYLES = listOf("cinema", "dash", "glass", "compact")
        val ALL_KINDS = listOf("ready", "reqstatus", "request", "report", "download", "problem", "stream", "update")
        /** Everything except each finished download, which can be a lot. */
        const val DEFAULT_KINDS = "ready,reqstatus,request,report,problem,stream,update"
        fun parse(t: String): Prefs {
            val m = t.lines().mapNotNull { l -> l.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0].trim() to it[1].trim() } }.toMap()
            val d = Prefs()
            return Prefs(
                start = m["start"]?.takeIf { it in STARTS } ?: d.start,
                posters = m["posters"]?.takeIf { it in listOf("small", "normal", "large") } ?: d.posters,
                refresh = m["refresh"]?.takeIf { it in listOf("fast", "normal", "slow") } ?: d.refresh,
                spoilers = m["spoilers"]?.toBooleanStrictOrNull() ?: d.spoilers,
                confirmRemove = m["confirmRemove"]?.toBooleanStrictOrNull() ?: d.confirmRemove,
                dismissedUpdate = m["dismissedUpdate"]?.take(40) ?: "",
                notify = m["notify"]?.toBooleanStrictOrNull() ?: d.notify,
                kinds = m["kinds"]?.split(',')?.filter { it in ALL_KINDS }?.joinToString(",") ?: d.kinds,
                every = m["every"]?.toIntOrNull()?.takeIf { it in listOf(15, 30, 60) } ?: d.every,
                askedNotify = m["askedNotify"]?.toBooleanStrictOrNull() ?: d.askedNotify,
                style = m["style"]?.takeIf { it in STYLES } ?: d.style,
                seenVersion = m["seenVersion"]?.take(40) ?: "",
            )
        }
    }
}

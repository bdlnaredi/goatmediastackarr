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

    data class Saved(val server: String, val sid: String?, val theme: String, val library: String)

    private fun read(p: Preferences) = Saved(p[kServer].orEmpty(), p[kSid], p[kTheme] ?: "goat", p[kLibrary].orEmpty())

    val saved: Flow<Saved> = ctx.store.data.map(::read)
    suspend fun load(): Saved = read(ctx.store.data.first())

    suspend fun setServer(v: String) = ctx.store.edit { it[kServer] = v; it.remove(kSid) }
    suspend fun setSid(v: String?) = ctx.store.edit { if (v == null) it.remove(kSid) else it[kSid] = v }
    suspend fun setTheme(v: String) = ctx.store.edit { it[kTheme] = v }
    suspend fun setLibrary(v: String) = ctx.store.edit { it[kLibrary] = v }
}

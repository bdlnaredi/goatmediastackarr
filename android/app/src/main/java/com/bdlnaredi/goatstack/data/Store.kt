package com.bdlnaredi.goatstack.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.store by preferencesDataStore(name = "goat")

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

package com.bdlnaredi.goatstack

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.bdlnaredi.goatstack.data.OfflineLink
import com.bdlnaredi.goatstack.data.OfflineNext
import com.bdlnaredi.goatstack.ui.screens.offlineDir
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.util.concurrent.TimeUnit

/** A show whose next episodes are kept on the phone. */
@Serializable data class SyncShow(val sid: String, val key: String, val title: String, val n: Int = 2, val q: String = "720")

/**
 * Offline sync: for each chosen show, the next [SyncShow.n] episodes the person has not watched are kept saved on the
 * phone, and the ones watched since are deleted. Over Wi-Fi only, every few hours (and when a show is added).
 */
object OfflineSync {
    private const val PREFS = "offline-sync"
    private val json = Json { ignoreUnknownKeys = true }

    fun shows(ctx: Context): List<SyncShow> = runCatching { json.decodeFromString<List<SyncShow>>(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("shows", "[]")!!) }.getOrDefault(emptyList())
    private fun saveShows(ctx: Context, l: List<SyncShow>) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("shows", json.encodeToString(l)).apply()
    /** Which file each kept episode is in ("sid:episode" → file name), so only those are ever deleted. */
    private fun files(ctx: Context): MutableMap<String, String> = runCatching { json.decodeFromString<Map<String, String>>(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("files", "{}")!!).toMutableMap() }.getOrDefault(mutableMapOf())
    private fun saveFiles(ctx: Context, m: Map<String, String>) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("files", json.encodeToString(m)).apply()
    private fun owner(ctx: Context): MutableMap<String, String> = runCatching { json.decodeFromString<Map<String, String>>(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("owner", "{}")!!).toMutableMap() }.getOrDefault(mutableMapOf())
    private fun saveOwner(ctx: Context, m: Map<String, String>) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("owner", json.encodeToString(m)).apply()

    fun add(ctx: Context, s: SyncShow) { saveShows(ctx, shows(ctx).filterNot { it.sid == s.sid && it.key == s.key } + s); schedule(ctx); runNow(ctx) }
    fun remove(ctx: Context, s: SyncShow) {
        saveShows(ctx, shows(ctx).filterNot { it.sid == s.sid && it.key == s.key })
        // Its kept episodes go too.
        val f = files(ctx); val o = owner(ctx)
        for ((k, show) in o.toMap()) if (show == "${s.sid}:${s.key}") { f.remove(k)?.let { File(offlineDir(ctx), it).delete() }; o.remove(k) }
        saveFiles(ctx, f); saveOwner(ctx, o)
    }

    private val wifi = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()
    fun schedule(ctx: Context) {
        if (shows(ctx).isEmpty() || com.bdlnaredi.goatstack.ui.Tuning.still) return
        runCatching { WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("goat-offline-sync", ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<OfflineSyncWorker>(4, TimeUnit.HOURS).setConstraints(wifi).build()) }
    }
    fun runNow(ctx: Context) {
        if (com.bdlnaredi.goatstack.ui.Tuning.still) return
        runCatching { WorkManager.getInstance(ctx).enqueueUniqueWork("goat-offline-sync-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<OfflineSyncWorker>().setConstraints(wifi).build()) }
    }

    suspend fun sync(ctx: Context, api: com.bdlnaredi.goatstack.data.Api, server: String) {
        val f = files(ctx); val o = owner(ctx)
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        for (s in shows(ctx)) {
            val next = runCatching { api.get<OfflineNext>("/api/offline/next?sid=${s.sid}&show=${Uri.encode(s.key)}&n=${s.n}") }.getOrNull() ?: continue
            val want = next.items.map { "${s.sid}:${it.key}" }.toSet()
            // Watched since (no longer among the next ones): deleted.
            for ((k, show) in o.toMap()) if (show == "${s.sid}:${s.key}" && k !in want) { f.remove(k)?.let { File(offlineDir(ctx), it).delete() }; o.remove(k) }
            // Not saved yet: fetched.
            for (it in next.items) {
                val k = "${s.sid}:${it.key}"
                if (f[k]?.let { n -> File(offlineDir(ctx), n).exists() } == true) continue
                val r = runCatching { api.post<OfflineLink>("/api/offline", buildJsonObject { put("sid", s.sid); put("key", it.key); put("title", it.title.ifEmpty { s.title }); put("sub", it.sub); put("q", s.q) }) }.getOrNull() ?: continue
                val name = r.name.replace(Regex("[^\\w .()-]"), "_") + "." + r.ext.ifEmpty { "mkv" }
                runCatching {
                    dm.enqueue(DownloadManager.Request(Uri.parse(server.trimEnd('/') + r.url)).setTitle(r.name).setDescription("Kept for offline")
                        .setAllowedOverMetered(false).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_MOVIES, "GoatStack/$name"))
                    f[k] = name; o[k] = "${s.sid}:${s.key}"
                }
            }
        }
        saveFiles(ctx, f); saveOwner(ctx, o)
    }
}

class OfflineSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val saved = runCatching { com.bdlnaredi.goatstack.data.Store(ctx).load() }.getOrNull() ?: return Result.success()
        val api = Widgets.api(ctx) ?: return Result.success()
        runCatching { OfflineSync.sync(ctx, api, saved.server) }
        return Result.success()
    }
}

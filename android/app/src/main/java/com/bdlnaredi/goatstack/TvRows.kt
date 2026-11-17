package com.bdlnaredi.goatstack

import android.content.ContentProvider
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.graphics.drawable.toBitmap
import androidx.tvprovider.media.tv.Channel
import androidx.tvprovider.media.tv.ChannelLogoUtils
import androidx.tvprovider.media.tv.PreviewProgram
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.bdlnaredi.goatstack.data.ContItem
import com.bdlnaredi.goatstack.data.MediaNow
import com.bdlnaredi.goatstack.data.Service
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Android TV's home screen: what you were watching goes in its "Play next" row, and what is new in the library gets a
 * row of its own ("New in your library"). Picking one opens GoatMediaStackarr. Only on a TV; phones are left alone.
 * The home screen loads the posters itself, without signing in, so they are saved on the TV first ([PosterProvider]).
 */
object TvRows {
    private const val PREFS = "tv-rows"
    private const val WORK = "goat-tv-rows"

    fun isTv(ctx: Context) = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

    /** Every few hours, and once now. */
    fun schedule(ctx: Context) {
        if (!isTv(ctx) || com.bdlnaredi.goatstack.ui.Tuning.still) return
        runCatching {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<TvRowsWorker>(3, TimeUnit.HOURS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }

    private fun intentUri(ctx: Context, link: String) = Intent(ctx, MainActivity::class.java).putExtra("link", link).toUri(Intent.URI_INTENT_SCHEME)

    /** The posters, saved where the home screen can read them, as content:// addresses. */
    private suspend fun poster(ctx: Context, api: com.bdlnaredi.goatstack.data.Api, s: Service, path: String): Uri? {
        val url = api.mediaImage(s.id, s.type, path) ?: return null
        val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) } + ".jpg"
        val f = File(PosterProvider.dir(ctx), name)
        if (!f.exists()) runCatching {
            api.client.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body?.bytes()?.let { f.writeBytes(it) } }
        }
        return if (f.exists()) Uri.parse("content://${ctx.packageName}.posters/$name") else null
    }

    suspend fun update(ctx: Context, api: com.bdlnaredi.goatstack.data.Api) {
        if (!isTv(ctx)) return
        val services = runCatching { api.get<List<Service>>("/api/services") }.getOrNull() ?: return
        val ms = services.firstOrNull { it.type == "plex" } ?: services.firstOrNull { it.type == "jellyfin" } ?: return
        val now = runCatching { api.get<MediaNow>("/api/${ms.type}/${ms.id}/now") }.getOrNull() ?: return
        val cr = ctx.contentResolver
        // Play next: what was started and not finished. The rows put there before are replaced.
        runCatching {
            cr.query(TvContractCompat.WatchNextPrograms.CONTENT_URI, arrayOf("_id"), null, null, null)?.use { c ->
                while (c.moveToNext()) cr.delete(TvContractCompat.buildWatchNextProgramUri(c.getLong(0)), null, null)
            }
        }
        for (x in now.cont.take(10)) runCatching {
            val p = WatchNextProgram.Builder()
                .setType(if (x.sub.startsWith("S")) TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE else TvContractCompat.WatchNextPrograms.TYPE_MOVIE)
                .setWatchNextType(if (x.next) TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT else TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
                .setLastEngagementTimeUtcMillis(System.currentTimeMillis())
                .setTitle(x.title).setDescription(x.sub)
                .setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_2_3)
                .setIntentUri(Uri.parse(intentUri(ctx, "home")))
                .setInternalProviderId("goat:" + x.key)
            poster(ctx, api, ms, x.thumb)?.let { p.setPosterArtUri(it) }
            cr.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, p.build().toContentValues())
        }
        // New in your library: the app's own row, made once and asked to be shown.
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var channel = sp.getLong("channel", -1)
        if (channel < 0) {
            val ch = Channel.Builder().setType(TvContractCompat.Channels.TYPE_PREVIEW).setDisplayName("New in your library")
                .setAppLinkIntentUri(Uri.parse(intentUri(ctx, "home"))).setInternalProviderId("goat-new").build()
            val uri = runCatching { cr.insert(TvContractCompat.Channels.CONTENT_URI, ch.toContentValues()) }.getOrNull() ?: return
            channel = ContentUris.parseId(uri)
            sp.edit().putLong("channel", channel).apply()
            // The app's icon (an adaptive one, so drawn into a picture first).
            runCatching { ChannelLogoUtils.storeChannelLogo(ctx, channel, ctx.packageManager.getApplicationIcon(ctx.packageName).toBitmap(256, 256)) }
            runCatching { TvContractCompat.requestChannelBrowsable(ctx, channel) }
        }
        runCatching { cr.delete(TvContractCompat.buildPreviewProgramsUriForChannel(channel), null, null) }
        for ((i, x) in now.recent.take(12).withIndex()) runCatching {
            val p = PreviewProgram.Builder().setChannelId(channel)
                .setType(if (x.sub.startsWith("S")) TvContractCompat.PreviewPrograms.TYPE_TV_SERIES else TvContractCompat.PreviewPrograms.TYPE_MOVIE)
                .setTitle(x.title).setDescription(x.sub).setWeight(100 - i)
                .setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_2_3)
                .setIntentUri(Uri.parse(intentUri(ctx, "home")))
                .setInternalProviderId("goat-new:" + x.key)
            poster(ctx, api, ms, x.thumb)?.let { p.setPosterArtUri(it) }
            cr.insert(TvContractCompat.PreviewPrograms.CONTENT_URI, p.build().toContentValues())
        }
        // Old posters go after a week.
        PosterProvider.dir(ctx).listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 7 * 86_400_000L }?.forEach { it.delete() }
    }
}

class TvRowsWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val api = Widgets.api(ctx) ?: return Result.success()
        runCatching { TvRows.update(ctx, api) }
        return Result.success()
    }
}

/** The posters of the TV rows, readable by the TV's home screen. Only files it saved itself, by name, can be read. */
class PosterProvider : ContentProvider() {
    companion object {
        fun dir(ctx: Context) = File(ctx.cacheDir, "tv-posters").apply { mkdirs() }
        private val NAME = Regex("^[a-f0-9]{40}\\.jpg$")
    }
    override fun onCreate() = true
    override fun getType(uri: Uri) = "image/jpeg"
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val ctx = context ?: return null
        val name = uri.lastPathSegment.orEmpty()
        if (mode != "r" || !NAME.matches(name)) return null
        val f = File(dir(ctx), name)
        return if (f.exists()) ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY) else null
    }
    override fun query(uri: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, v: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}

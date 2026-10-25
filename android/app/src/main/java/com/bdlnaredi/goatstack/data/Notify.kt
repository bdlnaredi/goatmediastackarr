package com.bdlnaredi.goatstack.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.bdlnaredi.goatstack.BuildConfig
import com.bdlnaredi.goatstack.MainActivity
import com.bdlnaredi.goatstack.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/**
 * Notifications on the phone. The server keeps a list of what happened for each person (/api/notifications); this asks
 * for what is new and shows the kinds that are switched on in Settings. While the app is open it asks every 30
 * seconds; in the background Android runs [CheckWorker] every 15, 30 or 60 minutes. No Google services are needed.
 */
object Notify {
    /** A kind of notification: its Android channel, and the words for it in Settings. */
    data class Kind(val id: String, val title: String, val text: String, val adminOnly: Boolean = false)

    val KINDS = listOf(
        Kind("ready", "Ready to watch", "Something you asked for is available"),
        Kind("reqstatus", "Your requests", "Approved, declined, or a download that failed"),
        Kind("stream", "Streaming", "Getting close to, or reaching, your monthly limit"),
        Kind("update", "New versions", "A newer app, or for admins a newer server"),
        Kind("request", "New requests", "Someone asked for something and it needs approval", adminOnly = true),
        Kind("report", "Problem reports", "Someone reported a problem with a title", adminOnly = true),
        Kind("problem", "Server problems", "An app stops answering, the VPN drops, the array is nearly full", adminOnly = true),
        Kind("download", "Finished downloads", "Every download that completes", adminOnly = true),
    )

    private const val WORK = "goat-notifications"

    fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        for (k in KINDS + Kind("test", "Test", "Test notifications")) {
            val imp = when (k.id) { "ready", "problem", "request" -> NotificationManager.IMPORTANCE_HIGH; "download" -> NotificationManager.IMPORTANCE_LOW; else -> NotificationManager.IMPORTANCE_DEFAULT }
            nm.createNotificationChannel(NotificationChannel(k.id, k.title, imp).apply { description = k.text })
        }
    }

    fun allowed(ctx: Context) = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Turns the background check on (or off) with the chosen interval. */
    fun schedule(ctx: Context, p: Prefs) {
        if (com.bdlnaredi.goatstack.ui.Tuning.still) return
        try {
            val wm = WorkManager.getInstance(ctx)
            if (!p.notify) { wm.cancelUniqueWork(WORK); return }
            val req = PeriodicWorkRequestBuilder<CheckWorker>(p.every.toLong().coerceAtLeast(15), TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
        } catch (_: Exception) { }
    }

    @SuppressLint("MissingPermission")
    private fun show(ctx: Context, id: Int, kind: String, title: String, body: String, link: String) {
        if (!allowed(ctx)) return
        val open = Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP; putExtra("link", link) }
        val pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, kind)
            .setSmallIcon(R.drawable.ic_launcher_mono)
            .setContentTitle(title).setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).setContentIntent(pi)
            .setCategory(if (kind == "problem") NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_STATUS)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (_: SecurityException) { }
    }

    /**
     * Asks the server what is new and shows it. The first time on a phone it only remembers where the list is, so
     * old events do not arrive all at once. Returns how many were shown.
     */
    suspend fun check(ctx: Context, store: Store, api: Api, prefs: Prefs): Int {
        if (!prefs.notify || api.base.isEmpty()) return 0
        var shown = 0
        val feed = try { api.get<Feed>("/api/notifications?after=" + store.feedLast().coerceAtLeast(0)) } catch (_: Exception) { return 0 }
        val last = store.feedLast()
        if (last < 0 || feed.last < last) { store.setFeedLast(feed.last); return 0 }   // first check, or a new server
        channels(ctx)
        for (x in feed.items.sortedBy { it.id }) if (x.id > last && prefs.wants(x.kind)) { show(ctx, (x.id % Int.MAX_VALUE).toInt(), x.kind, x.title, x.body, x.link); shown++ }
        store.setFeedLast(feed.last)
        // A newer phone app: told once per version.
        if (prefs.wants("update")) try {
            val u = api.get<Updates>("/api/updates")
            if (u.apk.isNotEmpty() && Versions.newer(u.latest, BuildConfig.VERSION_NAME) && store.notifiedUpdate() != u.latest) {
                store.setNotifiedUpdate(u.latest)
                show(ctx, 1_000_000_007, "update", "GoatStack ${u.latest} is ready", "A newer app is out. Tap to get it.", "update"); shown++
            }
        } catch (_: Exception) { }
        return shown
    }
}

/** The background check Android runs every so often, even when the app is closed. */
class CheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        val saved = try { store.load() } catch (_: Exception) { return Result.success() }
        if (saved.server.isEmpty() || saved.sid == null) return Result.success()
        val api = Api(onSession = { s -> CoroutineScope(Dispatchers.IO).launch { store.setSid(s) } })
        api.configure(saved.server, saved.sid)
        Notify.check(applicationContext, store, api, saved.prefs)
        com.bdlnaredi.goatstack.GoatWidget.refresh(applicationContext)
        return Result.success()
    }
}

package com.bdlnaredi.goatstack

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.bdlnaredi.goatstack.data.Api
import com.bdlnaredi.goatstack.data.AppHealth
import com.bdlnaredi.goatstack.data.GoatStatus
import com.bdlnaredi.goatstack.data.I18n
import com.bdlnaredi.goatstack.data.Live
import com.bdlnaredi.goatstack.data.Me
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.Store
import com.bdlnaredi.goatstack.data.tr
import com.bdlnaredi.goatstack.ui.Format
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.text.DateFormat
import java.util.Date

/** Every widget of the app, refreshed together (after a notification check, a button on a notification…). */
object Widgets {
    fun refreshAll(ctx: Context) {
        GoatWidget.refresh(ctx); GoatListWidget.refresh(ctx); DownloadsWidget.refresh(ctx); ServerWidget.refresh(ctx)
    }

    internal fun has(ctx: Context, cls: Class<*>) =
        runCatching { AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, cls)).isNotEmpty() }.getOrDefault(false)

    internal inline fun <reified W : CoroutineWorker> queue(ctx: Context, name: String) {
        if (com.bdlnaredi.goatstack.ui.Tuning.still) return
        runCatching {
            WorkManager.getInstance(ctx).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<W>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        }
    }

    /** Opens a page of the app (the same names a notification uses). */
    internal fun open(ctx: Context, code: Int, link: String): PendingIntent =
        PendingIntent.getActivity(ctx, code, Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK; putExtra("link", link) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    internal fun broadcast(ctx: Context, code: Int, cls: Class<*>, action: String): PendingIntent =
        PendingIntent.getBroadcast(ctx, code, Intent(ctx, cls).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Signed in and ready to ask the server, or null (the widget then says to open the app). */
    internal suspend fun api(ctx: Context): Api? {
        val store = Store(ctx)
        val saved = try { store.load() } catch (_: Exception) { return null }
        I18n.load(ctx, saved.prefs.lang)
        if (saved.server.isEmpty() || saved.sid == null) return null
        return Api(onSession = { s -> CoroutineScope(Dispatchers.IO).launch { store.setSid(s) } }).apply { configure(saved.server, saved.sid) }
    }

    internal fun now(): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
}

// ---------------------------------------------------------------- Downloads

/** One download on the widget. */
data class DlRow(val name: String, val progress: Int, val info: String)
data class DlView(val sum: String, val rows: List<DlRow>)

/** The Downloads widget: the busiest torrents with their progress, and Pause all / Resume all (the server checks the rights). */
class DownloadsWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { refresh(ctx) }
    override fun onReceive(ctx: Context, intent: Intent) { super.onReceive(ctx, intent); if (intent.action == REFRESH) refresh(ctx) }

    companion object {
        const val REFRESH = "com.bdlnaredi.goatstack.DL_REFRESH"
        private val ROWS = listOf(Triple(R.id.d_row1, R.id.d_name1, R.id.d_bar1) to R.id.d_info1, Triple(R.id.d_row2, R.id.d_name2, R.id.d_bar2) to R.id.d_info2,
            Triple(R.id.d_row3, R.id.d_name3, R.id.d_bar3) to R.id.d_info3)

        fun refresh(ctx: Context) { if (Widgets.has(ctx, DownloadsWidget::class.java)) Widgets.queue<DownloadsWidgetWorker>(ctx, "goat-dl-widget") }

        /** The three fastest downloads of every torrent app, and a line with the totals. */
        fun viewOf(l: Live?): DlView {
            if (l == null) return DlView(tr("Could not reach the server"), emptyList())
            val dl = l.qb.values.sumOf { it.dl } + l.sab.values.sumOf { it.speed.toLong() }
            val active = l.qb.values.sumOf { it.active } + l.sab.values.sumOf { it.slots }
            val top = l.qb.values.flatMap { it.top }.sortedByDescending { it.speed }.take(3).map { t ->
                val pct = (t.progress * 100).toInt().coerceIn(0, 100)
                val left = if (t.eta in 1 until 8_640_000) " · " + Format.eta(t.eta) + " " + tr("left") else ""
                DlRow(t.name, (t.progress * 1000).toInt().coerceIn(0, 1000), "$pct%$left · ↓ ${Format.speed(t.speed)}")
            } + l.sab.values.flatMap { it.jobs }.take((3 - l.qb.values.sumOf { it.top.size }).coerceAtLeast(0)).map { j ->
                DlRow(j.name, (j.pct * 10).toInt().coerceIn(0, 1000), "${j.pct.toInt()}% · Usenet")
            }
            val sum = if (active == 0 && top.isEmpty()) tr("Nothing is downloading") else "↓ ${Format.speed(dl)} · ↑ ${Format.speed(l.qb.values.sumOf { it.ul })} · $active ${tr("active")}"
            return DlView(sum, top.take(3))
        }

        fun draw(ctx: Context, v: DlView) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, DownloadsWidget::class.java)); if (ids.isEmpty()) return
            mgr.updateAppWidget(ids, build(ctx, v))
        }

        fun build(ctx: Context, v: DlView): RemoteViews {
            val rv = RemoteViews(ctx.packageName, R.layout.widget_downloads)
            rv.setTextViewText(R.id.d_sum, v.sum)
            ROWS.forEachIndexed { i, (ids3, info) ->
                val r = v.rows.getOrNull(i)
                rv.setViewVisibility(ids3.first, if (r == null) View.GONE else View.VISIBLE)
                if (r != null) { rv.setTextViewText(ids3.second, r.name); rv.setProgressBar(ids3.third, 1000, r.progress, false); rv.setTextViewText(info, r.info) }
            }
            rv.setTextViewText(R.id.d_pause, "⏸ " + tr("Pause all")); rv.setTextViewText(R.id.d_resume, "▶ " + tr("Resume all"))
            rv.setOnClickPendingIntent(R.id.d_root, Widgets.open(ctx, 20, "downloads"))
            rv.setOnClickPendingIntent(R.id.d_refresh, Widgets.broadcast(ctx, 21, DownloadsWidget::class.java, REFRESH))
            // The same buttons as on a download notification, done without opening the app. They go to the app's own
            // (not exported) receiver, so no other app can press them.
            rv.setOnClickPendingIntent(R.id.d_pause, com.bdlnaredi.goatstack.data.NotifyAction.intent(ctx, 9001, "pause", ""))
            rv.setOnClickPendingIntent(R.id.d_resume, com.bdlnaredi.goatstack.data.NotifyAction.intent(ctx, 9002, "resume", ""))
            return rv
        }
    }
}

class DownloadsWidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val api = Widgets.api(applicationContext) ?: run { DownloadsWidget.draw(applicationContext, DlView(tr("Open the app and sign in"), emptyList())); return Result.success() }
        val live = try { withTimeoutOrNull(20_000) { api.live().first() } } catch (_: Exception) { null }
        DownloadsWidget.draw(applicationContext, DownloadsWidget.viewOf(live))
        return Result.success()
    }
}

// ---------------------------------------------------------------- Server

data class ServerView(val apps: String, val vpn: String, val disk: String, val note: String)

/** The Server widget (admins): which apps do not answer, the VPN, and the fullest disk. */
class ServerWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { refresh(ctx) }
    override fun onReceive(ctx: Context, intent: Intent) { super.onReceive(ctx, intent); if (intent.action == REFRESH) refresh(ctx) }

    companion object {
        const val REFRESH = "com.bdlnaredi.goatstack.SERVER_REFRESH"

        fun refresh(ctx: Context) { if (Widgets.has(ctx, ServerWidget::class.java)) Widgets.queue<ServerWidgetWorker>(ctx, "goat-server-widget") }

        fun viewOf(services: List<Service>?, live: Live?, status: GoatStatus?, health: List<AppHealth>?, now: String = Widgets.now()): ServerView {
            if (services == null) return ServerView(tr("Could not reach the server"), "", "", now)
            val down = services.filter { live?.health?.get(it.id) == false }.map { it.name }
            val apps = when {
                live == null -> "${services.size} ${tr("apps")}"
                down.isEmpty() -> "✓ " + tr("All %d apps answering").replace("%d", services.size.toString())
                else -> "⚠ " + (if (down.size == 1) tr("Not answering:") else "${down.size} " + tr("not answering:")) + " " + down.take(3).joinToString(", ") + if (down.size > 3) "…" else ""
            }
            val v = status?.vpn
            val vpn = when {
                v == null || !v.enabled -> ""
                v.state == "up" -> "🛡 " + tr("VPN connected") + listOf(v.country, v.ip).filter { it.isNotBlank() }.joinToString(" · ", prefix = " · ").let { if (it == " · ") "" else it }
                else -> "⚠ " + tr("VPN not connected: download apps are offline")
            }
            // The disk with the least room left, once per folder.
            val d = health.orEmpty().flatMap { it.disks }.filter { it.total > 0 }.distinctBy { it.path }.minByOrNull { it.free.toDouble() / it.total }
            val disk = if (d == null) "" else {
                val used = ((1 - d.free.toDouble() / d.total) * 100).toInt()
                (if (used >= 90) "⚠ " else "💾 ") + "${d.label.ifBlank { d.path }}: ${Format.bytes(d.free)} " + tr("free of") + " ${Format.bytes(d.total)} ($used%)"
            }
            return ServerView(apps, vpn, disk, now)
        }

        fun draw(ctx: Context, v: ServerView) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, ServerWidget::class.java)); if (ids.isEmpty()) return
            mgr.updateAppWidget(ids, build(ctx, v))
        }

        fun build(ctx: Context, v: ServerView): RemoteViews {
            val rv = RemoteViews(ctx.packageName, R.layout.widget_server)
            for ((id, t) in listOf(R.id.s_apps to v.apps, R.id.s_vpn to v.vpn, R.id.s_disk to v.disk, R.id.s_when to v.note)) {
                rv.setTextViewText(id, t); rv.setViewVisibility(id, if (t.isBlank()) View.GONE else View.VISIBLE)
            }
            rv.setOnClickPendingIntent(R.id.s_root, Widgets.open(ctx, 30, "health"))
            rv.setOnClickPendingIntent(R.id.s_refresh, Widgets.broadcast(ctx, 31, ServerWidget::class.java, REFRESH))
            return rv
        }
    }
}

class ServerWidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val api = Widgets.api(ctx) ?: run { ServerWidget.draw(ctx, ServerView(tr("Open the app and sign in"), "", "", "")); return Result.success() }
        val me = runCatching { api.get<Me>("/api/me") }.getOrNull()
        if (me != null && me.user?.role != "admin") { ServerWidget.draw(ctx, ServerView(tr("For admins: sign in as an admin to see the server"), "", "", "")); return Result.success() }
        val services = runCatching { api.get<List<Service>>("/api/services") }.getOrNull()
        val live = try { withTimeoutOrNull(20_000) { api.live().first() } } catch (_: Exception) { null }
        val status = if (me?.goat == true) runCatching { api.get<GoatStatus>("/api/goat/status") }.getOrNull() else null
        val health = runCatching { api.get<List<AppHealth>>("/api/libhealth") }.getOrNull()
        ServerWidget.draw(ctx, ServerWidget.viewOf(services, live, status, health))
        return Result.success()
    }
}

// ---------------------------------------------------------------- Shortcuts

/** The Shortcuts widget: straight to Search, Discover, Requests or Downloads. Nothing to fetch. */
class ShortcutsWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { mgr.updateAppWidget(ids, build(ctx)) }

    companion object {
        fun build(ctx: Context): RemoteViews {
            val rv = RemoteViews(ctx.packageName, R.layout.widget_shortcuts)
            for ((i, x) in listOf(Triple(R.id.k_search, "search", "🔍 " + tr("Search")), Triple(R.id.k_discover, "discover", "✨ " + tr("Discover")),
                Triple(R.id.k_requests, "requests", "📥 " + tr("Requests")), Triple(R.id.k_downloads, "downloads", "⬇ " + tr("Downloads"))).withIndex()) {
                rv.setTextViewText(x.first, x.third); rv.setOnClickPendingIntent(x.first, Widgets.open(ctx, 40 + i, x.second))
            }
            return rv
        }
    }
}

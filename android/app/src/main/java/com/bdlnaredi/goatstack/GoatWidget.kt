package com.bdlnaredi.goatstack

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.bdlnaredi.goatstack.data.Api
import com.bdlnaredi.goatstack.data.I18n
import com.bdlnaredi.goatstack.data.Live
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

/**
 * The home-screen widget: download and upload speeds and what is playing, from the server's live feed.
 * Android refreshes it every half hour, the notification check refreshes it too, and a tap on the arrows does it now.
 */
class GoatWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { refresh(ctx) }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == REFRESH) refresh(ctx)
    }

    companion object {
        const val REFRESH = "com.bdlnaredi.goatstack.WIDGET_REFRESH"
        private const val WORK = "goat-widget"

        fun has(ctx: Context): Boolean = runCatching {
            AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, GoatWidget::class.java)).isNotEmpty()
        }.getOrDefault(false)

        /** Fetches new numbers in the background (needs the network) and redraws every widget. */
        fun refresh(ctx: Context) {
            if (com.bdlnaredi.goatstack.ui.Tuning.still || !has(ctx)) return
            runCatching {
                val req = OneTimeWorkRequestBuilder<WidgetWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
                WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
            }
        }

        fun viewOf(l: Live?, now: Long = System.currentTimeMillis()): WidgetView {
            if (l == null) return WidgetView("↓ –", "↑ –", tr("Could not reach the server"), "")
            val dl = l.qb.values.sumOf { it.dl } + l.sab.values.sumOf { it.speed.toLong() }
            val ul = l.qb.values.sumOf { it.ul }
            val playing = l.plex.values.flatten()
            val play = when (playing.size) {
                0 -> tr("Nothing is playing")
                1 -> "▶ ${playing[0].title} · ${playing[0].user}"
                else -> "▶ ${playing.size} · " + playing.take(2).joinToString(", ") { it.title }
            }
            return WidgetView("↓ " + Format.speed(dl), "↑ " + Format.speed(ul), play, DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(now)))
        }

        fun draw(ctx: Context, v: WidgetView) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, GoatWidget::class.java))
            if (ids.isEmpty()) return
            val rv = RemoteViews(ctx.packageName, R.layout.widget_goat)
            rv.setTextViewText(R.id.w_down, v.down)
            rv.setTextViewText(R.id.w_up, v.up)
            rv.setTextViewText(R.id.w_play, v.playing)
            rv.setTextViewText(R.id.w_when, v.note)
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK; putExtra("link", "downloads") },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            rv.setOnClickPendingIntent(R.id.w_root, open)
            val again = PendingIntent.getBroadcast(ctx, 1, Intent(ctx, GoatWidget::class.java).setAction(REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            rv.setOnClickPendingIntent(R.id.w_refresh, again)
            mgr.updateAppWidget(ids, rv)
        }
    }
}

/** What the widget shows, in words. */
data class WidgetView(val down: String, val up: String, val playing: String, val note: String)

/** Reads one update from the server's live feed and draws it on the widgets. */
class WidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        val saved = try { store.load() } catch (_: Exception) { return Result.success() }
        I18n.load(applicationContext, saved.prefs.lang)
        if (saved.server.isEmpty() || saved.sid == null) {
            GoatWidget.draw(applicationContext, WidgetView("↓ –", "↑ –", tr("Open the app and sign in"), "")); return Result.success()
        }
        val api = Api(onSession = { s -> CoroutineScope(Dispatchers.IO).launch { store.setSid(s) } })
        api.configure(saved.server, saved.sid)
        val live = try { withTimeoutOrNull(20_000) { api.live().first() } } catch (_: Exception) { null }
        GoatWidget.draw(applicationContext, GoatWidget.viewOf(live))
        return Result.success()
    }
}

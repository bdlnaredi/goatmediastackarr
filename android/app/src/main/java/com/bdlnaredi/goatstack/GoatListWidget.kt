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
import com.bdlnaredi.goatstack.data.Me
import com.bdlnaredi.goatstack.data.MediaRequest
import com.bdlnaredi.goatstack.data.Store
import com.bdlnaredi.goatstack.data.Upcoming
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** The second home-screen widget: the next things coming out, and the requests (waiting for an admin, or your own). */
class GoatListWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { refresh(ctx) }
    override fun onReceive(ctx: Context, intent: Intent) { super.onReceive(ctx, intent); if (intent.action == REFRESH) refresh(ctx) }

    companion object {
        const val REFRESH = "com.bdlnaredi.goatstack.LIST_REFRESH"
        private val ROWS = intArrayOf(R.id.l_row1, R.id.l_row2, R.id.l_row3, R.id.l_row4)

        fun has(ctx: Context) = runCatching { AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, GoatListWidget::class.java)).isNotEmpty() }.getOrDefault(false)

        fun refresh(ctx: Context) {
            if (com.bdlnaredi.goatstack.ui.Tuning.still || !has(ctx)) return
            runCatching {
                WorkManager.getInstance(ctx).enqueueUniqueWork("goat-list-widget", ExistingWorkPolicy.REPLACE,
                    OneTimeWorkRequestBuilder<ListWidgetWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
            }
        }

        /** "Today", "Tomorrow" or the weekday, then the title. */
        fun rows(up: Upcoming?, today: LocalDate = LocalDate.now()): List<String> {
            if (up == null) return listOf("Could not reach the server")
            val l = up.calendar.mapNotNull { c -> runCatching { LocalDate.parse(c.date.take(10)) }.getOrNull()?.let { it to c } }
                .filter { !it.first.isBefore(today) }.sortedBy { it.first }.take(4)
            if (l.isEmpty()) return listOf("Nothing coming up this week")
            return l.map { (d, c) ->
                val day = when (d) { today -> "Today"; today.plusDays(1) -> "Tomorrow"; else -> d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()) }
                "$day · ${c.title}" + if (c.sub.isNotBlank()) " ${c.sub}" else ""
            }
        }

        fun reqLine(admin: Boolean, reqs: List<MediaRequest>?): String = when {
            reqs == null -> ""
            admin -> reqs.count { it.status == "pending" }.let { if (it == 0) "No requests waiting" else "$it request${if (it == 1) "" else "s"} waiting for you" }
            else -> reqs.filter { it.status != "declined" && it.stage != "available" }.size.let { if (it == 0) "Nothing on its way for you" else "$it of your requests on the way" }
        }

        fun draw(ctx: Context, rows: List<String>, req: String) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, GoatListWidget::class.java)); if (ids.isEmpty()) return
            val rv = RemoteViews(ctx.packageName, R.layout.widget_list)
            ROWS.forEachIndexed { i, id -> rv.setTextViewText(id, rows.getOrNull(i) ?: "") }
            rv.setTextViewText(R.id.l_req, req)
            rv.setOnClickPendingIntent(R.id.l_root, PendingIntent.getActivity(ctx, 10, Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK; putExtra("link", "upcoming") },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            rv.setOnClickPendingIntent(R.id.l_req, PendingIntent.getActivity(ctx, 11, Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK; putExtra("link", "requests") },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            rv.setOnClickPendingIntent(R.id.l_refresh, PendingIntent.getBroadcast(ctx, 12, Intent(ctx, GoatListWidget::class.java).setAction(REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            mgr.updateAppWidget(ids, rv)
        }
    }
}

class ListWidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        val saved = try { store.load() } catch (_: Exception) { return Result.success() }
        if (saved.server.isEmpty() || saved.sid == null) { GoatListWidget.draw(applicationContext, listOf("Open the app and sign in"), ""); return Result.success() }
        val api = Api(onSession = { s -> CoroutineScope(Dispatchers.IO).launch { store.setSid(s) } })
        api.configure(saved.server, saved.sid)
        val up = runCatching { api.get<Upcoming>("/api/upcoming") }.getOrNull()
        val admin = runCatching { api.get<Me>("/api/me").user?.role == "admin" }.getOrDefault(false)
        val reqs = runCatching { api.get<List<MediaRequest>>("/api/requests") }.getOrNull()
        GoatListWidget.draw(applicationContext, GoatListWidget.rows(up), GoatListWidget.reqLine(admin, reqs))
        return Result.success()
    }
}

package com.bdlnaredi.goatstack.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The buttons on a notification: Approve and Decline on a new request, Pause all on a download or a server problem.
 * They call the server straight away, without opening the app, then take the notification away and say what happened.
 * Only admins are told about new requests and downloads, and the server checks the rights again either way.
 */
class NotifyAction : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val act = intent.getStringExtra(ACT) ?: return
        val ref = intent.getStringExtra(REF).orEmpty()
        val nid = intent.getIntExtra(NID, 0)
        val app = ctx.applicationContext
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val msg = try { run(app, act, ref) } catch (e: Exception) { "Could not do that: " + (e.message ?: "no answer") }
            withContext(Dispatchers.Main) {
                runCatching { NotificationManagerCompat.from(app).cancel(nid) }
                Toast.makeText(app, msg, Toast.LENGTH_SHORT).show()
            }
            com.bdlnaredi.goatstack.GoatWidget.refresh(app); com.bdlnaredi.goatstack.GoatListWidget.refresh(app)
            done.finish()
        }
    }

    private suspend fun run(ctx: Context, act: String, ref: String): String {
        val store = Store(ctx)
        val saved = store.load()
        if (saved.server.isEmpty() || saved.sid == null) return "Open the app and sign in first"
        val api = Api(onSession = { s -> CoroutineScope(Dispatchers.IO).launch { store.setSid(s) } })
        api.configure(saved.server, saved.sid)
        return when (act) {
            "approve", "decline" -> { api.post<JsonObject>("/api/requests/$ref/$act", buildJsonObject { }); if (act == "approve") "Request approved" else "Request declined" }
            "pause", "resume" -> {
                val r = api.post<AllDone>("/api/downloads/all", buildJsonObject { put("op", act) })
                when { r.done.isEmpty() && r.failed.isNotEmpty() -> "Could not reach " + r.failed.joinToString(); r.done.isEmpty() -> "No download apps to ${act}"
                    else -> (if (act == "pause") "Paused " else "Resumed ") + r.done.joinToString() + if (r.failed.isEmpty()) "" else " (not ${r.failed.size} others)" }
            }
            else -> "Unknown button"
        }
    }

    companion object {
        private const val ACT = "act"; private const val REF = "ref"; private const val NID = "nid"

        /** Which buttons a notification gets (a label and what it does). */
        fun actionsFor(kind: String, ref: String, admin: Boolean): List<Pair<String, String>> = when {
            !admin -> emptyList()
            kind == "request" && ref.isNotBlank() -> listOf("Approve" to "approve", "Decline" to "decline")
            kind == "download" || kind == "problem" -> listOf("Pause all" to "pause")
            else -> emptyList()
        }

        fun intent(ctx: Context, nid: Int, act: String, ref: String): PendingIntent =
            PendingIntent.getBroadcast(ctx, nid * 4 + act.hashCode() % 4, Intent(ctx, NotifyAction::class.java).putExtra(ACT, act).putExtra(REF, ref).putExtra(NID, nid),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}

@kotlinx.serialization.Serializable data class AllDone(val op: String = "", val done: List<String> = emptyList(), val failed: List<String> = emptyList())

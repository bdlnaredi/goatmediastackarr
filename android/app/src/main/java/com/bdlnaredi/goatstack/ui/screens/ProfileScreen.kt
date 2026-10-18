package com.bdlnaredi.goatstack.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.Profile2
import com.bdlnaredi.goatstack.data.Usage
import com.bdlnaredi.goatstack.data.User
import com.bdlnaredi.goatstack.ui.Avatar
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.Bar
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.Poster
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.StatTile
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream

/** Makes a picture small enough to send: at most 512 pixels on its longest side, as a JPEG. */
private fun shrink(ctx: android.content.Context, uri: Uri): ByteArray {
    val cr = ctx.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 512) sample *= 2
    val bmp = cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        ?: throw IllegalArgumentException("That file is not a picture this phone can read")
    val scale = 512f / maxOf(bmp.width, bmp.height)
    val out = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
    return ByteArrayOutputStream().use { o -> out.compress(Bitmap.CompressFormat.JPEG, 86, o); o.toByteArray() }
}

/**
 * A person's profile: picture, what their requests take on the server's disks, how much they watched, and (for an
 * admin looking at someone else) the space limit. [uid] null means the signed-in person.
 */
@Composable
fun ProfileScreen(uid: String?) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val own = uid == null || uid == ctx.user.id
    val usage = rememberLoad(uid) { ctx.api.get<Usage>(if (own) "/api/usage" else "/api/users/$uid/usage") }
    val other = rememberLoad(uid) { if (own) null else ctx.api.get<List<Profile2>>("/api/users").firstOrNull { it.id == uid } }
    var uploading by remember { mutableStateOf(false) }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            uploading = true
            scope.launch {
                try {
                    val bytes = withContext(Dispatchers.IO) { shrink(context, uri) }
                    val u = ctx.api.json.decodeFromString(User.serializer(), ctx.api.call("PUT", "/api/me/avatar",
                        buildJsonObject { put("type", "image/jpeg"); put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)) }.toString()))
                    ctx.app.updateUser(u); toast("Picture saved")
                } catch (e: Exception) { toast(e.message ?: "Could not save the picture") }
                uploading = false
            }
        }
    }

    val name = if (own) ctx.user.name else other.value?.name ?: usage.value?.name ?: ""
    val avatar = if (own) ctx.user.avatar else other.value?.avatar.orEmpty()
    val role = if (own) ctx.user.role else other.value?.role ?: "user"
    val plex = if (own) ctx.user.plex?.name else other.value?.plex?.name

    Column(Modifier.fillMaxSize()) {
        BackPage(if (own) "Your profile" else "Profile", null)
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box {
                        Avatar(avatar, name, 112.dp)
                        if (uploading) Box(Modifier.size(112.dp).clip(CircleShape).background(g.bg.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = g.primary)
                        }
                        if (own) IconButton(enabled = !uploading, onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                            modifier = Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 4.dp).size(38.dp).clip(CircleShape).background(g.primary)) {
                            Icon(Icons.Rounded.CameraAlt, "Change picture", tint = g.onPrimary, modifier = Modifier.size(20.dp))
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(name, style = MaterialTheme.typography.headlineSmall, color = g.text)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                        Badge(if (role == "admin") "Admin" else "Member", if (role == "admin") g.primary else g.muted)
                        if (plex != null) Badge("Plex: $plex", g.warn)
                    }
                    if (own && avatar.isNotEmpty()) GhostButton("Remove picture", icon = Icons.Rounded.Delete, color = g.muted, modifier = Modifier.padding(top = 10.dp), onClick = {
                        scope.launch {
                            try { ctx.app.updateUser(ctx.api.json.decodeFromString(User.serializer(), ctx.api.call("DELETE", "/api/me/avatar"))); toast("Picture removed") }
                            catch (e: Exception) { toast(e.message ?: "That did not work") }
                        }
                    })
                }
            }
            item {
                LoadView(usage) { u -> UsageCards(u, own, role == "admin", reload = usage.reload) }
            }
        }
    }
}

@Composable
private fun UsageCards(u: Usage, own: Boolean, isAdmin: Boolean, reload: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        u.stream?.let { st ->
            SectionTitle("Streaming this month", Modifier.padding(top = 6.dp), trailing = { Icon(Icons.Rounded.Wifi, null, tint = g.primary, modifier = Modifier.size(18.dp)) })
            StreamCard(st, own, isAdmin)
            if (!own && ctx.user.admin && !isAdmin) StreamLimitEditor(u.id, st, reload)
        }
        SectionTitle("Space on the server", Modifier.padding(top = 6.dp), trailing = { Icon(Icons.Rounded.Storage, null, tint = g.primary, modifier = Modifier.size(18.dp)) })
        GoatCard(Modifier.fillMaxWidth()) {
            val used = u.space?.bytes ?: 0L
            val limit = u.limitGb.toLong() * 1_000_000_000L
            Text(Format.gb(used), style = MaterialTheme.typography.headlineMedium, color = g.text)
            Text(when {
                u.space == null -> "Could not read the library just now."
                limit > 0 -> "used of ${u.limitGb} GB" + if (used >= limit) " · the limit is reached, new requests wait" else " · ${Format.gb(limit - used)} left"
                isAdmin -> "taken by what ${if (own) "you" else "they"} asked for. Admins have no limit."
                else -> "taken by what ${if (own) "you" else "they"} asked for · no limit set"
            }, style = MaterialTheme.typography.bodySmall, color = if (limit in 1..used) g.bad else g.muted)
            if (limit > 0) {
                Spacer(Modifier.height(10.dp))
                val f = (used.toDouble() / limit).toFloat().coerceIn(0f, 1f)
                Bar(f, color = if (f >= 1f) g.bad else if (f > 0.8f) g.warn else g.primary, height = 8.dp)
            }
            Text("Counted from the shows and movies ${if (own) "you" else "they"} requested, as they are on the disks now.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 10.dp))
        }
        if (!own && ctx.user.admin && !isAdmin) LimitEditor(u, reload)

        SectionTitle("Requests", Modifier.padding(top = 6.dp), trailing = { Icon(Icons.Rounded.Inbox, null, tint = g.primary, modifier = Modifier.size(18.dp)) })
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("In all", "${u.requests.total}", Modifier.weight(1f))
            StatTile("30 days", "${u.requests.month}", Modifier.weight(1f), tint = g.accent)
            StatTile("Waiting", "${u.requests.pending}", Modifier.weight(1f), tint = g.warn)
        }
        u.reqLimit?.let { Text("Limit: ${it.n} request${if (it.n == 1) "" else "s"} every ${if (it.days == 1) "day" else "${it.days} days"}.", style = MaterialTheme.typography.bodySmall, color = g.muted) }

        val w = u.watch
        if (w != null) {
            SectionTitle("Watching", Modifier.padding(top = 6.dp), trailing = { Icon(Icons.Rounded.PlayCircle, null, tint = g.primary, modifier = Modifier.size(18.dp)) })
            if (w.isEmpty()) Text("Tautulli has no plays for this Plex account yet.", style = MaterialTheme.typography.bodySmall, color = g.muted)
            else Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(1 to "Today", 7 to "7 days", 30 to "30 days").forEach { (d, label) ->
                    val x = w.firstOrNull { it.days == d }
                    StatTile(label, Format.hours(x?.seconds ?: 0), Modifier.weight(1f), tint = g.good)
                }
            }
            w.firstOrNull { it.days == 0 }?.let { Text("${it.plays} plays and ${Format.hours(it.seconds)} in all.", style = MaterialTheme.typography.bodySmall, color = g.muted) }
        }

        val items = u.space?.items.orEmpty().filter { it.size > 0 }
        if (items.isNotEmpty()) {
            SectionTitle("Taking the most space", Modifier.padding(top = 6.dp))
            items.take(8).forEach { x ->
                GoatCard(Modifier.fillMaxWidth(), padding = 10.dp, onClick = { ctx.title(x.mediaType, x.mediaId) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Poster(x.poster, x.title, Modifier.width(40.dp), corner = 8.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(x.title, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOf(if (x.mediaType == "tv") "Show" else "Movie", x.year).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = g.muted)
                        }
                        Text(Format.gb(x.size), style = MaterialTheme.typography.labelLarge, color = g.primary)
                    }
                }
            }
        }
        if (own) GhostButton("Signed in on ${u.devices} device${if (u.devices == 1) "" else "s"}", icon = Icons.Rounded.Devices, modifier = Modifier.fillMaxWidth().padding(top = 6.dp), onClick = { ctx.go("devices") })
    }
}

/** For an admin: how much disk space this person's requests may take. 0 means no limit. */
@Composable
private fun LimitEditor(u: Usage, reload: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var text by remember(u.limitGb) { mutableStateOf(if (u.limitGb > 0) u.limitGb.toString() else "") }
    var busy by remember { mutableStateOf(false) }
    GoatCard(Modifier.fillMaxWidth()) {
        Text("Space limit", style = MaterialTheme.typography.titleSmall, color = g.text)
        Text("When their requests take this much, new requests are refused until you raise it or remove something. Leave empty for no limit.",
            style = MaterialTheme.typography.bodySmall, color = g.muted)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            GoatField(text, { v -> text = v.filter { it.isDigit() }.take(7) }, "GB", Icons.Rounded.Storage, Modifier.weight(1f), keyboard = KeyboardType.Number, ime = ImeAction.Done)
            Spacer(Modifier.width(10.dp))
            GhostButton(if (busy) "Saving…" else "Save", icon = Icons.Rounded.Save, enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        ctx.api.send("PUT", "/api/users/${u.id}", buildJsonObject { put("dataLimit", text.toIntOrNull() ?: 0) })
                        toast(if ((text.toIntOrNull() ?: 0) > 0) "Limit set to $text GB" else "No limit now"); reload()
                    } catch (e: Exception) { toast(e.message ?: "That did not work") }
                    busy = false
                }
            })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            listOf(50, 250, 1000).forEach { n -> androidx.compose.material3.SuggestionChip(onClick = { text = n.toString() }, label = { Text(if (n >= 1000) "${n / 1000} TB" else "$n GB") }) }
        }
    }
}

/** How much has been streamed from Plex and Jellyfin this month, against the limit, with the last few months. */
@Composable
private fun StreamCard(st: com.bdlnaredi.goatstack.data.StreamUse, own: Boolean, isAdmin: Boolean) {
    val g = LocalGoat.current
    val limit = (st.limitGb * 1e9).toLong()
    val f = if (limit > 0) (st.bytes.toDouble() / limit).toFloat().coerceIn(0f, 1f) else 0f
    val resets = if (st.resets > 0) java.time.Instant.ofEpochMilli(st.resets).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
        .format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.getDefault())) else "the 1st"
    GoatCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(Format.gb(st.bytes), style = MaterialTheme.typography.headlineMedium, color = g.text)
            if (limit > 0) Text("  of ${Format.limit(st.limitGb)}", style = MaterialTheme.typography.titleMedium, color = g.muted, modifier = Modifier.padding(bottom = 3.dp))
        }
        Text(when {
            isAdmin -> "Admins have no streaming limit."
            limit <= 0 -> "No limit for ${if (own) "you" else "them"}."
            st.bytes >= limit -> "The limit is reached. Streams are stopped until $resets."
            else -> "${Format.gb(limit - st.bytes)} left · starts again on $resets" + if (!st.custom) " · the server's default" else ""
        }, style = MaterialTheme.typography.bodySmall, color = if (limit in 1..st.bytes) g.bad else g.muted)
        if (limit > 0) {
            Spacer(Modifier.height(10.dp))
            Bar(f, color = if (f >= 1f) g.bad else if (f >= 0.8f) g.warn else g.primary, height = 8.dp)
        }
        Text(if (st.wanOnly) "Only streams from outside the home count (${Format.gb(st.all)} in all this month)."
            else "Everything played from Plex and Jellyfin counts" + if (st.wan > 0) ", ${Format.gb(st.wan)} of it from outside the home." else ".",
            style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(top = 10.dp))
        val hist = st.history.filter { it.month != st.month || it.bytes > 0 }
        if (hist.size > 1) {
            Spacer(Modifier.height(12.dp))
            val top = (hist.maxOf { it.bytes }.coerceAtLeast(limit)).coerceAtLeast(1)
            Row(Modifier.fillMaxWidth().height(70.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
                hist.forEach { m ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.fillMaxWidth().height((48f * m.bytes / top).coerceAtLeast(2f).dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                            .background(if (m.month == st.month) g.primary else g.line))
                        Text(Format.month(m.month, short = true), style = MaterialTheme.typography.labelSmall, color = g.muted)
                    }
                }
            }
        }
    }
}

/** For an admin: this person's monthly streaming limit — the server default, their own number, or none. */
@Composable
private fun StreamLimitEditor(uid: String, st: com.bdlnaredi.goatstack.data.StreamUse, reload: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var mode by remember(st) { mutableStateOf(if (!st.custom) "default" else if (st.limitGb <= 0) "none" else "own") }
    var text by remember(st) { mutableStateOf(if (st.custom && st.limitGb > 0) st.limitGb.toString().removeSuffix(".0") else "") }
    var busy by remember { mutableStateOf(false) }
    fun save(v: Double?) {
        busy = true
        scope.launch {
            try {
                ctx.api.send("PUT", "/api/users/$uid", buildJsonObject { if (v == null) put("streamLimit", kotlinx.serialization.json.JsonNull) else put("streamLimit", v) })
                toast(when { v == null -> "Uses the default now"; v <= 0 -> "No streaming limit now"; else -> "Limit set to ${Format.limit(v)} a month" }); reload()
            } catch (e: Exception) { toast(e.message ?: "That did not work") }
            busy = false
        }
    }
    GoatCard(Modifier.fillMaxWidth()) {
        Text("Streaming limit", style = MaterialTheme.typography.titleSmall, color = g.text)
        Text("What they may stream each month. At the limit their Plex and Jellyfin streams are stopped, with a message, until the 1st.", style = MaterialTheme.typography.bodySmall, color = g.muted)
        Spacer(Modifier.height(10.dp))
        com.bdlnaredi.goatstack.ui.ChoiceRow(listOf("default" to "Default (${Format.limit(st.defaultGb)})", "own" to "Their own", "none" to "No limit"), mode, { m ->
            mode = m; if (m == "default") save(null) else if (m == "none") save(0.0)
        })
        if (mode == "own") {
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                GoatField(text, { v -> text = v.filter { it.isDigit() || it == '.' }.take(9) }, "GB a month", Icons.Rounded.Wifi, Modifier.weight(1f), keyboard = KeyboardType.Decimal, ime = ImeAction.Done)
                Spacer(Modifier.width(10.dp))
                GhostButton(if (busy) "Saving…" else "Save", icon = Icons.Rounded.Save, enabled = !busy && (text.toDoubleOrNull() ?: 0.0) > 0, onClick = { save(text.toDoubleOrNull()) })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                listOf(50, 200, 500).forEach { n -> androidx.compose.material3.SuggestionChip(onClick = { text = n.toString() }, label = { Text("$n GB") }) }
            }
        }
    }
}

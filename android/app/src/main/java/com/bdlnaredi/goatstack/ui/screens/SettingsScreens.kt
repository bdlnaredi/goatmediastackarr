package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.SyncAlt
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bdlnaredi.goatstack.BuildConfig
import com.bdlnaredi.goatstack.data.Device
import com.bdlnaredi.goatstack.data.Prefs
import com.bdlnaredi.goatstack.ui.Avatar
import com.bdlnaredi.goatstack.ui.Badge
import com.bdlnaredi.goatstack.ui.ChoiceRow
import com.bdlnaredi.goatstack.ui.EmptyState
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.SectionTitle
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.GoatPalette
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import com.bdlnaredi.goatstack.ui.theme.Themes
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val RELEASES = "https://github.com/bdlnaredi/goatmediastackarr/releases/latest"
private const val ISSUES = "https://github.com/bdlnaredi/goatmediastackarr/issues"

@Composable
private fun ThemeCard(p: GoatPalette, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val g = LocalGoat.current
    val shape = RoundedCornerShape(20.dp)
    Column(modifier.clip(shape).border(if (selected) 2.dp else 1.dp, if (selected) g.primary else g.line, shape).clickable(onClick = onClick)) {
        // A tiny picture of the theme: its background, a card, a poster row and its highlight colour.
        Box(Modifier.fillMaxWidth().height(96.dp).background(p.bg).padding(10.dp)) {
            Column {
                Box(Modifier.width(56.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.text.copy(alpha = 0.85f)))
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    repeat(3) { i -> Box(Modifier.width(22.dp).height(32.dp).clip(RoundedCornerShape(5.dp)).background(if (i == 0) p.primary else p.card)) }
                }
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.card)) {
                    Box(Modifier.fillMaxWidth(0.6f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(p.primary))
                }
            }
            if (selected) Box(Modifier.align(Alignment.TopEnd).size(22.dp).clip(CircleShape).background(p.primary), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Check, null, tint = p.onPrimary, modifier = Modifier.size(15.dp))
            }
        }
        Column(Modifier.fillMaxWidth().background(g.card).padding(10.dp)) {
            Text(p.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1)
            Text(p.blurb, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A row in a settings card: an icon, a title with a line under it, and something on the right (or an arrow when it opens something). */
@Composable
private fun SettingRow(icon: ImageVector, title: String, text: String? = null, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val g = LocalGoat.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = g.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = g.text)
            if (!text.isNullOrBlank()) Text(text, style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        when {
            trailing != null -> trailing()
            onClick != null -> Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = g.muted)
        }
    }
}

@Composable
private fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) {
    val g = LocalGoat.current
    Switch(on, onChange, colors = SwitchDefaults.colors(checkedTrackColor = g.primary, checkedThumbColor = g.onPrimary))
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = LocalGoat.current.muted, modifier = Modifier.padding(start = 20.dp, top = 6.dp, bottom = 6.dp))
}

@Composable
fun SettingsScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val uri = LocalUriHandler.current
    val theme by ctx.app.theme.collectAsStateWithLifecycle()
    val prefs by ctx.app.prefs.collectAsStateWithLifecycle()
    var signOut by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<String?>(null) }
    val themes = Themes.all.filter { !it.dynamic || android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S }
    val set = { p: Prefs -> ctx.app.setPrefs(p) }
    val hasPassword = ctx.user.plex == null

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item { BackPage("Settings", null) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), onClick = { ctx.profile() }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(ctx.user.avatar, ctx.user.name, 48.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(ctx.user.name, style = MaterialTheme.typography.titleMedium, color = g.text)
                        Text("Picture, space used and watch time", style = MaterialTheme.typography.bodySmall, color = g.muted)
                    }
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = g.muted)
                }
            }
        }

        item { SectionTitle("Appearance", Modifier.padding(top = 10.dp), trailing = { Icon(Icons.Rounded.Palette, null, tint = g.primary, modifier = Modifier.size(18.dp)) }) }
        themes.chunked(2).forEach { pair ->
            item(key = "t" + pair.first().id) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { p -> ThemeCard(p, p.id == theme, Modifier.weight(1f)) { ctx.app.setTheme(p.id) } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }

        item { SectionTitle("On this phone", Modifier.padding(top = 10.dp), trailing = { Icon(Icons.Rounded.Tune, null, tint = g.primary, modifier = Modifier.size(18.dp)) }) }
        item {
            Label("Open the app on")
            ChoiceRow(listOf("home" to "Home", "discover" to "Discover", "library" to "Library", "downloads" to "Downloads"), prefs.start, { set(prefs.copy(start = it)) })
            Label("Poster size")
            ChoiceRow(listOf("small" to "Small", "normal" to "Normal", "large" to "Large"), prefs.posters, { set(prefs.copy(posters = it)) })
            Label("Downloads update")
            ChoiceRow(listOf("fast" to "Fast", "normal" to "Normal", "slow" to "Saves battery"), prefs.refresh, { set(prefs.copy(refresh = it)) })
            Spacer(Modifier.height(6.dp))
        }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.Lock, "Hide episode stories", "Only show what an episode is about after you tap it") { Toggle(prefs.spoilers) { set(prefs.copy(spoilers = it)) } }
                SettingRow(Icons.Rounded.Security, "Ask before removing a download", "A safety check before anything is taken out of qBittorrent") { Toggle(prefs.confirmRemove) { set(prefs.copy(confirmRemove = it)) } }
            }
        }
        item { Text("The start page is used the next time the app opens.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }

        item { SectionTitle("Account", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.Key, "Signed in as", ctx.user.name + (if (ctx.user.admin) " (admin)" else "") + (ctx.user.plex?.let { " · with Plex as ${it.name}" } ?: ""))
                if (hasPassword) SettingRow(Icons.Rounded.Lock, "Change password", "Signs you out on your other devices", onClick = { dialog = "password" })
                if (hasPassword) SettingRow(Icons.Rounded.Email, "Recovery email", ctx.user.email.ifEmpty { "Not set. Needed to reset a forgotten password." }, onClick = { dialog = "email" })
                SettingRow(Icons.Rounded.Security, "Two-step sign-in", if (ctx.user.twofa) "On" else if (hasPassword) "Off. Turn it on from the web page under Settings → Account." else "Plex looks after your sign-in")
                SettingRow(Icons.Rounded.Notifications, "Phone messages", ctx.user.notify.ifEmpty { "Get told when a request is ready (ntfy, Gotify, or any web address)" }, onClick = { dialog = "notify" })
                SettingRow(Icons.Rounded.Devices, "Signed-in devices", "See them, and sign out the ones you do not use", onClick = { ctx.go("devices") })
                Spacer(Modifier.height(6.dp))
                GhostButton("Sign out", icon = Icons.AutoMirrored.Rounded.Logout, color = g.bad, modifier = Modifier.fillMaxWidth(), onClick = { signOut = true })
            }
        }

        item { SectionTitle("Server", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.Dns, "Address", ctx.app.server)
                SettingRow(Icons.Rounded.Dns, "Version", ctx.me.version + if (ctx.me.goat) " · GoatMediaStackarr" else "")
                SettingRow(Icons.Rounded.Language, "Open the web page", "Everything the app does not have yet", onClick = { runCatching { uri.openUri(ctx.app.server) } })
                Spacer(Modifier.height(6.dp))
                GhostButton("Use a different server", icon = Icons.Rounded.SyncAlt, modifier = Modifier.fillMaxWidth(), onClick = { ctx.app.forgetServer() })
            }
        }

        item { SectionTitle("About", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.PhoneAndroid, "GoatStack app", "Version ${BuildConfig.VERSION_NAME}")
                SettingRow(Icons.Rounded.SystemUpdate, "Get the newest app", "Download it from the latest release", onClick = { runCatching { uri.openUri(RELEASES) } })
                SettingRow(Icons.Rounded.BugReport, "Report a problem", "On GitHub", onClick = { runCatching { uri.openUri(ISSUES) } })
            }
        }
    }
    if (signOut) Confirm("Sign out?", "You will need to sign in again on this phone.", "Sign out", danger = true, onYes = { signOut = false; ctx.app.logout() }, onNo = { signOut = false })
    when (dialog) {
        "password" -> PasswordDialog { dialog = null }
        "email" -> EmailDialog { dialog = null }
        "notify" -> NotifyDialog { dialog = null }
    }
}

@Composable
private fun PasswordDialog(onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var old by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text("Change password") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                GoatField(old, { old = it }, "Current password", Icons.Rounded.Lock, password = true)
                GoatField(new, { new = it }, "New password (8 or more)", Icons.Rounded.Key, password = true)
                GoatField(again, { again = it }, "New password again", Icons.Rounded.Key, password = true, ime = ImeAction.Done)
                if (error != null) Text(error!!, color = g.bad)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && old.isNotEmpty() && new.length >= 8, onClick = {
                if (new != again) { error = "The two new passwords are not the same"; return@TextButton }
                busy = true; error = null
                scope.launch {
                    try { ctx.api.send("POST", "/api/password", buildJsonObject { put("old", old); put("new", new) }); toast("Password changed"); onClose() }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Saving…" else "Change", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

@Composable
private fun EmailDialog(onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var email by remember { mutableStateOf(ctx.user.email) }
    var pass by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text("Recovery email") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("A reset link goes here if you forget your password. Leave it empty to remove it.", style = MaterialTheme.typography.bodySmall, color = g.muted)
                GoatField(email, { email = it }, "Email", Icons.Rounded.Email, keyboard = KeyboardType.Email)
                GoatField(pass, { pass = it }, "Your password", Icons.Rounded.Lock, password = true, ime = ImeAction.Done)
                if (error != null) Text(error!!, color = g.bad)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && pass.isNotEmpty(), onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        ctx.api.send("PUT", "/api/me/email", buildJsonObject { put("email", email.trim()); put("password", pass) })
                        ctx.app.updateUser(ctx.user.copy(email = email.trim())); toast("Saved"); onClose()
                    } catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Saving…" else "Save", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

@Composable
private fun NotifyDialog(onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var url by remember { mutableStateOf(ctx.user.notify) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun save(test: Boolean) {
        busy = true; error = null
        scope.launch {
            try {
                ctx.api.send("PUT", "/api/me/notify", buildJsonObject { put("url", url.trim()) })
                ctx.app.updateUser(ctx.user.copy(notify = url.trim()))
                if (test) { ctx.api.send("POST", "/api/me/notify/test"); toast("Test message sent") } else { toast("Saved"); onClose() }
            } catch (e: Exception) { error = e.message }
            busy = false
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text("Phone messages") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("A message is sent to this address when something you asked for is ready. For example an ntfy topic: https://ntfy.sh/your-topic", style = MaterialTheme.typography.bodySmall, color = g.muted)
                GoatField(url, { url = it }, "https://…", Icons.Rounded.Notifications, keyboard = KeyboardType.Uri, ime = ImeAction.Done)
                if (error != null) Text(error!!, color = g.bad)
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = { save(false) }) { Text(if (busy) "Saving…" else "Save", color = g.primary) } },
        dismissButton = {
            Row {
                TextButton(enabled = !busy && url.isNotBlank(), onClick = { save(true) }) { Text("Send a test", color = g.text) }
                TextButton(onClick = onClose, enabled = !busy) { Text("Cancel", color = g.muted) }
            }
        },
    )
}

/** Where this profile is signed in, newest first. Any of them (except this phone) can be signed out. */
@Composable
fun DevicesScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val data = rememberLoad { ctx.api.get<List<Device>>("/api/sessions") }
    fun revoke(body: kotlinx.serialization.json.JsonObject, ok: String) {
        scope.launch { try { ctx.api.send("POST", "/api/sessions/revoke", body); toast(ok); data.reload() } catch (e: Exception) { toast(e.message ?: "That did not work") } }
    }
    androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
        BackPage("Signed-in devices", null)
        LoadView(data) { list ->
            if (list.isEmpty()) EmptyState(Icons.Rounded.Devices, "No devices", "Nothing else is signed in.")
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(list, key = { it.id }) { d ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Devices, null, tint = if (d.current) g.primary else g.muted)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(d.device.ifBlank { "Unknown device" }, style = MaterialTheme.typography.titleSmall, color = g.text)
                                Text(listOf(d.ip, if (d.seen > 0) "last used " + Format.ago(d.seen) else "").filter { it.isNotBlank() }.joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall, color = g.muted)
                            }
                            if (d.current) Badge("This phone", g.good)
                            else IconButton(onClick = { revoke(buildJsonObject { put("id", d.id) }, "Signed out") }) { Icon(Icons.AutoMirrored.Rounded.Logout, "Sign out ${d.device}", tint = g.muted) }
                        }
                    }
                }
                if (list.count { !it.current } > 1) item {
                    GhostButton("Sign out every other device", icon = Icons.AutoMirrored.Rounded.Logout, color = g.bad, modifier = Modifier.fillMaxWidth(),
                        onClick = { revoke(buildJsonObject { put("others", true) }, "Every other device is signed out") })
                }
            }
        }
    }
}


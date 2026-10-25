package com.bdlnaredi.goatstack.ui.screens

import com.bdlnaredi.goatstack.data.tr
import androidx.compose.runtime.LaunchedEffect
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

/** A small drawing of a style, in the current theme's colours: how its cards, posters and corners look. */
@Composable
private fun StyleCard(st: com.bdlnaredi.goatstack.ui.theme.GoatStyle, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val g = LocalGoat.current
    val shape = RoundedCornerShape(20.dp)
    val c = st.corner / 3
    Column(modifier.clip(shape).border(if (selected) 2.dp else 1.dp, if (selected) g.primary else g.line, shape).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(96.dp).background(g.styledBg(st)).padding((10 * st.density).dp)) {
            when (st.id) {
                "cinema" -> Column {
                    Box(Modifier.width(60.dp).height(9.dp).clip(RoundedCornerShape(3.dp)).background(g.text))
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { repeat(3) { i -> Box(Modifier.width(30.dp).height(44.dp).clip(RoundedCornerShape(4.dp)).background(if (i == 0) g.primary else g.accent.copy(alpha = 0.6f - i * 0.15f))) } }
                }
                "dash" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { repeat(3) { Box(Modifier.width(34.dp).height(26.dp).clip(RoundedCornerShape(3.dp)).background(g.card).border(1.dp, g.line, RoundedCornerShape(3.dp))) } }
                    Box(Modifier.fillMaxWidth().height(30.dp).clip(RoundedCornerShape(3.dp)).background(g.card).border(1.dp, g.line, RoundedCornerShape(3.dp)))
                }
                "glass" -> Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(g.primary.copy(alpha = 0.55f), g.accent.copy(alpha = 0.45f))))) {
                    Box(Modifier.padding(8.dp).width(54.dp).height(40.dp).clip(RoundedCornerShape(12.dp)).background(androidx.compose.ui.graphics.Color.White.copy(alpha = 0.22f)).border(1.dp, androidx.compose.ui.graphics.Color.White.copy(alpha = 0.4f), RoundedCornerShape(12.dp)))
                }
                else -> Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(c)).background(g.primary))
                    repeat(4) { Box(Modifier.fillMaxWidth(if (it == 3) 0.6f else 1f).height(8.dp).clip(RoundedCornerShape(c)).background(g.card)) }
                }
            }
            if (selected) Box(Modifier.align(Alignment.TopEnd).size(22.dp).clip(CircleShape).background(g.primary), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Check, null, tint = g.onPrimary, modifier = Modifier.size(15.dp))
            }
        }
        Column(Modifier.fillMaxWidth().background(g.card).padding(10.dp)) {
            Text(st.name, style = MaterialTheme.typography.titleSmall, color = g.text, maxLines = 1)
            Text(st.blurb, style = MaterialTheme.typography.labelSmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}
private fun GoatPalette.styledBg(st: com.bdlnaredi.goatstack.ui.theme.GoatStyle) = if (st.id == "cinema" && dark) androidx.compose.ui.graphics.Color(0xFF050506) else bg

/** A row in a settings card: an icon, a title with a line under it, and something on the right (or an arrow when it opens something). */
@Composable
private fun SettingRow(icon: ImageVector, title: String, text: String? = null, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val g = LocalGoat.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = g.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(tr(title), style = MaterialTheme.typography.bodyLarge, color = g.text)
            if (!text.isNullOrBlank()) Text(tr(text), style = MaterialTheme.typography.bodySmall, color = g.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
    Text(tr(text), style = MaterialTheme.typography.labelLarge, color = LocalGoat.current.muted, modifier = Modifier.padding(start = 20.dp, top = 6.dp, bottom = 6.dp))
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
    // Plex profiles sign in only through Plex; an admin who linked Plex keeps their password too.
    val hasPassword = ctx.user.plex == null || ctx.user.admin

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

        item { SectionTitle("Style", Modifier.padding(top = 10.dp)) }
        com.bdlnaredi.goatstack.ui.theme.Styles.all.chunked(2).forEach { pair ->
            item(key = "s" + pair.first().id) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { st -> StyleCard(st, st.id == prefs.style, Modifier.weight(1f)) { set(prefs.copy(style = st.id)) } }
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
            Label("Language")
            ChoiceRow(com.bdlnaredi.goatstack.data.I18n.LANGS, prefs.lang, { set(prefs.copy(lang = it)) })
            Spacer(Modifier.height(6.dp))
        }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.Lock, "Hide episode stories", "Only show what an episode is about after you tap it") { Toggle(prefs.spoilers) { set(prefs.copy(spoilers = it)) } }
                SettingRow(Icons.Rounded.Security, "Ask before removing a download", "A safety check before anything is taken out of qBittorrent") { Toggle(prefs.confirmRemove) { set(prefs.copy(confirmRemove = it)) } }
            }
        }
        item { Text("The start page is used the next time the app opens.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }

        item { SectionTitle("Notifications", Modifier.padding(top = 10.dp), trailing = { Icon(Icons.Rounded.Notifications, null, tint = g.primary, modifier = Modifier.size(18.dp)) }) }
        item { NotifySettings(prefs, set) }

        item { SectionTitle("Account", Modifier.padding(top = 10.dp)) }
        item {
            GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
                SettingRow(Icons.Rounded.Key, "Signed in as", ctx.user.name + (if (ctx.user.admin) " (admin)" else "") + (ctx.user.plex?.let { " · with Plex as ${it.name}" } ?: ""))
                if (hasPassword) SettingRow(Icons.Rounded.Lock, "Change password", "Signs you out on your other devices", onClick = { dialog = "password" })
                if (hasPassword) SettingRow(Icons.Rounded.Email, "Recovery email", ctx.user.email.ifEmpty { "Not set. Needed to reset a forgotten password." }, onClick = { dialog = "email" })
                if (ctx.user.admin && ctx.me.plexLogin) PlexLinkRow()
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
                val upd by ctx.app.updates.collectAsStateWithLifecycle()
                val appOld = upd?.let { it.apk.isNotEmpty() && com.bdlnaredi.goatstack.data.Versions.newer(it.latest, BuildConfig.VERSION_NAME) } == true
                SettingRow(Icons.Rounded.SystemUpdate, if (appOld) "Version ${upd?.latest} is ready" else "Get the newest app",
                    when { appOld -> "Tap to download it, then open it to install over this one"; upd?.latest?.isNotEmpty() == true -> "You have the newest app (${upd?.latest})"; else -> "Download it from the latest release" },
                    onClick = { runCatching { uri.openUri(if (appOld) upd!!.apk else RELEASES) } })
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


/** Which notifications this phone shows, how often it looks in the background, and a test. */
@Composable
private fun NotifySettings(prefs: Prefs, set: (Prefs) -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var allowed by remember { mutableStateOf(com.bdlnaredi.goatstack.data.Notify.allowed(context)) }
    val ask = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok ->
        allowed = ok; if (!ok) toast("Notifications are off for this app in Android's settings")
    }
    val kinds = prefs.kinds.split(',').filter { it.isNotEmpty() }.toSet()
    Column {
        GoatCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 10.dp) {
            SettingRow(Icons.Rounded.Notifications, "Notify me on this phone", if (prefs.notify && !allowed) "Android is blocking them: tap to allow" else "Also when the app is closed") {
                Toggle(prefs.notify && allowed) { on ->
                    set(prefs.copy(notify = on))
                    if (on && !allowed && android.os.Build.VERSION.SDK_INT >= 33) ask.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }
            }
            if (prefs.notify) {
                com.bdlnaredi.goatstack.data.Notify.KINDS.filter { !it.adminOnly || ctx.user.admin }.forEach { k ->
                    val (icon, _) = kindIcon(k.id)
                    SettingRow(icon, k.title, k.text) {
                        Toggle(k.id in kinds) { on -> set(prefs.copy(kinds = (if (on) kinds + k.id else kinds - k.id).joinToString(","))) }
                    }
                }
            }
        }
        if (prefs.notify) {
            Label("When the app is closed, look every")
            ChoiceRow(listOf(15 to "15 minutes", 30 to "30 minutes", 60 to "Hour"), prefs.every, { set(prefs.copy(every = it)) })
            Text("While the app is open it looks every 30 seconds. Android may wait a little longer to save battery.", style = MaterialTheme.typography.labelSmall, color = g.muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("Send a test", icon = Icons.Rounded.Notifications, modifier = Modifier.weight(1f), onClick = {
                    scope.launch {
                        try {
                            ctx.api.send("POST", "/api/notifications/test")
                            if (ctx.app.store.feedLast() < 0) ctx.app.store.setFeedLast(ctx.api.get<com.bdlnaredi.goatstack.data.Feed>("/api/notifications").last - 1)
                            val n = com.bdlnaredi.goatstack.data.Notify.check(context, ctx.app.store, ctx.api, prefs)
                            toast(if (n > 0) "Sent. Look at the top of your screen." else if (!allowed) "Allow notifications first" else "Sent")
                        } catch (e: Exception) { toast(e.message ?: "That did not work") }
                    }
                })
                GhostButton("See them all", modifier = Modifier.weight(1f), onClick = { ctx.go("notifications") })
            }
        }
    }
}

/** Admins: link a Plex account so "Sign in with Plex" works for this profile too (it is refused until then). */
@Composable
private fun PlexLinkRow() {
    val ctx = LocalCtx.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val android = androidx.compose.ui.platform.LocalContext.current
    var ticket by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(ticket) {
        val t = ticket ?: return@LaunchedEffect
        repeat(150) {
            kotlinx.coroutines.delay(2000)
            try { val u = ctx.app.plexLinkPoll(t); if (u != null) { ticket = null; toast("Plex linked as ${u.plex?.name ?: "you"}"); return@LaunchedEffect } }
            catch (e: Exception) { ticket = null; toast(e.message ?: "Could not link Plex"); return@LaunchedEffect }
        }
        ticket = null; toast("That took too long. Please try again.")
    }
    val linked = ctx.user.plex
    SettingRow(Icons.Rounded.Key, "Sign in with Plex",
        when { ticket != null -> "Waiting for Plex… finish signing in on the Plex page"; linked != null -> "Linked to ${linked.name}. Tap to unlink."; else -> "Not linked. Tap to link your Plex account, then you can sign in with Plex." },
        onClick = {
            if (ticket != null) return@SettingRow
            scope.launch {
                try {
                    if (linked != null) { ctx.api.send("DELETE", "/api/me/plex"); ctx.app.updateUser(ctx.user.copy(plex = null)); toast("Plex unlinked") }
                    else { val st = ctx.app.plexLinkStart(); ticket = st.ticket; openBrowser(android, st.url) }
                } catch (e: Exception) { toast(e.message ?: "That did not work") }
            }
        })
}

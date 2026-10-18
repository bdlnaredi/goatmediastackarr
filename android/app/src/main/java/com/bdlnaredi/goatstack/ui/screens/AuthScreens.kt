package com.bdlnaredi.goatstack.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.R
import com.bdlnaredi.goatstack.data.AppState
import com.bdlnaredi.goatstack.data.Me
import com.bdlnaredi.goatstack.ui.GhostButton
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The shared frame of the first screens: the emblem on a soft glow, then a card. */
@Composable
private fun AuthFrame(title: String, subtitle: String, content: @Composable () -> Unit) {
    val g = LocalGoat.current
    Box(
        Modifier.fillMaxSize().background(Brush.radialGradient(listOf(g.primary.copy(alpha = 0.22f), g.bg), radius = 1400f)),
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            Image(painterResource(R.drawable.goat_emblem), contentDescription = null, modifier = Modifier.size(132.dp))
            Spacer(Modifier.height(18.dp))
            Text("GoatMediaStackarr", style = MaterialTheme.typography.labelSmall, color = g.primary)
            Spacer(Modifier.height(6.dp))
            Text(title, style = MaterialTheme.typography.displaySmall, color = g.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyLarge, color = g.muted, textAlign = TextAlign.Center)
            Spacer(Modifier.height(28.dp))
            content()
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
fun GoatField(
    value: String, onChange: (String) -> Unit, label: String, icon: ImageVector, modifier: Modifier = Modifier,
    password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, ime: ImeAction = ImeAction.Next, onDone: () -> Unit = {},
) {
    val g = LocalGoat.current
    var show by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        leadingIcon = { Icon(icon, null, tint = g.muted) },
        trailingIcon = {
            if (password) IconButton(onClick = { show = !show }) {
                Icon(if (show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (show) "Hide" else "Show", tint = g.muted)
            }
        },
        visualTransformation = if (password && !show) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard, imeAction = ime, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }, onGo = { onDone() }, onSearch = { onDone() }),
        shape = RoundedCornerShape(16.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = g.primary, unfocusedBorderColor = g.line, focusedLabelColor = g.primary, cursorColor = g.primary,
            focusedContainerColor = g.card, unfocusedContainerColor = g.card,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun ErrorLine(text: String?) {
    if (text != null) {
        Spacer(Modifier.height(10.dp))
        Text(text, color = LocalGoat.current.bad, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth())
    }
}

// ---------- 1. Which server ----------

@Composable
fun ServerScreen(state: AppState) {
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val go = {
        if (!busy && address.isNotBlank()) {
            busy = true; error = null
            scope.launch { error = state.connect(address); busy = false }
        }
    }
    AuthFrame("Your server", "Enter the address of your GoatMediaStackarr, the same one you open in a browser.") {
        GoatCard(Modifier.fillMaxWidth(), padding = 20.dp) {
            GoatField(address, { address = it; error = null }, "Server address", Icons.Rounded.Dns, keyboard = KeyboardType.Uri, ime = ImeAction.Go, onDone = go)
            Spacer(Modifier.height(8.dp))
            Text("For example 192.168.1.10:2806 at home, or your own https address from outside.", style = MaterialTheme.typography.bodySmall, color = LocalGoat.current.muted)
            ErrorLine(error)
            Spacer(Modifier.height(18.dp))
            PrimaryButton(if (busy) "Connecting…" else "Connect", onClick = go, enabled = !busy && address.isNotBlank(), modifier = Modifier.fillMaxWidth())
        }
    }
}

// ---------- 2. Signing in ----------

private fun openBrowser(ctx: Context, url: String) {
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(url))
    } catch (_: Exception) {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@Composable
fun LoginScreen(state: AppState, me: Me) {
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var name by rememberSaveable { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var ticket by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var plexTicket by remember { mutableStateOf<String?>(null) }
    var plexUrl by remember { mutableStateOf("") }

    // While Plex's page is open, ask the server every two seconds whether Plex has said yes.
    LaunchedEffect(plexTicket) {
        val t = plexTicket ?: return@LaunchedEffect
        val until = System.currentTimeMillis() + 10 * 60_000
        while (System.currentTimeMillis() < until) {
            delay(2000)
            try { if (state.plexPoll(t)) return@LaunchedEffect } catch (e: Exception) { error = e.message; plexTicket = null; return@LaunchedEffect }
        }
        error = "The Plex sign-in timed out. Please try again."; plexTicket = null
    }

    if (me.setup) {
        AuthFrame("Almost there", "This server has no admin yet. Open it in a browser once to create the first admin, then sign in here.") {
            GhostButton("Check again", onClick = { state.refresh() }, icon = Icons.Rounded.Refresh, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            TextButton(onClick = { state.forgetServer() }) { Text("Use a different server", color = g.muted) }
        }
        return
    }

    val submit = {
        if (!busy) {
            busy = true; error = null
            scope.launch {
                try {
                    val tk = ticket
                    if (tk == null) ticket = state.login(name.trim(), pass)
                    else state.twoStep(tk, code.trim())
                } catch (e: Exception) { error = e.message }
                busy = false
            }
        }
    }

    AuthFrame(if (ticket != null) "Two-step code" else "Welcome back", if (ticket != null) "Enter the 6-digit code from your authenticator app, or a recovery code." else state.server.removePrefix("http://").removePrefix("https://")) {
        GoatCard(Modifier.fillMaxWidth(), padding = 20.dp) {
            if (plexTicket != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), color = g.primary, strokeWidth = 2.5.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Waiting for Plex… Finish signing in on the Plex page, then come back here.", color = g.text, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(14.dp))
                GhostButton("Open the Plex page again", onClick = { openBrowser(ctx, plexUrl) }, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { plexTicket = null }, modifier = Modifier.fillMaxWidth()) { Text("Cancel", color = g.muted) }
            } else if (ticket == null) {
                GoatField(name, { name = it; error = null }, "Name", Icons.Rounded.Person)
                Spacer(Modifier.height(12.dp))
                GoatField(pass, { pass = it; error = null }, "Password", Icons.Rounded.Lock, password = true, ime = ImeAction.Go, onDone = submit)
                ErrorLine(error)
                Spacer(Modifier.height(18.dp))
                PrimaryButton(if (busy) "Signing in…" else "Sign in", onClick = submit, enabled = !busy && name.isNotBlank() && pass.isNotEmpty(),
                    icon = Icons.AutoMirrored.Rounded.Login, modifier = Modifier.fillMaxWidth())
            } else {
                GoatField(code, { code = it; error = null }, "Code", Icons.Rounded.Key, keyboard = KeyboardType.Ascii, ime = ImeAction.Go, onDone = submit)
                ErrorLine(error)
                Spacer(Modifier.height(18.dp))
                PrimaryButton(if (busy) "Checking…" else "Continue", onClick = submit, enabled = !busy && code.isNotBlank(), modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { ticket = null; code = "" }, modifier = Modifier.fillMaxWidth()) { Text("Back", color = g.muted) }
            }
        }
        if (me.plexLogin && ticket == null && plexTicket == null) {
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                Box(Modifier.weight(1f).height(1.dp).background(g.line)); Text("  or  ", color = g.muted, style = MaterialTheme.typography.labelMedium); Box(Modifier.weight(1f).height(1.dp).background(g.line))
            }
            Spacer(Modifier.height(18.dp))
            PlexButton(enabled = !busy) {
                busy = true; error = null
                scope.launch {
                    try { val s = state.plexStart(); plexUrl = s.url; plexTicket = s.ticket; openBrowser(ctx, s.url) } catch (e: Exception) { error = e.message }
                    busy = false
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = { state.forgetServer() }) { Text("Use a different server", color = g.muted) }
    }
}

/** Plex's own colours, so it is recognisable as "the Plex button". */
@Composable
private fun PlexButton(enabled: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.Button(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(16.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color(0xFFE5A00D), contentColor = Color(0xFF1F1F1F)),
        modifier = Modifier.fillMaxWidth().height(52.dp),
    ) {
        Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF1F1F1F)), contentAlignment = Alignment.Center) {
            Text("›", color = Color(0xFFE5A00D), fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.width(10.dp))
        Text("Sign in with Plex", style = MaterialTheme.typography.labelLarge)
    }
}

// ---------- Server not answering ----------

@Composable
fun OfflineScreen(state: AppState, message: String) {
    AuthFrame("Can't reach your server", message) {
        PrimaryButton("Try again", onClick = { state.refresh() }, icon = Icons.Rounded.Refresh, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        GhostButton("Use a different server", onClick = { state.forgetServer() }, icon = Icons.Rounded.WifiOff, modifier = Modifier.fillMaxWidth())
    }
}

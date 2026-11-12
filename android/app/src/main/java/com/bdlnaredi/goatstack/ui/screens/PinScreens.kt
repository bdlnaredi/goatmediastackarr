package com.bdlnaredi.goatstack.ui.screens

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Pin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bdlnaredi.goatstack.R
import com.bdlnaredi.goatstack.data.AppState
import com.bdlnaredi.goatstack.data.User
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The PIN, asked for over everything when the app opens (and when it comes back after a minute away). */
@Composable
fun PinLock(state: AppState, user: User) {
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current as? Activity
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // Back leaves the app rather than getting past the PIN.
    BackHandler { activity?.moveTaskToBack(true) }
    fun press(k: String) {
        if (busy) return
        error = null
        pin = if (k == "<") pin.dropLast(1) else (pin + k).take(4)
        if (pin.length == 4) { busy = true; val p = pin
            scope.launch { val e = state.checkPin(p); if (e != null) { error = e; pin = "" }; busy = false } }
    }
    Box(Modifier.fillMaxSize().background(g.bg).clickable(remember { MutableInteractionSource() }, null) {}, contentAlignment = Alignment.Center) {
        Column(Modifier.safeDrawingPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.goat_emblem), contentDescription = null, modifier = Modifier.size(84.dp))
            Spacer(Modifier.height(14.dp))
            Text("Enter your PIN", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = g.text)
            Text(user.name, color = g.muted, modifier = Modifier.padding(top = 2.dp))
            Row(Modifier.padding(vertical = 22.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                repeat(4) { i -> Box(Modifier.size(16.dp).clip(CircleShape).border(2.dp, if (error != null) g.bad else g.text, CircleShape)
                    .background(if (i < pin.length) g.text else g.bg)) }
            }
            Text(error ?: " ", color = g.bad, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().height(40.dp))
            for (row in listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("", "0", "<"))) {
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                    for (k in row) Box(Modifier.size(72.dp).clip(CircleShape).then(if (k.isEmpty()) Modifier else Modifier.background(g.card).clickable { press(k) }),
                        contentAlignment = Alignment.Center) {
                        when (k) {
                            "" -> {}
                            "<" -> Icon(Icons.AutoMirrored.Rounded.Backspace, "Delete", tint = g.text)
                            else -> Text(k, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = g.text)
                        }
                    }
                }
            }
            TextButton(onClick = { state.logout() }, modifier = Modifier.padding(top = 10.dp)) { Text("Forgot your PIN? Sign out", color = g.muted) }
        }
    }
}

/** Settings → Account → PIN: make one, change it, or turn it off. */
@Composable
fun PinDialog(onClose: () -> Unit) {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    val on = ctx.user.pin
    var current by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val digits = { s: String -> s.filter { it.isDigit() }.take(4) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() }, containerColor = g.surface,
        title = { Text(if (on) "Change PIN" else "Create a PIN") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Asked for whenever the app or the web page opens on a device that is already signed in. Your password still signs you in. 5 wrong PINs sign that device out.",
                    color = g.muted, style = MaterialTheme.typography.bodySmall)
                if (on) GoatField(current, { current = it }, "Current PIN or password", Icons.Rounded.Lock, password = true)
                if (on) Text("Forgot it? Within 15 minutes of signing in, you can leave this empty.", color = g.muted, style = MaterialTheme.typography.labelSmall)
                GoatField(pin, { pin = digits(it) }, if (on) "New PIN (4 digits)" else "PIN (4 digits)", Icons.Rounded.Pin, password = true, keyboard = KeyboardType.NumberPassword)
                GoatField(again, { again = digits(it) }, "The same PIN again", Icons.Rounded.Key, password = true, keyboard = KeyboardType.NumberPassword, ime = ImeAction.Done)
                if (error != null) Text(error!!, color = g.bad)
                if (on) TextButton(enabled = !busy, onClick = {
                    busy = true; error = null
                    scope.launch {
                        try { ctx.api.send("DELETE", "/api/pin", buildJsonObject { put("current", current) }); ctx.app.updateUser(ctx.user.copy(pin = false)); toast("PIN turned off"); onClose() }
                        catch (e: Exception) { error = e.message; busy = false }
                    }
                }) { Text("Turn off the PIN", color = g.bad) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && pin.length == 4 && again.length == 4, onClick = {
                if (pin != again) { error = "The two PINs are not the same"; return@TextButton }
                busy = true; error = null
                scope.launch {
                    try { ctx.api.send("POST", "/api/pin", buildJsonObject { put("pin", pin); put("current", current) }); ctx.app.updateUser(ctx.user.copy(pin = true)); toast(if (on) "PIN changed" else "PIN created"); onClose() }
                    catch (e: Exception) { error = e.message; busy = false }
                }
            }) { Text(if (busy) "Saving…" else "Save", color = g.primary) }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel", color = g.muted) } },
    )
}

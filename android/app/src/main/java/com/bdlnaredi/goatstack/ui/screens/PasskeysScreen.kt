package com.bdlnaredi.goatstack.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.bdlnaredi.goatstack.data.PasskeyCancelled
import com.bdlnaredi.goatstack.data.Passkeys
import com.bdlnaredi.goatstack.data.PkItem
import com.bdlnaredi.goatstack.ui.Format
import com.bdlnaredi.goatstack.ui.GoatCard
import com.bdlnaredi.goatstack.ui.LoadView
import com.bdlnaredi.goatstack.ui.LocalCtx
import com.bdlnaredi.goatstack.ui.PrimaryButton
import com.bdlnaredi.goatstack.ui.rememberLoad
import com.bdlnaredi.goatstack.ui.theme.LocalGoat
import kotlinx.coroutines.launch

/** Your passkeys: add one on this phone (fingerprint or face), see them all, remove one. */
@Composable
fun PasskeysScreen() {
    val ctx = LocalCtx.current
    val g = LocalGoat.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = toaster()
    var again by remember { mutableIntStateOf(0) }
    var name by remember { mutableStateOf(android.os.Build.MODEL ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val list = rememberLoad("passkeys", again) { ctx.api.get<List<PkItem>>("/api/passkeys") }
    val why = Passkeys.unusable(ctx.api.base)
    Column(Modifier.fillMaxSize()) {
        BackPage("Passkeys", "Sign in with your fingerprint or face, no password")
        LoadView(list) { l ->
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    GoatCard(Modifier.fillMaxWidth(), padding = 16.dp) {
                        Text("Add a passkey on this phone", style = MaterialTheme.typography.titleSmall, color = g.text)
                        Text("It is kept by your phone's password manager (Google Password Manager, Samsung Pass…) and works in this app and in the browser at ${java.net.URI(ctx.api.base).host ?: "this address"}. A passkey also counts as the second step when two-step sign-in is on.",
                            style = MaterialTheme.typography.bodySmall, color = g.muted)
                        Spacer(Modifier.height(10.dp))
                        if (why != null) Text(why, color = g.warn, style = MaterialTheme.typography.bodySmall)
                        else {
                            OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            error?.let { Text(it, color = g.bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                            Spacer(Modifier.height(10.dp))
                            PrimaryButton(if (busy) "Adding…" else "Add a passkey", icon = Icons.Rounded.Key, enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                                busy = true; error = null
                                scope.launch {
                                    try { Passkeys.add(context, ctx.api, name.trim()); toast("Passkey added"); again++ }
                                    catch (e: PasskeyCancelled) { } catch (e: Exception) { error = e.message }
                                    busy = false
                                }
                            })
                        }
                    }
                }
                items(l, key = { it.id }) { k ->
                    GoatCard(Modifier.fillMaxWidth(), padding = 14.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(k.name, style = MaterialTheme.typography.titleSmall, color = g.text)
                                Text(k.rp + " · added " + Format.ago(k.at) + (if (k.used > 0) " · used " + Format.ago(k.used) else ""), style = MaterialTheme.typography.bodySmall, color = g.muted)
                            }
                            TextButton(onClick = {
                                scope.launch { try { ctx.api.send("DELETE", "/api/passkeys/${k.id}"); toast("Removed"); again++ } catch (e: Exception) { toast(e.message ?: "Could not remove it") } }
                            }) { Text("Remove", color = g.bad) }
                        }
                    }
                }
            }
        }
    }
}


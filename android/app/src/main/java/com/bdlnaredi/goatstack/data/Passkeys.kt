package com.bdlnaredi.goatstack.data

import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable data class PkLoginStart(val ticket: String = "", val challenge: String = "", val rpId: String = "")
@Serializable data class PkRp(val id: String = "", val name: String = "")
@Serializable data class PkUser(val id: String = "", val name: String = "", val displayName: String = "")
@Serializable data class PkRegStart(val ticket: String = "", val challenge: String = "", val rp: PkRp = PkRp(), val user: PkUser = PkUser(), val exclude: List<String> = emptyList())
@Serializable data class PkItem(val id: String = "", val name: String = "", val rp: String = "", val at: Long = 0, val used: Long = 0, val here: Boolean = false)
@Serializable data class PkAdded(val id: String = "", val name: String = "")

/** A passkey step the person stopped themselves: nothing to show. */
class PasskeyCancelled : Exception("Cancelled")

/**
 * Passkeys through Android's Credential Manager (Google Password Manager, Samsung Pass and the like). Android lets the app
 * use passkeys for the server's address only when the address vouches for the app (/.well-known/assetlinks.json, which
 * GoatMediaStackarr serves), so this works at a public https address, not a 192.168… one.
 */
object Passkeys {
    private val json = Json { ignoreUnknownKeys = true }

    /** Why passkeys cannot work with this server address, or null when they can. */
    fun unusable(server: String): String? {
        val u = runCatching { java.net.URI(server) }.getOrNull() ?: return "Passkeys need an https address."
        if (u.scheme != "https") return "Passkeys need the server's https address (your Cloudflare address, say). This app is connected over http."
        if (Regex("^[0-9.]+$|^\\[?[0-9a-fA-F:]+]?$").matches(u.host ?: "")) return "Passkeys need a name address (like goat.example.com), not a number one."
        return null
    }

    /** Signs in with a passkey on this phone. The server's reply sets the sign-in cookie. */
    suspend fun signIn(context: Context, api: Api) {
        val st = api.post<PkLoginStart>("/api/passkeys/login/start")
        val req = buildJsonObject { put("challenge", st.challenge); put("rpId", st.rpId); put("userVerification", "preferred"); put("timeout", 120000); put("allowCredentials", JsonArray(emptyList())) }
        val cred = try {
            CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(req.toString())))).credential
        } catch (e: GetCredentialCancellationException) { throw PasskeyCancelled() }
        catch (e: NoCredentialException) { throw Exception("This phone has no passkey for ${st.rpId}. Sign in with your password, then add one under Settings → Passkeys.") }
        catch (e: GetCredentialException) { throw Exception(e.errorMessage?.toString() ?: "The passkey did not work") }
        val j = json.parseToJsonElement((cred as? PublicKeyCredential ?: throw Exception("That was not a passkey")).authenticationResponseJson).jsonObject
        val r = j["response"]?.jsonObject ?: throw Exception("The passkey answer was empty")
        api.post<LoginReply>("/api/passkeys/login/finish", buildJsonObject {
            put("ticket", st.ticket); put("id", j.str("id"))
            put("clientDataJSON", r.str("clientDataJSON")); put("authenticatorData", r.str("authenticatorData")); put("signature", r.str("signature")); put("userHandle", r.str("userHandle"))
        })
    }

    /** Makes a passkey on this phone for the signed-in profile. */
    suspend fun add(context: Context, api: Api, name: String): PkAdded {
        val st = api.post<PkRegStart>("/api/passkeys/register/start")
        val req = buildJsonObject {
            put("challenge", st.challenge)
            put("rp", buildJsonObject { put("id", st.rp.id); put("name", st.rp.name) })
            put("user", buildJsonObject { put("id", st.user.id); put("name", st.user.name); put("displayName", st.user.displayName) })
            put("pubKeyCredParams", buildJsonArray { listOf(-7, -257).forEach { a -> add(buildJsonObject { put("type", "public-key"); put("alg", a) }) } })
            put("authenticatorSelection", buildJsonObject { put("residentKey", "required"); put("requireResidentKey", true); put("userVerification", "preferred") })
            put("excludeCredentials", buildJsonArray { st.exclude.forEach { id -> add(buildJsonObject { put("type", "public-key"); put("id", id) }) } })
            put("attestation", "none"); put("timeout", 120000)
        }
        val res = try {
            CredentialManager.create(context).createCredential(context, CreatePublicKeyCredentialRequest(req.toString())) as CreatePublicKeyCredentialResponse
        } catch (e: CreateCredentialCancellationException) { throw PasskeyCancelled() }
        catch (e: CreateCredentialException) { throw Exception(e.errorMessage?.toString() ?: "The passkey could not be made") }
        val j = json.parseToJsonElement(res.registrationResponseJson).jsonObject
        val r = j["response"]?.jsonObject ?: throw Exception("The passkey answer was empty")
        return api.post("/api/passkeys/register/finish", buildJsonObject {
            put("ticket", st.ticket); put("id", j.str("id")); put("name", name)
            put("clientDataJSON", r.str("clientDataJSON")); put("attestationObject", r.str("attestationObject"))
            r.str("authenticatorData").takeIf { it.isNotEmpty() }?.let { put("authenticatorData", it) }
            r.str("publicKey").takeIf { it.isNotEmpty() }?.let { put("publicKey", it) }
            (r["publicKeyAlgorithm"] as? JsonPrimitive)?.content?.toIntOrNull()?.let { put("alg", it) }
        })
    }

    private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
}

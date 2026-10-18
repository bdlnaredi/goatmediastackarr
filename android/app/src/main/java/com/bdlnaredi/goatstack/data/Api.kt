package com.bdlnaredi.goatstack.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** A problem the server or the network reported, already in words a person can read. */
class ApiError(val code: Int, message: String) : IOException(message)

/**
 * Talks to one GoatMediaStackarr server. The sign-in is the server's own `sid` cookie: it is taken from the
 * sign-in answer, kept on the phone, and sent back with every call to that server (and only that server).
 */
class Api(private val onSession: (String?) -> Unit) {
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false; isLenient = true }

    @Volatile var base: String = ""
        private set
    @Volatile var sid: String? = null
        private set

    private val _signedOut = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Fires when the server says the sign-in is no longer valid (signed out elsewhere, or expired). */
    val signedOut: SharedFlow<Unit> = _signedOut

    fun configure(server: String, session: String?) { base = server.trimEnd('/'); sid = session }

    private fun ours(url: okhttp3.HttpUrl): Boolean {
        val b = base.toHttpUrlOrNull() ?: return false
        return url.host == b.host && url.port == b.port && url.scheme == b.scheme
    }

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(70, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val req = chain.request()
            val mine = ours(req.url)
            val b = req.newBuilder().header("Accept", "application/json")
            if (mine) sid?.let { b.header("Cookie", "sid=$it") }
            val res = chain.proceed(b.build())
            if (mine) for (c in res.headers("Set-Cookie")) {
                if (c.startsWith("sid=")) {
                    val v = c.substringAfter("sid=").substringBefore(';').trim()
                    sid = v.ifEmpty { null }
                    onSession(sid)
                }
            }
            res
        }
        .build()

    private val liveClient by lazy { client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build() }

    /** A full address for something the server returned, which may be relative ("/api/artimg?..."). */
    fun abs(u: String?): String? = when {
        u.isNullOrBlank() -> null
        u.startsWith("http://") || u.startsWith("https://") -> u
        u.startsWith("/") -> base + u
        else -> null
    }

    fun mediaImage(sid: String, type: String, path: String): String? =
        if (path.isBlank()) null else "$base/api/$type/$sid/img?p=${enc(path)}"

    suspend fun call(method: String, path: String, body: String? = null): String = withContext(Dispatchers.IO) {
        if (base.isEmpty()) throw ApiError(0, "No server set")
        val rb = when {
            body != null -> body.toRequestBody(JSON_TYPE)
            method == "GET" || method == "DELETE" -> null
            else -> "{}".toRequestBody(JSON_TYPE)
        }
        val req = Request.Builder().url(base + path).method(method, rb).build()
        val res = try { client.newCall(req).execute() } catch (e: IOException) {
            throw ApiError(0, "Could not reach the server (${e.message ?: e.javaClass.simpleName}). Check the address and that you are on the right network.")
        }
        res.use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                if (r.code == 401 && !path.startsWith("/api/login") && !path.startsWith("/api/plexlogin")) _signedOut.tryEmit(Unit)
                throw ApiError(r.code, errorText(text) ?: "The server answered ${r.code}")
            }
            text.ifEmpty { "{}" }
        }
    }

    private fun errorText(text: String): String? = try {
        json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.contentOrNull
    } catch (_: Exception) { null }

    suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call("GET", path))
    suspend inline fun <reified T> post(path: String, body: JsonObject = JsonObject(emptyMap())): T = json.decodeFromString(call("POST", path, body.toString()))
    suspend fun send(method: String, path: String, body: JsonObject? = null) { call(method, path, body?.toString()) }

    /** The server's live feed (downloads, playing now, health), one update about every second. Reconnects by itself. */
    fun live(): Flow<Live> = flow {
        while (true) {
            try {
                val req = Request.Builder().url("$base/api/live").header("Accept", "text/event-stream").build()
                liveClient.newCall(req).execute().use { r ->
                    if (r.code == 401) { _signedOut.tryEmit(Unit); return@flow }
                    if (!r.isSuccessful) throw IOException("live ${r.code}")
                    val src = r.body!!.source()
                    while (!src.exhausted()) {
                        val line = src.readUtf8Line() ?: break
                        if (line.startsWith("data:")) {
                            val data = line.removePrefix("data:").trim()
                            if (data.isNotEmpty()) emit(json.decodeFromString<Live>(data))
                            if (com.bdlnaredi.goatstack.ui.Tuning.still) return@flow
                        }
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { }
            if (com.bdlnaredi.goatstack.ui.Tuning.still) return@flow
            delay(3000)
        }
    }.flowOn(Dispatchers.IO)

    companion object {
        val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

        /** Turns what someone typed ("192.168.1.10:2806", "goat.example.com") into a full address. */
        fun normalizeServer(input: String): String? {
            var s = input.trim()
            if (s.isEmpty()) return null
            if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s)) s = "http://$s"
            val u = s.trimEnd('/').toHttpUrlOrNull() ?: return null
            if (u.host.isBlank()) return null
            val path = u.encodedPath.trimEnd('/')
            val port = if ((u.scheme == "http" && u.port == 80) || (u.scheme == "https" && u.port == 443)) "" else ":${u.port}"
            return "${u.scheme}://${u.host}$port$path"
        }
    }
}

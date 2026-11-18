package com.bdlnaredi.goatstack

import android.content.Context
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.SessionProvider
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.security.SecureRandom

/** Chromecast: Google's own player on the TV (no receiver app of our own is needed). */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(ctx: Context): CastOptions = CastOptions.Builder().setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID).build()
    override fun getAdditionalSessionProviders(ctx: Context): List<SessionProvider>? = null
}

object Cast {
    val selector: MediaRouteSelector by lazy { MediaRouteSelector.Builder().addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)).build() }

    /** Null on a phone without Google Play services (then there is no casting). */
    @Suppress("DEPRECATION")
    fun context(ctx: Context): CastContext? = try { CastContext.getSharedInstance(ctx.applicationContext) } catch (_: Throwable) { null }

    /** The Chromecasts (and TVs with it) on this Wi-Fi, found while [onChange] is listened to. Returns a stop function. */
    fun watch(ctx: Context, onChange: (List<MediaRouter.RouteInfo>) -> Unit): () -> Unit {
        if (context(ctx) == null) { onChange(emptyList()); return {} }
        val router = MediaRouter.getInstance(ctx)
        fun now() = router.routes.filter { !it.isDefault && it.matchesSelector(selector) && it.isEnabled }
        val cb = object : MediaRouter.Callback() {
            override fun onRouteAdded(r: MediaRouter, route: MediaRouter.RouteInfo) = onChange(now())
            override fun onRouteRemoved(r: MediaRouter, route: MediaRouter.RouteInfo) = onChange(now())
            override fun onRouteChanged(r: MediaRouter, route: MediaRouter.RouteInfo) = onChange(now())
        }
        router.addCallback(selector, cb, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN)
        onChange(now())
        return { router.removeCallback(cb) }
    }

    /** Connects to [route] and plays [url] there. [done] gets null when it plays, or what went wrong. */
    fun play(ctx: Context, route: MediaRouter.RouteInfo, url: String, title: String, sub: String, done: (String?) -> Unit) {
        val cc = context(ctx) ?: return done("Casting needs Google Play services on this phone")
        val info = MediaInfo.Builder(url).setStreamType(MediaInfo.STREAM_TYPE_BUFFERED).setContentType(if (url.contains(".mkv")) "video/x-matroska" else "video/mp4")
            .setMetadata(MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply { putString(MediaMetadata.KEY_TITLE, title); if (sub.isNotEmpty()) putString(MediaMetadata.KEY_SUBTITLE, sub) }).build()
        fun load(s: CastSession) {
            val c = s.remoteMediaClient ?: return done("The TV did not answer")
            c.load(MediaLoadRequestData.Builder().setMediaInfo(info).setAutoplay(true).build()).setResultCallback { r -> done(if (r.status.isSuccess) null else "The TV could not play it (${r.status.statusCode})") }
        }
        val sm = cc.sessionManager
        val cur = sm.currentCastSession
        if (cur != null && cur.isConnected && cur.castDevice?.deviceId == com.google.android.gms.cast.CastDevice.getFromBundle(route.extras)?.deviceId) return load(cur)
        val l = object : SessionManagerListener<CastSession> {
            override fun onSessionStarted(s: CastSession, id: String) { sm.removeSessionManagerListener(this, CastSession::class.java); load(s) }
            override fun onSessionResumed(s: CastSession, was: Boolean) { sm.removeSessionManagerListener(this, CastSession::class.java); load(s) }
            override fun onSessionStartFailed(s: CastSession, e: Int) { sm.removeSessionManagerListener(this, CastSession::class.java); done("Could not connect to the TV") }
            override fun onSessionStarting(s: CastSession) {}
            override fun onSessionEnding(s: CastSession) {}
            override fun onSessionEnded(s: CastSession, e: Int) {}
            override fun onSessionResuming(s: CastSession, id: String) {}
            override fun onSessionResumeFailed(s: CastSession, e: Int) {}
            override fun onSessionSuspended(s: CastSession, r: Int) {}
        }
        sm.addSessionManagerListener(l, CastSession::class.java)
        MediaRouter.getInstance(ctx).selectRoute(route)
    }

    /** The phone's own address on the Wi-Fi, for the TV to fetch a saved video from. */
    fun wifiAddress(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
    }.getOrNull()
}

/**
 * Hands one saved video to the TV over the Wi-Fi: a tiny web server on the phone that serves only that file, at an
 * address with a random part, while casting. Seeking works (it answers ranges).
 */
object PhoneShare {
    private var server: ServerSocket? = null
    private var thread: Thread? = null

    /** Starts serving [f]; returns the address for the TV, or null without a Wi-Fi address. */
    @Synchronized fun start(f: File): String? {
        stop()
        val ip = Cast.wifiAddress() ?: return null
        val token = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val ss = ServerSocket(0)
        server = ss
        thread = Thread {
            while (!ss.isClosed) {
                val sock = runCatching { ss.accept() }.getOrNull() ?: break
                Thread { runCatching { serve(sock, f, token) }; runCatching { sock.close() } }.apply { isDaemon = true }.start()
            }
        }.apply { isDaemon = true; start() }
        return "http://$ip:${ss.localPort}/$token/" + if (f.extension == "mp4") "video.mp4" else "video.mkv"
    }

    @Synchronized fun stop() { runCatching { server?.close() }; server = null; thread = null }

    private fun serve(sock: java.net.Socket, f: File, token: String) {
        sock.soTimeout = 30_000
        val input = sock.getInputStream().bufferedReader()
        val first = input.readLine() ?: return
        val headers = generateSequence { input.readLine()?.takeIf { it.isNotEmpty() } }.toList()
        val out = sock.getOutputStream()
        val parts = first.split(" ")
        if (parts.size < 2 || !parts[1].startsWith("/$token/") || (parts[0] != "GET" && parts[0] != "HEAD")) {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return
        }
        val len = f.length()
        val range = headers.firstOrNull { it.startsWith("Range:", true) }?.substringAfter("=")?.split("-")
        val start = range?.getOrNull(0)?.toLongOrNull() ?: 0L
        val end = range?.getOrNull(1)?.toLongOrNull()?.coerceAtMost(len - 1) ?: (len - 1)
        val type = if (f.extension == "mp4") "video/mp4" else "video/x-matroska"
        val head = if (range != null) "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes $start-$end/$len\r\n" else "HTTP/1.1 200 OK\r\n"
        out.write((head + "Content-Type: $type\r\nAccept-Ranges: bytes\r\nContent-Length: ${end - start + 1}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").toByteArray())
        if (parts[0] == "HEAD") return
        f.inputStream().use { s ->
            s.skip(start); var left = end - start + 1; val buf = ByteArray(64 * 1024)
            while (left > 0) { val n = s.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (n < 0) break; out.write(buf, 0, n); left -= n }
        }
        out.flush()
    }
}

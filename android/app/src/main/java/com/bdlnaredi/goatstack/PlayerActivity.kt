package com.bdlnaredi.goatstack

import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.bdlnaredi.goatstack.data.PlayLink
import com.bdlnaredi.goatstack.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * The app's own video player. Plays a movie or episode from Plex or Jellyfin (through a short-lived link from the
 * server: the original file, or a smaller stream on mobile data), or a video saved on the phone. Seeking, audio and
 * subtitle tracks, speed, picture-in-picture, and it carries on where you stopped.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    companion object {
        private val QUALITY = listOf("orig" to "Original", "1080" to "1080p", "720" to "720p", "480" to "480p")

        /** Plays [key] from the media server [sid]; [at] is the part already watched (0 to 1). */
        fun stream(ctx: Context, sid: String, key: String, title: String, sub: String = "", at: Double = 0.0) =
            ctx.startActivity(Intent(ctx, PlayerActivity::class.java).putExtra("sid", sid).putExtra("key", key).putExtra("title", title).putExtra("sub", sub).putExtra("at", at)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

        /** Plays a video saved on the phone. */
        fun file(ctx: Context, f: File) =
            ctx.startActivity(Intent(ctx, PlayerActivity::class.java).putExtra("file", f.absolutePath).putExtra("title", f.nameWithoutExtension).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private lateinit var qualityBtn: TextView
    private lateinit var titleView: TextView
    private var sid = ""; private var key = ""; private var file: String? = null
    private var title = ""; private var sub = ""
    private var quality = "orig"
    /** For a smaller stream: where in the title the stream's time 0 is (seconds). */
    private var base = 0L
    private var duration = 0L
    private var doneSent = false
    private val prefs by lazy { getSharedPreferences("player", MODE_PRIVATE) }
    private val resumeKey get() = file?.let { "file:$it" } ?: "$sid:$key"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars()); systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        view = PlayerView(this).apply {
            setBackgroundColor(Color.BLACK); keepScreenOn = true
            setShowSubtitleButton(true); setShowNextButton(false); setShowPreviousButton(false)
            contentDescription = "Video player"
        }
        qualityBtn = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 14f; setPadding(36, 24, 36, 24); setBackgroundColor(0x66000000)
            contentDescription = "Picture quality"; isFocusable = true
            setOnClickListener { askQuality() }
        }
        titleView = TextView(this).apply { setTextColor(Color.WHITE); textSize = 16f; setPadding(36, 24, 36, 24); setShadowLayer(4f, 0f, 0f, Color.BLACK) }
        view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> qualityBtn.visibility = if (file == null) v else View.GONE; titleView.visibility = v })
        setContentView(FrameLayout(this).apply {
            addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(titleView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START))
            addView(qualityBtn, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END))
        })
        load(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); savePosition(); load(intent) }

    private fun load(i: Intent) {
        file = i.getStringExtra("file"); sid = i.getStringExtra("sid").orEmpty(); key = i.getStringExtra("key").orEmpty()
        title = i.getStringExtra("title").orEmpty(); sub = i.getStringExtra("sub").orEmpty(); doneSent = false
        titleView.text = listOf(title, sub).filter { it.isNotBlank() }.joinToString(" · ")
        val saved = prefs.getLong(resumeKey, 0L)
        val f = file
        if (f != null) { start(MediaItem.Builder().setUri(Uri.fromFile(File(f))).setMediaMetadata(meta()).build(), saved * 1000); return }
        // On mobile data a smaller stream, on Wi-Fi the original (unless chosen otherwise before).
        val metered = runCatching { (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered }.getOrDefault(false)
        quality = prefs.getString(if (metered) "q.cell" else "q.wifi", if (metered) "720" else "orig")!!
        open(if (saved > 0) saved else 0L, if (saved > 0) 0.0 else i.getDoubleExtra("at", 0.0))
    }

    /** Asks the server for a link at [quality], starting [from] seconds in (or [at], the part watched). */
    private fun open(from: Long, at: Double = 0.0) {
        qualityBtn.text = QUALITY.firstOrNull { it.first == quality }?.second ?: quality
        lifecycleScope.launch {
            try {
                val api = withContext(Dispatchers.IO) { Widgets.api(this@PlayerActivity) } ?: throw IllegalStateException("Sign in to the app first")
                val server = withContext(Dispatchers.IO) { Store(this@PlayerActivity).load().server }.trimEnd('/')
                val r = api.post<PlayLink>("/api/play", buildJsonObject { put("sid", sid); put("key", key); put("title", title); put("sub", sub); put("q", quality); put("from", from); put("at", at) })
                duration = r.duration
                base = if (r.hls) r.from else 0L
                val item = MediaItem.Builder().setUri(server + r.url).setMediaMetadata(meta())
                    .apply { if (r.hls) setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
                start(item, if (r.hls) 0L else r.from * 1000)
            } catch (e: Exception) { Toast.makeText(this@PlayerActivity, e.message ?: "Could not play that", Toast.LENGTH_LONG).show(); finish() }
        }
    }

    private fun meta() = MediaMetadata.Builder().setTitle(title).setSubtitle(sub).build()

    private fun start(item: MediaItem, at: Long) {
        val p = player ?: ExoPlayer.Builder(this).setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(30_000).build().also { p ->
            player = p; view.player = p
            p.setAudioAttributes(androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) finished() }
                override fun onPlayerError(error: PlaybackException) { Toast.makeText(this@PlayerActivity, "Could not play: ${error.errorCodeName}", Toast.LENGTH_LONG).show() }
                override fun onVideoSizeChanged(size: VideoSize) { pipParams()?.let { runCatching { setPictureInPictureParams(it) } } }
                override fun onIsPlayingChanged(playing: Boolean) { if (!playing) savePosition() }
            })
        }
        p.setMediaItem(item, at.coerceAtLeast(0)); p.prepare(); p.playWhenReady = true
    }

    /** Seconds into the title. */
    private fun position(): Long = base + (player?.currentPosition ?: 0L) / 1000
    private fun length(): Long = duration.takeIf { it > 0 } ?: player?.duration?.takeIf { it > 0 }?.let { base + it / 1000 } ?: 0L

    private fun savePosition() {
        val p = player ?: return
        if (p.playbackState == Player.STATE_IDLE) return
        val pos = position(); val len = length()
        // Near the end counts as watched: nothing to carry on from.
        if (pos < 30 || (len > 0 && pos > len * 0.95)) prefs.edit().remove(resumeKey).apply() else prefs.edit().putLong(resumeKey, pos).apply()
    }

    private fun finished() {
        prefs.edit().remove(resumeKey).apply()
        if (file == null && !doneSent) {
            doneSent = true
            lifecycleScope.launch { runCatching { Widgets.api(this@PlayerActivity)?.send("POST", "/api/play/done", buildJsonObject { put("sid", sid); put("key", key) }) } }
        }
        finish()
    }

    private fun askQuality() {
        val labels = QUALITY.map { it.second }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Picture quality")
            .setSingleChoiceItems(labels, QUALITY.indexOfFirst { it.first == quality }) { d, which ->
                d.dismiss()
                val q = QUALITY[which].first
                if (q == quality) return@setSingleChoiceItems
                quality = q
                val metered = runCatching { (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered }.getOrDefault(false)
                prefs.edit().putString(if (metered) "q.cell" else "q.wifi", q).apply()
                open(position())
            }.show()
    }

    private fun pipParams(): PictureInPictureParams? {
        val s = player?.videoSize ?: return null
        val r = if (s.width > 0 && s.height > 0) Rational(s.width, s.height).let { if (it.toFloat() > 2.39f) Rational(239, 100) else if (it.toFloat() < 0.42f) Rational(42, 100) else it } else Rational(16, 9)
        return PictureInPictureParams.Builder().setAspectRatio(r).apply { if (Build.VERSION.SDK_INT >= 31) setAutoEnterEnabled(player?.isPlaying == true) }.build()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (player?.isPlaying == true && Build.VERSION.SDK_INT < 31 && packageManager.hasSystemFeature("android.software.picture_in_picture"))
            runCatching { pipParams()?.let { enterPictureInPictureMode(it) } }
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, cfg: Configuration) {
        super.onPictureInPictureModeChanged(inPip, cfg)
        view.useController = !inPip
        qualityBtn.visibility = if (inPip || file != null) View.GONE else qualityBtn.visibility
    }

    override fun onPause() { super.onPause(); savePosition() }

    override fun onStop() {
        super.onStop()
        savePosition()
        // Left the player (or closed the small window): it stops.
        player?.pause()
        if (!isChangingConfigurations) { player?.release(); player = null; view.player = null; finish() }
    }

    override fun onDestroy() { player?.release(); player = null; super.onDestroy() }
}

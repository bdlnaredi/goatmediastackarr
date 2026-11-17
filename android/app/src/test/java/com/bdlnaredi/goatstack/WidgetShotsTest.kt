package com.bdlnaredi.goatstack

import android.app.Activity
import android.graphics.Color
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.RemoteViews
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bdlnaredi.goatstack.data.AppHealth
import com.bdlnaredi.goatstack.data.Disk
import com.bdlnaredi.goatstack.data.GoatStatus
import com.bdlnaredi.goatstack.data.Live
import com.bdlnaredi.goatstack.data.QbLive
import com.bdlnaredi.goatstack.data.QbTop
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.Vpn
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The widgets drawn on a home-screen-like background, as pictures (with the screens' pictures). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h880dp-xxhdpi")
class WidgetShotsTest {
    @Test fun widgets() {
        val act = Robolectric.buildActivity(Activity::class.java).setup().get()
        val dp = act.resources.displayMetrics.density
        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(40, 52, 78)); setPadding((16 * dp).toInt(), (24 * dp).toInt(), (16 * dp).toInt(), (24 * dp).toInt()) }
        fun add(rv: RemoteViews, hDp: Int) {
            val box = FrameLayout(act)
            box.addView(rv.apply(act, box), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            col.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (hDp * dp).toInt()).apply { bottomMargin = (16 * dp).toInt() })
        }
        val live = Live(qb = mapOf("q1" to QbLive(dl = 17_500_000, ul = 1_190_000, active = 4, top = listOf(
            QbTop(name = "Ember.Falls.2026.2160p.WEB-DL.x265", progress = 0.72, speed = 8_960_000, eta = 380),
            QbTop(name = "Quiet.Orbit.2026.1080p.WEB-DL.x265", progress = 0.31, speed = 5_820_000, eta = 1900),
            QbTop(name = "Riverside.2026.2160p.WEB-DL.x265", progress = 0.08, speed = 120_000, eta = 0),
        ))), health = mapOf("s1" to true, "r1" to false, "q1" to true))
        add(DownloadsWidget.build(act, DownloadsWidget.viewOf(live)), 250)
        val svcs = listOf(Service(id = "s1", name = "Sonarr"), Service(id = "r1", name = "Radarr"), Service(id = "q1", name = "qBittorrent"))
        val health = listOf(AppHealth(disks = listOf(Disk("/media", "Media", free = 1_200_000_000_000, total = 8_000_000_000_000))))
        add(ServerWidget.build(act, ServerWidget.viewOf(svcs, live, GoatStatus(vpn = Vpn(enabled = true, state = "up", country = "Netherlands", ip = "185.107.x.x")), health, "21:40")), 150)
        add(ShortcutsWidget.build(act), 64)
        act.setContentView(col)
        Robolectric.flushForegroundThreadScheduler()
        col.captureRoboImage("build/outputs/roborazzi/81-widgets.png")
    }
}

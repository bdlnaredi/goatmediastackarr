package com.bdlnaredi.goatstack

import com.bdlnaredi.goatstack.data.AppHealth
import com.bdlnaredi.goatstack.data.Disk
import com.bdlnaredi.goatstack.data.GoatStatus
import com.bdlnaredi.goatstack.data.Live
import com.bdlnaredi.goatstack.data.QbLive
import com.bdlnaredi.goatstack.data.QbTop
import com.bdlnaredi.goatstack.data.Service
import com.bdlnaredi.goatstack.data.Vpn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the Downloads and Server widgets say. */
class WidgetsTest {
    @Test fun downloads() {
        val l = Live(qb = mapOf("q1" to QbLive(dl = 3_000_000, ul = 1_000_000, active = 4, top = listOf(
            QbTop(name = "Slow", progress = 0.5, speed = 1_000, eta = 0),
            QbTop(name = "Fast.2026.2160p", progress = 0.723, speed = 2_000_000, eta = 380),
            QbTop(name = "Middle", progress = 0.1, speed = 500_000, eta = 9_000_000),
            QbTop(name = "Tiny", progress = 0.9, speed = 10, eta = 5),
        ))))
        val v = DownloadsWidget.viewOf(l)
        assertEquals(listOf("Fast.2026.2160p", "Middle", "Slow"), v.rows.map { it.name })
        assertEquals(723, v.rows[0].progress)
        assertTrue(v.rows[0].info, v.rows[0].info.startsWith("72% · 6m"))
        assertTrue("no time for a stalled one", !v.rows[1].info.contains("left"))
        assertTrue(v.sum, v.sum.endsWith("4 active"))
        assertEquals("Nothing is downloading", DownloadsWidget.viewOf(Live()).sum)
        assertEquals("Could not reach the server", DownloadsWidget.viewOf(null).sum)
    }

    @Test fun server() {
        val svcs = listOf(Service(id = "s1", name = "Sonarr"), Service(id = "r1", name = "Radarr"), Service(id = "q1", name = "qBittorrent"))
        val ok = Live(health = mapOf("s1" to true, "r1" to true, "q1" to true))
        val disks = listOf(AppHealth(disks = listOf(Disk("/media", "Media", free = 500_000_000_000, total = 8_000_000_000_000), Disk("/downloads", "", free = 900_000_000_000, total = 1_000_000_000_000))),
            AppHealth(disks = listOf(Disk("/media", "Media", free = 500_000_000_000, total = 8_000_000_000_000))))
        var v = ServerWidget.viewOf(svcs, ok, GoatStatus(vpn = Vpn(enabled = true, state = "up", country = "Netherlands", ip = "185.1.2.3")), disks, "10:00")
        assertEquals("✓ All 3 apps answering", v.apps)
        assertEquals("🛡 VPN connected · Netherlands · 185.1.2.3", v.vpn)
        assertTrue(v.disk, v.disk.startsWith("⚠ Media:") && v.disk.endsWith("(93%)"))
        v = ServerWidget.viewOf(svcs, Live(health = mapOf("s1" to false, "r1" to true, "q1" to true)), GoatStatus(vpn = Vpn(enabled = true, state = "down")), emptyList(), "10:00")
        assertEquals("⚠ Not answering: Sonarr", v.apps)
        assertTrue(v.vpn.startsWith("⚠ VPN not connected"))
        assertEquals("", v.disk)
        assertEquals("", ServerWidget.viewOf(svcs, ok, null, null).vpn)
        assertEquals("Could not reach the server", ServerWidget.viewOf(null, null, null, null).apps)
    }
}

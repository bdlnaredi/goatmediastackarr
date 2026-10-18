package com.bdlnaredi.goatstack

import com.bdlnaredi.goatstack.data.Api
import com.bdlnaredi.goatstack.data.LibItem
import com.bdlnaredi.goatstack.data.Live
import com.bdlnaredi.goatstack.data.Me
import com.bdlnaredi.goatstack.data.User
import com.bdlnaredi.goatstack.ui.Format
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class FormatTest {
    @Test fun bytes() {
        assertEquals("512 B", Format.bytes(512))
        assertEquals("1.00 KB", Format.bytes(1024))
        assertEquals("1.50 GB", Format.bytes(1610612736))
        assertEquals("120 GB", Format.bytes(120L * 1024 * 1024 * 1024))
    }

    @Test fun eta() {
        assertEquals("∞", Format.eta(8640000))
        assertEquals("45s", Format.eta(45))
        assertEquals("2m 5s", Format.eta(125))
        assertEquals("1h 1m", Format.eta(3660))
        assertEquals("2d 3h", Format.eta(2 * 86400 + 3 * 3600))
    }

    @Test fun days() {
        val today = LocalDate.of(2026, 10, 18)
        assertEquals("Today", Format.day("2026-10-18", today))
        assertEquals("Tomorrow", Format.day("2026-10-19", today))
    }

    @Test fun torrentStates() {
        assertEquals("Downloading", Format.torrentState("downloading"))
        assertEquals("Seeding", Format.torrentState("stalledUP"))
        assertEquals("Finished", Format.torrentState("stoppedUP"))
        assertEquals("Paused", Format.torrentState("pausedDL"))
    }

    @Test fun serverAddresses() {
        assertEquals("http://192.168.1.10:2806", Api.normalizeServer(" 192.168.1.10:2806/ "))
        assertEquals("https://goat.example.com", Api.normalizeServer("https://goat.example.com/"))
        assertEquals("http://tower.local:2806/goat", Api.normalizeServer("tower.local:2806/goat"))
        assertNull(Api.normalizeServer(""))
        assertNull(Api.normalizeServer("http://"))
        assertEquals("https://goat.example.com:8443", Api.normalizeServer("HTTPS://goat.example.com:8443"))
    }

    // The app must read what the server sends, including fields it does not know and values left out.
    @Test fun readsServerAnswers() {
        val api = Api {}
        val me = api.json.decodeFromString<Me>("""{"setup":false,"version":"0.3.0","goat":true,"plexLogin":true,"extra":1,"user":{"id":"a","name":"Ann","role":"user","perms":{"add":false,"control":true,"remove":false,"request":true},"lists":{"tmdb":true}}}""")
        assertEquals("0.3.0", me.version)
        val u: User = me.user!!
        assertFalse(u.can("add")); assertTrue(u.can("request")); assertEquals(listOf("tmdb"), u.lists.sources)
        val item = api.json.decodeFromString<LibItem>("""{"id":7,"title":"Show","year":2021,"poster":null,"size":123,"rating":8.4,"genres":["Drama"]}""")
        assertEquals(7L, item.id); assertNull(item.poster); assertEquals("", item.overview)
        val live = api.json.decodeFromString<Live>("""{"t":1,"qb":{"q1":{"dl":100,"ul":5,"active":2,"top":[]}},"sab":{},"plex":{"p1":[{"title":"Film","progress":0.5}]},"health":{"q1":true}}""")
        assertEquals(100L, live.qb["q1"]!!.dl); assertEquals("Film", live.plex["p1"]!![0].title)
    }

    @Test fun newerHelpers() {
        assertEquals("4.2 GB", Format.gb(4_200_000_000)); assertEquals("0 GB", Format.gb(0)); assertEquals("250 GB", Format.gb(250_000_000_000))
        assertEquals("100 GB", Format.limit(100.0)); assertEquals("0.5 GB", Format.limit(0.5)); assertEquals("1.5 TB", Format.limit(1500.0)); assertEquals("2 TB", Format.limit(2000.0))
        assertEquals("3 h 20 min", Format.hours(12_000)); assertEquals("5 min", Format.hours(300))
        assertTrue(Format.parseMillis("Sat, 17 Oct 2026 10:00:00 +0000") > 0)
        assertEquals(0L, Format.parseMillis("not a date")); assertEquals("", Format.ago(0))
        val p = com.bdlnaredi.goatstack.data.Prefs.parse("start=library\nposters=large\nrefresh=nonsense\nspoilers=true")
        assertEquals("library", p.start); assertEquals(140, p.posterDp); assertEquals(2500L, p.refreshMs); assertTrue(p.spoilers)
        assertEquals(p, com.bdlnaredi.goatstack.data.Prefs.parse(p.text()))
        val t = Api {}.json.decodeFromString<com.bdlnaredi.goatstack.data.TitleInfo>("""{"type":"tv","id":5,"title":"X","cast":[{"name":"A"}],"library":{"sid":"s1","id":2,"kind":"tv"},"new":1}""")
        assertEquals("s1", t.library!!.sid); assertEquals("A", t.cast[0].name)
    }
}

package com.bdlnaredi.goatstack

import com.bdlnaredi.goatstack.data.Shared
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the app makes of links and files shared to it from other apps. */
class SharedTest {
    @Test fun magnetLinks() {
        val m = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=A.Film.2026"
        assertEquals(Shared.Links(listOf(m)), Shared.parse(m))
        // Shared from a page: the text around it is left out, and the same link twice counts once.
        assertEquals(Shared.Links(listOf(m, "magnet:?xt=urn:btih:ff")), Shared.parse("Found it: $m\n$m and magnet:?xt=urn:btih:ff"))
    }

    @Test fun titlePages() {
        assertEquals(Shared.Title("movie", 550), Shared.parse("https://www.themoviedb.org/movie/550-fight-club?language=en"))
        assertEquals(Shared.Title("tv", 1399), Shared.parse("Game of Thrones https://www.themoviedb.org/tv/1399"))
        assertEquals(Shared.Imdb("tt0111161"), Shared.parse("https://www.imdb.com/title/tt0111161/"))
        assertEquals(Shared.Imdb("tt0903747"), Shared.parse("Breaking Bad (TV Series 2008–2013) - IMDb https://m.imdb.com/title/tt0903747/?ref_=ext_shr_lnk"))
        assertEquals(Shared.Imdb("tt0111161"), Shared.parse("https://www.imdb.com/de/title/tt0111161/"))
    }

    @Test fun torrentAddressesAndOthers() {
        assertEquals(Shared.Links(listOf("https://tracker.example/dl/123.torrent?key=abc")), Shared.parse("https://tracker.example/dl/123.torrent?key=abc"))
        assertTrue(Shared.parse("just some words") is Shared.Unknown)
        assertTrue(Shared.parse("https://example.com/page") is Shared.Unknown)
        assertNull(Shared.parse("  ")); assertNull(Shared.parse(null))
    }

    @Test fun torrentFiles() {
        assertTrue(Shared.isTorrent("d8:announce30:http://tracker.example/announce4:infod4:name1:aee".toByteArray()))
        assertFalse(Shared.isTorrent("<html>not a torrent at all</html>".toByteArray()))
        assertFalse(Shared.isTorrent("d1:a".toByteArray()))
    }
}

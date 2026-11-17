package com.bdlnaredi.goatstack.data

/** Something shared to the app from another one (a browser, a torrent site, IMDb). */
sealed class Shared {
    /** Magnet links or torrent web addresses, to add as downloads. */
    data class Links(val urls: List<String>) : Shared()
    /** A .torrent file (its bytes, at most 2 MB). */
    data class TorrentFile(val name: String, val bytes: ByteArray) : Shared()
    /** A movie or show by its TMDB number. */
    data class Title(val type: String, val id: Long) : Shared()
    /** A movie or show by its IMDb number, looked up by the server. */
    data class Imdb(val id: String) : Shared()
    /** Shared text the app cannot use. */
    data class Unknown(val text: String) : Shared()

    companion object {
        private val MAGNET = Regex("""magnet:\?[^\s"'<>]+""", RegexOption.IGNORE_CASE)
        private val TMDB = Regex("""themoviedb\.org/(movie|tv)/(\d+)""", RegexOption.IGNORE_CASE)
        private val IMDB = Regex("""imdb\.com/(?:[a-z]{2}/)?title/(tt\d{5,10})""", RegexOption.IGNORE_CASE)
        private val TORRENT_URL = Regex("""https?://[^\s"'<>]+\.torrent(\?[^\s"'<>]*)?""", RegexOption.IGNORE_CASE)

        /** What a piece of shared text (a link, or a page title with a link in it) points at. */
        fun parse(text: String?): Shared? {
            val t = text?.trim().orEmpty()
            if (t.isEmpty()) return null
            MAGNET.findAll(t).map { it.value }.toList().distinct().takeIf { it.isNotEmpty() }?.let { return Links(it.take(20)) }
            TMDB.find(t)?.let { m -> m.groupValues[2].toLongOrNull()?.let { return Title(m.groupValues[1].lowercase(), it) } }
            IMDB.find(t)?.let { return Imdb(it.groupValues[1].lowercase()) }
            TORRENT_URL.findAll(t).map { it.value }.toList().distinct().takeIf { it.isNotEmpty() }?.let { return Links(it.take(20)) }
            return Unknown(t.take(200))
        }

        /** Whether bytes look like a .torrent file (bencoded: starts with "d"). */
        fun isTorrent(b: ByteArray) = b.size in 21 until 2_000_000 && b[0] == 'd'.code.toByte()
    }
}

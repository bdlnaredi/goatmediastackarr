package com.bdlnaredi.goatstack

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * A pretend GoatMediaStackarr server for the screenshot tests. Its answers have the same shape as the real
 * server's (ui/server.js), so the screens are tested against what they will really receive.
 */
class FakeServer(private val server: MockWebServer) : Dispatcher() {
    @Volatile var signedIn = true
    @Volatile var admin = true
    val calls = java.util.concurrent.CopyOnWriteArrayList<String>()

    private fun img(n: Int) = server.url("/img/p${(n - 1) % 12 + 1}.png").toString()
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun png(name: String): MockResponse {
        val bytes = javaClass.getResourceAsStream("/shots/$name")?.readBytes() ?: return MockResponse().setResponseCode(404)
        return MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))
    }
    private fun day(plus: Long, hour: Int = 20) = LocalDate.now().plusDays(plus).atTime(hour, 0).atOffset(ZoneOffset.UTC).toString()

    private val titles = listOf("Northwind", "The Last Harbor", "Glass City", "Ember Falls", "Quiet Orbit", "Riverside", "Neon Saints", "The Deep",
        "Paper Moon", "Stormline", "Velvet Road", "Iron Bloom")

    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.path ?: "/"
        calls.add("${request.method} $path")
        val p = path.substringBefore('?')
        return when {
            p.startsWith("/img/") -> png(p.removePrefix("/img/"))
            p.startsWith("/api/jellyfin/") && p.endsWith("/img") -> png("p${(path.length % 12) + 1}.png")
            p == "/api/me" -> json(me())
            p == "/api/login" -> json("""{"user":{"id":"u1","name":"Ann","role":"admin"}}""").also { signedIn = true }.setHeader("Set-Cookie", "sid=abc123; HttpOnly; Path=/")
            p == "/api/plexlogin/start" -> json("""{"ticket":"t1","url":"https://app.plex.tv/auth#?code=x"}""")
            p == "/api/services" -> json(SERVICES)
            p == "/api/live" -> MockResponse().setHeader("Content-Type", "text/event-stream").setBody("retry: 3000\n\ndata: ${live()}\n\n")
            p == "/api/upcoming" -> json(upcoming())
            p == "/api/requests" -> json(requests())
            p == "/api/goat/status" -> json(STATUS)
            p == "/api/discover" -> json(discover())
            p == "/api/library" -> json(library(request.requestUrl?.queryParameter("sid") == "r1"))
            p.matches(Regex("/api/series/\\w+/\\d+")) -> json(series())
            p.matches(Regex("/api/qb/\\w+/list")) -> json(torrents())
            p.matches(Regex("/api/sab/\\w+/queue")) -> json(SAB)
            p == "/api/seerr/search" -> json("[" + (1..5).joinToString(",") { i -> """{"mediaType":"${if (i % 2 == 0) "tv" else "movie"}","id":${100 + i},"title":"${titles[i]}","year":"${2018 + i}","overview":"A story about ${titles[i].lowercase()} and the people who live there.","poster":"${img(i + 1)}","status":${listOf(0, 5, 0, 2, 0)[i - 1]}}""" } + "]")
            else -> json("""{"error":"Not in the pretend server: $p"}""", 404)
        }
    }

    private fun me() = """{"setup":false,"version":"0.3.0","goat":true,"plexLogin":true,"user":${if (signedIn) """{"id":"u1","name":"Ann","role":"${if (admin) "admin" else "user"}","lists":{"tmdb":true,"trakt":true},"plex":{"name":"ann.plex"}}""" else "null"}}"""

    private fun live(): String {
        val tops = (0..2).joinToString(",") { i -> """{"hash":"h$i","name":"${titles[i + 3]}.2026.2160p.WEB-DL","progress":${listOf(0.72, 0.31, 0.08)[i]},"speed":${listOf(9_400_000, 6_100_000, 2_800_000)[i]},"eta":${listOf(380, 1900, 5400)[i]},"size":${listOf(14_000_000_000, 6_500_000_000, 2_100_000_000)[i]}}""" }
        return """{"t":1,"qb":{"q1":{"dl":18300000,"ul":1250000,"active":3,"conn":"connected","top":[$tops]}},"sab":{"z1":{"speed":5200000,"paused":false,"slots":1,"left":"3.1 GB","timeleft":"0:10:12","jobs":[{"name":"Paper.Moon.S01E04.1080p","pct":46}]}},
            "plex":{"j1":[{"id":"a","user":"Ravi","device":"Living room TV","title":"Glass City","sub":"S02E05 The Tower","kind":"episode","progress":0.42,"thumb":"/Items/1/Images/Primary","state":"playing"},
            {"id":"b","user":"Mira","device":"Phone","title":"Northwind","sub":"2024","kind":"movie","progress":0.81,"thumb":"/Items/2/Images/Primary","state":"playing"}]},
            "health":{"s1":true,"r1":true,"q1":true,"z1":true,"e1":true,"j1":true}}""".replace("\n", "")
    }

    private fun upcoming(): String {
        val cal = (0..9).joinToString(",") { i ->
            val tv = i % 3 != 2
            """{"date":"${if (tv) day((i / 2).toLong(), 18 + i % 4) else LocalDate.now().plusDays((i / 2).toLong()).toString()}","sid":"${if (tv) "s1" else "r1"}","id":${i + 1},"title":"${titles[(i + 2) % 12]}","sub":"${if (tv) "S0${1 + i % 3}E0${2 + i % 7} · Chapter ${i + 2}" else "Movie release"}","poster":"${img(i + 3)}","overview":""}"""
        }
        return """{"calendar":[$cal],"queue":[{"title":"Ember Falls","sub":"Ember.Falls.S01E03.1080p","status":"downloading","timeleft":"00:12:40","progress":0.64,"poster":"${img(4)}","meta":"torrent · qBittorrent"}],"errors":[]}"""
    }

    private fun requests(): String {
        val st = listOf("pending", "pending", "approved", "available", "declined", "approved")
        val stage = listOf("pending", "pending", "downloading", "available", "declined", "searching")
        val who = listOf("Ravi", "Mira", "Ann", "Ravi", "Leo", "Mira")
        return "[" + st.indices.joinToString(",") { i -> """{"id":"r$i","sid":"e1","uid":"u$i","user":"${who[i]}","mediaType":"${if (i % 2 == 0) "movie" else "tv"}","mediaId":${200 + i},"title":"${titles[(i + 5) % 12]}","year":"${2019 + i}","poster":"${img(i + 6)}","status":"${st[i]}","stage":"${stage[i]}","at":${System.currentTimeMillis() - (i + 1) * 3_600_000L * (i + 1)}}""" } + "]"
    }

    private fun discover() = "[" + (0..11).joinToString(",") { i -> """{"mediaType":"movie","title":"${titles[(i + 4) % 12]}","year":"${2020 + i % 6}","overview":"","poster":"${img(i + 5)}","rating":${7.0 + (i % 5) * 0.4},"tmdb":${300 + i}}""" } + "]"

    private fun library(movies: Boolean) = "[" + (0..11).joinToString(",") { i ->
        """{"id":${i + 1},"title":"${titles[i]}","year":${2012 + i},"poster":"${img(i + 1)}","fanart":"/img/fanart.png","overview":"When the lights go out across the coast, a lighthouse keeper and her estranged brother have one winter to find out who is sending the signals, and why they began the night their father disappeared.",
            "size":${(i + 1) * 4_300_000_000L},"missing":${if (i % 4 == 1) 3 else 0},"monitored":true,"status":"continuing","genres":["Drama","Mystery","Thriller"],"maker":"${if (movies) "Northlight Pictures" else "HBX"}","profile":"HD-1080p",
            "added":"2026-0${1 + i % 9}-1${i % 9}T10:00:00Z","rating":${7.2 + (i % 4) * 0.4},"runtime":${if (movies) 118 else 52},"cert":"${if (movies) "PG-13" else "TV-14"}","seasons":${if (movies) 0 else 3},"have":${if (movies) (if (i % 4 == 1) 0 else 1) else 24 - (if (i % 4 == 1) 3 else 0)},"total":${if (movies) 1 else 24},"next":"${if (!movies && i == 0) day(2) else ""}"}""".replace("\n", "")
    } + "]"

    private fun series(): String {
        val eps = (1..3).flatMap { s -> (1..8).map { e -> s to e } }.joinToString(",") { (s, e) ->
            val has = s < 3 || e < 5
            """{"id":${s * 100 + e},"season":$s,"num":$e,"title":"Chapter ${(s - 1) * 8 + e}","date":"${day((s - 3) * 60L + e * 7L - 20)}","monitored":true,"has":$has,"quality":"${if (has) "WEBDL-1080p" else ""}","size":${if (has) 1_700_000_000 else 0},"aired":${s < 3 || e < 7}}"""
        }
        return """{"id":1,"title":"Northwind","monitored":true,"seasons":[{"n":0,"monitored":false},{"n":1,"monitored":true},{"n":2,"monitored":true},{"n":3,"monitored":true}],"episodes":[$eps]}"""
    }

    private fun torrents(): String {
        val states = listOf("downloading", "downloading", "stalledDL", "uploading", "stoppedUP", "pausedDL")
        val prog = listOf(0.72, 0.31, 0.08, 1.0, 1.0, 0.55)
        return """{"dl":18300000,"ul":1250000,"alt":false,"torrents":[""" + states.indices.joinToString(",") { i ->
            """{"hash":"${"%040d".format(i)}","name":"${titles[(i + 3) % 12]}.2026.${if (i % 2 == 0) "2160p" else "1080p"}.WEB-DL.x265","state":"${states[i]}","progress":${prog[i]},"dlspeed":${if (i < 2) 9_400_000 - i * 3_300_000 else 0},"upspeed":${if (i == 3) 1_250_000 else 0},"size":${(i + 2) * 3_200_000_000L},"added":${1_760_000_000 - i * 3600},"eta":${listOf(380, 1900, 8640000, 0, 0, 8640000)[i]},"ratio":${listOf(0.0, 0.0, 0.0, 1.42, 2.05, 0.0)[i]},"seeds":12,"peers":4,"category":"${if (i % 2 == 0) "radarr" else "sonarr"}"}"""
        } + "]}"
    }

    companion object {
        const val SERVICES = """[{"id":"s1","type":"sonarr","name":"Sonarr","managed":true},{"id":"r1","type":"radarr","name":"Radarr","managed":true},{"id":"q1","type":"qbittorrent","name":"qBittorrent","managed":true},{"id":"z1","type":"sabnzbd","name":"SABnzbd","managed":true},{"id":"e1","type":"seerr","name":"Seerr","managed":true},{"id":"j1","type":"jellyfin","name":"Jellyfin","managed":true}]"""
        const val SAB = """{"paused":false,"status":"Downloading","speed":5200000,"slots":2,"left":"3.1 GB","timeleft":"0:10:12","jobs":[{"name":"Paper.Moon.S01E04.1080p.WEB","pct":46,"size":"2.2 GB","left":"0:06:10"},{"name":"Stormline.S03E01.2160p","pct":0,"size":"6.0 GB","left":"0:24:00"}]}"""
        val STATUS = """{"vpn":{"enabled":true,"state":"up","ip":"185.107.56.12","country":"NL","port":"51234","type":"wireguard"},"container":true,
            "engines":[{"id":"1","key":"sonarr","name":"Sonarr","ok":true},{"id":"2","key":"radarr","name":"Radarr","ok":true},{"id":"3","key":"lidarr","name":"Lidarr","ok":true},{"id":"4","key":"prowlarr","name":"Prowlarr","ok":true},{"id":"5","key":"bazarr","name":"Bazarr","ok":true},{"id":"6","key":"qbittorrent","name":"qBittorrent","ok":true},{"id":"7","key":"sabnzbd","name":"SABnzbd","ok":true},{"id":"8","key":"jellyfin","name":"Jellyfin","ok":true},{"id":"9","key":"seerr","name":"Seerr","ok":false}],
            "wired":{"at":1,"running":false,"steps":{"sonarr":{"ok":true},"radarr":{"ok":true},"prowlarr":{"ok":true},"jellyfin":{"ok":true},"seerr":{"ok":false,"error":"waiting for Jellyfin to be set up first"}}},
            "counts":{"indexers":6,"newsServers":1}}""".replace("\n", "")
    }
}

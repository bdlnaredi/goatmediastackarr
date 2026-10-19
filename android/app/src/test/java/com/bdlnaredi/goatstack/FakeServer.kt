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
    /** The newest release the pretend server reports; empty means none is known. */
    @Volatile var latest = ""
    val calls = java.util.concurrent.CopyOnWriteArrayList<String>()
    /** Calls the app made that the pretend server does not know: each one is a mistake in the app (or here). */
    val misses = java.util.concurrent.CopyOnWriteArrayList<String>()

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
            p == "/api/wanted" -> json("""{"total":42,"items":[""" + (0..7).joinToString(",") { i -> """{"id":${i + 1},"title":"${titles[(i + 1) % 12]}","sub":"S0${1 + i % 3}E0${1 + i}  Chapter ${i + 1}","date":"${day(-i.toLong() * 3)}","poster":"${img(i + 2)}","overview":""}""" } + "]}")
            p == "/api/bazarr/b1/wanted" -> json("""{"total":5,"movies":[{"id":3,"title":"Ember Falls","missing":[{"code":"en","name":"English","forced":false,"hi":false},{"code":"hi","name":"Hindi","forced":false,"hi":false}]}],"episodes":[""" + (0..3).joinToString(",") { i -> """{"id":${10 + i},"seriesId":1,"title":"${titles[i]}","ep":"1x0${i + 1}","name":"Chapter ${i + 1}","missing":[{"code":"en","name":"English","forced":${i == 2},"hi":false}]}""" } + "]}")
            p == "/api/media/l1/library" -> json("""{"missing":3,"items":[""" + (0..8).joinToString(",") { i -> """{"id":${i + 1},"title":"${listOf("Aurora Lines", "The Night Choir", "Velvet Static", "Kilometre Zero", "Saffron Tide", "Hollow Pines", "Neon Ganges", "Paper Kites", "Low Orbit")[i]}","poster":"${img(i + 4)}","monitored":true,"count":${2 + i % 4},"have":${20 + i * 3},"total":${24 + i * 3},"size":${(i + 1) * 900_000_000L}}""" } + "]}")
            p == "/api/libhealth" -> json(HEALTH)
            p == "/api/prowlarr/p2/indexers" -> json(INDEXERS)
            p == "/api/sab/z1/servers" -> json("""[{"name":"news_example_com","displayname":"Newshosting","host":"news.example.com","port":563,"ssl":true,"username":"ann","hasPassword":true,"connections":30,"enable":true,"priority":0},{"name":"block","displayname":"Backup block","host":"bonus.example.net","port":119,"ssl":false,"username":"ann","hasPassword":true,"connections":8,"enable":false,"priority":1}]""")
            p == "/api/tautulli/t1/stats" -> json(stats())
            p == "/api/tautulli/t1/img" -> png("p${(path.length % 12) + 1}.png")
            p == "/api/unraid/u1" -> json(UNRAID)
            p == "/api/users" -> json("""[{"id":"u1","name":"Ann","role":"admin","twofa":true},{"id":"u2","name":"Ravi","role":"user","plex":{"name":"ravi"},"dataLimit":500,"avatar":"/img/p7.png"},{"id":"u3","name":"Mira","role":"user","plex":{"name":"mira"}},{"id":"u4","name":"Leo","role":"user"}]""")
            p == "/api/title" -> json(title(request.requestUrl?.queryParameter("type") == "tv"))
            p == "/api/usage" -> json(usage("u1", "Ann", 0))
            p == "/api/notifications" -> json(feed())
            p == "/api/notifications/read" -> json("""{"read":9}""")
            p == "/api/updates" -> json("""{"server":"0.3.6","latest":"$latest","url":"https://github.com/bdlnaredi/goatmediastackarr/releases/tag/v$latest","apk":"${if (latest.isEmpty()) "" else "https://github.com/bdlnaredi/goatmediastackarr/releases/download/v$latest/goatmediastackarr.apk"}","serverUpdate":${latest.isNotEmpty()}}""")
            p == "/api/streaming" -> json("""{"month":"${java.time.YearMonth.now()}","months":[],"defaultGb":100,"wanOnly":false,"resets":${System.currentTimeMillis() + 9 * 86_400_000L},"users":[{"id":"u2","name":"Ravi","profile":true,"bytes":63400000000,"all":63400000000,"wan":21000000000,"limitGb":100},{"id":"u3","name":"Mira","profile":true,"bytes":97100000000,"all":97100000000,"wan":0,"limitGb":100},{"id":"","name":"grandma.plex","profile":false,"bytes":12800000000,"all":12800000000,"wan":12800000000,"limitGb":0},{"id":"u1","name":"Ann","profile":true,"bytes":5100000000,"all":5100000000,"wan":0,"limitGb":0},{"id":"u4","name":"Leo","profile":true,"bytes":0,"all":0,"wan":0,"limitGb":250}]}""")
            p.matches(Regex("/api/users/\\w+/usage")) -> json(usage(p.split('/')[3], "Ravi", 500))
            p == "/api/sessions" -> json("""[{"id":"a1","user":"Ann","device":"GoatStack app on Android","ip":"192.168.1.20","at":1,"seen":${System.currentTimeMillis() - 60_000},"current":true},{"id":"b2","user":"Ann","device":"Chrome on Windows","ip":"192.168.1.12","at":1,"seen":${System.currentTimeMillis() - 7_200_000},"current":false},{"id":"c3","user":"Ann","device":"Safari on iPhone","ip":"10.0.0.4","at":1,"seen":${System.currentTimeMillis() - 400_000_000},"current":false}]""")
            p.matches(Regex("/api/qb/\\w+/meta")) -> json("""{"free":600000000000,"categories":[{"name":"radarr","path":"/downloads/movies"},{"name":"sonarr","path":"/downloads/tv"},{"name":"kids","path":""}],"tags":["4k","keep"]}""")
            p.matches(Regex("/api/rss/\\w+/feeds")) -> json("""[{"path":"Linux ISOs","name":"Linux ISOs","url":"https://example.org/rss/linux","unread":3,"total":12,"error":false},{"path":"Open films","name":"Open films","url":"https://example.org/rss/films","unread":0,"total":5,"error":false},{"path":"Old tracker","name":"Old tracker","url":"https://old.example.net/rss","unread":0,"total":0,"error":true}]""")
            p.matches(Regex("/api/rss/\\w+/articles")) -> json("[" + (0..9).joinToString(",") { i -> """{"id":"a$i","title":"${listOf("Ubuntu 26.04 LTS desktop amd64", "Fedora 45 Workstation x86_64", "Big Buck Bunny 2160p", "Debian 14.1 netinst", "Sintel 4K remaster", "Tears of Steel 1080p", "Arch Linux 2026.10.01", "Linux Mint 23", "Elephants Dream HD", "openSUSE Tumbleweed")[i]}","date":"${java.time.ZonedDateTime.now().minusHours(i * 5L).format(java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)}","feed":"${if (i % 3 == 2) "Open films" else "Linux ISOs"}","read":${i > 2}}""" } + "]")
            p.matches(Regex("/api/rss/\\w+/rules")) -> json("""{"rules":[{"name":"Ubuntu releases","enabled":true,"mustContain":"Ubuntu","mustNotContain":"beta","assignedCategory":"kids","lastMatch":"2026-10-12"},{"name":"Open movies in 4K","enabled":false,"mustContain":"2160p","mustNotContain":""}],"feeds":[{"path":"Linux ISOs","url":"https://example.org/rss/linux"}]}""")
            p == "/api/goat/import" -> json("""{"state":"idle"}""")
            p == "/api/goat/import/check" -> json("""{"kind":"sonarr","total":184,"already":12,"todo":172,"roots":["/tv"],"newRoots":["/media/tv"],"suggest":[["/tv","/media/tv"],["/anime","/media/tv"]],"settings":{"profiles":["Any","HD-1080p","Ultra-HD"],"formats":14}}""")
            else -> { misses.add("${request.method} $p"); json("""{"error":"Not in the pretend server: $p"}""", 404) }
        }
    }

    private fun me() = """{"setup":false,"version":"0.3.0","goat":true,"plexLogin":true,"user":${if (signedIn) """{"id":"u1","name":"Ann","role":"${if (admin) "admin" else "user"}","lists":{"tmdb":true,"trakt":true},"plex":{"name":"ann.plex"},"avatar":"/img/p3.png","email":"ann@example.com","notify":"https://ntfy.sh/ann-goat"}""" else "null"}}"""

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
        val stage = listOf("pending", "pending", "downloading", "available", "declined", "importing")
        val who = listOf("Ravi", "Mira", "Ann", "Ravi", "Leo", "Mira")
        return "[" + st.indices.joinToString(",") { i -> """{"id":"r$i","sid":"e1","uid":"u$i","user":"${who[i]}","mediaType":"${if (i % 2 == 0) "movie" else "tv"}","mediaId":${200 + i},"title":"${titles[(i + 5) % 12]}","year":"${2019 + i}","poster":"${img(i + 6)}","status":"${st[i]}","stage":"${stage[i]}","progress":${if (i == 2) 0.64 else null},"eta":"${if (i == 2) "00:12:40" else ""}","where":"${if (i == 3) "Plex" else ""}","at":${System.currentTimeMillis() - (i + 1) * 3_600_000L * (i + 1)}}""" } + "]"
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
            """{"id":${s * 100 + e},"season":$s,"num":$e,"title":"Chapter ${(s - 1) * 8 + e}","overview":"The storm cuts the island off. Chapter ${(s - 1) * 8 + e} follows the keeper as she finds the second radio and learns who has been answering it.","runtime":52,"date":"${day((s - 3) * 60L + e * 7L - 20)}","monitored":true,"has":$has,"quality":"${if (has) "WEBDL-1080p" else ""}","size":${if (has) 1_700_000_000 else 0},"aired":${s < 3 || e < 7}}"""
        }
        return """{"id":1,"title":"Northwind","monitored":true,"seasons":[{"n":0,"monitored":false},{"n":1,"monitored":true},{"n":2,"monitored":true},{"n":3,"monitored":true}],"episodes":[$eps]}"""
    }

    private fun title(tv: Boolean): String {
        val cast = listOf("Ana Reyes" to "Mara Quinn", "Tom Okafor" to "Elias", "Lin Park" to "Dr. Hale", "Sam Varga" to "The Keeper", "Ivy Moss" to "June").withIndex()
            .joinToString(",") { (i, c) -> """{"name":"${c.first}","role":"${c.second}","photo":"${img(i + 2)}"}""" }
        val seasons = if (tv) (1..3).joinToString(",") { """{"n":$it,"episodes":${6 + it * 2},"name":"Season $it","date":"${2021 + it}-03-0$it"}""" } else ""
        return """{"type":"${if (tv) "tv" else "movie"}","id":304,"title":"Quiet Orbit","year":"2025","date":"2025-04-11","tagline":"Some signals should stay unanswered.","overview":"A lone engineer on a dying space station picks up a voice that should not exist, and has three days to decide whether to answer before the station falls out of orbit.",
            "poster":"${img(5)}","backdrop":"${server.url("/img/fanart.png")}","rating":7.9,"runtime":${if (tv) 48 else 121},"genres":["Sci-Fi","Thriller","Drama"],"status":"Released","studio":"Northlight Pictures",
            "cast":[$cast],"seasons":[$seasons],"trailer":"dQw4w9WgXcQ","seerr":"e1","available":0,"library":null,"request":null}""".replace("\n", "")
    }

    private fun feed(): String {
        val now = System.currentTimeMillis()
        val l = listOf(
            listOf("ready", "Ready to watch", "Quiet Orbit is now available on Plex.", "title:movie:304"),
            listOf("request", "New request", "Ravi asked for Neon Saints", "requests"),
            listOf("problem", "VPN not active", "qBittorrent is not using the VPN", "stack"),
            listOf("reqstatus", "Request approved", "Paper Moon will be downloaded.", "title:tv:205"),
            listOf("stream", "Streaming limit reached", "Mira has streamed 100 GB of 100 GB this month.", "users"),
            listOf("download", "Download finished", "Stormline.S03E01.2160p.WEB-DL", "downloads"),
            listOf("update", "GoatMediaStackarr 0.3.8 is out", "You have 0.3.7. On Unraid open the Docker tab and click Update.", "update"),
        )
        return """{"last":9,"read":6,"items":[""" + l.withIndex().joinToString(",") { (i, x) -> """{"id":${9 - i},"at":${now - i * 5_400_000L},"kind":"${x[0]}","title":"${x[1]}","body":"${x[2]}","link":"${x[3]}"}""" } + "]}"
    }

    private fun stream(member: Boolean): String {
        val now = java.time.YearMonth.now()
        val hist = (5 downTo 0).joinToString(",") { i -> """{"month":"${now.minusMonths(i.toLong())}","bytes":${listOf(41, 88, 102, 74, 95, 63)[5 - i] * 1_000_000_000L}}""" }
        return """{"month":"$now","bytes":63400000000,"all":63400000000,"wan":21000000000,"limitGb":${if (member) 100 else 0},"custom":false,"defaultGb":100,"wanOnly":false,"resets":${System.currentTimeMillis() + 9 * 86_400_000L},"history":[$hist]}"""
    }

    private fun usage(id: String, name: String, limit: Int): String {
        val items = (0..4).joinToString(",") { i -> """{"title":"${titles[i + 2]}","year":"${2019 + i}","mediaType":"${if (i % 2 == 0) "tv" else "movie"}","mediaId":${300 + i},"poster":"${img(i + 3)}","size":${(60 - i * 11) * 1_000_000_000L}}""" }
        return """{"id":"$id","name":"$name","requests":{"total":23,"month":4,"approved":19,"pending":2,"declined":2},"reqLimit":${if (limit > 0) """{"n":10,"days":7}""" else "null"},
            "space":{"bytes":412000000000,"items":[$items]},"limitGb":$limit,"stream":${stream(limit > 0)},"watch":[{"days":1,"plays":3,"seconds":9600},{"days":7,"plays":17,"seconds":61200},{"days":30,"plays":58,"seconds":212400},{"days":0,"plays":640,"seconds":2304000}],"devices":3}""".replace("\n", "")
    }

    private fun stats(): String {
        val days = (0..29).joinToString(",") { "\"${LocalDate.now().minusDays((29 - it).toLong())}\"" }
        val plays = (0..29).joinToString(",") { ((it * 7 + 3) % 11 + (if (it % 7 >= 5) 6 else 1)).toString() }
        val top = (0..5).joinToString(",") { i -> """{"title":"${titles[(i + 6) % 12]}","plays":${20 - i * 3},"thumb":"/library/metadata/${i + 1}/thumb"}""" }
        return """{"days":30,"movies":[$top],"tv":[$top],"users":[{"title":"Ravi","plays":64,"seconds":198000},{"title":"Mira","plays":41,"seconds":120000},{"title":"Ann","plays":22,"seconds":70000}],
            "totals":{"plays":127,"seconds":388000},"byDate":{"categories":[$days],"series":[{"name":"TV","data":[$plays]},{"name":"Movies","data":[$plays]}]},
            "history":[""" + (0..5).joinToString(",") { i -> """{"user":"${listOf("Ravi", "Mira", "Ann")[i % 3]}","title":"${titles[i]} - Chapter ${i + 2}","type":"episode","at":${System.currentTimeMillis() - i * 5_400_000L},"player":"${listOf("Living room TV", "Phone", "Chrome")[i % 3]}","pct":${listOf(100, 46, 92, 100, 15, 100)[i]},"thumb":"/library/metadata/${i + 1}/thumb"}""" } + "]}"
    }

    private fun torrents(): String {
        val states = listOf("downloading", "downloading", "stalledDL", "uploading", "stoppedUP", "pausedDL")
        val prog = listOf(0.72, 0.31, 0.08, 1.0, 1.0, 0.55)
        return """{"dl":18300000,"ul":1250000,"alt":false,"torrents":[""" + states.indices.joinToString(",") { i ->
            """{"hash":"${"%040d".format(i)}","name":"${titles[(i + 3) % 12]}.2026.${if (i % 2 == 0) "2160p" else "1080p"}.WEB-DL.x265","state":"${states[i]}","progress":${prog[i]},"dlspeed":${if (i < 2) 9_400_000 - i * 3_300_000 else 0},"upspeed":${if (i == 3) 1_250_000 else 0},"size":${(i + 2) * 3_200_000_000L},"added":${1_760_000_000 - i * 3600},"eta":${listOf(380, 1900, 8640000, 0, 0, 8640000)[i]},"ratio":${listOf(0.0, 0.0, 0.0, 1.42, 2.05, 0.0)[i]},"seeds":12,"peers":4,"category":"${if (i % 2 == 0) "radarr" else "sonarr"}"}"""
        } + "]}"
    }

    companion object {
        const val SERVICES = """[{"id":"l1","type":"lidarr","name":"Lidarr","managed":true},{"id":"b1","type":"bazarr","name":"Bazarr","managed":true},{"id":"p2","type":"prowlarr","name":"Prowlarr","managed":true},{"id":"t1","type":"tautulli","name":"Tautulli","managed":true},{"id":"u1","type":"unraid","name":"Tower"},{"id":"s1","type":"sonarr","name":"Sonarr","managed":true},{"id":"r1","type":"radarr","name":"Radarr","managed":true},{"id":"q1","type":"qbittorrent","name":"qBittorrent","managed":true},{"id":"z1","type":"sabnzbd","name":"SABnzbd","managed":true},{"id":"e1","type":"seerr","name":"Seerr","managed":true},{"id":"j1","type":"jellyfin","name":"Jellyfin","managed":true}]"""
        const val SAB = """{"paused":false,"status":"Downloading","speed":5200000,"slots":2,"left":"3.1 GB","timeleft":"0:10:12","jobs":[{"name":"Paper.Moon.S01E04.1080p.WEB","pct":46,"size":"2.2 GB","left":"0:06:10"},{"name":"Stormline.S03E01.2160p","pct":0,"size":"6.0 GB","left":"0:24:00"}]}"""
        val HEALTH = """[{"id":"s1","name":"Sonarr","type":"sonarr","ok":true,"issues":[{"level":"warn","text":"Indexers unavailable due to failures for more than 6 hours: Cloudy Site"}],"disks":[{"path":"/media","label":"Media library","free":28831900000000,"total":33492300000000},{"path":"/downloads","label":"Downloads","free":29105700000000,"total":33975100000000},{"path":"/config","label":"App data","free":273800000000,"total":482800000000},{"path":"/","label":"Container (Docker image)","free":42300000000,"total":53700000000}],"queue":[{"title":"Stormline.S03E01.2160p","message":"No files found are eligible for import"}],"missing":14},
            {"id":"r1","name":"Radarr","type":"radarr","ok":true,"issues":[],"disks":[],"queue":[],"missing":3},{"id":"p2","name":"Prowlarr","type":"prowlarr","ok":true,"issues":[],"disks":[],"queue":[],"missing":null},
            {"id":"l1","name":"Lidarr","type":"lidarr","ok":false,"error":"Connection refused","issues":[],"disks":[],"queue":[]}]""".replace("\n", "")
        val INDEXERS = """{"health":[],"indexers":[{"id":1,"name":"Torrent Galaxy","protocol":"torrent","enabled":true,"priority":25,"status":"ok"},{"id":2,"name":"Cloudy Site","protocol":"torrent","enabled":true,"priority":25,"status":"failing","until":"2026-10-19T10:00:00Z"},
            {"id":3,"name":"NZBgeek","protocol":"usenet","enabled":true,"priority":20,"status":"ok"},{"id":4,"name":"Old Tracker","protocol":"torrent","enabled":false,"priority":30,"status":"disabled"}]}""".replace("\n", "")
        val UNRAID = """{"host":"Tower","arrayState":"STARTED","used":7400000000,"total":12000000000,"cpu":23.4,"mem":61.2,"uptime":"12 days","cpuInfo":{"brand":"Intel Core i5-12400","cores":6,"threads":12},
            "containers":[{"id":"c1","name":"goatmediastackarr","state":"RUNNING"},{"id":"c2","name":"plex","state":"RUNNING"},{"id":"c3","name":"mediahub","state":"RUNNING"},{"id":"c4","name":"qbittorrentvpn","state":"EXITED"}],
            "disks":[{"name":"parity","role":"Parity","temp":34,"status":"DISK_OK"},{"name":"disk1","role":"Data","temp":36,"status":"DISK_OK"},{"name":"disk2","role":"Data","temp":"*","status":"DISK_OK"},{"name":"cache","role":"Cache","temp":41,"status":"DISK_OK"}],"errors":[]}""".replace("\n", "")
        val STATUS = """{"vpn":{"enabled":true,"state":"up","ip":"185.107.56.12","country":"NL","port":"51234","type":"wireguard"},"container":true,
            "engines":[{"id":"1","key":"sonarr","name":"Sonarr","ok":true},{"id":"2","key":"radarr","name":"Radarr","ok":true},{"id":"3","key":"lidarr","name":"Lidarr","ok":true},{"id":"4","key":"prowlarr","name":"Prowlarr","ok":true},{"id":"5","key":"bazarr","name":"Bazarr","ok":true},{"id":"6","key":"qbittorrent","name":"qBittorrent","ok":true},{"id":"7","key":"sabnzbd","name":"SABnzbd","ok":true},{"id":"8","key":"jellyfin","name":"Jellyfin","ok":true},{"id":"9","key":"seerr","name":"Seerr","ok":false}],
            "wired":{"at":1,"running":false,"steps":{"sonarr":{"ok":true},"radarr":{"ok":true},"prowlarr":{"ok":true},"jellyfin":{"ok":true},"seerr":{"ok":false,"error":"waiting for Jellyfin to be set up first"}}},
            "counts":{"indexers":6,"newsServers":1}}""".replace("\n", "")
    }
}

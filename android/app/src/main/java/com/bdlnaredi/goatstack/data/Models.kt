package com.bdlnaredi.goatstack.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// The shapes the GoatMediaStackarr server sends (ui/server.js). Every field has a default, so an older or newer
// server that leaves one out, or adds new ones, still works.

@Serializable
data class Me(
    val setup: Boolean = false,
    val version: String = "",
    val demo: Boolean = false,
    val goat: Boolean = false,
    val plexLogin: Boolean = false,
    val recovery: Boolean = false,
    val user: User? = null,
)

@Serializable
data class User(
    val id: String = "",
    val name: String = "",
    val role: String = "user",
    val email: String = "",
    val twofa: Boolean = false,
    val perms: Perms? = null,
    val plex: PlexName? = null,
    val lists: Lists = Lists(),
    val autoApprove: Boolean = false,
    val avatar: String = "",
    val dataLimit: Int = 0,
    val notify: String = "",
) {
    val admin get() = role == "admin"
    // Same rule as the server: an admin can do everything; otherwise only what is not switched off.
    fun can(what: String): Boolean = admin || when (what) {
        "add" -> perms?.add ?: true
        "control" -> perms?.control ?: true
        "remove" -> perms?.remove ?: true
        "request" -> perms?.request ?: true
        else -> true
    }
}

@Serializable data class Perms(val add: Boolean? = null, val control: Boolean? = null, val remove: Boolean? = null, val request: Boolean? = null)
@Serializable data class PlexName(val name: String = "")
@Serializable data class Lists(val trakt: Boolean = false, val tmdb: Boolean = false, val tvdb: Boolean = false) {
    val any get() = trakt || tmdb || tvdb
    val sources get() = buildList { if (tmdb) add("tmdb"); if (trakt) add("trakt"); if (tvdb) add("tvdb") }
}

@Serializable
data class Service(val id: String = "", val type: String = "", val name: String = "", val url: String = "", val managed: Boolean = false)

@Serializable data class LoginReply(val user: User? = null, val twofa: Boolean = false, val ticket: String? = null)
@Serializable data class PlexStart(val ticket: String = "", val url: String = "")
@Serializable data class PlexPoll(val pending: Boolean = false, val user: User? = null)

// ---------- Requests (Seerr) ----------
@Serializable
data class SeerrHit(
    val mediaType: String = "movie", val id: Long = 0, val title: String = "", val year: String = "",
    val overview: String? = null, val poster: String = "", val status: Int = 0,
)

@Serializable data class SeerrSeasons(val seasons: List<SeasonCount> = emptyList())
@Serializable data class SeasonCount(val n: Int = 0, val episodes: Int = 0)

@Serializable
data class MediaRequest(
    val id: String = "", val sid: String = "", val uid: String = "", val user: String = "",
    val mediaType: String = "movie", val mediaId: Long = 0, val title: String = "", val year: String = "",
    val poster: String = "", val status: String = "pending", val stage: String = "", val at: Long = 0,
    val seasons: List<Int> = emptyList(),
)

@Serializable
data class DiscoverItem(
    val mediaType: String = "movie", val title: String = "", val year: String = "", val overview: String = "",
    val poster: String = "", val rating: Double = 0.0, val tmdb: Long = 0, val tvdb: Long = 0,
)

// ---------- Library (Sonarr / Radarr) ----------
@Serializable
data class LibItem(
    val id: Long = 0, val title: String = "", val year: Int = 0, val poster: String? = null, val fanart: String? = null,
    val overview: String = "", val size: Long = 0, val missing: Int = 0, val monitored: Boolean = false, val status: String = "",
    val genres: List<String> = emptyList(), val maker: String = "", val profile: String = "", val added: String = "",
    val rating: Double = 0.0, val runtime: Int = 0, val cert: String = "", val seasons: Int = 0, val have: Int = 0,
    val total: Int = 0, val next: String = "",
)

@Serializable
data class SeriesDetail(
    val id: Long = 0, val title: String = "", val monitored: Boolean = false,
    val seasons: List<SeasonMon> = emptyList(), val episodes: List<Episode> = emptyList(),
)
@Serializable data class SeasonMon(val n: Int = 0, val monitored: Boolean = false)
@Serializable
data class Episode(
    val id: Long = 0, val season: Int = 0, val num: Int = 0, val title: String = "", val date: String = "",
    val monitored: Boolean = false, val has: Boolean = false, val quality: String = "", val size: Long = 0, val aired: Boolean = false,
    val overview: String = "", val runtime: Int = 0,
)

@Serializable
data class LookupReply(val results: List<LookupHit> = emptyList(), val folders: List<Folder> = emptyList(), val profiles: List<Profile> = emptyList())
@Serializable
data class LookupHit(val title: String = "", val year: Int = 0, val overview: String? = null, val added: Boolean = false, val poster: String? = null, val raw: JsonObject = JsonObject(emptyMap()))
@Serializable data class Folder(val path: String = "")
@Serializable data class Profile(val id: Int = 0, val name: String = "")

// ---------- Downloads ----------
@Serializable
data class QbList(val dl: Long = 0, val ul: Long = 0, val alt: Boolean = false, val torrents: List<Torrent> = emptyList())
@Serializable
data class Torrent(
    val hash: String = "", val name: String = "", val state: String = "", val progress: Double = 0.0,
    val dlspeed: Long = 0, val upspeed: Long = 0, val size: Long = 0, val added: Long = 0, val eta: Long = 0,
    val ratio: Double = 0.0, val seeds: Int = 0, val peers: Int = 0, val category: String = "",
) {
    val paused get() = state.startsWith("paused") || state.startsWith("stopped")
    val done get() = progress >= 0.999
}
@Serializable
data class SabQueue(
    val paused: Boolean = false, val status: String? = null, val speed: Double = 0.0, val slots: Int = 0,
    val left: String? = null, val timeleft: String? = null, val jobs: List<SabJob> = emptyList(),
)
@Serializable data class SabJob(val name: String = "", val pct: Double = 0.0, val size: String? = null, val left: String? = null)

// ---------- Upcoming ----------
@Serializable
data class Upcoming(val calendar: List<CalItem> = emptyList(), val queue: List<QueueItem> = emptyList(), val errors: List<String> = emptyList())
@Serializable
data class CalItem(val date: String = "", val sid: String = "", val id: Long = 0, val title: String = "", val sub: String = "", val poster: String? = null, val overview: String? = null)
@Serializable
data class QueueItem(val title: String = "", val sub: String = "", val status: String = "", val timeleft: String? = null, val progress: Double = 0.0, val poster: String? = null, val meta: String = "")

// ---------- Stack (container status) ----------
@Serializable
data class GoatStatus(
    val vpn: Vpn = Vpn(), val wired: Wired? = null, val engines: List<Engine> = emptyList(),
    val counts: Counts? = null, val container: Boolean = false, val vpnFiles: List<String> = emptyList(),
)
@Serializable
data class Vpn(
    val enabled: Boolean = false, val state: String = "off", val ip: String = "", val country: String = "",
    val port: String = "", val type: String = "", val message: String = "", val apps: List<String> = emptyList(),
)
@Serializable data class Wired(val at: Long = 0, val running: Boolean = false, val steps: Map<String, WireStep> = emptyMap())
@Serializable data class WireStep(val ok: Boolean = false, val error: String? = null)
@Serializable data class Engine(val id: String = "", val key: String = "", val name: String = "", val ok: Boolean? = null)
@Serializable data class Counts(val indexers: Int? = null, val newsServers: Int? = null)

// ---------- Live updates (/api/live) ----------
@Serializable
data class Live(
    val t: Long = 0,
    val qb: Map<String, QbLive> = emptyMap(),
    val sab: Map<String, SabLive> = emptyMap(),
    val plex: Map<String, List<Playing>> = emptyMap(),
    val health: Map<String, Boolean> = emptyMap(),
)
@Serializable
data class QbLive(val dl: Long = 0, val ul: Long = 0, val active: Int = 0, val conn: String = "", val top: List<QbTop> = emptyList())
@Serializable data class QbTop(val hash: String = "", val name: String = "", val progress: Double = 0.0, val speed: Long = 0, val eta: Long = 0, val size: Long = 0)
@Serializable
data class SabLive(val speed: Double = 0.0, val paused: Boolean = false, val slots: Int = 0, val left: String = "", val timeleft: String = "", val jobs: List<SabLiveJob> = emptyList())
@Serializable data class SabLiveJob(val name: String = "", val pct: Double = 0.0)
@Serializable
data class Playing(
    val id: String = "", val user: String = "", val player: String = "", val device: String = "", val state: String = "",
    val title: String = "", val sub: String = "", val kind: String = "", val progress: Double = 0.0, val thumb: String = "",
    val decision: String = "", val res: String = "",
)

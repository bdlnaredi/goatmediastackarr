package com.bdlnaredi.goatstack.data

import kotlinx.serialization.Serializable

// Version 3 pages. Same rule as Models.kt: every field has a default.

// ---------- A movie or show in full (/api/title) ----------
@Serializable
data class TitleInfo(
    val type: String = "movie", val id: Long = 0, val title: String = "", val year: String = "", val date: String = "",
    val tagline: String = "", val overview: String = "", val poster: String = "", val backdrop: String = "", val rating: Double = 0.0,
    val runtime: Int = 0, val genres: List<String> = emptyList(), val status: String = "", val studio: String = "",
    val cast: List<CastMember> = emptyList(), val seasons: List<TitleSeason> = emptyList(), val trailer: String = "",
    val seerr: String = "", val available: Int = 0, val library: LibLink? = null, val request: ReqState? = null,
    val similar: List<MediaCard> = emptyList(), val watch: Boolean = false, val collection: CollRef? = null,
)
@Serializable data class CollRef(val id: Long = 0, val name: String = "", val poster: String = "")

// ---------- Watchlist, collections, "Because you watched", missing episodes ----------
@Serializable data class WatchItem(
    val uid: String = "", val type: String = "movie", val id: Long = 0, val title: String = "", val year: String = "", val poster: String = "",
    val added: Long = 0, val inLib: Boolean = false, val wanted: Boolean = false, val request: String = "",
)
@Serializable data class Watchlist(val auto: Boolean = false, val items: List<WatchItem> = emptyList())
/** The answer to adding: [requested] is "approved", "pending", an object with an error, or nothing. */
@Serializable data class WatchAdd(val ok: Boolean = false, val items: List<WatchItem> = emptyList(), val requested: kotlinx.serialization.json.JsonElement? = null)
@Serializable data class ForYou(val rows: List<ForYouRow> = emptyList())
@Serializable data class ForYouRow(val because: Because = Because(), val source: String = "", val items: List<MediaCard> = emptyList())
@Serializable data class Because(val type: String = "movie", val id: Long = 0, val title: String = "")
@Serializable data class TitleCollection(
    val id: Long = 0, val name: String = "", val overview: String = "", val poster: String = "", val backdrop: String = "", val seerr: String = "",
    val parts: List<CollPart> = emptyList(),
)
@Serializable data class CollPart(
    val type: String = "movie", val id: Long = 0, val title: String = "", val year: String = "", val poster: String = "",
    val rating: Double = 0.0, val available: Int = 0, val inLib: Boolean = false, val requested: Boolean = false,
)
@Serializable data class CollAsk(val asked: Int = 0, val approved: Int = 0, val waiting: Int = 0, val errors: List<String> = emptyList())
@Serializable data class TitleEpisode(
    val season: Int = 0, val num: Int = 0, val title: String = "", val date: String = "", val aired: Boolean = false,
    val has: Boolean = false, val monitored: Boolean = false, val asked: Boolean = false,
)
/** Self-healing on the Health page: its settings and what it fixed. */
@Serializable data class Heal(val cfg: HealCfg = HealCfg(), val log: List<HealEntry> = emptyList())
@Serializable data class HealCfg(val on: Boolean = true, val stuck: Boolean = true, val failed: Boolean = true, val apps: Boolean = true, val hours: Int = 24)
@Serializable data class HealEntry(val at: Long = 0, val kind: String = "", val app: String = "", val title: String = "", val what: String = "")

@Serializable data class CastMember(val id: Long = 0, val name: String = "", val role: String = "", val photo: String = "")
/** A small poster card: "More like this" and a person's filmography. [available] is Seerr's status (5 = available). */
@Serializable
data class MediaCard(
    val type: String = "movie", val id: Long = 0, val title: String = "", val year: String = "", val poster: String = "",
    val rating: Double = 0.0, val available: Int = 0, val inLib: Boolean = false, val role: String = "", val crew: Boolean = false,
)
/** One actor or film maker (/api/person), with everything they were in, newest first. */
@Serializable
data class PersonInfo(
    val id: Long = 0, val name: String = "", val photo: String = "", val bio: String = "", val born: String = "", val died: String = "",
    val place: String = "", val known: String = "", val seerr: String = "", val credits: List<MediaCard> = emptyList(),
)
@Serializable data class TitleSeason(val n: Int = 0, val episodes: Int = 0, val name: String = "", val date: String = "")
@Serializable data class LibLink(val sid: String = "", val id: Long = 0, val kind: String = "movie")
@Serializable data class ReqState(val status: String = "", val stage: String = "")

// ---------- What someone uses (/api/usage) ----------
@Serializable
data class Usage(
    val id: String = "", val name: String = "", val requests: ReqCounts = ReqCounts(), val reqLimit: ReqLimit? = null,
    val space: Space? = null, val limitGb: Int = 0, val watch: List<WatchTime>? = null, val devices: Int = 0,
    val stream: StreamUse? = null,
)

/** Streaming from Plex and Jellyfin this calendar month. [limitGb] 0 means no limit; [custom] false means the default applies. */
@Serializable
data class StreamUse(
    val month: String = "", val bytes: Long = 0, val all: Long = 0, val wan: Long = 0, val limitGb: Double = 0.0, val custom: Boolean = false,
    val defaultGb: Double = 100.0, val wanOnly: Boolean = false, val resets: Long = 0, val history: List<MonthUse> = emptyList(),
)
@Serializable data class MonthUse(val month: String = "", val bytes: Long = 0)

/** Everyone's streaming this month (/api/streaming), for admins. */
@Serializable
data class StreamAll(
    val month: String = "", val months: List<String> = emptyList(), val defaultGb: Double = 100.0, val wanOnly: Boolean = false,
    val resets: Long = 0, val users: List<StreamRow> = emptyList(),
)
@Serializable data class StreamRow(val id: String = "", val name: String = "", val profile: Boolean = false, val bytes: Long = 0, val all: Long = 0, val wan: Long = 0, val limitGb: Double = 0.0)
@Serializable data class ReqCounts(val total: Int = 0, val month: Int = 0, val approved: Int = 0, val pending: Int = 0, val declined: Int = 0)
@Serializable data class ReqLimit(val n: Int = 0, val days: Int = 7)
@Serializable data class Space(val bytes: Long = 0, val items: List<SpaceItem> = emptyList())
@Serializable data class SpaceItem(val title: String = "", val year: String = "", val mediaType: String = "movie", val mediaId: Long = 0, val poster: String = "", val size: Long = 0)
@Serializable data class WatchTime(val days: Int = 0, val plays: Int = 0, val seconds: Long = 0)

// ---------- Signed-in devices (/api/sessions) ----------
@Serializable
data class Device(val id: String = "", val user: String = "", val device: String = "", val ip: String = "", val at: Long = 0, val seen: Long = 0, val current: Boolean = false)

// ---------- RSS (qBittorrent) ----------
@Serializable data class RssFeed(val path: String = "", val name: String = "", val url: String = "", val unread: Int = 0, val total: Int = 0, val error: Boolean = false)
@Serializable data class RssArticle(val id: String = "", val title: String = "", val date: String = "", val feed: String = "", val read: Boolean = false)

// ---------- Download categories and tags (/api/qb/{sid}/meta) ----------
@Serializable data class QbMeta(val free: Long = 0, val categories: List<QbCategory> = emptyList(), val tags: List<String> = emptyList())
@Serializable data class QbCategory(val name: String = "", val path: String = "")

/** The newest release on GitHub (/api/updates), and whether the server itself is behind (told to admins only). */
@Serializable
data class Updates(val server: String = "", val latest: String = "", val url: String = "", val apk: String = "", val published: String = "", val notes: String = "", val serverUpdate: Boolean = false)

object Versions {
    private fun parts(v: String) = v.removePrefix("v").split('.', '-').take(3).map { it.toIntOrNull() ?: 0 } .let { it + List(3 - it.size) { 0 } }
    /** True when [a] is a later version than [b] ("0.3.10" is later than "0.3.9"; "0.0.41-dev" counts as 0.0.41). */
    fun newer(a: String, b: String): Boolean {
        if (a.isBlank()) return false
        val x = parts(a); val y = parts(b)
        for (i in 0..2) if (x[i] != y[i]) return x[i] > y[i]
        return false
    }
}

// ---------- Notifications (/api/notifications) ----------
@Serializable data class Feed(val last: Long = 0, val read: Long = 0, val items: List<FeedItem> = emptyList())
@Serializable data class FeedItem(val id: Long = 0, val at: Long = 0, val kind: String = "", val title: String = "", val body: String = "", val link: String = "")

// ---------- Trackers: searching them, and their websites (/api/sites, /api/trackers) ----------
@Serializable data class SiteInfo(val id: String = "", val name: String = "", val url: String = "", val vpn: Boolean = true, val category: String = "", val signedIn: Boolean = false)
@Serializable data class TrackerHit(val id: String = "", val title: String = "", val size: Long = 0, val seeders: Int = 0, val leechers: Int = 0, val indexer: String = "", val date: String = "", val info: String = "")
@Serializable data class OpenReply(val url: String = "", val direct: Boolean = false, val site: String = "")

/** One release an indexer has for a movie or episode (interactive search). */
@Serializable data class Release(
    val guid: String = "", val indexerId: Int = 0, val title: String = "", val size: Long = 0, val seeders: Int = 0, val leechers: Int = 0,
    val indexer: String = "", val quality: String = "", val age: Int = 0, val rejected: Boolean = false, val why: String = "",
    val langs: List<String> = emptyList(), val link: String = "", val protocol: String = "", val group: String = "",
)

/** The answer to downloading several RSS articles at once: how many were added, and the titles that had no link. */
@Serializable data class RssBatch(val added: Int = 0, val failed: List<String> = emptyList())

// ---------- What's new (/api/changelog) ----------
@Serializable
data class Changelog(val current: String = "", val versions: List<ChangeVersion> = emptyList())
@Serializable
data class ChangeVersion(val version: String = "", val date: String = "", val items: List<String> = emptyList(), val current: Boolean = false, val next: Boolean = false)

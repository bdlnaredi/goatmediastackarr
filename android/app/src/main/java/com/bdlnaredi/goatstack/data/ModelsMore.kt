package com.bdlnaredi.goatstack.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Version 2 pages. Same rule as Models.kt: every field has a default.

// ---------- Indexers (Prowlarr) ----------
@Serializable data class IndexerList(val health: List<String> = emptyList(), val indexers: List<Indexer> = emptyList())
@Serializable
data class Indexer(val id: Int = 0, val name: String = "", val protocol: String = "", val enabled: Boolean = false, val priority: Int = 0, val status: String = "ok", val until: String = "")
@Serializable data class IndexerTest(val id: Int = 0, val ok: Boolean = false, val error: String = "")

// ---------- Health (/api/libhealth) ----------
@Serializable
data class AppHealth(
    val id: String = "", val name: String = "", val type: String = "", val ok: Boolean = false, val error: String? = null,
    val issues: List<Issue> = emptyList(), val disks: List<Disk> = emptyList(), val queue: List<QueueProblem> = emptyList(), val missing: Int? = null,
)
@Serializable data class Issue(val level: String = "warn", val text: String = "")
@Serializable data class Disk(val path: String = "", val free: Long = 0, val total: Long = 0)
@Serializable data class QueueProblem(val title: String = "", val message: String = "")

// ---------- Stats (Tautulli) ----------
@Serializable
data class Stats(
    val days: Int = 30, val own: Boolean = false, val movies: List<TopItem> = emptyList(), val tv: List<TopItem> = emptyList(),
    val users: List<TopUser> = emptyList(), val totals: Totals = Totals(), val byDate: Chart? = null, val byHour: Chart? = null,
    val byPlatform: Chart? = null, val history: List<Watched> = emptyList(),
)
@Serializable data class TopItem(val title: String = "", val plays: Int = 0, val thumb: String = "", val year: JsonElement? = null)
@Serializable data class TopUser(val title: String = "", val plays: Int = 0, val seconds: Long = 0)
@Serializable data class Totals(val plays: Long = 0, val seconds: Long = 0)
@Serializable data class Chart(val categories: List<String> = emptyList(), val series: List<Series> = emptyList()) {
    /** Every series added up, one number per category. */
    val totals: List<Double> get() = categories.indices.map { i -> series.sumOf { it.data.getOrNull(i) ?: 0.0 } }
}
@Serializable data class Series(val name: String = "", val data: List<Double> = emptyList())
@Serializable
data class Watched(val user: String = "", val title: String = "", val type: String = "", val at: Long = 0, val player: String = "", val pct: Int = 0, val thumb: String = "")

// ---------- Wanted ----------
@Serializable data class WantedPage(val total: Int = 0, val items: List<WantedItem> = emptyList())
@Serializable
data class WantedItem(val id: Long = 0, val title: String = "", val sub: String = "", val date: String? = null, val poster: String? = null, val overview: String = "")

// ---------- Subtitles (Bazarr) ----------
@Serializable data class SubsWanted(val episodes: List<SubEpisode> = emptyList(), val movies: List<SubMovie> = emptyList(), val total: Int = 0)
@Serializable
data class SubEpisode(val id: Long = 0, val seriesId: Long = 0, val title: String = "", val ep: String = "", val name: String = "", val missing: List<SubLang> = emptyList())
@Serializable data class SubMovie(val id: Long = 0, val title: String = "", val missing: List<SubLang> = emptyList())
@Serializable data class SubLang(val code: String = "", val name: String = "", val forced: Boolean = false, val hi: Boolean = false)
@Serializable data class SubResult(val found: Int = 0, val of: Int = 0)

// ---------- Music (Lidarr) ----------
@Serializable data class MusicLibrary(val missing: Int = 0, val items: List<Artist> = emptyList())
@Serializable
data class Artist(
    val id: Long = 0, val title: String = "", val overview: String = "", val poster: String = "", val monitored: Boolean = false,
    val genres: List<String> = emptyList(), val added: String = "", val size: Long = 0, val have: Int = 0, val total: Int = 0, val count: Int = 0,
)
@Serializable
data class MusicLookup(val results: List<LookupHit> = emptyList(), val folders: List<Folder> = emptyList(), val profiles: List<Profile> = emptyList(), val meta: List<Profile> = emptyList())

// ---------- Usenet servers (SABnzbd) ----------
@Serializable
data class NewsServer(
    val name: String = "", val displayname: String = "", val host: String = "", val port: Int = 0, val ssl: Boolean = false,
    val username: String = "", val hasPassword: Boolean = false, val connections: Int = 0, val enable: Boolean = false, val priority: Int = 0,
)
@Serializable data class ServerTest(val ok: Boolean = false, val message: String = "")

// ---------- Unraid ----------
@Serializable
data class Unraid(
    val host: String = "", val arrayState: String = "", val used: Long = 0, val total: Long = 0, val cpu: Double = 0.0, val mem: Double = 0.0,
    val memTotal: Long = 0, val memUsed: Long = 0, val uptime: String = "", val cpuInfo: CpuInfo? = null,
    val containers: List<Container> = emptyList(), val disks: List<UnraidDisk> = emptyList(), val shares: List<Share> = emptyList(),
    val errors: List<String> = emptyList(),
)
@Serializable data class CpuInfo(val brand: String = "", val cores: Int = 0, val threads: Int = 0, val ghz: Double = 0.0)
@Serializable data class Container(val id: String = "", val name: String = "", val state: String = "") { val running get() = state.equals("running", true) }
@Serializable data class UnraidDisk(val name: String = "", val role: String = "", val temp: JsonElement? = null, val status: String = "")
@Serializable data class Share(val name: String = "", val free: Long = 0, val used: Long = 0, val size: Long = 0)

// ---------- Profiles (users) ----------
@Serializable
data class Profile2(val id: String = "", val name: String = "", val role: String = "user", val email: String = "", val twofa: Boolean = false, val plex: PlexName? = null, val avatar: String = "", val dataLimit: Int = 0)

// ---------- Bringing in an existing setup ----------
@Serializable
data class ImportPlan(
    val kind: String = "", val total: Int = 0, val already: Int = 0, val todo: Int = 0, val roots: List<String> = emptyList(),
    val newRoots: List<String> = emptyList(), val suggest: List<List<String>> = emptyList(), val settings: ImportSettings? = null,
)
@Serializable data class ImportSettings(val profiles: List<String> = emptyList(), val formats: Int = 0)
@Serializable
data class ImportJob(
    val state: String = "idle", val kind: String = "", val phase: String = "", val done: Int = 0, val total: Int = 0,
    val added: Int = 0, val skipped: Int = 0, val failed: List<ImportFail> = emptyList(), val error: String? = null,
)
@Serializable data class ImportFail(val name: String? = null, val error: String = "")

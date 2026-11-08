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
@Serializable data class Disk(val path: String = "", val label: String = "", val free: Long = 0, val total: Long = 0)
@Serializable data class QueueProblem(val title: String = "", val message: String = "")

// ---------- Stats (Tautulli) ----------
@Serializable
data class Stats(
    val days: Int = 30, val own: Boolean = false, val movies: List<TopItem> = emptyList(), val tv: List<TopItem> = emptyList(),
    val users: List<TopUser> = emptyList(), val totals: Totals = Totals(), val byDate: Chart? = null, val byHour: Chart? = null,
    val byPlatform: Chart? = null, val history: List<Watched> = emptyList(),
)
@Serializable data class TopItem(val title: String = "", val plays: Int = 0, val thumb: String = "", val year: JsonElement? = null, val lib: LibLink? = null)
@Serializable data class TopUser(val title: String = "", val plays: Int = 0, val seconds: Long = 0)
@Serializable data class Totals(val plays: Long = 0, val seconds: Long = 0)
@Serializable data class Chart(val categories: List<String> = emptyList(), val series: List<Series> = emptyList()) {
    /** Every series added up, one number per category. */
    val totals: List<Double> get() = categories.indices.map { i -> series.sumOf { it.data.getOrNull(i) ?: 0.0 } }
}
@Serializable data class Series(val name: String = "", val data: List<Double> = emptyList())
@Serializable
data class Watched(val user: String = "", val title: String = "", val type: String = "", val at: Long = 0, val player: String = "", val pct: Int = 0, val thumb: String = "", val lib: LibLink? = null)

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
    val errors: List<String> = emptyList(), val updates: Map<String, Boolean> = emptyMap(),
)
@Serializable data class CpuInfo(val brand: String = "", val cores: Int = 0, val threads: Int = 0, val ghz: Double = 0.0)
@Serializable data class Container(val id: String = "", val name: String = "", val state: String = "") { val running get() = state.equals("running", true) }
@Serializable data class UnraidDisk(val name: String = "", val role: String = "", val temp: JsonElement? = null, val status: String = "")
@Serializable data class Share(val name: String = "", val free: Long = 0, val used: Long = 0, val size: Long = 0)

// ---------- Profiles (users) ----------
@Serializable
data class Profile2(val id: String = "", val name: String = "", val role: String = "user", val email: String = "", val twofa: Boolean = false, val plex: PlexName? = null, val avatar: String = "", val dataLimit: Int = 0, val streamLimit: Double? = null)

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

// ---------- Every app's warnings (/api/warnings) ----------
@Serializable data class Warning(val sid: String = "", val app: String = "", val type: String = "", val level: String = "warn", val text: String = "", val wiki: String = "", val fix: String = "")
@Serializable data class WarnFixed(val done: String = "")

// ---------- Alerts and newsletters ----------
@Serializable data class AlertsInfo(val events: List<String> = emptyList(), val meta: Map<String, EventMeta> = emptyMap(), val channels: List<AlertChannel> = emptyList(), val ops: Map<String, String> = emptyMap())
@Serializable data class EventMeta(val name: String = "", val group: String = "", val params: List<String> = emptyList(), val subject: String = "", val body: String = "")
@Serializable data class AlertChannel(val id: String = "", val type: String = "", val name: String = "", val events: List<String> = emptyList(),
    val tpl: Map<String, AlertText> = emptyMap(), val conds: List<AlertCond> = emptyList(), val condMode: String = "all")
@Serializable data class AlertText(val subject: String = "", val body: String = "")
@Serializable data class AlertCond(val p: String = "", val op: String = "is", val v: String = "")
@Serializable data class AlertPreview(val subject: String = "", val body: String = "")
@Serializable data class Newsletters(val list: List<Newsletter> = emptyList())
@Serializable data class Newsletter(val id: String = "", val name: String = "", val on: Boolean = false, val every: String = "week", val day: Int = 0, val hour: Int = 9, val days: Int = 7, val next: Long = 0)
@Serializable data class SendResult(val sent: Int = 0, val empty: Boolean = false, val errors: List<String> = emptyList(), val results: List<SendOne> = emptyList())
@Serializable data class SendOne(val ok: Boolean = false, val error: String? = null)

// ---------- Chat apps (/api/me/chats) ----------
@Serializable data class ChatState(val telegram: Boolean = false, val discord: Boolean = false, val bots: ChatBots = ChatBots())
@Serializable data class ChatBots(val telegram: String = "", val discord: String = "")
@Serializable data class ChatCode(val code: String = "", val minutes: Int = 15)

// ---------- Data per day (/api/traffic) ----------
@Serializable data class Traffic(val days: List<TrafficDay> = emptyList(), val total: TrafficTotal = TrafficTotal(), val usenetOn: Boolean = false)
@Serializable data class TrafficDay(val date: String = "", val dl: Long = 0, val ul: Long = 0, val usenet: Long = 0)
@Serializable data class TrafficTotal(val dl: Long = 0, val ul: Long = 0)

// ---------- Importing a finished download (/api/import/look) ----------
@Serializable data class ImportLook(val name: String = "", val apps: List<ImportApp> = emptyList())
@Serializable data class ImportApp(val sid: String = "", val name: String = "", val type: String = "", val files: List<ImportFile> = emptyList(), val error: String = "")
@Serializable data class ImportFile(val path: String = "", val name: String = "", val size: Long = 0, val q: String = "", val quality: kotlinx.serialization.json.JsonElement? = null,
    val languages: List<kotlinx.serialization.json.JsonElement> = emptyList(), val releaseGroup: String = "", val match: ImportMatch? = null, val season: Int? = null,
    val episodes: List<ImportEp> = emptyList(), val why: List<String> = emptyList())
@Serializable data class ImportMatch(val id: Long = 0, val title: String = "")
@Serializable data class ImportEp(val id: Long = 0, val season: Int = 0, val num: Int = 0, val title: String = "")
@Serializable data class ImportResult(val imported: Int = 0)

// Continue watching (/api/plex|jellyfin/:sid/now): what the person started and has not finished.
@kotlinx.serialization.Serializable
data class MediaNow(val cont: List<ContItem> = emptyList(), val machine: String = "", val server: String = "")
@kotlinx.serialization.Serializable
data class ContItem(val title: String = "", val sub: String = "", val thumb: String = "", val key: String = "", val progress: Double = 0.0, val next: Boolean = false)

// Subtitles for one title (/api/subs): its Bazarr language profile, what it has and what it misses.
@kotlinx.serialization.Serializable
data class SubProfile(val id: Int = 0, val name: String = "")
@kotlinx.serialization.Serializable
data class TitleSubs(val bazarr: String = "", val known: Boolean = false, val profiles: List<SubProfile> = emptyList(), val profile: Int? = null,
    val have: List<SubLang> = emptyList(), val missing: List<SubLang> = emptyList(), val missingEps: Int? = null)

// Before a request is sent (/api/request/estimate): about how big it is, and whether it goes through by itself.
@kotlinx.serialization.Serializable
data class ReqEstimate(val bytes: Long = 0, val minutes: Int = 0, val episodes: Int = 0, val quality: String = "", val approve: String = "admin", val rule: String = "",
    val left: Int? = null, val days: Int? = null)

// Year in review (/api/wrapped).
@kotlinx.serialization.Serializable
data class WrapTop(val title: String = "", val plays: Int = 0, val seconds: Long = 0, val thumb: String = "")
@kotlinx.serialization.Serializable
data class WrapBinge(val title: String = "", val date: String = "", val episodes: Int = 0)
@kotlinx.serialization.Serializable
data class WrapFirst(val title: String = "", val date: String = "")
@kotlinx.serialization.Serializable
data class WrapWatch(val plays: Int = 0, val seconds: Long = 0, val episodes: Int = 0, val movies: Int = 0, val topShows: List<WrapTop> = emptyList(), val topMovies: List<WrapTop> = emptyList(),
    val day: String = "", val hour: Int? = null, val months: List<Long> = emptyList(), val binge: WrapBinge? = null, val first: WrapFirst? = null, val devices: List<String> = emptyList(), val people: List<WrapTop>? = null)
@kotlinx.serialization.Serializable
data class WrapReq(val made: Int = 0, val ready: Int = 0, val movies: Int = 0, val shows: Int = 0)
@kotlinx.serialization.Serializable
data class WrapPerson(val id: String = "", val name: String = "")
@kotlinx.serialization.Serializable
data class Wrapped(val year: Int = 0, val name: String = "", val watch: WrapWatch? = null, val note: String = "", val sid: String = "", val requests: WrapReq = WrapReq(), val people: List<WrapPerson>? = null)

// A tracker in Prowlarr, to search on its own (/api/trackers/indexers).
@kotlinx.serialization.Serializable
data class TrkIndexer(val id: Int = 0, val name: String = "", val protocol: String = "")

// How often qBittorrent checks the RSS feeds (/api/rss/:sid/settings).
@kotlinx.serialization.Serializable
data class RssSettings(val interval: Int = 30, val max: Int = 50, val on: Boolean = true, val rules: Boolean = true)

// ---------- Suggestions (/api/suggestions) ----------
@kotlinx.serialization.Serializable data class SugIssue(val number: Int = 0, val url: String = "")
@kotlinx.serialization.Serializable data class Suggestion(val id: String = "", val title: String = "", val body: String = "", val kind: String = "feature", val at: Long = 0,
    val status: String = "new", val issue: SugIssue? = null, val votes: Int = 0, val voted: Boolean = false, val mine: Boolean = false, val user: String? = null)
@kotlinx.serialization.Serializable data class SugList(val items: List<Suggestion> = emptyList(), val repo: String = "", val names: Boolean = false, val token: Boolean = false)

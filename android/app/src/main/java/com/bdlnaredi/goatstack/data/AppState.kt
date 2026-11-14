package com.bdlnaredi.goatstack.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Where the app is: still starting, needs a server address, needs a sign-in, or ready to use. */
sealed interface Phase {
    data object Starting : Phase
    data object NeedServer : Phase
    data class NeedLogin(val me: Me) : Phase
    data class Ready(val me: Me, val user: User) : Phase
    data class Offline(val message: String) : Phase
}

class AppState(val store: Store) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val api = Api(onSession = { s -> scope.launch { store.setSid(s) } })

    private val _phase = MutableStateFlow<Phase>(Phase.Starting)
    val phase: StateFlow<Phase> = _phase
    private val _theme = MutableStateFlow("goat")
    val theme: StateFlow<String> = _theme
    private val _services = MutableStateFlow<List<Service>>(emptyList())
    val services: StateFlow<List<Service>> = _services
    private val _link = MutableStateFlow<String?>(null)
    /** A page to open, from a tapped notification ("title:movie:5002", "requests", ...). */
    val pendingLink: StateFlow<String?> = _link
    fun openLink(l: String?) { if (!l.isNullOrBlank()) _link.value = l }
    fun linkDone() { _link.value = null }
    private val _updates = MutableStateFlow<Updates?>(null)
    /** The newest release, asked of the server once per start (an older server without the check just leaves it empty). */
    val updates: StateFlow<Updates?> = _updates
    private val _locked = MutableStateFlow(false)
    /** The PIN is to be entered before anything else (the app was opened, or came back after a minute away). */
    val locked: StateFlow<Boolean> = _locked
    // Signed in with the password (or a passkey, or Plex) just now: no PIN for that.
    private var freshSignIn = false
    private var awayAt = 0L
    fun wentAway() { awayAt = System.currentTimeMillis() }
    /** Unlocked by a fingerprint or face, on this phone. */
    fun unlockedByBiometric() { _locked.value = false }
    fun cameBack() {
        val p = _phase.value
        if (awayAt > 0 && System.currentTimeMillis() - awayAt > 60_000 && p is Phase.Ready && p.user.pin) _locked.value = true
        awayAt = 0
    }
    /** Null when the PIN is right; otherwise what to say (5 wrong ones sign this phone out). */
    suspend fun checkPin(pin: String): String? = try {
        api.send("POST", "/api/pin/check", buildJsonObject { put("pin", pin) }); _locked.value = false; null
    } catch (e: Exception) { e.message ?: "That did not work" }
    private val _prefs = MutableStateFlow(Prefs())
    val prefs: StateFlow<Prefs> = _prefs
    var server: String = ""
        private set
    var lastLibrary: String = ""
        private set
    /** The server's address at home (see [watchNetwork]), and whether the app is using it right now. */
    var home: String = ""
        private set
    private val _atHome = MutableStateFlow(false)
    val atHome: StateFlow<Boolean> = _atHome

    init {
        scope.launch {
            // Settings that cannot be read are treated like a first start, never as a reason to hang.
            val s = try { store.load() } catch (_: Exception) { Store.Saved("", null, "goat", "") }
            _theme.value = s.theme
            _prefs.value = s.prefs
            lastLibrary = s.library
            // Only if nothing else (a sign-in, a new server) happened while the settings were being read.
            if (_phase.value is Phase.Starting) {
                server = s.server; home = s.home
                if (s.server.isEmpty()) _phase.value = Phase.NeedServer
                else { api.configure(s.server, s.sid); if (home.isNotEmpty()) pickBase(); refresh() }
            }
        }
        scope.launch { api.signedOut.collect { if (_phase.value is Phase.Ready) refresh() } }
    }

    // ---------- Home address (like nzb360): on Wi-Fi, when the server answers at its home address, the app talks to it
    // there (fast, and it works when the internet is down); anywhere else it uses the main address. Same sign-in.
    private var cm: android.net.ConnectivityManager? = null
    private var pickJob: kotlinx.coroutines.Job? = null

    /** Follows the phone's network, so the app switches between the home and the main address by itself. */
    fun watchNetwork(context: android.content.Context) {
        val c = context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return
        cm = c
        runCatching {
            c.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) { scope.launch { pickBase() } }
                override fun onCapabilitiesChanged(network: android.net.Network, caps: android.net.NetworkCapabilities) { scope.launch { pickBase() } }
                override fun onLost(network: android.net.Network) { scope.launch { pickBase() } }
            })
        }
    }

    private fun onLan(): Boolean {
        val c = cm ?: return true   // not known (tests): try the home address anyway
        val caps = c.getNetworkCapabilities(c.activeNetwork) ?: return false
        return caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** Answers at that address within a couple of seconds, as GoatMediaStackarr. */
    private suspend fun answers(url: String): Boolean = kotlinx.coroutines.withContext(Dispatchers.IO) {
        runCatching {
            val quick = api.client.newBuilder().connectTimeout(2, java.util.concurrent.TimeUnit.SECONDS).readTimeout(3, java.util.concurrent.TimeUnit.SECONDS).build()
            quick.newCall(okhttp3.Request.Builder().url(url.trimEnd('/') + "/api/me").build()).execute().use { r -> r.isSuccessful && (r.body?.string() ?: "").contains("\"version\"") }
        }.getOrDefault(false)
    }

    /** Picks the address to use now. A short wait first, so a burst of network changes is one check. */
    fun pickBase() {
        pickJob?.cancel()
        pickJob = scope.launch {
            kotlinx.coroutines.delay(400)
            if (server.isEmpty()) return@launch
            val useHome = home.isNotEmpty() && onLan() && answers(home)
            val want = if (useHome) home else server
            val was = _atHome.value
            if (api.base != want.trimEnd('/')) api.useBase(want)
            _atHome.value = useHome
            if (was != useHome && _phase.value is Phase.Offline) refresh()
        }
    }

    /** Sets (or clears, with "") the home address. Checks it is this server first; returns a problem in words, or null. */
    suspend fun setHome(address: String): String? {
        if (address.isBlank()) { store.setHome(""); home = ""; pickBase(); return null }
        val url = Api.normalizeServer(address) ?: return "That does not look like an address. Try something like 192.168.1.10:2806"
        if (!answers(url)) return "GoatMediaStackarr did not answer at $url. Check the address, and that this phone is on your home Wi-Fi."
        store.setHome(url); home = url; pickBase()
        return null
    }

    /** Asks the server who we are, and moves to the sign-in or the app accordingly. */
    fun refresh() {
        scope.launch {
            try {
                val me = api.get<Me>("/api/me")
                val u = me.user
                val opening = _phase.value is Phase.Starting || _phase.value is Phase.NeedServer
                if (u == null) { _locked.value = false; _phase.value = Phase.NeedLogin(me) }
                else {
                    if (u.pin && opening && !freshSignIn) _locked.value = true
                    if (!u.pin) _locked.value = false
                    freshSignIn = false
                    loadServices(); _phase.value = Phase.Ready(me, u)
                }
            } catch (e: Exception) {
                _phase.value = Phase.Offline(e.message ?: "Could not reach the server")
            }
        }
    }

    suspend fun loadServices() {
        try { _services.value = api.get("/api/services") } catch (_: Exception) { }
        if (_updates.value == null) scope.launch { try { _updates.value = api.get<Updates>("/api/updates") } catch (_: Exception) { } }
    }

    /** Checks an address really is a GoatMediaStackarr (or MediaHub) server before keeping it. */
    suspend fun connect(address: String): String? {
        val url = Api.normalizeServer(address) ?: return "That does not look like an address. Try something like 192.168.1.10:2806"
        api.configure(url, null)
        return try {
            val me = api.get<Me>("/api/me")
            if (me.version.isEmpty()) return "Something answered at that address, but it is not GoatMediaStackarr."
            store.setServer(url); server = url; home = ""; _atHome.value = false
            if (me.user != null) { loadServices(); _phase.value = Phase.Ready(me, me.user) } else _phase.value = Phase.NeedLogin(me)
            null
        } catch (e: Exception) { e.message ?: "Could not reach it" }
    }

    fun forgetServer() { scope.launch { store.setServer(""); server = ""; api.configure("", null); _services.value = emptyList(); _phase.value = Phase.NeedServer } }

    /** Password sign-in. Returns the two-step ticket when the profile has two-step sign-in turned on. */
    suspend fun login(name: String, password: String): String? {
        val r = api.post<LoginReply>("/api/login", buildJsonObject { put("name", name); put("password", password) })
        if (r.twofa) return r.ticket ?: ""
        freshSignIn = true; refresh(); return null
    }

    suspend fun twoStep(ticket: String, code: String) {
        api.post<LoginReply>("/api/login/2fa", buildJsonObject { put("ticket", ticket); put("code", code) })
        freshSignIn = true; refresh()
    }

    /** Passkey sign-in (Android's Credential Manager), then load the profile it signed in to. */
    suspend fun passkeySignIn(context: android.content.Context) { Passkeys.signIn(context, api); freshSignIn = true; refresh() }

    suspend fun plexStart(): PlexStart = api.post("/api/plexlogin/start")

    /** Admins: links a Plex account to this profile, so it can sign in with Plex too. */
    suspend fun plexLinkStart(): PlexStart = api.post("/api/plexlogin/start", buildJsonObject { put("link", true) })

    /** Null while Plex is still waiting; the updated profile once the Plex account is linked. */
    suspend fun plexLinkPoll(ticket: String): User? {
        val r = api.get<PlexPoll>("/api/plexlogin/poll?t=${Api.enc(ticket)}")
        if (r.pending || !r.linked) return null
        return r.user?.also { updateUser(it) }
    }

    /** True once Plex has said yes and the server has signed us in. */
    suspend fun plexPoll(ticket: String): Boolean {
        val r = api.get<PlexPoll>("/api/plexlogin/poll?t=${Api.enc(ticket)}")
        if (r.pending) return false
        freshSignIn = true; refresh(); return true
    }

    fun logout() {
        scope.launch {
            try { api.send("POST", "/api/logout") } catch (_: Exception) { }
            store.setSid(null); api.configure(server, null); _services.value = emptyList(); refresh()
        }
    }

    fun setPrefs(p: Prefs) { _prefs.value = p; scope.launch { store.setPrefs(p) } }

    /** Called after something changes the signed-in profile (a new picture, say), so every screen shows it. */
    fun updateUser(u: User) { val p = _phase.value; if (p is Phase.Ready) _phase.value = p.copy(user = u, me = p.me.copy(user = u)) }

    fun setTheme(id: String) { _theme.value = id; scope.launch { store.setTheme(id) } }
    fun rememberLibrary(id: String) { lastLibrary = id; scope.launch { store.setLibrary(id) } }
}

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

class AppState(private val store: Store) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val api = Api(onSession = { s -> scope.launch { store.setSid(s) } })

    private val _phase = MutableStateFlow<Phase>(Phase.Starting)
    val phase: StateFlow<Phase> = _phase
    private val _theme = MutableStateFlow("goat")
    val theme: StateFlow<String> = _theme
    private val _services = MutableStateFlow<List<Service>>(emptyList())
    val services: StateFlow<List<Service>> = _services
    private val _prefs = MutableStateFlow(Prefs())
    val prefs: StateFlow<Prefs> = _prefs
    var server: String = ""
        private set
    var lastLibrary: String = ""
        private set

    init {
        scope.launch {
            // Settings that cannot be read are treated like a first start, never as a reason to hang.
            val s = try { store.load() } catch (_: Exception) { Store.Saved("", null, "goat", "") }
            _theme.value = s.theme
            _prefs.value = s.prefs
            lastLibrary = s.library
            // Only if nothing else (a sign-in, a new server) happened while the settings were being read.
            if (_phase.value is Phase.Starting) {
                server = s.server
                if (s.server.isEmpty()) _phase.value = Phase.NeedServer
                else { api.configure(s.server, s.sid); refresh() }
            }
        }
        scope.launch { api.signedOut.collect { if (_phase.value is Phase.Ready) refresh() } }
    }

    /** Asks the server who we are, and moves to the sign-in or the app accordingly. */
    fun refresh() {
        scope.launch {
            try {
                val me = api.get<Me>("/api/me")
                val u = me.user
                if (u == null) _phase.value = Phase.NeedLogin(me)
                else { loadServices(); _phase.value = Phase.Ready(me, u) }
            } catch (e: Exception) {
                _phase.value = Phase.Offline(e.message ?: "Could not reach the server")
            }
        }
    }

    suspend fun loadServices() {
        try { _services.value = api.get("/api/services") } catch (_: Exception) { }
    }

    /** Checks an address really is a GoatMediaStackarr (or MediaHub) server before keeping it. */
    suspend fun connect(address: String): String? {
        val url = Api.normalizeServer(address) ?: return "That does not look like an address. Try something like 192.168.1.10:2806"
        api.configure(url, null)
        return try {
            val me = api.get<Me>("/api/me")
            if (me.version.isEmpty()) return "Something answered at that address, but it is not GoatMediaStackarr."
            store.setServer(url); server = url
            if (me.user != null) { loadServices(); _phase.value = Phase.Ready(me, me.user) } else _phase.value = Phase.NeedLogin(me)
            null
        } catch (e: Exception) { e.message ?: "Could not reach it" }
    }

    fun forgetServer() { scope.launch { store.setServer(""); server = ""; api.configure("", null); _services.value = emptyList(); _phase.value = Phase.NeedServer } }

    /** Password sign-in. Returns the two-step ticket when the profile has two-step sign-in turned on. */
    suspend fun login(name: String, password: String): String? {
        val r = api.post<LoginReply>("/api/login", buildJsonObject { put("name", name); put("password", password) })
        if (r.twofa) return r.ticket ?: ""
        refresh(); return null
    }

    suspend fun twoStep(ticket: String, code: String) {
        api.post<LoginReply>("/api/login/2fa", buildJsonObject { put("ticket", ticket); put("code", code) })
        refresh()
    }

    suspend fun plexStart(): PlexStart = api.post("/api/plexlogin/start")

    /** True once Plex has said yes and the server has signed us in. */
    suspend fun plexPoll(ticket: String): Boolean {
        val r = api.get<PlexPoll>("/api/plexlogin/poll?t=${Api.enc(ticket)}")
        if (r.pending) return false
        refresh(); return true
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

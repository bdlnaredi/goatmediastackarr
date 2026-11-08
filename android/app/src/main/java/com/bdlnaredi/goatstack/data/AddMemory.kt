package com.bdlnaredi.goatstack.data

import android.content.Context

/**
 * The last choices made when adding or requesting a show or movie (quality, folder, what to monitor…), kept on this
 * phone for each kind ("sonarr" for shows, "radarr" for movies) and offered again next time, in Search and Discover.
 */
class AddMemory(context: Context, private val kind: String) {
    private val sp = context.getSharedPreferences("addopts", Context.MODE_PRIVATE)
    private fun k(n: String) = "$kind.$n"
    var profile: Int get() = sp.getInt(k("profile"), 0); set(v) { sp.edit().putInt(k("profile"), v).apply() }
    var folder: String get() = sp.getString(k("folder"), "") ?: ""; set(v) { sp.edit().putString(k("folder"), v).apply() }
    /** Shows: all, future, missing, existing, firstSeason, latestSeason, pilot, none. Movies: "1" or "0". */
    var monitor: String get() = sp.getString(k("monitor"), "") ?: ""; set(v) { sp.edit().putString(k("monitor"), v).apply() }
    var avail: String get() = sp.getString(k("avail"), "") ?: ""; set(v) { sp.edit().putString(k("avail"), v).apply() }
    var seriesType: String get() = sp.getString(k("stype"), "standard") ?: "standard"; set(v) { sp.edit().putString(k("stype"), v).apply() }
    var seasonFolder: Boolean get() = sp.getBoolean(k("sfold"), true); set(v) { sp.edit().putBoolean(k("sfold"), v).apply() }
    var search: Boolean get() = sp.getBoolean(k("search"), true); set(v) { sp.edit().putBoolean(k("search"), v).apply() }

    companion object { fun kindOf(mediaType: String) = if (mediaType == "tv") "sonarr" else "radarr" }
}

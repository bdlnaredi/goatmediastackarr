package com.bdlnaredi.goatstack.ui

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.pow

/** Plain-Kotlin helpers for showing numbers and dates. No Android here, so they are unit tested. */
object Format {
    fun bytes(n: Long): String {
        if (n < 1024) return "$n B"
        val units = listOf("KB", "MB", "GB", "TB", "PB")
        val e = (ln(n.toDouble()) / ln(1024.0)).toInt().coerceIn(1, units.size)
        val v = n / 1024.0.pow(e)
        return String.format(Locale.US, if (v >= 100) "%.0f %s" else if (v >= 10) "%.1f %s" else "%.2f %s", v, units[e - 1])
    }

    fun speed(bytesPerSecond: Long): String = if (bytesPerSecond <= 0) "0 B/s" else bytes(bytesPerSecond) + "/s"

    /** qBittorrent sends 8640000 for "no idea", so anything that long reads as "∞". */
    fun eta(seconds: Long): String = when {
        seconds < 0 || seconds >= 8640000 -> "∞"
        seconds < 60 -> "${seconds}s"
        seconds < 3600 -> "${seconds / 60}m ${seconds % 60}s"
        seconds < 86400 -> "${seconds / 3600}h ${(seconds % 3600) / 60}m"
        else -> "${seconds / 86400}d ${(seconds % 86400) / 3600}h"
    }

    fun percent(fraction: Double): String = "${(fraction.coerceIn(0.0, 1.0) * 100).toInt()}%"

    fun parseDate(s: String): Instant? = try {
        when {
            s.isBlank() -> null
            s.length == 10 -> LocalDate.parse(s).atStartOfDay(ZoneId.systemDefault()).toInstant()
            else -> OffsetDateTime.parse(s).toInstant()
        }
    } catch (_: Exception) { try { Instant.parse(s) } catch (_: Exception) { null } }

    /** "Today", "Tomorrow", "Wed 22 Oct" — for the calendar. */
    fun day(s: String, today: LocalDate = LocalDate.now()): String {
        val d = parseDate(s)?.atZone(ZoneId.systemDefault())?.toLocalDate() ?: return s
        return when (ChronoUnit.DAYS.between(today, d)) {
            0L -> "Today"
            1L -> "Tomorrow"
            -1L -> "Yesterday"
            else -> d.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()))
        }
    }

    fun time(s: String): String {
        if (s.length <= 10) return ""
        val z = parseDate(s)?.atZone(ZoneId.systemDefault()) ?: return ""
        return z.format(DateTimeFormatter.ofPattern("HH:mm"))
    }

    /** "3 min ago", "2 days ago" from milliseconds. */
    fun ago(ms: Long, now: Long = System.currentTimeMillis()): String {
        val s = abs(now - ms) / 1000
        return when {
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86400 -> "${s / 3600} h ago"
            s < 86400 * 30 -> "${s / 86400} day${if (s / 86400 == 1L) "" else "s"} ago"
            else -> Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate().format(DateTimeFormatter.ofPattern("d MMM yyyy"))
        }
    }

    fun ep(season: Int, num: Int): String = "S%02dE%02d".format(season, num)

    /** What a qBittorrent state means, in words. */
    fun torrentState(state: String): String = when {
        state.startsWith("paused") || state.startsWith("stopped") -> if (state.endsWith("UP")) "Finished" else "Paused"
        state in setOf("downloading", "forcedDL") -> "Downloading"
        state in setOf("metaDL", "forcedMetaDL") -> "Getting info"
        state in setOf("stalledDL") -> "Waiting for peers"
        state in setOf("uploading", "forcedUP", "stalledUP") -> "Seeding"
        state.startsWith("queued") -> "Queued"
        state.startsWith("checking") -> "Checking"
        state == "error" || state == "missingFiles" -> "Problem"
        else -> state.replaceFirstChar { it.uppercase() }
    }
}

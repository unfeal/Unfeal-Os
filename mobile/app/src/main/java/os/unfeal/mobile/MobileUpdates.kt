package os.unfeal.mobile

import org.json.JSONArray
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal object MobileUpdates {
    private val tagPattern = Regex("mobile-v(\\d+)\\.(\\d+)\\.(\\d+)")
    private val versionPattern = Regex("(\\d+)\\.(\\d+)\\.(\\d+)")
    private const val repository = "unfeal/Unfeal-Os"

    data class Release(val version: String, val url: String)
    private fun parts(match: MatchResult) =
        match.groupValues.drop(1).map { it.toIntOrNull() ?: 0 }
    private fun compare(left: List<Int>, right: List<Int>): Int =
        left.zip(right).map { (a, b) -> a.compareTo(b) }.firstOrNull { it != 0 } ?: 0

    fun check(installed: String): Release? {
        val current = parts(requireNotNull(versionPattern.matchEntire(installed)))
        val connection = URL("https://api.github.com/repos/$repository/releases?per_page=100")
            .openConnection() as HttpsURLConnection
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        try {
            check(connection.responseCode == 200)
            val releases = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
            var newest = current
            var update: Release? = null
            for (index in 0 until releases.length()) {
                val release = releases.getJSONObject(index)
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue
                val tag = release.optString("tag_name")
                val match = tagPattern.matchEntire(tag) ?: continue
                val version = parts(match)
                val assets = release.optJSONArray("assets") ?: continue
                if (compare(version, newest) <= 0 || (0 until assets.length()).none {
                    assets.getJSONObject(it).optString("name") == "UNFEAL-Mobile.apk"
                }) continue
                newest = version
                update = Release(tag.removePrefix("mobile-v"), "https://github.com/$repository/releases/tag/$tag")
            }
            return update
        } finally {
            connection.disconnect()
        }
    }
}

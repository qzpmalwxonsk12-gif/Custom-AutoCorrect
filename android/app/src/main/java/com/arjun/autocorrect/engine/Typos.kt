package com.arjun.autocorrect.engine

/**
 * High-precision typo table retained from the original engine.
 *
 * The correction engine cross-checks each left-hand side against the bundled
 * ESDB dictionary before applying it, because a few strings ("abut", "wont")
 * also have legitimate real-word uses.
 *
 * Two-letter entries such as `im -> i'm` live here because the candidate
 * generator has a three-character floor; the capitalisation rule then lifts the
 * result to "I'm".
 */
object Typos {

    @Volatile
    private var table: Map<String, String> = emptyMap()

    @Volatile
    var isReady: Boolean = false
        private set

    val size: Int get() = table.size

    /** Each line is `<typo>\t<correction>`. */
    fun install(lines: Sequence<String>) {
        val map = HashMap<String, String>(512)
        for (line in lines) {
            val tab = line.indexOf('\t')
            if (tab <= 0) continue
            val key = line.substring(0, tab).trim()
            val value = line.substring(tab + 1).trim()
            if (key.isNotEmpty() && value.isNotEmpty() && key != value) map[key] = value
        }
        table = map
        isReady = true
    }

    fun lookup(word: String): String? = table[normaliseRuleText(word)]

    /** Test support. */
    fun reset() {
        table = emptyMap()
        isReady = false
    }
}

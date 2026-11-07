package com.arjun.autocorrect.engine

/**
 * Corpus word-frequency lookup.
 *
 * The table is a small number of quantised bands rather than an exact rank per
 * word: the precision is deliberately coarse, and the whole point is that a
 * lookup is one hash hit. This sits alongside the legacy prior in
 * [frequencyScore] rather than replacing it - the legacy prior still
 * contributes to generation scoring, this table feeds the separately measured
 * frequency term at weight [FREQUENCY_WEIGHT].
 */
object Frequency {

    /** Rank of a word the table does not list. */
    const val UNRANKED = 0

    /** Highest band value, for callers normalising into 0..1. */
    const val MAX_RANK = 255

    /** Penalty applied to a rank inherited from a base word. */
    const val INFLECTION_PENALTY = 32

    @Volatile
    private var table: Map<String, Int> = emptyMap()

    @Volatile
    var isReady: Boolean = false
        private set

    val size: Int get() = table.size

    /**
     * Installs the packed bands.
     *
     * Each line is `<bandValue>\t<space separated words>`, which is the shape
     * `android/tools/generate-assets.mjs` writes.
     */
    fun install(lines: Sequence<String>) {
        val map = HashMap<String, Int>(1 shl 16)
        for (line in lines) {
            val tab = line.indexOf('\t')
            if (tab <= 0) continue
            val value = line.substring(0, tab).trim().toIntOrNull() ?: continue
            for (word in line.substring(tab + 1).split(' ')) {
                if (word.isNotEmpty()) map[word] = value
            }
        }
        table = map
        isReady = true
    }

    /**
     * Resolves a word's band against an arbitrary lookup.
     *
     * Split out from [rank] so the inheritance fallback can be tested against
     * synthetic data: a real 50,000-entry corpus lists both "work" and
     * "working" directly, so no real pair reliably exercises it.
     */
    fun resolveRank(word: String, lookup: (String) -> Int?): Int {
        // A direct entry always wins. The corpus knows this word's own
        // frequency; deriving it from a base would discard measured evidence.
        lookup(word)?.let { return it }

        for (base in inflectionBases(word)) {
            val inherited = lookup(base)
            // One band down: an inflected form is genuinely less common.
            if (inherited != null) return maxOf(1, inherited - INFLECTION_PENALTY)
        }
        return UNRANKED
    }

    /** Quantised frequency band for a word, 0 when unranked. */
    fun rank(input: String): Int {
        val snapshot = table
        return resolveRank(normaliseDictionaryWord(input)) { snapshot[it] }
    }

    /** Frequency band expressed as 0..1, for use as a score term. */
    fun weight(input: String): Double = rank(input).toDouble() / MAX_RANK

    /** Simple English inflections whose base may carry the frequency evidence. */
    fun inflectionBases(word: String): List<String> {
        val bases = ArrayList<String>(4)
        if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
            bases.add(word.dropLast(1))
            if (word.endsWith("es")) bases.add(word.dropLast(2))
            if (word.endsWith("ies")) bases.add(word.dropLast(3) + "y")
        }
        if (word.length > 4 && word.endsWith("ed")) {
            bases.add(word.dropLast(2))
            bases.add(word.dropLast(1))
            if (word.endsWith("ied")) bases.add(word.dropLast(3) + "y")
        }
        if (word.length > 5 && word.endsWith("ing")) {
            bases.add(word.dropLast(3))
            bases.add(word.dropLast(3) + "e")
        }
        if (word.length > 4 && word.endsWith("ly")) bases.add(word.dropLast(2))
        if (word.length > 4 && word.endsWith("er")) {
            bases.add(word.dropLast(2))
            bases.add(word.dropLast(1))
        }
        return bases
    }

    /** Test support. */
    fun reset() {
        table = emptyMap()
        isReady = false
    }
}

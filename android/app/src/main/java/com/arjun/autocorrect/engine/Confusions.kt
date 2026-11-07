package com.arjun.autocorrect.engine

/**
 * Real-word confusion sets.
 *
 * These words are all valid English, so the spelling pipeline can never touch
 * them - by construction it declines anything the dictionary knows. Only local
 * context evidence can decide "form" was meant to be "from".
 *
 * Evidence is intentionally hand-written and tiny: a few hundred bigram cues
 * cost nothing to evaluate and are auditable, unlike a model.
 */
object Confusions {

    data class Entry(
        val word: String,
        val setId: String,
        /** Words that, immediately before [word], argue *for* it. */
        val prev: Set<String>,
        /** Words that, immediately after [word], argue *for* it. */
        val next: Set<String>,
        /** Sentence-level cues tested against the lower-cased window. */
        val patterns: List<Regex>,
    )

    data class Match(val alternatives: List<String>, val setId: String)

    @Volatile
    private var entries: Map<String, Entry> = emptyMap()

    @Volatile
    private var index: Map<String, Match> = emptyMap()

    @Volatile
    var isReady: Boolean = false
        private set

    val size: Int get() = entries.size

    /**
     * Each line is `setId \t word \t prev words \t next words \t regex|||regex`.
     */
    fun install(lines: Sequence<String>) {
        val parsed = ArrayList<Entry>(16)
        for (line in lines) {
            val parts = line.split('\t')
            if (parts.size < 4) continue
            val patterns = if (parts.size >= 5 && parts[4].isNotEmpty()) {
                parts[4].split("|||").filter { it.isNotEmpty() }.map { Regex(it) }
            } else {
                emptyList()
            }
            parsed.add(
                Entry(
                    word = parts[1],
                    setId = parts[0],
                    prev = parts[2].split(' ').filter { it.isNotEmpty() }.toSet(),
                    next = parts[3].split(' ').filter { it.isNotEmpty() }.toSet(),
                    patterns = patterns,
                ),
            )
        }

        val bySet = parsed.groupBy { it.setId }
        entries = parsed.associateBy { it.word }
        index = parsed.associate { member ->
            member.word to Match(
                alternatives = bySet[member.setId].orEmpty()
                    .filter { it.word != member.word }
                    .map { it.word },
                setId = member.setId,
            )
        }
        isReady = true
    }

    fun forWord(word: String): Match? = index[word.lowercase()]

    fun entry(word: String): Entry? = entries[word.lowercase()]

    /** Test support. */
    fun reset() {
        entries = emptyMap()
        index = emptyMap()
        isReady = false
    }
}

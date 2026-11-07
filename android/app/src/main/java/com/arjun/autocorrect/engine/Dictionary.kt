package com.arjun.autocorrect.engine

/**
 * The bundled ESDB `en_US` word list and its one-time bucket index.
 *
 * The Chrome build ships this list as a source module because an extension has
 * no asset channel. Android does, so the words arrive as a newline-separated
 * asset and are installed once at service start. Everything after [install] is
 * a hash lookup or an index hit; nothing here ever scans the full list.
 */
object Dictionary {

    @Volatile
    private var words: HashSet<String> = HashSet()

    @Volatile
    private var byLengthAndFirstLetter: Map<Int, Map<Char, List<String>>> = emptyMap()

    @Volatile
    var isReady: Boolean = false
        private set

    val size: Int get() = words.size

    /** Number of `length -> firstLetter` buckets, for diagnostics. */
    val bucketCount: Int
        get() = byLengthAndFirstLetter.values.sumOf { it.size }

    /**
     * Builds the word set and the length/first-letter index.
     *
     * Called once. The bucket index is what makes Process 1 bounded: it visits
     * one bucket, never the 107,901-word list.
     */
    fun install(source: Sequence<String>) {
        val set = HashSet<String>(1 shl 18)
        val buckets = HashMap<Int, HashMap<Char, ArrayList<String>>>(64)

        for (raw in source) {
            val word = raw.trim()
            if (word.isEmpty()) continue
            set.add(word)
            val first = word[0]
            buckets
                .getOrPut(word.length) { HashMap(32) }
                .getOrPut(first) { ArrayList(64) }
                .add(word)
        }

        // Freeze into read-only shapes so the hot path cannot accidentally
        // mutate the index it is iterating.
        val frozen = HashMap<Int, Map<Char, List<String>>>(buckets.size)
        for ((length, byFirst) in buckets) {
            val inner = HashMap<Char, List<String>>(byFirst.size)
            for ((first, bucket) in byFirst) {
                bucket.trimToSize()
                inner[first] = bucket
            }
            frozen[length] = inner
        }

        words = set
        byLengthAndFirstLetter = frozen
        isReady = true
    }

    /** Membership, case- and apostrophe-insensitive like the TS `NormalisedWordSet`. */
    fun has(word: String): Boolean = words.contains(normaliseDictionaryWord(word))

    fun bucket(length: Int, firstLetter: Char): List<String> {
        if (length < 1) return emptyList()
        return byLengthAndFirstLetter[length]?.get(firstLetter) ?: emptyList()
    }

    /** Clears the installed data. Test-support only. */
    fun reset() {
        words = HashSet()
        byLengthAndFirstLetter = emptyMap()
        isReady = false
    }
}

/**
 * The one canonical representation used by the generated data and by runtime
 * lookup. Candidate generation already emits this form, so the fast path is a
 * scan for anything outside `[a-z']` rather than an allocation.
 */
fun normaliseDictionaryWord(input: String): String {
    var plain = true
    for (ch in input) {
        if (!((ch in 'a'..'z') || ch == '\'')) {
            plain = false
            break
        }
    }
    if (plain) return input
    return normaliseRuleText(input.trim())
}

fun isKnownWord(word: String): Boolean = Dictionary.has(word)

/**
 * ESDB is an alphabetical word list and carries no corpus frequencies. This
 * short, explicit legacy prior breaks otherwise-equal ranking ties and nothing
 * else. It never changes dictionary membership.
 *
 * Kept verbatim from the TypeScript engine so ranking parity is testable.
 */
private val COMMON_WORDS: List<String> = (
    "the be to of and a in that have i it for not on with he as you do at this but his " +
        "by from they we say her she or an will my one all would there their what so up out " +
        "if about who get which go me when make can like time no just him know take people " +
        "into year your good some could them see other than then now look only come its over " +
        "think also back after use two how our work first well way even new want because any " +
        "these give day most us is are was were been has had did does said made find here " +
        "thing many very still own too little world life tell may ask before great same must " +
        "number part place case group problem fact through where much right need feel seem " +
        "while last long high different small large next early young important few public " +
        "bad able why let put mean keep begin help talk turn start show hear play run move " +
        "live believe bring happen write provide sit stand lose pay meet include continue set " +
        "learn change lead understand watch follow stop create speak read allow add spend grow " +
        "open walk win offer remember love consider appear buy wait serve die send expect " +
        "build stay fall cut reach remain suggest raise pass sell require report decide"
    ).split(" ").filter { it.isNotEmpty() }

private val COMMON_RANK: Map<String, Int> =
    COMMON_WORDS.withIndex().associate { (index, word) -> word to index }

private fun explicitFrequency(word: String): Double? {
    val rank = COMMON_RANK[word] ?: return null
    if (COMMON_WORDS.size <= 1) return 1.0
    return 1 - (rank.toDouble() / (COMMON_WORDS.size - 1)) * 0.25
}

/**
 * A deterministic 0..1 ranking prior.
 *
 * Known words outside the explicit common-word list receive a neutral 0.5. A
 * few simple inflections inherit their base word's prior at a small discount.
 */
fun frequencyScore(input: String): Double {
    val word = normaliseDictionaryWord(input)
    if (!Dictionary.has(word)) return 0.0

    explicitFrequency(word)?.let { return it }

    val bases = ArrayList<String>(3)
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
        bases.add(word.dropLast(1))
    }
    if (word.length > 4 && word.endsWith("ed")) {
        bases.add(word.dropLast(2))
        bases.add(word.dropLast(1))
    }
    if (word.length > 5 && word.endsWith("ing")) {
        bases.add(word.dropLast(3))
        bases.add(word.dropLast(3) + "e")
    }

    for (base in bases) {
        explicitFrequency(base)?.let { return it * 0.98 }
    }
    return 0.5
}

package com.arjun.autocorrect.engine

/**
 * Lexical support for apostrophe insertion (Process 7).
 *
 * Process 7 turns "didnt" into "didn't" by trying an apostrophe at each
 * interior position and keeping whatever the dictionary recognises. Dictionary
 * membership alone is far too weak a test: ESDB carries the possessive of
 * essentially every noun, so "mis" matched "mi's" - the possessive of the
 * musical note - and any three-letter fragment could be "corrected" into a
 * possessive nobody wrote.
 *
 * The fix is not a length rule; that would break `hes`, `ims` and `dont`
 * equally. It is to require *lexical support*: the candidate must be a real
 * contraction, or a possessive whose stem the corpus actually ranks.
 */
object Contractions {

    /**
     * The closed set of English contraction suffixes. English has no others: a
     * word cannot become a contraction by gaining an apostrophe anywhere else.
     */
    private val CONTRACTION_SUFFIXES = setOf("t", "s", "re", "ve", "ll", "d", "m", "clock")

    /**
     * Stems that form a contraction with `'t`.
     *
     * These include the `n`: "didn't" splits as `didn` + `'` + `t`, not
     * `did` + `'t`. The stem is whatever precedes the apostrophe, which is what
     * the generator hands us. Curated because the set is closed and small, and
     * because "didn't" must work whether or not a corpus ranks "didnt".
     */
    private val NEGATIVE_STEMS = setOf(
        "aren", "can", "couldn", "didn", "doesn", "don", "hadn", "hasn", "haven",
        "isn", "mustn", "needn", "oughtn", "shan", "shouldn", "wasn", "weren", "won",
        "wouldn", "ain", "daren", "mightn", "mayn",
    )

    /**
     * Stems that form a contraction with 's, 're, 've, 'll, 'd or 'm.
     *
     * Pronouns, question words and the handful of nouns that routinely
     * contract. Everything outside this list must earn its apostrophe from the
     * corpus.
     */
    private val CONTRACTING_STEMS = setOf(
        "i", "you", "he", "she", "it", "we", "they", "that", "this", "there", "here",
        "what", "who", "where", "when", "why", "how", "which", "let", "one", "somebody",
        "someone", "something", "nobody", "everyone", "everybody", "anyone", "anybody",
        "y", "ma", "o",
    )

    /**
     * Frequency band a possessive's stem must reach for the apostrophe to be
     * offered without a curated entry.
     *
     * 128 is the "ordinary" band - roughly the top 20,000 English words. A stem
     * below it is either rare or not really a word being possessed, which is
     * exactly the "mi's" case.
     */
    private const val MIN_STEM_RANK = 128

    /** Shortest stem that can take a possessive. Pronouns are handled above. */
    private const val MIN_POSSESSIVE_STEM = 3

    enum class Reason {
        NEGATIVE_CONTRACTION,
        PRONOUN_CONTRACTION,
        OCLOCK,
        POSSESSIVE_OF_COMMON_STEM,
        UNSUPPORTED_SUFFIX,
        STEM_TOO_SHORT,
        STEM_TOO_RARE,
    }

    data class Support(val supported: Boolean, val reason: Reason)

    /**
     * Decides whether `stem + ' + suffix` is a contraction or possessive that
     * English actually forms.
     *
     * Deliberately strict. A false negative costs one missed correction; a
     * false positive rewrites a word the user meant.
     */
    fun support(stem: String, suffix: String): Support {
        val s = normaliseDictionaryWord(stem)
        val suf = suffix.lowercase()

        if (suf !in CONTRACTION_SUFFIXES) {
            return Support(false, Reason.UNSUPPORTED_SUFFIX)
        }
        // "o'clock" is the only common word of its shape.
        if (suf == "clock") {
            return if (s == "o") Support(true, Reason.OCLOCK)
            else Support(false, Reason.UNSUPPORTED_SUFFIX)
        }
        // "didn't", "can't", "won't": a closed, curated set.
        if (suf == "t") {
            return if (s in NEGATIVE_STEMS) Support(true, Reason.NEGATIVE_CONTRACTION)
            else Support(false, Reason.STEM_TOO_RARE)
        }
        // "I'm", "you're", "they've", "we'll", "he'd", "that's".
        if (s in CONTRACTING_STEMS) {
            return Support(true, Reason.PRONOUN_CONTRACTION)
        }
        /*
         * Everything else can only be a possessive, and only 's forms one. The
         * stem must be a word the corpus ranks: "dog's" yes, "mi's" no. This is
         * the check that closes the false positive, and it improves
         * automatically as the frequency corpus improves rather than needing a
         * curated list of every noun in English.
         */
        if (suf != "s") return Support(false, Reason.STEM_TOO_RARE)
        /*
         * A stem of one or two letters is not a noun being possessed. "mi's",
         * "ab's" and "de's" are all in a broad dictionary; none is what a
         * writer typing "mis" meant. Genuine short possessives are pronouns,
         * already covered by CONTRACTING_STEMS above.
         */
        if (s.length < MIN_POSSESSIVE_STEM) {
            return Support(false, Reason.STEM_TOO_SHORT)
        }
        return if (Frequency.rank(s) >= MIN_STEM_RANK) {
            Support(true, Reason.POSSESSIVE_OF_COMMON_STEM)
        } else {
            Support(false, Reason.STEM_TOO_RARE)
        }
    }

    /** Convenience for the generator. */
    fun isSupported(stem: String, suffix: String): Boolean = support(stem, suffix).supported
}

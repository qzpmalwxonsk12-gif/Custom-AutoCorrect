package com.arjun.autocorrect.engine

import kotlin.math.max
import kotlin.math.min

/**
 * Deterministic spelling candidates: the seven bounded processes.
 *
 *   1. score only the same-length, same-first-letter dictionary bucket;
 *   2. check the n - 1 adjacent swaps;
 *   3. check one QWERTY-neighbour substitution at a time;
 *   4. remove one half of a repeated-letter run;
 *   5. insert one missing letter;
 *   6. delete one extra letter;
 *   7. insert one apostrophe.
 *
 * Processes 2-7 are a word-length-bounded number of hash lookups. Process 1
 * visits exactly one prebuilt bucket. Nothing here iterates the full word list,
 * and nothing generates multi-edit permutations.
 */

/** Which character was removed to reach a candidate. */
data class RemovedLetterEvidence(val removedIndex: Int, val removedCharacter: Char)

/** Which character was inserted, and where, to reach a candidate. */
data class InsertedLetterEvidence(val insertedIndex: Int, val insertedCharacter: Char)

/** Evidence that Process 3 generated this candidate from the neighbour map. */
data class KeyboardSubstitutionEvidence(
    val index: Int,
    val typedCharacter: Char,
    val replacementCharacter: Char,
    val neighbourMapMatched: Boolean,
    val keyDistance: Double,
)

data class Candidate(
    val word: String,
    /** 1..7 - which process produced it. */
    val process: Int,
    val shape: EditShape,
    /** See [OperationCost]. Dominates ranking. */
    val operationCost: Double,
    /** 0..1 combined structural similarity used by the final scorer. */
    val similarity: Double,
    /** 0..1 fraction of characters in the same position. */
    val positionMatches: Double,
    /** 0..1 multiset letter overlap. */
    val letterOverlap: Double,
    /** 0..1 common-prefix fraction. */
    val prefixSimilarity: Double,
    /** 0..1 keyboard plausibility (1 for anything but Process 3). */
    val proximity: Double,
    /** 0..1 legacy frequency prior; neutral for unranked ESDB entries. */
    val frequency: Double,
    val keyboardSubstitution: KeyboardSubstitutionEvidence? = null,
    val duplicateLetter: RemovedLetterEvidence? = null,
    val missingLetter: InsertedLetterEvidence? = null,
    val extraLetter: RemovedLetterEvidence? = null,
    val missingApostrophe: InsertedLetterEvidence? = null,
)

/**
 * Deterministic cost of the edit that explains a candidate. Lower is a simpler
 * and therefore more plausible typo.
 *
 * This is the dominant ranking term: it is what stops a broad same-length
 * bucket match ("iprove" -> "iphone", several substitutions) from beating a
 * single-operation explanation ("iprove" -> "improve", one inserted letter).
 */
object OperationCost {
    const val EXACT_RULE = 0.0
    const val DUPLICATE_LETTER = 1.0
    const val ADJACENT_SWAP = 1.0
    const val KEYBOARD_SUBSTITUTION = 1.0
    const val MISSING_LETTER = 1.0
    const val EXTRA_LETTER = 1.0

    /**
     * Cheaper than any other single edit. Dropping the apostrophe from a
     * contraction is the single most common thing a fast typist does, and the
     * result is almost never a real word - so when "didnt" has both a
     * one-apostrophe reading ("didn't") and a one-letter reading ("dint"), the
     * apostrophe is overwhelmingly the intended one.
     */
    const val MISSING_APOSTROPHE = 0.5
    const val ARBITRARY_SUBSTITUTION = 2.0
    const val BUCKET_SIMILARITY = 3.0
    const val MULTI_OPERATION = 4.0
}

/** Per-pass counters, surfaced by the diagnostics screen. */
data class CandidateDiagnostics(
    var process1Examined: Int = 0,
    var adjacentSwapsGenerated: Int = 0,
    var keyboardSubstitutionsGenerated: Int = 0,
    var duplicateLetterGenerated: Int = 0,
    var missingLetterGenerated: Int = 0,
    var extraLetterGenerated: Int = 0,
    var apostropheGenerated: Int = 0,
    var membershipChecks: Int = 0,
)

object CandidateGenerator {

    private const val MIN_LENGTH = 3
    private const val MAX_LENGTH = 24
    private const val PROCESS_ONE_MIN_SIMILARITY = 0.48

    /** Public cap on returned candidates. */
    const val MAX_CANDIDATES = 10

    /**
     * Runs all seven processes, merges duplicate hits, ranks deterministically
     * and returns at most [limit] candidates (clamped to [MAX_CANDIDATES]).
     *
     * [rankAdjustment] is the personal/context nudge applied *before* the
     * top-ten cutoff, so a rule the user has reinforced cannot be pruned by the
     * bound before the ranking layer ever sees it.
     */
    fun generate(
        word: String,
        limit: Int = MAX_CANDIDATES,
        diagnostics: CandidateDiagnostics? = null,
        rankAdjustment: ((Candidate) -> Double)? = null,
    ): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        if (w.length < MIN_LENGTH || w.length > MAX_LENGTH || !isPlainWord(w)) {
            return emptyList()
        }

        val boundedLimit = max(0, min(MAX_CANDIDATES, limit))
        if (boundedLimit == 0) return emptyList()

        val comparator = candidateComparator(rankAdjustment)
        val merged = LinkedHashMap<String, Candidate>()

        val processOne = collectSameLengthCandidates(w, diagnostics)
            .sortedWith(comparator)
            .take(MAX_CANDIDATES)
        for (candidate in processOne) mergeCandidate(merged, candidate, comparator)

        for (candidate in adjacentSwaps(w, diagnostics)) mergeCandidate(merged, candidate, comparator)
        for (candidate in keyboardSubstitutions(w, diagnostics)) mergeCandidate(merged, candidate, comparator)
        // Single-operation length changes. These run unconditionally: a weak
        // result from an earlier process must never prevent a simpler
        // explanation from being considered.
        for (candidate in duplicateLetters(w, diagnostics)) mergeCandidate(merged, candidate, comparator)
        for (candidate in insertions(w, diagnostics)) mergeCandidate(merged, candidate, comparator)
        for (candidate in deletions(w, diagnostics)) mergeCandidate(merged, candidate, comparator)
        for (candidate in apostrophes(w, diagnostics)) mergeCandidate(merged, candidate, comparator)

        return merged.values.sortedWith(comparator).take(boundedLimit)
    }

    /* ------------------------------ Process 1 ------------------------------ */

    /** Inspects only the indexed length + first-letter bucket. */
    fun sameLength(
        word: String,
        diagnostics: CandidateDiagnostics? = null,
        rankAdjustment: ((Candidate) -> Double)? = null,
    ): List<Candidate> =
        collectSameLengthCandidates(word, diagnostics)
            .sortedWith(candidateComparator(rankAdjustment))
            .take(MAX_CANDIDATES)

    private fun collectSameLengthCandidates(
        word: String,
        diagnostics: CandidateDiagnostics?,
    ): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        val first = w.firstOrNull() ?: return emptyList()

        val bucket = Dictionary.bucket(w.length, first)
        val out = ArrayList<Candidate>(min(bucket.size, 64))
        for (candidate in bucket) {
            diagnostics?.process1Examined = (diagnostics?.process1Examined ?: 0) + 1
            if (candidate == w) continue
            val metrics = similarityMetrics(w, candidate)
            if (metrics.similarity < PROCESS_ONE_MIN_SIMILARITY) continue
            out.add(makeCandidate(w, candidate, 1, metrics))
        }
        return out
    }

    /* ------------------------------ Process 2 ------------------------------ */

    /** Generates exactly one swap for each adjacent pair (n - 1). */
    fun adjacentSwaps(word: String, diagnostics: CandidateDiagnostics? = null): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        val seen = HashSet<String>()
        val out = ArrayList<Candidate>(4)

        for (index in 0 until w.length - 1) {
            diagnostics?.adjacentSwapsGenerated = (diagnostics?.adjacentSwapsGenerated ?: 0) + 1
            val candidate = buildString(w.length) {
                append(w, 0, index)
                append(w[index + 1])
                append(w[index])
                append(w, index + 2, w.length)
            }
            diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
            val known = Dictionary.has(candidate)
            if (candidate == w || !seen.add(candidate)) continue
            if (!known) continue
            out.add(makeCandidate(w, candidate, 2, similarityMetrics(w, candidate)))
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------ Process 3 ------------------------------ */

    /**
     * Replaces one character with one physical QWERTY neighbour. Every
     * generated string differs from the input at exactly one position.
     */
    fun keyboardSubstitutions(
        word: String,
        diagnostics: CandidateDiagnostics? = null,
    ): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        val seen = HashSet<String>()
        val out = ArrayList<Candidate>(4)

        for (index in w.indices) {
            val typedCharacter = w[index]
            for (neighbour in neighbours(typedCharacter)) {
                diagnostics?.keyboardSubstitutionsGenerated =
                    (diagnostics?.keyboardSubstitutionsGenerated ?: 0) + 1
                val candidate = buildString(w.length) {
                    append(w, 0, index)
                    append(neighbour)
                    append(w, index + 1, w.length)
                }
                if (!seen.add(candidate)) continue
                diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
                if (!Dictionary.has(candidate)) continue
                out.add(
                    makeCandidate(
                        w, candidate, 3, similarityMetrics(w, candidate),
                        KeyboardSubstitutionEvidence(
                            index = index,
                            typedCharacter = typedCharacter,
                            replacementCharacter = neighbour,
                            neighbourMapMatched = true,
                            keyDistance = keyDistance(typedCharacter, neighbour),
                        ),
                    ),
                )
            }
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------ Process 4 ------------------------------ */

    /**
     * Removes one half of a repeated-letter run ("punctuatioon"). Only runs of
     * two or more identical characters are considered, so this is at most
     * n - 1 membership checks.
     */
    fun duplicateLetters(word: String, diagnostics: CandidateDiagnostics? = null): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        val seen = HashSet<String>()
        val out = ArrayList<Candidate>(2)

        for (index in 1 until w.length) {
            if (w[index] != w[index - 1]) continue
            diagnostics?.duplicateLetterGenerated = (diagnostics?.duplicateLetterGenerated ?: 0) + 1
            val candidate = w.substring(0, index) + w.substring(index + 1)
            if (candidate == w || !seen.add(candidate)) continue
            diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
            if (!Dictionary.has(candidate)) continue
            out.add(
                makeCandidate(w, candidate, 4, similarityMetrics(w, candidate))
                    .copy(duplicateLetter = RemovedLetterEvidence(index, w[index])),
            )
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------ Process 5 ------------------------------ */

    /**
     * Inserts one letter at each of the n + 1 positions ("iprove").
     * Exact dictionary membership only - the word list is never scanned.
     */
    fun insertions(word: String, diagnostics: CandidateDiagnostics? = null): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        if (w.length + 1 > MAX_LENGTH) return emptyList()
        val seen = HashSet<String>()
        val out = ArrayList<Candidate>(4)

        for (index in 0..w.length) {
            for (code in 'a'..'z') {
                diagnostics?.missingLetterGenerated = (diagnostics?.missingLetterGenerated ?: 0) + 1
                val candidate = buildString(w.length + 1) {
                    append(w, 0, index)
                    append(code)
                    append(w, index, w.length)
                }
                if (!seen.add(candidate)) continue
                diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
                if (!Dictionary.has(candidate)) continue
                out.add(
                    makeCandidate(w, candidate, 5, similarityMetrics(w, candidate))
                        .copy(missingLetter = InsertedLetterEvidence(index, code)),
                )
            }
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------ Process 6 ------------------------------ */

    /**
     * Deletes one letter that is not part of a repeated run - those are
     * Process 4's job, and carry clearer evidence.
     */
    fun deletions(word: String, diagnostics: CandidateDiagnostics? = null): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        val seen = HashSet<String>()
        val out = ArrayList<Candidate>(4)

        for (index in w.indices) {
            /*
             * An apostrophe inside a word is structure, not a stray keystroke.
             *
             * Without this the process offered "o'neal" -> "oneal" and "can't"
             * -> "cant", turning every possessive and contraction into a
             * candidate. Process 7 handles the error that actually happens - a
             * *missing* apostrophe; deleting a present one is never the fix.
             */
            if (w[index] == '\'') continue
            val isRepeat =
                (index > 0 && w[index] == w[index - 1]) ||
                    (index + 1 < w.length && w[index] == w[index + 1])
            if (isRepeat) continue
            diagnostics?.extraLetterGenerated = (diagnostics?.extraLetterGenerated ?: 0) + 1
            val candidate = w.substring(0, index) + w.substring(index + 1)
            if (candidate == w || !seen.add(candidate)) continue
            diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
            if (!Dictionary.has(candidate)) continue
            out.add(
                makeCandidate(w, candidate, 6, similarityMetrics(w, candidate))
                    .copy(extraLetter = RemovedLetterEvidence(index, w[index])),
            )
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------ Process 7 ------------------------------ */

    /**
     * Inserts an apostrophe at each interior position ("didnt").
     *
     * At most n - 1 exact membership checks. This exists because the
     * letter-level processes handle a dropped apostrophe *badly*: "didnt" is
     * one deletion from "dint" and one substitution from several other words,
     * so without this process the engine confidently produced "dint". The
     * dictionary already carries 18,761 apostrophe forms, so the correct answer
     * was always one lookup away.
     */
    fun apostrophes(word: String, diagnostics: CandidateDiagnostics? = null): List<Candidate> {
        val w = normaliseDictionaryWord(word)
        // A word that already has an apostrophe is not missing one.
        if (w.contains('\'')) return emptyList()
        val out = ArrayList<Candidate>(2)

        // Interior positions only: a leading or trailing apostrophe is a quote
        // mark, not a contraction.
        for (index in 1 until w.length) {
            diagnostics?.apostropheGenerated = (diagnostics?.apostropheGenerated ?: 0) + 1
            val candidate = w.substring(0, index) + "'" + w.substring(index)
            diagnostics?.membershipChecks = (diagnostics?.membershipChecks ?: 0) + 1
            if (!Dictionary.has(candidate)) continue
            /*
             * Dictionary membership is necessary but nowhere near sufficient -
             * see Contractions for the "mi's" false positive this closes.
             */
            if (!Contractions.isSupported(w.substring(0, index), w.substring(index))) continue
            out.add(
                makeCandidate(w, candidate, 7, similarityMetrics(w, candidate))
                    .copy(missingApostrophe = InsertedLetterEvidence(index, '\'')),
            )
        }
        return out.sortedWith(plainComparator)
    }

    /* ------------------------------- scoring ------------------------------- */

    private data class SimilarityMetrics(
        val similarity: Double,
        val positionMatches: Double,
        val letterOverlap: Double,
        val prefixSimilarity: Double,
    )

    private fun similarityMetrics(typed: String, candidate: String): SimilarityMetrics {
        val length = max(max(typed.length, candidate.length), 1).toDouble()
        var positions = 0
        val shared = min(typed.length, candidate.length)
        for (index in 0 until shared) {
            if (typed[index] == candidate[index]) positions++
        }

        val typedCounts = characterCounts(typed)
        val candidateCounts = characterCounts(candidate)
        var overlap = 0
        for ((character, count) in typedCounts) {
            overlap += min(count, candidateCounts[character] ?: 0)
        }

        var prefix = 0
        while (prefix < typed.length && prefix < candidate.length && typed[prefix] == candidate[prefix]) {
            prefix++
        }

        val positionMatches = positions / length
        val letterOverlap = overlap / length
        val prefixSimilarity = prefix / length
        return SimilarityMetrics(
            similarity = positionMatches * 0.5 + letterOverlap * 0.35 + prefixSimilarity * 0.15,
            positionMatches = positionMatches,
            letterOverlap = letterOverlap,
            prefixSimilarity = prefixSimilarity,
        )
    }

    private fun characterCounts(word: String): Map<Char, Int> {
        val counts = HashMap<Char, Int>(word.length)
        for (character in word) counts[character] = (counts[character] ?: 0) + 1
        return counts
    }

    private fun makeCandidate(
        typed: String,
        word: String,
        process: Int,
        metrics: SimilarityMetrics,
        keyboardSubstitution: KeyboardSubstitutionEvidence? = null,
    ): Candidate {
        /*
         * Exact mutation processes carry a stronger similarity prior than a
         * broad bucket match, while retaining the individual metrics for
         * inspection. A single-letter length change scores badly on positional
         * similarity ("iprove"/"improve" shares one aligned character) even
         * though it is the simplest possible explanation, so those processes
         * get a floor too.
         */
        val similarity = when (process) {
            2 -> max(metrics.similarity, 0.98)
            3 -> max(metrics.similarity, 0.94)
            4 -> max(metrics.similarity, 0.96)
            5, 6 -> max(metrics.similarity, 0.95)
            // A dropped apostrophe leaves every letter in place, so the typed
            // word and the contraction are as close as two strings get.
            7 -> max(metrics.similarity, 0.99)
            else -> metrics.similarity
        }

        return Candidate(
            word = word,
            process = process,
            shape = classifyEdit(typed, word),
            operationCost = operationCostFor(process, typed, word),
            similarity = similarity,
            positionMatches = metrics.positionMatches,
            letterOverlap = metrics.letterOverlap,
            prefixSimilarity = metrics.prefixSimilarity,
            proximity = if (process == 3) proximityScore(typed, word) else 1.0,
            frequency = frequencyScore(word),
            keyboardSubstitution = keyboardSubstitution,
        )
    }

    /**
     * Cost of the edit that produced this candidate. Processes 2-7 each perform
     * exactly one operation. Process 1 inspects a whole bucket, so its cost is
     * derived from how far the candidate actually is from the typed word.
     */
    private fun operationCostFor(process: Int, typed: String, candidate: String): Double {
        when (process) {
            2 -> return OperationCost.ADJACENT_SWAP
            3 -> return OperationCost.KEYBOARD_SUBSTITUTION
            4 -> return OperationCost.DUPLICATE_LETTER
            5 -> return OperationCost.MISSING_LETTER
            6 -> return OperationCost.EXTRA_LETTER
            7 -> return OperationCost.MISSING_APOSTROPHE
        }
        // Process 1: same length by construction, so count differing positions.
        var differences = 0
        for (index in typed.indices) {
            if (index >= candidate.length || typed[index] != candidate[index]) differences++
        }
        if (differences == 1) return OperationCost.ARBITRARY_SUBSTITUTION
        if (differences == 2 && classifyEdit(typed, candidate) == EditShape.TRANSPOSITION) {
            return OperationCost.ADJACENT_SWAP
        }
        if (differences <= 2) return OperationCost.BUCKET_SIMILARITY
        return OperationCost.MULTI_OPERATION
    }

    private fun mergeCandidate(
        target: MutableMap<String, Candidate>,
        candidate: Candidate,
        comparator: Comparator<Candidate>,
    ) {
        val previous = target[candidate.word]
        if (previous == null || comparator.compare(candidate, previous) < 0) {
            target[candidate.word] = candidate
        }
    }

    /**
     * Both comparators delegate to the one tie-break sequence in
     * [compareByScore]. They differ only in the score supplied: the pre-cutoff
     * ordering includes the personal rank nudge, the plain one does not.
     * Keeping the *sequence* in one place is what stops the generator's
     * ordering and the final ranking from disagreeing.
     */
    private fun candidateComparator(
        rankAdjustment: ((Candidate) -> Double)?,
    ): Comparator<Candidate> {
        if (rankAdjustment == null) return plainComparator
        val cache = HashMap<String, Double>()
        val score = { candidate: Candidate ->
            cache.getOrPut(candidate.word) {
                candidateGenerationScore(candidate) + rankAdjustment(candidate)
            }
        }
        return Comparator { a, b -> compareByScore(a, b, score) }
    }

    private val plainComparator: Comparator<Candidate> =
        Comparator { a, b -> compareByScore(a, b, ::candidateGenerationScore) }

    /** Matches the TS guard `/^[a-z]+(?:'[a-z]+)*$/`. */
    private fun isPlainWord(w: String): Boolean {
        if (w.isEmpty()) return false
        var previousWasApostrophe = true // a leading apostrophe is invalid
        for (ch in w) {
            if (ch == '\'') {
                if (previousWasApostrophe) return false
                previousWasApostrophe = true
            } else if (ch in 'a'..'z') {
                previousWasApostrophe = false
            } else {
                return false
            }
        }
        // A trailing apostrophe is invalid too.
        return !previousWasApostrophe
    }
}

/**
 * Penalty applied for the complexity of the explaining edit.
 *
 * Sized so a single-operation candidate (cost 1) always outranks a
 * multi-substitution bucket match (cost 4) regardless of how similar the latter
 * looks - that is what makes "iprove" resolve to "improve" and never to
 * "iphone" - while keeping the result inside the 0..1 range the confidence
 * layer needs.
 *
 * Banded rather than keyed by exact value: costs are not all integers (a
 * dropped apostrophe is deliberately cheaper than any letter edit), and an
 * exact-key lookup silently gave every fractional cost the *worst* penalty.
 */
internal fun costPenalty(cost: Double): Double = when {
    cost <= 1.0 -> 0.0
    cost <= 2.0 -> 0.1
    cost <= 3.0 -> 0.18
    else -> 0.28
}

/**
 * Non-personal score shared by pre-cutoff ranking and the final confidence
 * layer, so a viable candidate cannot be pruned under different weights.
 */
fun candidateGenerationScore(candidate: Candidate): Double {
    val processPrior = when (candidate.process) {
        2 -> 0.11
        3 -> 0.08
        /*
         * Deliberately the strongest prior of any process, for a reason
         * specific to it: this process only ever runs on a word the dictionary
         * does *not* know, and a non-word that becomes a word by adding one
         * apostrophe is essentially always that contraction.
         *
         * The competitor is always a short, high-frequency word - "thats" ->
         * "that", "theyre" -> "there", "shes" -> "she" - whose frequency prior
         * beat the apostrophe on cost alone. Cost banding could not separate
         * them either, because a half-cost and a unit-cost edit share a band.
         */
        7 -> 0.3
        4, 5, 6 -> 0.14
        else -> 0.04
    }
    val keyboardEvidence =
        if (candidate.process == 3) max(0.0, candidate.proximity - 0.5) * 0.11 else 0.0

    // Keep the pre-cutoff order identical to scoreSpelling's non-personal
    // terms, so the top-ten bound cannot discard a frequency-backed winner
    // before the final ranking layer sees it - and so ranking and confidence
    // can never disagree about which candidate wins.
    return candidate.similarity * 0.72 +
        candidate.frequency * 0.18 +
        processPrior +
        keyboardEvidence -
        costPenalty(candidate.operationCost)
}

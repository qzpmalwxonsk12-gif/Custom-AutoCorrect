package com.arjun.autocorrect.engine

/**
 * The one candidate score and the one comparator.
 *
 * Everything here operates on an **unclamped** score. Clamping into a
 * confidence value happens once, after ranking and after the margin has been
 * measured. The reason is a real bug in the original engine: the engine sorted
 * on a value already clamped to 0.99, so two genuinely different candidates
 * could both hit the ceiling, tie, and be separated by *alphabetical order* -
 * which is how "thats" resolved to "that" instead of "that's".
 */

/**
 * Weights for every context score term.
 *
 * Each new signal ships at **zero**. That is the whole rollout policy in one
 * object: a term can be implemented, tested and compared while contributing
 * exactly nothing to what the user sees.
 *
 * `editOperation` is 1 because it is not new - it is the existing
 * operation-cost and similarity score that already decides every correction.
 */
data class ScoreWeights(
    val editOperation: Double = 1.0,
    val frequency: Double = FREQUENCY_WEIGHT,
    val partOfSpeech: Double = 0.0,
    val wordContext: Double = 0.0,
    val sentencePosition: Double = 0.0,
    val documentReuse: Double = 0.0,
    val personalHistory: Double = 0.0,
    val knownPhrase: Double = 0.0,
    val characterContext: Double = 0.0,
)

/**
 * The frequency weight chosen after measurement.
 *
 * Swept at 0.02 / 0.04 / 0.06 / 0.08 / 0.10 over UD English EWT with a fixed
 * seed. 0.04 captures 81% of the maximum measured gain while avoiding a third
 * regression entirely: "mastter" resolves to "master" at 0.04 and flips to
 * "matter" at 0.06, where the frequency gap finally overcomes duplicate-letter
 * evidence. Higher weights buy 6 more improvements at the price of a regression
 * on a doubled-letter typo, which is the single most recognisable kind.
 */
const val FREQUENCY_WEIGHT = 0.04

val DEFAULT_WEIGHTS = ScoreWeights()

/** Each term's contribution, already multiplied by its weight. */
data class ScoreTerms(
    val editOperation: Double = 0.0,
    val frequency: Double = 0.0,
    val partOfSpeech: Double = 0.0,
    val wordContext: Double = 0.0,
    val sentencePosition: Double = 0.0,
    val documentReuse: Double = 0.0,
    val personalHistory: Double = 0.0,
    val knownPhrase: Double = 0.0,
    val characterContext: Double = 0.0,
)

data class ScoredCandidate(
    val candidate: Candidate,
    val terms: ScoreTerms,
    /** Sum of every term. **Never clamped.** */
    val rawScore: Double,
    /**
     * The pre-existing personal/context nudge applied before the top-ten
     * cutoff. Not a new signal and not weighted: current behaviour, preserved.
     */
    val rankAdjustment: Double,
)

/**
 * Scores one candidate.
 *
 * The production defaults combine the existing generation score with the
 * measured frequency term. Every other context signal remains at zero until it
 * has evidence supporting a rollout, and a term whose weight is zero is skipped
 * entirely: a signal that is switched off must cost nothing, not merely
 * contribute nothing.
 */
fun scoreCandidate(
    candidate: Candidate,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    rankAdjustment: Double = 0.0,
): ScoredCandidate {
    val editOperation = candidateGenerationScore(candidate) * weights.editOperation
    val frequency =
        if (weights.frequency != 0.0) Frequency.weight(candidate.word) * weights.frequency else 0.0

    val terms = ScoreTerms(editOperation = editOperation, frequency = frequency)
    val rawScore = editOperation + frequency + rankAdjustment

    return ScoredCandidate(candidate, terms, rawScore, rankAdjustment)
}

private fun contextualSupport(scored: ScoredCandidate): Double =
    scored.terms.wordContext +
        scored.terms.partOfSpeech +
        scored.terms.knownPhrase +
        scored.terms.personalHistory +
        scored.terms.sentencePosition

/** Scores and ranks a whole candidate set with one comparator. */
fun rankCandidates(
    candidates: List<Candidate>,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    rankAdjustment: ((Candidate) -> Double)? = null,
): List<ScoredCandidate> {
    val scored = candidates.map {
        scoreCandidate(it, weights, rankAdjustment?.invoke(it) ?: 0.0)
    }
    val scores = scored.associate { it.candidate.word to it.rawScore }
    val support = scored.associate { it.candidate.word to contextualSupport(it) }
    return scored.sortedWith { a, b ->
        compareByScore(
            a.candidate,
            b.candidate,
            { scores[it.word] ?: 0.0 },
            { support[it.word] ?: 0.0 },
        )
    }
}

/**
 * Minimum lead the ranking layer itself asks for before calling a result
 * unambiguous. The correction-risk policy applies its own, stricter margin per
 * class afterwards; this one only separates "clear winner" from "toss-up".
 */
const val RANKING_MARGIN = 0.06

data class ContextDecision(
    val rankedCandidates: List<ScoredCandidate>,
    val bestCandidate: ScoredCandidate?,
    val secondBestCandidate: ScoredCandidate?,
    /** Unclamped throughout: this is what the policy layer tests. */
    val margin: Double,
    val action: ProposalAction,
)

/**
 * The single place ranking happens.
 *
 * Computing the margin from a clamped confidence is what previously let two
 * very different candidates look identical, so it is deliberately measured here
 * on the raw scale and handed to the policy layer untouched.
 */
fun rank(
    candidates: List<Candidate>,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    rankAdjustment: ((Candidate) -> Double)? = null,
): ContextDecision {
    val ranked = rankCandidates(candidates, weights, rankAdjustment)
    val best = ranked.firstOrNull()
        ?: return ContextDecision(emptyList(), null, null, 0.0, ProposalAction.NONE)
    val second = ranked.getOrNull(1)

    val margin = if (second != null) best.rawScore - second.rawScore else best.rawScore

    return ContextDecision(
        rankedCandidates = ranked,
        bestCandidate = best,
        secondBestCandidate = second,
        margin = margin,
        // Provisional only. The engine's thresholds and the correction-risk
        // policy both get a say before anything is applied.
        action = if (margin >= RANKING_MARGIN) ProposalAction.AUTOCORRECT else ProposalAction.SUGGEST,
    )
}

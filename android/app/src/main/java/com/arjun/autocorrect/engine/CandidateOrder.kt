package com.arjun.autocorrect.engine

/**
 * The one tie-break sequence.
 *
 * Extracted so the candidate generator's pre-cutoff ordering and the ranking
 * layer's final ordering cannot drift apart. Both call [compareByScore]; the
 * only thing that differs is which score function they pass in.
 */

/**
 * Strength of the direct edit evidence attached to a candidate.
 *
 * A candidate that can name the exact character it added or removed is better
 * evidenced than one that merely resembles the typed word.
 */
fun editEvidence(candidate: Candidate): Int = when {
    candidate.missingApostrophe != null -> 3
    candidate.duplicateLetter != null ||
        candidate.missingLetter != null ||
        candidate.extraLetter != null -> 2
    candidate.keyboardSubstitution != null -> 1
    else -> 0
}

/**
 * Ascending order: `a` before `b` means `a` ranks higher.
 *
 * Sequence, most meaningful first:
 *   1. higher score
 *   2. lower operation cost
 *   3. stronger direct edit evidence
 *   4. higher contextual support (zero until an unmeasured signal is enabled)
 *   5. higher frequency
 *   6. lexical order, purely for determinism
 *
 * Lexical order is last deliberately. It says nothing about which correction is
 * right, and letting it decide anything earlier is the bug that turned "thats"
 * into "that" rather than "that's".
 */
fun compareByScore(
    a: Candidate,
    b: Candidate,
    scoreOf: (Candidate) -> Double,
    contextOf: (Candidate) -> Double = { 0.0 },
): Int {
    val score = scoreOf(b).compareTo(scoreOf(a))
    if (score != 0) return score

    if (a.operationCost != b.operationCost) return a.operationCost.compareTo(b.operationCost)

    val evidence = editEvidence(b) - editEvidence(a)
    if (evidence != 0) return evidence

    val context = contextOf(b).compareTo(contextOf(a))
    if (context != 0) return context

    val frequency = b.frequency.compareTo(a.frequency)
    if (frequency != 0) return frequency

    return a.word.compareTo(b.word)
}

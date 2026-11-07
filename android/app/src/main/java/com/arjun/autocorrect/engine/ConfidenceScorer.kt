package com.arjun.autocorrect.engine

import kotlin.math.max
import kotlin.math.min

/**
 * Turns evidence into a single 0..1 confidence, then into an action.
 *
 * The personal term is a smoothed acceptance ratio, so one rejection does not
 * kill a rule that has been accepted forty times, but four rejections out of
 * twelve pull it below the autocorrect threshold - which is exactly the
 * behaviour the "form -> from" example needs.
 */
object ConfidenceScorer {

    /** Beta-smoothed acceptance ratio in 0..1; 0.5 with no evidence. */
    fun personalFactor(rule: CorrectionRule?): Double {
        if (rule == null) return 0.5
        val accepted = rule.accepted
        // Reverts weigh double, blocks quadruple: an explicit "no" is far
        // stronger evidence than silence.
        val rejected = rule.reverted * 2 + rule.blocked * 4
        val alpha = 2
        val beta = 2
        return (accepted + alpha).toDouble() / (accepted + rejected + alpha + beta)
    }

    /** Confidence for a dictionary-derived spelling candidate. */
    fun scoreSpelling(
        candidate: Candidate,
        /** True when the typed word is itself in the dictionary (real-word error). */
        originalIsWord: Boolean,
        rule: CorrectionRule? = null,
        /** 0..1 evidence that this pair was accepted in the same local context. */
        contextSupport: Double = 0.0,
    ): Double {
        val personal = personalFactor(rule)
        var base = candidateGenerationScore(candidate) +
            (personal - 0.5) * 0.14 +
            min(1.0, max(0.0, contextSupport)) * 0.06

        // A typed word that is itself valid must not be "fixed" by spelling.
        if (originalIsWord) base -= 0.45
        return clamp(base, 0.0, 0.99)
    }

    /** Confidence for a context-driven real-word correction. */
    fun scoreContextual(contextScore: Double, rule: CorrectionRule?, support: Double): Double {
        if (contextScore <= 0) return 0.0
        // Two independent cues (prev + next word) are needed for the top band.
        val base = 0.55 + min(contextScore, 2.0) * 0.14 + min(support, 1.0) * 0.08
        val personal = personalFactor(rule)
        return clamp(base * (0.75 + 0.5 * personal), 0.0, 0.95)
    }

    /** Confidence for an exact typo-table or user-authored rule. */
    fun scoreExact(source: RuleSource, rule: CorrectionRule?): Double {
        val base = when (source) {
            RuleSource.USER_CREATED -> 0.99
            RuleSource.BUILTIN_TYPO -> 0.96
            else -> 0.9
        }
        // A user-created rule is not second-guessed by statistics.
        if (source == RuleSource.USER_CREATED) return base
        val personal = personalFactor(rule)
        return clamp(base * (0.65 + 0.7 * personal), 0.0, 0.99)
    }

    fun decideAction(confidence: Double, mode: RuleMode, settings: Settings): ProposalAction {
        if (mode == RuleMode.BLOCKED) return ProposalAction.NONE
        if (confidence < settings.suggestionThreshold) return ProposalAction.NONE
        if (mode == RuleMode.SUGGESTION) return ProposalAction.SUGGEST
        return if (confidence >= settings.autocorrectThreshold) {
            ProposalAction.AUTOCORRECT
        } else {
            ProposalAction.SUGGEST
        }
    }

    /** Human-friendly confidence band for the UI. */
    fun band(confidence: Double): String = when {
        confidence >= 0.9 -> "high"
        confidence >= 0.7 -> "medium"
        else -> "low"
    }
}

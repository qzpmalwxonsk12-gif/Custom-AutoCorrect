package com.arjun.autocorrect.engine

/**
 * Correction-risk classes and the margins each one demands.
 *
 * The scorer decides which candidate is best. This decides whether that
 * evidence is strong enough, and safe enough, to act on - two separate
 * questions that one global margin cannot answer, because the cost of being
 * wrong is not constant. Turning "punctuatioon" into "punctuation" when the
 * user meant something else is a nuisance. Turning "woks" into "works" when
 * they run a kitchen supply shop changes what they said.
 */

enum class CorrectionRiskClass {
    EXACT_PERSONAL_RULE,
    INVALID_WORD_SINGLE_EDIT,
    INVALID_WORD_MULTI_EDIT,
    VALID_WORD_REPLACEMENT,
    TOKEN_MERGE,
    TOKEN_SPLIT,
}

data class RiskPolicy(
    /** Minimum score the winner must reach. */
    val requiredScore: Double,
    /** Minimum lead over the runner-up, on the unclamped scale. */
    val requiredMargin: Double,
    /** The strongest action this class may ever take. */
    val maximumAction: ProposalAction,
    /** Whether personal acceptance may promote this class over time. */
    val allowsPersonalPromotion: Boolean,
)

/**
 * `maximumAction` is a ceiling, never a floor. A class permitting AUTOCORRECT
 * still produces a suggestion when the margin is thin.
 */
val RISK_POLICY: Map<CorrectionRiskClass, RiskPolicy> = mapOf(
    CorrectionRiskClass.EXACT_PERSONAL_RULE to RiskPolicy(
        requiredScore = 0.6,
        requiredMargin = 0.02,
        maximumAction = ProposalAction.AUTOCORRECT,
        allowsPersonalPromotion = true,
    ),
    CorrectionRiskClass.INVALID_WORD_SINGLE_EDIT to RiskPolicy(
        requiredScore = 0.7,
        requiredMargin = 0.06,
        maximumAction = ProposalAction.AUTOCORRECT,
        allowsPersonalPromotion = true,
    ),
    CorrectionRiskClass.INVALID_WORD_MULTI_EDIT to RiskPolicy(
        requiredScore = 0.75,
        requiredMargin = 0.12,
        maximumAction = ProposalAction.AUTOCORRECT,
        allowsPersonalPromotion = true,
    ),
    /*
     * The word the user typed is real. The long-standing rule was to never
     * touch these at all; the relaxation is that context may now *offer* an
     * alternative, never impose one, and only on overwhelming evidence.
     */
    CorrectionRiskClass.VALID_WORD_REPLACEMENT to RiskPolicy(
        requiredScore = 0.8,
        requiredMargin = 0.35,
        maximumAction = ProposalAction.SUGGEST,
        allowsPersonalPromotion = false,
    ),
    CorrectionRiskClass.TOKEN_MERGE to RiskPolicy(
        requiredScore = 0.8,
        requiredMargin = 0.2,
        maximumAction = ProposalAction.AUTOCORRECT,
        allowsPersonalPromotion = false,
    ),
    CorrectionRiskClass.TOKEN_SPLIT to RiskPolicy(
        requiredScore = 0.8,
        requiredMargin = 0.2,
        maximumAction = ProposalAction.AUTOCORRECT,
        allowsPersonalPromotion = false,
    ),
)

data class PolicyDecision(
    val action: ProposalAction,
    val riskClass: CorrectionRiskClass,
    /** Why the action was lowered, when it was. */
    val reason: String? = null,
)

/** Assigns a correction to its risk class. */
fun classifyRisk(
    originalIsValidWord: Boolean,
    candidate: Candidate? = null,
    isPersonalRule: Boolean = false,
): CorrectionRiskClass {
    if (isPersonalRule) return CorrectionRiskClass.EXACT_PERSONAL_RULE

    // A real word being replaced is the highest-risk spelling case, whatever
    // process produced the alternative.
    if (originalIsValidWord) return CorrectionRiskClass.VALID_WORD_REPLACEMENT

    val cost = candidate?.operationCost ?: 1.0
    return if (cost <= 1.0) {
        CorrectionRiskClass.INVALID_WORD_SINGLE_EDIT
    } else {
        CorrectionRiskClass.INVALID_WORD_MULTI_EDIT
    }
}

/**
 * Applies the class policy to a ranked result.
 *
 * Only ever lowers an action. A class cannot promote a correction the scorer
 * was unwilling to make.
 */
fun applyPolicy(
    riskClass: CorrectionRiskClass,
    /** Winner's unclamped score. */
    score: Double,
    /** Winner minus runner-up, unclamped. */
    margin: Double,
    /** The action the scorer would otherwise take. */
    proposedAction: ProposalAction,
): PolicyDecision {
    val policy = RISK_POLICY.getValue(riskClass)
    val ceiling = policy.maximumAction

    var action = proposedAction
    var reason: String? = null

    if (action == ProposalAction.AUTOCORRECT && ceiling != ProposalAction.AUTOCORRECT) {
        action = ceiling
        reason = "$riskClass may not apply automatically"
    }
    if (action != ProposalAction.NONE && score < policy.requiredScore) {
        action = ProposalAction.NONE
        reason = "score ${"%.3f".format(score)} below ${policy.requiredScore} for $riskClass"
    }
    if (action == ProposalAction.AUTOCORRECT && margin < policy.requiredMargin) {
        action = ProposalAction.SUGGEST
        reason = "margin ${"%.3f".format(margin)} below ${policy.requiredMargin} for $riskClass"
    }

    return PolicyDecision(action, riskClass, reason)
}

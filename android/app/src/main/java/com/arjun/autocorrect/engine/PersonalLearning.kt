package com.arjun.autocorrect.engine

/**
 * Pure helpers over [LearningData].
 *
 * Every path that could produce a replacement funnels through [ruleUsable], so
 * a rejection learned once is honoured by the typo table, the candidate
 * pipeline and the context layer alike - not just by whichever layer the user
 * happened to reject it in.
 */
object PersonalLearning {

    fun findRule(data: LearningData, original: String, replacement: String): CorrectionRule? =
        data.rules[ruleId(original, replacement)]

    fun isBlockedPair(data: LearningData, original: String, replacement: String): Boolean =
        ruleId(original, replacement) in data.blockedPairs

    fun isDictionaryWord(data: LearningData, word: String): Boolean =
        normaliseRuleText(word) in data.dictionary

    /**
     * True when [rule] may fire in this context.
     *
     * Checks, in order: the rule is live, not blocked outright, not switched
     * off for this app, and not blocked for these neighbouring words.
     */
    fun ruleUsable(
        rule: CorrectionRule?,
        data: LearningData,
        ctx: EngineContext,
        blockedIds: Set<String>? = null,
    ): Boolean {
        if (rule == null) return false
        if (!rule.enabled || rule.mode == RuleMode.BLOCKED) return false
        val blocked = blockedIds ?: data.blockedPairs
        if (rule.id in blocked) return false
        if (rule.apps[ctx.origin] == "off") return false
        if (ContextScorer.contextBlocked(rule, ctx)) return false
        return true
    }

    /** True when any replacement for [original] has been blocked outright. */
    fun hasBlockedAlternative(data: LearningData, original: String): Boolean {
        val prefix = "${normaliseRuleText(original)}->"
        return data.blockedPairs.any { it.startsWith(prefix) }
    }
}

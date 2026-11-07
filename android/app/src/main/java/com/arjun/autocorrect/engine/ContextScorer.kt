package com.arjun.autocorrect.engine

/**
 * Lightweight local context scoring for real-word errors.
 *
 * No model, no network: a signed evidence score built from hand-written bigram
 * cues plus whatever the user's own accept/reject history says.
 */
object ContextScorer {

    data class Verdict(
        /** Positive: swap to [replacement]. Negative or zero: keep the typed word. */
        val score: Double,
        val replacement: String?,
        val reason: String,
    )

    private fun evidence(word: String, ctx: EngineContext): Double {
        val entry = Confusions.entry(word) ?: return 0.0
        var s = 0.0
        if (ctx.previousWord.isNotEmpty() && ctx.previousWord in entry.prev) s += 1.0
        if (ctx.nextWord.isNotEmpty() && ctx.nextWord in entry.next) s += 1.0
        if (entry.patterns.isNotEmpty()) {
            val window = "${ctx.before} ${ctx.after}".lowercase()
            for (pattern in entry.patterns) {
                if (pattern.containsMatchIn(window)) s += 0.5
            }
        }
        return s
    }

    /**
     * Decides whether a *valid* word is the wrong word here.
     *
     * The score is roughly "how much more the context supports the alternative
     * than the typed word". Callers turn that into confidence.
     */
    fun scoreContext(word: String, ctx: EngineContext): Verdict? {
        val set = Confusions.forWord(word) ?: return null

        val own = evidence(word, ctx)
        var best: Pair<String, Double>? = null
        for (alt in set.alternatives) {
            val s = evidence(alt, ctx)
            if (best == null || s > best.second) best = alt to s
        }
        val winner = best ?: return null

        val delta = winner.second - own
        if (delta <= 0) {
            return Verdict(delta, null, "context supports \"$word\"")
        }
        // The typed word having *any* support is a strong veto: "complete the
        // form" must never flip, even though "from" also has cues nearby.
        if (own > 0) {
            return Verdict(delta - own, null, "both readings have support")
        }
        return Verdict(
            score = delta,
            replacement = winner.first,
            reason = "context suggests \"${winner.first}\" (${describeCues(ctx)})",
        )
    }

    private fun describeCues(ctx: EngineContext): String {
        val parts = ArrayList<String>(2)
        if (ctx.previousWord.isNotEmpty()) parts.add("after \"${ctx.previousWord}\"")
        if (ctx.nextWord.isNotEmpty()) parts.add("before \"${ctx.nextWord}\"")
        return if (parts.isEmpty()) "sentence context" else parts.joinToString(", ")
    }

    /**
     * Applies the user's context-specific rejections ("keep `form` after
     * `application`"). True when this rule must not fire here.
     */
    fun contextBlocked(rule: CorrectionRule?, ctx: EngineContext): Boolean {
        if (rule == null) return false
        if (ctx.previousWord.isNotEmpty() && ctx.previousWord in rule.blockedAfter) return true
        if (ctx.nextWord.isNotEmpty() && ctx.nextWord in rule.blockedBefore) return true
        return false
    }

    /** Positive nudge when the user previously accepted this rule right here. */
    fun contextSupport(rule: CorrectionRule?, ctx: EngineContext): Double {
        if (rule == null) return 0.0
        var s = 0.0
        if (ctx.previousWord.isNotEmpty() && ctx.previousWord in rule.acceptedAfter) s += 0.5
        return s
    }
}

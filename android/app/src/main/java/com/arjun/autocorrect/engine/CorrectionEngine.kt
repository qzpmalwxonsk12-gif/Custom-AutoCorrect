package com.arjun.autocorrect.engine

import kotlin.math.max
import kotlin.math.min

/**
 * The correction engine: layered, deterministic, allocation-light.
 *
 * Entry point is [analyze], called once per committed word. Layers run in a
 * fixed priority order and the first actionable one wins:
 *
 *   1. guards (URL, code, digits, caps, ...)   5. common typo table
 *   2. personal dictionary                     6. the seven-process pipeline
 *   3. user-created exact rules                7. context (real-word errors)
 *   4. personal learned rules                  8. local grammar rules
 *
 * Nothing in this file touches Android, the network or storage.
 */
object CorrectionEngine {

    private const val CONTEXT_WINDOW = 60

    /** Minimum lead over the runner-up required for a spelling auto-correction. */
    const val SPELLING_AUTOCORRECT_MARGIN = 0.06

    /**
     * Preserves short acronym/ticker protection while allowing a long, unknown
     * all-caps word to receive the same spelling analysis as ordinary prose.
     * The confidence and ambiguity gates still apply.
     */
    private const val MIN_ALL_CAPS_SPELLCHECK_LENGTH = 6

    private val SENTENCE_BOUNDARY_BEFORE = Regex("""[.!?][)"'\]]?\s""")
    private val SENTENCE_BOUNDARY_AFTER = Regex("""(?:\r?\n|[.!?][)"'\]]?(?:\s|$))""")

    /** Builds the bounded context window handed to the scorers. */
    fun buildContext(text: String, start: Int, end: Int, origin: String): EngineContext {
        val rawBefore = text.substring(max(0, start - CONTEXT_WINDOW), start)
        var beforeStart = max(
            rawBefore.lastIndexOf('\n') + 1,
            rawBefore.lastIndexOf('\r') + 1,
        )
        for (match in SENTENCE_BOUNDARY_BEFORE.findAll(rawBefore)) {
            beforeStart = max(beforeStart, match.range.last + 1)
        }
        val before = rawBefore.substring(min(beforeStart, rawBefore.length))

        var after = text.substring(end, min(text.length, end + CONTEXT_WINDOW))
        SENTENCE_BOUNDARY_AFTER.find(after)?.let { match ->
            after = after.substring(0, match.range.last + 1)
        }

        return EngineContext(
            before = before,
            after = after,
            previousWord = Tokenizer.previousWord(text, start),
            nextWord = Tokenizer.nextWord(text, end),
            isSentenceStart = Tokenizer.isSentenceStart(text, start),
            origin = origin,
        )
    }

    /** Case-adjusts a replacement for the word it is standing in for. */
    private fun fit(observed: String, replacement: String, ctx: EngineContext): String {
        var out = matchCase(observed, replacement)
        // Preserve a curly apostrophe the user actually typed.
        val apostrophe = observed.firstOrNull { it == '\u02BC' || it == '\u2018' || it == '\u2019' || it == '\uFF07' }
        if (apostrophe != null) out = out.replace('\'', apostrophe)
        if (ctx.isSentenceStart && detectCaseStyle(observed) != CaseStyle.UPPER) {
            out = capitalise(out)
        }
        return out
    }

    /**
     * Analyses the word ending at [AnalyzeInput.wordEnd] and returns a
     * proposal, or null when nothing should happen. Cost is bounded and
     * independent of the length of the field.
     */
    fun analyze(input: AnalyzeInput, data: LearningData, settings: Settings): AnalyzeResult? {
        if (!settings.enabled) return null
        if (!Dictionary.isReady) return null
        val (text, wordEnd, origin) = input
        if (settings.appOverrides[origin] == "off") return null

        val token = Tokenizer.wordEndingAt(text, wordEnd) ?: return null

        val guard = Tokenizer.analyzeToken(text, token.start, token.end)
        val ctx = buildContext(text, token.start, token.end, origin)
        val word = token.text
        val lower = normaliseRuleText(word)

        // Layers 1 + 2: protected tokens and the personal dictionary
        // short-circuit every replacement layer. Grammar still gets a look
        // because it only ever rewrites the *article* in front of the word.
        val longUnknownAllCaps = guard.reason == ProtectionReason.ALL_CAPS &&
            word.length >= MIN_ALL_CAPS_SPELLCHECK_LENGTH &&
            !isKnownWord(lower)
        val spellingAllowed = (!guard.protectedToken || longUnknownAllCaps) &&
            !PersonalLearning.isDictionaryWord(data, lower)

        if (spellingAllowed) {
            val proposal = exactRuleLayer(token, lower, ctx, data, settings)
                ?: typoLayer(token, lower, ctx, data, settings)
                ?: dictionaryPipelineLayer(token, lower, ctx, data, settings)
                ?: contextualLayer(token, lower, ctx, data, settings)
            if (proposal != null) return AnalyzeResult(proposal, ctx)
        }

        if (settings.grammarEnabled) {
            val fix = checkArticle(text, token.start, token.end)
            if (fix != null && !PersonalLearning.isBlockedPair(data, fix.original, fix.replacement)) {
                // Grammar targets the preceding article, so its learning
                // context must be built around that span rather than around the
                // committed noun.
                val grammarCtx = buildContext(text, fix.start, fix.end, origin)
                val rule = PersonalLearning.findRule(data, fix.original, fix.replacement)
                if (rule != null && !PersonalLearning.ruleUsable(rule, data, grammarCtx)) return null
                val confidence = if (rule != null) {
                    clamp(fix.confidence * (0.7 + 0.6 * ConfidenceScorer.personalFactor(rule)), 0.0, 0.99)
                } else {
                    fix.confidence
                }
                val action = ConfidenceScorer.decideAction(
                    confidence, rule?.mode ?: RuleMode.DEFAULT, settings,
                )
                if (action != ProposalAction.NONE) {
                    return AnalyzeResult(
                        CorrectionProposal(
                            start = fix.start,
                            end = fix.end,
                            original = fix.original,
                            replacement = fix.replacement,
                            correctionType = CorrectionType.GRAMMAR,
                            source = RuleSource.BUILTIN_GRAMMAR,
                            confidence = confidence,
                            action = action,
                            reason = fix.reason,
                            ruleId = rule?.id,
                        ),
                        grammarCtx,
                    )
                }
            }
        }
        return null
    }

    /* ------------------------------ layers ------------------------------ */

    /** Layers 3 + 4: user-created rules, then personal learned rules. */
    private fun exactRuleLayer(
        token: Token,
        lower: String,
        ctx: EngineContext,
        data: LearningData,
        settings: Settings,
    ): CorrectionProposal? {
        val candidates = data.rules.values.filter { rule ->
            (rule.source == RuleSource.USER_CREATED || rule.source == RuleSource.PERSONAL_LEARNING) &&
                rule.original == lower &&
                PersonalLearning.ruleUsable(rule, data, ctx)
        }
        if (candidates.isEmpty()) return null

        val rule = candidates.maxByOrNull { r ->
            (if (r.source == RuleSource.USER_CREATED) 2 else 1) * 10 + r.confidence
        } ?: return null

        val source = if (rule.source == RuleSource.USER_CREATED) {
            RuleSource.USER_CREATED
        } else {
            RuleSource.PERSONAL_LEARNING
        }
        val confidence = clamp(
            ConfidenceScorer.scoreExact(source, rule) +
                ContextScorer.contextSupport(rule, ctx) * 0.05,
            0.0, 0.99,
        )
        val action = ConfidenceScorer.decideAction(confidence, rule.mode, settings)
        if (action == ProposalAction.NONE) return null

        return CorrectionProposal(
            start = token.start,
            end = token.end,
            original = token.text,
            replacement = fit(token.text, rule.replacement, ctx),
            correctionType = if (rule.source == RuleSource.USER_CREATED) {
                CorrectionType.EXACT_RULE
            } else {
                CorrectionType.PERSONAL_RULE
            },
            source = rule.source,
            confidence = confidence,
            action = action,
            reason = if (rule.source == RuleSource.USER_CREATED) {
                "your replacement rule"
            } else {
                "learned from your edits (${rule.accepted} kept, ${rule.reverted} reverted)"
            },
            ruleId = rule.id,
        )
    }

    /** Layer 5: the shipped common-typo table. */
    private fun typoLayer(
        token: Token,
        lower: String,
        ctx: EngineContext,
        data: LearningData,
        settings: Settings,
    ): CorrectionProposal? {
        // The typo table predates the full ESDB list. If its left-hand side is
        // a legitimate dictionary word ("abut", "wont"), treating it as an
        // unconditional typo would create a real-word error.
        if (isKnownWord(lower)) return null
        val replacement = Typos.lookup(lower) ?: return null
        if (PersonalLearning.isBlockedPair(data, lower, replacement)) return null

        val rule = PersonalLearning.findRule(data, lower, replacement)
        if (rule != null && !PersonalLearning.ruleUsable(rule, data, ctx)) return null

        val confidence = ConfidenceScorer.scoreExact(RuleSource.BUILTIN_TYPO, rule)
        val action = ConfidenceScorer.decideAction(
            confidence, rule?.mode ?: RuleMode.DEFAULT, settings,
        )
        if (action == ProposalAction.NONE) return null

        return CorrectionProposal(
            start = token.start,
            end = token.end,
            original = token.text,
            replacement = fit(token.text, replacement, ctx),
            correctionType = CorrectionType.SPELLING,
            source = RuleSource.BUILTIN_TYPO,
            confidence = confidence,
            action = action,
            reason = "common misspelling",
            ruleId = rule?.id,
        )
    }

    /** Layer 6: the deterministic seven-process dictionary pipeline. */
    private fun dictionaryPipelineLayer(
        token: Token,
        lower: String,
        ctx: EngineContext,
        data: LearningData,
        settings: Settings,
    ): CorrectionProposal? {
        // A word the dictionary knows is not a spelling error. Real-word errors
        // are deliberately delegated to the context layer.
        if (isKnownWord(lower)) return null
        if (lower.length < 3) return null
        // Capitalised mid-sentence is almost always a name, so do not infer
        // that an uncommon proper noun is a misspelling merely because ESDB
        // lacks it.
        if (detectCaseStyle(token.text) == CaseStyle.TITLE && !ctx.isSentenceStart) return null

        val hasBlockedAlternative = PersonalLearning.hasBlockedAlternative(data, lower)

        data class Evidence(
            val eligible: Boolean,
            val rule: CorrectionRule?,
            val rankAdjustment: Double,
        )

        val evidenceByWord = HashMap<String, Evidence>()
        fun evidenceFor(candidate: Candidate): Evidence = evidenceByWord.getOrPut(candidate.word) {
            val id = ruleId(lower, candidate.word)
            val rule = data.rules[id]
            val eligible = id !in data.blockedPairs &&
                (rule == null || PersonalLearning.ruleUsable(rule, data, ctx, data.blockedPairs))
            Evidence(
                eligible = eligible,
                rule = rule,
                rankAdjustment = when {
                    eligible && rule != null ->
                        (ConfidenceScorer.personalFactor(rule) - 0.5) * 0.14 +
                            ContextScorer.contextSupport(rule, ctx) * 0.06
                    eligible -> 0.0
                    else -> -1.0
                },
            )
        }

        val candidates = CandidateGenerator.generate(
            lower,
            CandidateGenerator.MAX_CANDIDATES,
            null,
        ) { evidenceFor(it).rankAdjustment }
        if (candidates.isEmpty()) return null

        val eligible = candidates.filter { evidenceFor(it).eligible }
        if (eligible.isEmpty()) return null

        /*
         * Ranking happens once, on an **unclamped** score, before confidence is
         * computed. Sorting on a clamped value is what previously let two
         * different candidates tie at the 0.99 ceiling and be separated by
         * alphabetical order.
         */
        val decision = rank(eligible, DEFAULT_WEIGHTS) { evidenceFor(it).rankAdjustment }
        val bestScored = decision.bestCandidate ?: return null

        val bestRule = evidenceFor(bestScored.candidate).rule
        val baseConfidence = ConfidenceScorer.scoreSpelling(
            candidate = bestScored.candidate,
            originalIsWord = false,
            rule = bestRule,
            contextSupport = ContextScorer.contextSupport(bestRule, ctx),
        )
        val hasRunnerUp = decision.secondBestCandidate != null

        /*
         * There is exactly one ambiguity margin: the winner's lead on the
         * unified, unclamped scale. Display confidence is deliberately computed
         * only after ranking and must not widen that lead.
         */
        val rawMargin = if (hasRunnerUp) decision.margin else 1.0
        // A close runner-up is evidence against certainty, even when the winner
        // remains the best deterministic suggestion.
        val ambiguityPenalty = if (hasRunnerUp) {
            max(0.0, SPELLING_AUTOCORRECT_MARGIN - rawMargin)
        } else {
            0.0
        }
        // Clamping happens here and only here: after ranking, after the margin.
        val confidence = clamp(baseConfidence - ambiguityPenalty, 0.0, 0.99)
        var action = ConfidenceScorer.decideAction(
            confidence, bestRule?.mode ?: RuleMode.DEFAULT, settings,
        )
        if (action == ProposalAction.AUTOCORRECT && rawMargin < SPELLING_AUTOCORRECT_MARGIN) {
            action = ProposalAction.SUGGEST
        }
        // If the user explicitly blocked a different replacement for this
        // spelling, an automatically chosen fallback would evade that decision.
        if (action == ProposalAction.AUTOCORRECT && hasBlockedAlternative) {
            action = ProposalAction.SUGGEST
        }
        // Appending a letter to a short token is the signature of a word the
        // user has not finished ("impro" + " " + "vement"). Completing it
        // automatically destroys the evidence a later merge would need.
        val insertion = bestScored.candidate.missingLetter
        if (action == ProposalAction.AUTOCORRECT &&
            insertion != null &&
            insertion.insertedIndex >= lower.length &&
            lower.length < 7
        ) {
            action = ProposalAction.SUGGEST
        }

        /*
         * Correction-risk policy, applied last. The scorer has already decided
         * *which* candidate is best; this decides whether that evidence is
         * strong and safe enough to act on. It can only ever lower the action.
         */
        val policy = applyPolicy(
            riskClass = classifyRisk(
                originalIsValidWord = false,
                candidate = bestScored.candidate,
                isPersonalRule = bestRule?.source == RuleSource.USER_CREATED ||
                    bestRule?.source == RuleSource.PERSONAL_LEARNING,
            ),
            score = bestScored.rawScore,
            margin = rawMargin,
            proposedAction = action,
        )
        action = policy.action
        if (action == ProposalAction.NONE) return null

        return CorrectionProposal(
            start = token.start,
            end = token.end,
            original = token.text,
            replacement = fit(token.text, bestScored.candidate.word, ctx),
            correctionType = correctionTypeFor(bestScored.candidate),
            source = RuleSource.LEXICON,
            confidence = confidence,
            action = action,
            reason = describeCandidate(bestScored.candidate, ambiguityPenalty > 0),
            ruleId = bestRule?.id,
            process = bestScored.candidate.process,
        )
    }

    /** Layer 7: real-word errors decided by local context. */
    private fun contextualLayer(
        token: Token,
        lower: String,
        ctx: EngineContext,
        data: LearningData,
        settings: Settings,
    ): CorrectionProposal? {
        if (!settings.contextualEnabled) return null
        val verdict = ContextScorer.scoreContext(lower, ctx) ?: return null
        val replacement = verdict.replacement ?: return null
        if (verdict.score <= 0) return null
        if (PersonalLearning.isBlockedPair(data, lower, replacement)) return null

        val rule = PersonalLearning.findRule(data, lower, replacement)
        if (rule != null && !PersonalLearning.ruleUsable(rule, data, ctx)) return null

        val confidence = ConfidenceScorer.scoreContextual(
            verdict.score, rule, ContextScorer.contextSupport(rule, ctx),
        )
        var action = ConfidenceScorer.decideAction(
            confidence, rule?.mode ?: RuleMode.DEFAULT, settings,
        )
        // Contextual rewrites only auto-apply when the user has opted in *and*
        // the rule has personal evidence behind it.
        if (action == ProposalAction.AUTOCORRECT &&
            !(settings.contextualAutocorrect && rule != null && rule.accepted >= 3)
        ) {
            action = ProposalAction.SUGGEST
        }
        if (action == ProposalAction.NONE) return null

        return CorrectionProposal(
            start = token.start,
            end = token.end,
            original = token.text,
            replacement = fit(token.text, replacement, ctx),
            correctionType = CorrectionType.CONTEXTUAL,
            source = RuleSource.LEXICON,
            confidence = confidence,
            action = action,
            reason = verdict.reason,
            ruleId = rule?.id,
        )
    }

    /** Presentation type, so the history screen can name the operation. */
    private fun correctionTypeFor(candidate: Candidate): CorrectionType = when (candidate.process) {
        3 -> CorrectionType.KEYBOARD_PROXIMITY
        else -> CorrectionType.SPELLING
    }

    /** Plain-language explanation of what the winning process actually did. */
    fun describeCandidate(candidate: Candidate, ambiguous: Boolean): String {
        val suffix = if (ambiguous) "; close alternative also found" else ""
        return when (candidate.process) {
            2 -> "two adjacent letters swapped$suffix"
            3 -> candidate.keyboardSubstitution?.let {
                "keyboard-neighbour substitution at position ${it.index + 1}: " +
                    "${it.typedCharacter} → ${it.replacementCharacter}$suffix"
            } ?: "keyboard-neighbour substitution$suffix"
            4 -> candidate.duplicateLetter?.let {
                "removed accidental duplicate letter: " +
                    "${it.removedCharacter} at position ${it.removedIndex + 1}$suffix"
            } ?: "removed an accidental duplicate letter$suffix"
            5 -> candidate.missingLetter?.let {
                "inserted missing letter: " +
                    "${it.insertedCharacter} at position ${it.insertedIndex + 1}$suffix"
            } ?: "inserted a missing letter$suffix"
            6 -> candidate.extraLetter?.let {
                "removed extra letter: ${it.removedCharacter} at position ${it.removedIndex + 1}$suffix"
            } ?: "removed an extra letter$suffix"
            7 -> candidate.missingApostrophe?.let {
                "restored the missing apostrophe at position ${it.insertedIndex + 1}$suffix"
            } ?: "restored a missing apostrophe$suffix"
            else -> "same-length dictionary match$suffix"
        }
    }
}

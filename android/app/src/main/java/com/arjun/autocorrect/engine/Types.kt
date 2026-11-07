package com.arjun.autocorrect.engine

/**
 * Engine-wide value types.
 *
 * Nothing in the `engine` package may import an Android class. That is the same
 * rule the TypeScript original enforces for the DOM, and it is what lets the
 * whole correction pipeline run under plain JVM unit tests.
 */

/** What the engine wants the caller to do with a proposal. */
enum class ProposalAction { NONE, SUGGEST, AUTOCORRECT }

/** Which layer produced a proposal. */
enum class CorrectionType {
    SPELLING,
    KEYBOARD_PROXIMITY,
    EXACT_RULE,
    PERSONAL_RULE,
    CONTEXTUAL,
    GRAMMAR,
    CAPITALISATION,
}

enum class RuleSource {
    BUILTIN_TYPO,
    BUILTIN_GRAMMAR,
    LEXICON,
    USER_CREATED,
    PERSONAL_LEARNING,
}

/** Per-rule override, mirroring the extension's rule modes. */
enum class RuleMode { DEFAULT, SUGGESTION, BLOCKED }

/**
 * A single proposed change to `[start, end)` of the analysed text.
 *
 * The engine never applies anything itself; it returns this and the service
 * layer decides, verifies and records.
 */
data class CorrectionProposal(
    val start: Int,
    val end: Int,
    val original: String,
    val replacement: String,
    val correctionType: CorrectionType,
    val source: RuleSource,
    val confidence: Double,
    val action: ProposalAction,
    val reason: String,
    val ruleId: String? = null,
    /** Which of the seven candidate processes produced this, when applicable. */
    val process: Int? = null,
)

/** Bounded window of text around the target word, handed to the scorers. */
data class EngineContext(
    val before: String,
    val after: String,
    val previousWord: String,
    val nextWord: String,
    val isSentenceStart: Boolean,
    /** Package name of the host app; the Android analogue of a web origin. */
    val origin: String,
)

data class AnalyzeInput(
    val text: String,
    /** Exclusive end offset of the word that was just committed. */
    val wordEnd: Int,
    val origin: String,
)

data class AnalyzeResult(
    val proposal: CorrectionProposal,
    val context: EngineContext,
)

/**
 * One learned or authored replacement.
 *
 * `accepted` / `reverted` / `blocked` drive the smoothed acceptance ratio in
 * [ConfidenceScorer.personalFactor], so a rule earns or loses automatic status
 * from real use rather than from a fixed table.
 */
data class CorrectionRule(
    val id: String,
    val original: String,
    val replacement: String,
    val source: RuleSource,
    val mode: RuleMode = RuleMode.DEFAULT,
    val enabled: Boolean = true,
    val confidence: Double = 0.5,
    val accepted: Int = 0,
    val reverted: Int = 0,
    val blocked: Int = 0,
    /** Per-app overrides: package name -> "on" | "off". */
    val apps: Map<String, String> = emptyMap(),
    /** Previous words after which this rule must not fire. */
    val blockedAfter: Set<String> = emptySet(),
    /** Next words before which this rule must not fire. */
    val blockedBefore: Set<String> = emptySet(),
    /** Previous words where this rule was explicitly accepted. */
    val acceptedAfter: Set<String> = emptySet(),
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)

/**
 * Everything the engine has learned. Immutable snapshot: the service holds one
 * and swaps it wholesale when the store publishes an update, so a correction
 * pass can never observe a half-applied edit.
 */
data class LearningData(
    val rules: Map<String, CorrectionRule> = emptyMap(),
    /** Words the user asked never to correct. */
    val dictionary: Set<String> = emptySet(),
    /** Rule ids ("typed->replacement") blocked for good. */
    val blockedPairs: Set<String> = emptySet(),
) {
    companion object {
        val EMPTY = LearningData()
    }
}

/** User-facing behaviour switches. */
data class Settings(
    val enabled: Boolean = true,
    val contextualEnabled: Boolean = true,
    val contextualAutocorrect: Boolean = false,
    val grammarEnabled: Boolean = true,
    val capitalisationEnabled: Boolean = true,
    /** 0..1; a proposal must beat this to be written into the text. */
    val autocorrectThreshold: Double = 0.85,
    /** 0..1; below this nothing is offered at all. */
    val suggestionThreshold: Double = 0.60,
    val learnFromDecisions: Boolean = true,
    val learnFromManualEdits: Boolean = true,
    /** Manual repeats required before a personal rule is proposed. */
    val manualEditEvidence: Int = 3,
    /** Characters of surrounding text stored per correction (0 disables it). */
    val contextRadius: Int = 32,
    val historyRetentionDays: Int = 30,
    /** Package names the service is allowed to act in. Empty = act nowhere. */
    val allowedApps: Set<String> = emptySet(),
    /** Per-app master switch, overriding [allowedApps] membership. */
    val appOverrides: Map<String, String> = emptyMap(),
    val vibrateOnCorrection: Boolean = false,
    val showCorrectionToast: Boolean = false,
)

/** Clamp helper matching the TS `clamp`. */
internal fun clamp(value: Double, lo: Double, hi: Double): Double =
    if (value < lo) lo else if (value > hi) hi else value

private val UNICODE_APOSTROPHES = Regex("[ʼ‘’＇]")

/**
 * Canonical form shared by dictionary, rule, block and learning lookups.
 *
 * Matches the TS `normaliseRuleText` exactly: curly apostrophes fold onto the
 * ASCII one before lower-casing, so "don’t" and "don't" are one key.
 */
fun normaliseRuleText(value: String): String =
    UNICODE_APOSTROPHES.replace(value, "'").lowercase()

/** Stable id for a replacement pair. */
fun ruleId(original: String, replacement: String): String =
    "${normaliseRuleText(original)}->${normaliseRuleText(replacement)}"

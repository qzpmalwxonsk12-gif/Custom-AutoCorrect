/**
 * Grammar-lane data model and pure helpers, shared by the content script (which
 * requests lints and shows chips) and the background (which hosts the Harper
 * engine). This file must never import from 'harper.js': the content bundle
 * must stay Harper-free, and every helper here has to be unit-testable in Node.
 *
 * Design notes:
 *  - Issues carry a paragraph-relative UTF-16 span derived by *diffing* the
 *    paragraph against Harper's own applySuggestion() output. That sidesteps
 *    two bug classes at once: Harper spans count Unicode scalar values (Rust
 *    chars), not UTF-16 code units, and Remove/InsertAfter suggestions have no
 *    natural replacement span. The diff always yields a plain replace edit.
 *  - Empty-sided edits (pure insertions/deletions) are widened to word
 *    boundaries so both `original` and `replacement` are non-empty; the
 *    existing anchor/locator/reverter machinery requires that.
 */
import type { GrammarRuleStats, LearningData, Settings } from './types.js';

/** One actionable finding from the grammar engine, fully serialisable. */
export interface GrammarIssue {
  /** Harper rule name, e.g. "SubjectVerbAgreement". Namespaced by callers. */
  ruleId: string;
  /** Harper lint kind, e.g. "Agreement", "Punctuation". */
  kind: string;
  /** Human-readable explanation shown on the chip/card. */
  message: string;
  /** UTF-16 offsets into the *paragraph text that was linted*. */
  start: number;
  end: number;
  /** Exact text currently at [start, end). Never empty. */
  original: string;
  /** Replacement text. Never empty. */
  replacement: string;
  /** Harper context hash (decimal string) for its ignore list, when available. */
  ignoreHash?: string;
}

export interface LintRequest {
  /** The paragraph to lint, exactly as sliced from the field text. */
  paragraph: string;
  /** Raw FNV-1a fingerprint of `paragraph` (not normalised - offsets matter). */
  fingerprint: string;
}

export interface LintResponse {
  issues: GrammarIssue[];
  /** Engine time for this call, in ms. */
  lintMs: number;
  /** Set only on the call that paid for engine setup, in ms. */
  setupMs?: number;
  /** True when Harper is disabled by settings; issues will be empty. */
  disabled?: boolean;
}

export type GrammarVerdict = 'offered' | 'accepted' | 'rejected';

export interface GrammarFeedback {
  /** Bare Harper rule name (no `harper:` prefix). */
  ruleId: string;
  verdict: GrammarVerdict;
  /** Present on rejections that should feed Harper's ignore list. */
  ignoreHash?: string;
  /** True when the user chose "never apply this rule" - disables it globally. */
  disableRule?: boolean;
}

/** Prefix for `sourceRuleId` on records produced by the Harper lane. */
export const HARPER_RULE_PREFIX = 'harper:';

export function isHarperRuleId(sourceRuleId: string | undefined): boolean {
  return sourceRuleId !== undefined && sourceRuleId.startsWith(HARPER_RULE_PREFIX);
}

export function bareHarperRule(sourceRuleId: string): string {
  return sourceRuleId.startsWith(HARPER_RULE_PREFIX)
    ? sourceRuleId.slice(HARPER_RULE_PREFIX.length)
    : sourceRuleId;
}

/* ------------------------------------------------------------------ *
 * Edit derivation
 * ------------------------------------------------------------------ */

export interface DerivedEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Derives the single replace-edit that turns `before` into `after`, as UTF-16
 * offsets into `before`. Returns null when the strings are identical.
 */
export function deriveEdit(before: string, after: string): DerivedEdit | null {
  if (before === after) return null;
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix),
  };
}

const WORDISH = /[A-Za-zÀ-ɏ0-9'’]/;

/**
 * Widens a minimal diff into a presentable, locatable edit:
 *
 *  1. word-boundary snapping - a diff that cuts through a word ("s" -> "ve"
 *     inside has/have) grows to cover the whole word, because the characters
 *     outside the minimal diff are identical in both strings by construction;
 *  2. empty-side absorption - pure insertions/deletions swallow the adjacent
 *     word so both `original` and `replacement` end up non-empty, which the
 *     anchor/locator/reverter machinery requires.
 *
 * Returns null when no sane widening exists.
 */
export function widenEdit(paragraph: string, edit: DerivedEdit): DerivedEdit | null {
  let { start, end, replacement } = edit;

  // 1. Snap to word boundaries. Growing left/right by k characters prepends/
  //    appends the same k characters to both sides of the edit.
  const touchesWordLeft = () =>
    start > 0 &&
    WORDISH.test(paragraph[start - 1]!) &&
    (start < end ? WORDISH.test(paragraph[start]!) : WORDISH.test(replacement[0] ?? ''));
  while (touchesWordLeft()) {
    start--;
    replacement = paragraph[start]! + replacement;
  }
  const touchesWordRight = () =>
    end < paragraph.length &&
    WORDISH.test(paragraph[end]!) &&
    (start < end
      ? WORDISH.test(paragraph[end - 1]!)
      : WORDISH.test(replacement[replacement.length - 1] ?? ''));
  while (touchesWordRight()) {
    replacement = replacement + paragraph[end]!;
    end++;
  }

  // 2. Absorb a neighbouring word while either side is still empty.
  if (paragraph.slice(start, end).length === 0 || replacement.length === 0) {
    let cursor = start;
    while (cursor > 0 && paragraph[cursor - 1] === ' ') cursor--;
    while (cursor > 0 && WORDISH.test(paragraph[cursor - 1]!)) cursor--;
    if (cursor < start) {
      replacement = paragraph.slice(cursor, start) + replacement;
      start = cursor;
    }
  }
  if (paragraph.slice(start, end).length === 0 || replacement.length === 0) {
    let cursor = end;
    while (cursor < paragraph.length && paragraph[cursor] === ' ') cursor++;
    while (cursor < paragraph.length && WORDISH.test(paragraph[cursor]!)) cursor++;
    if (cursor > end) {
      replacement = replacement + paragraph.slice(end, cursor);
      end = cursor;
    }
  }

  const finalOriginal = paragraph.slice(start, end);
  if (finalOriginal.length === 0 || replacement.length === 0) return null;
  if (finalOriginal === replacement) return null;
  return { start, end, replacement };
}

/* ------------------------------------------------------------------ *
 * Issue validation (content side, before anything is shown or applied)
 * ------------------------------------------------------------------ */

export interface IssueValidationInput {
  issue: GrammarIssue;
  /** Full current field text. */
  text: string;
  /** Where the linted paragraph started in the field text. */
  paragraphStart: number;
  /** Where the linted paragraph ended (exclusive). */
  paragraphEnd: number;
  learning: LearningData;
  /** Session-local set of dismissed issue keys. */
  dismissed: ReadonlySet<string>;
  /** Ranges (field coordinates) already owned by live correction records. */
  occupiedRanges: ReadonlyArray<{ start: number; end: number }>;
}

export type IssueValidation =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: string };

/** Stable key used for session-local dismissal suppression. */
export function issueKey(issue: GrammarIssue, paragraphFingerprint: string): string {
  return `${issue.ruleId}|${issue.original}|${issue.start}|${paragraphFingerprint}`;
}

/**
 * Re-checks an issue against the *current* text right before it is offered.
 * Every failure is a silent skip, never an error - lint results are advisory.
 */
export function validateIssue(input: IssueValidationInput): IssueValidation {
  const { issue, text, paragraphStart, paragraphEnd } = input;
  if (issue.original.length === 0 || issue.replacement.length === 0) {
    return { ok: false, reason: 'empty-side' };
  }
  if (issue.original === issue.replacement) return { ok: false, reason: 'no-op' };
  if (issue.start < 0 || issue.end <= issue.start) return { ok: false, reason: 'bad-span' };

  const start = paragraphStart + issue.start;
  const end = paragraphStart + issue.end;
  if (end > paragraphEnd || end > text.length) return { ok: false, reason: 'out-of-range' };

  if (text.slice(start, end) !== issue.original) return { ok: false, reason: 'text-drifted' };

  // Paragraphs are linted in isolation, so the engine treats every paragraph
  // start as a sentence start. When the preceding document text does not end
  // a sentence (hard-wrapped lines, pasted fragments), a capitalisation
  // finding at offset 0 is an artefact of the slicing, not of the writing.
  if (issue.kind === 'Capitalization' && issue.start === 0 && paragraphStart > 0) {
    const before = text.slice(0, paragraphStart).replace(/[\s"'”’)\]]+$/u, '');
    const lastChar = before.slice(-1);
    if (lastChar && !'.!?'.includes(lastChar)) {
      return { ok: false, reason: 'mid-sentence-capitalization' };
    }
  }

  // Respect the user's word-pair blocks and dictionary for single-word issues.
  const lowerOriginal = issue.original.toLowerCase();
  const lowerReplacement = issue.replacement.toLowerCase();
  if (!/\s/.test(issue.original)) {
    if (input.learning.dictionary.includes(lowerOriginal.replace(/[.,;:!?]$/, ''))) {
      return { ok: false, reason: 'in-dictionary' };
    }
    const pairId = `${lowerOriginal}->${lowerReplacement}`;
    if (input.learning.blockedPairs.includes(pairId)) {
      return { ok: false, reason: 'pair-blocked' };
    }
  }

  // Never fight a live correction record over the same characters.
  for (const range of input.occupiedRanges) {
    if (start < range.end && end > range.start) return { ok: false, reason: 'overlaps-record' };
  }
  return { ok: true, start, end };
}

/* ------------------------------------------------------------------ *
 * Automatic application gating
 * ------------------------------------------------------------------ */

/**
 * Rules that stay suggestion-only even with auto-apply on, because they were
 * measured producing wrong replacements in this build's configuration.
 *
 * NominalWants rewrites "wont" -> "want". Harper's own SpellCheck would offer
 * "won't", but this extension suppresses Spelling (the local engine owns it),
 * so this rule is the only one that fires and its answer is wrong whenever the
 * user meant "won't".
 */
export const AUTO_APPLY_DENY_RULES: ReadonlySet<string> = new Set(['NominalWants']);

/**
 * Lint kinds that express taste rather than correctness. Never auto-applied:
 * silently rewriting someone's voice is not a correction.
 */
export const AUTO_APPLY_DENY_KINDS: ReadonlySet<string> = new Set(['Style', 'Readability']);

/** Reverts (with no offsetting acceptances) after which a rule loses auto-apply. */
const AUTO_APPLY_REVERT_LIMIT = 2;

export type AutoApplyDecision =
  | { auto: true }
  | { auto: false; reason: 'setting-off' | 'denied-rule' | 'denied-kind' | 'user-reverts' };

/**
 * Decides whether a finding may be written into the text without asking.
 * Conservative by construction: the setting must be on, the rule and kind must
 * both be auto-applyable, and the user's own revert history must not argue
 * against it.
 */
export function autoApplyDecision(
  issue: GrammarIssue,
  settings: Settings,
  learning: LearningData,
): AutoApplyDecision {
  if (!settings.harperAutoApply) return { auto: false, reason: 'setting-off' };
  if (AUTO_APPLY_DENY_RULES.has(issue.ruleId)) return { auto: false, reason: 'denied-rule' };
  if (AUTO_APPLY_DENY_KINDS.has(issue.kind)) return { auto: false, reason: 'denied-kind' };
  const stats = learning.grammarStats[issue.ruleId];
  if (
    stats &&
    stats.rejected >= AUTO_APPLY_REVERT_LIMIT &&
    stats.rejected > stats.accepted
  ) {
    // The user keeps undoing this rule: demote it back to a suggestion rather
    // than keep imposing it.
    return { auto: false, reason: 'user-reverts' };
  }
  return { auto: true };
}

/* ------------------------------------------------------------------ *
 * User-authored rule validation (context menu, options page)
 * ------------------------------------------------------------------ */

export type RulePairCheck = { ok: true } | { ok: false, reason: string };

const RULE_WORD = /^[A-Za-zÀ-ɏ'’-]+$/;

/**
 * Validates a user-authored replacement pair. Shared by the context menu, the
 * options form and the background handler so all three agree.
 */
export function validateRulePair(original: string, replacement: string): RulePairCheck {
  const from = original.trim();
  const to = replacement.trim();
  if (!from || !to) return { ok: false, reason: 'Both the typed word and the correction are required.' };
  if (from.length > 64) return { ok: false, reason: 'The typed word is too long (64 characters max).' };
  if (to.length > 64) return { ok: false, reason: 'The correction is too long (64 characters max).' };
  if (from.toLowerCase() === to.toLowerCase()) {
    return { ok: false, reason: 'The two sides are the same.' };
  }
  if (/\s/.test(from)) return { ok: false, reason: 'The typed word must be a single word.' };
  if (!RULE_WORD.test(from)) {
    return { ok: false, reason: 'The typed word must be letters only (no digits or symbols).' };
  }
  if (!/^[A-Za-zÀ-ɏ'’ -]+$/.test(to)) {
    return { ok: false, reason: 'The correction must be letters (spaces are allowed).' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Per-rule statistics (promotion groundwork - recording only, no promotion)
 * ------------------------------------------------------------------ */

const MAX_TRACKED_RULES = 200;

export function recordGrammarFeedback(data: LearningData, feedback: GrammarFeedback): void {
  const ruleId = feedback.ruleId.slice(0, 128);
  if (!ruleId) return;
  const stats = data.grammarStats;
  const entry: GrammarRuleStats = stats[ruleId] ?? { offered: 0, accepted: 0, rejected: 0 };
  if (!(ruleId in stats) && Object.keys(stats).length >= MAX_TRACKED_RULES) return;
  switch (feedback.verdict) {
    case 'offered':
      entry.offered++;
      break;
    case 'accepted':
      entry.accepted++;
      break;
    case 'rejected':
      entry.rejected++;
      break;
  }
  stats[ruleId] = entry;

  if (feedback.verdict === 'rejected' && feedback.ignoreHash) {
    if (
      /^\d{1,30}$/.test(feedback.ignoreHash) &&
      !data.grammarIgnoredLints.includes(feedback.ignoreHash) &&
      data.grammarIgnoredLints.length < 2000
    ) {
      data.grammarIgnoredLints.push(feedback.ignoreHash);
    }
  }
}

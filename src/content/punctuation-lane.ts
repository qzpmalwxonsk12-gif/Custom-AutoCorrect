/**
 * Content-side glue for the essential-punctuation lane.
 *
 * Pure helpers, kept out of the controller so they stay unit-testable: turning
 * settings into engine settings, converting an issue into a CorrectionProposal
 * the existing history machinery understands, and verifying a result is still
 * safe to apply.
 */
import {
  claimedSpans,
  type HarperSpan,
} from '../engine/punctuation/overlap-resolver.js';
import type {
  PunctuationIssue,
  PunctuationSettings,
} from '../engine/punctuation/punctuation-types.js';
import { fnv1a } from '../shared/util.js';
import type { CorrectionProposal, LearningData, Settings } from '../shared/types.js';

/** Projects extension settings onto the engine's own settings shape. */
export function punctuationSettingsFrom(settings: Settings): PunctuationSettings {
  return {
    enabled: settings.enabled && settings.punctuationEnabled,
    automatic: settings.punctuationAutomatic,
    oxfordComma: settings.punctuationOxfordComma,
    directAddress: settings.punctuationDirectAddress,
    introductoryClause: settings.punctuationIntroductoryClause,
    independentClause: settings.punctuationIndependentClause,
    simpleList: settings.punctuationSimpleList,
    nonrestrictiveClause: settings.punctuationNonrestrictiveClause,
    suggestionThreshold: settings.punctuationSuggestionThreshold,
    automaticThreshold: settings.punctuationAutomaticThreshold,
    showExplanations: settings.punctuationShowExplanations,
    allowRulePromotion: settings.punctuationAllowRulePromotion,
  };
}

/** Engine stats view built from persisted learning data. */
export function punctuationStatsFrom(learning: LearningData) {
  const out: Record<string, {
    ruleId: string;
    shown: number;
    accepted: number;
    rejected: number;
    reverted: number;
    ignoredInContext: number;
  }> = {};
  for (const [ruleId, stats] of Object.entries(learning.punctuationStats ?? {})) {
    out[ruleId] = { ruleId, ...stats };
  }
  return out;
}

/**
 * Converts an issue (paragraph coordinates) into a proposal in field
 * coordinates. Insertions are already normalised by the engine into a
 * replacement over a non-empty span, so the existing anchor/locator/reverter
 * work unchanged.
 */
export function proposalFromIssue(
  issue: PunctuationIssue,
  baseOffset: number,
  harperAgreed: boolean,
): CorrectionProposal {
  return {
    start: baseOffset + issue.start,
    end: baseOffset + issue.end,
    original: issue.originalText,
    replacement: issue.replacementText,
    correctionType: 'punctuation',
    source: 'builtin-grammar',
    confidence: issue.confidence,
    action: issue.action === 'automatic' ? 'autocorrect' : 'suggest',
    reason: harperAgreed ? `${issue.message} (grammar engine agrees)` : issue.message,
    ruleId: issue.ruleId,
  };
}

/** Spans this lane owns, so the Harper lane can skip them entirely. */
export function punctuationClaims(
  issues: PunctuationIssue[],
  baseOffset: number,
): HarperSpan[] {
  return claimedSpans(issues).map((span) => ({
    start: span.start + baseOffset,
    end: span.end + baseOffset,
    replacement: span.replacement,
  }));
}

/**
 * Final safety check before an issue is written into the field: the exact
 * characters must still be there. Cheap and unconditional - the lane may run
 * asynchronously relative to typing.
 */
export function issueStillApplies(
  text: string,
  issue: PunctuationIssue,
  baseOffset: number,
): boolean {
  const start = baseOffset + issue.start;
  const end = baseOffset + issue.end;
  if (end > text.length || end <= start) return false;
  return text.slice(start, end) === issue.originalText;
}

/** Session-local key so a dismissed issue is never re-offered. */
export function punctuationKey(issue: PunctuationIssue, paragraphFingerprint: string): string {
  return `${issue.ruleId}|${paragraphFingerprint}|${issue.start}|${fnv1a(issue.replacementText)}`;
}

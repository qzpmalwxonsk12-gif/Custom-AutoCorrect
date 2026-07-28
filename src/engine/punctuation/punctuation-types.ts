/**
 * Essential-punctuation lane: shared types.
 *
 * Platform independent - no DOM, no chrome, no harper.js. Everything here is
 * pure data so the whole engine is testable in Node and reusable on Android
 * alongside the existing spelling engine.
 */

export type PunctuationAction = 'automatic' | 'suggestion' | 'none';

/** Stable rule identifiers. Persisted in correction records and stats. */
export type PunctuationRuleId =
  | 'punctuation:introductory-clause'
  | 'punctuation:introductory-participle'
  | 'punctuation:direct-address'
  | 'punctuation:simple-list'
  | 'punctuation:independent-clause'
  | 'punctuation:nonrestrictive-clause';

/** Prefix marking a correction record as produced by this lane. */
export const PUNCTUATION_RULE_PREFIX = 'punctuation:';

export function isPunctuationRuleId(sourceRuleId: string | undefined): boolean {
  return sourceRuleId !== undefined && sourceRuleId.startsWith(PUNCTUATION_RULE_PREFIX);
}

/**
 * One local, reversible punctuation edit.
 *
 * `start`/`end` are UTF-16 offsets into the analysed text. Insertions are
 * normalised into a replacement over a non-empty original span (see
 * `rule-runner.ts`) so the existing anchor/locator/reverter machinery can
 * relocate and undo them exactly like any other correction.
 */
export interface PunctuationIssue {
  /** Deterministic within one analysis: ruleId + span + replacement. */
  id: string;
  ruleId: PunctuationRuleId;
  category: 'punctuation';
  start: number;
  end: number;
  originalText: string;
  replacementText: string;
  /** 0..1. Rule-specific; see punctuation-config.ts for thresholds. */
  confidence: number;
  action: PunctuationAction;
  /** Higher wins in overlap resolution. */
  priority: number;
  /** One line for the chip/panel. */
  message: string;
  /** Longer human-readable justification for the details view. */
  explanation: string;
  /** Why the rule fired, for debugging and the panel's details rows. */
  evidence: string[];
}

/* ------------------------------------------------------------------ *
 * Token classification
 * ------------------------------------------------------------------ */

// Linguistic types moved to src/engine/context/context-types.ts so the spelling
// lane can use them without importing the punctuation engine. Imported for this
// file's own declarations, and re-exported so every punctuation rule keeps its
// existing import site.
import type { AnalysedToken, ClauseAnalysis, TokenType } from '../context/context-types.js';

export type { AnalysedToken, ClauseAnalysis, TokenType };
/** One sentence carved out of the analysed text. */
export interface SentenceAnalysis {
  /** Offsets into the analysed text. */
  start: number;
  end: number;
  text: string;
  tokens: AnalysedToken[];
  /** True when the sentence looks like a heading, list item or fragment. */
  isFragmentary: boolean;
  /** True when any protected token (URL/code/number) is present. */
  hasProtectedContent: boolean;
  /** True when the sentence ends with '?'. */
  isQuestion: boolean;
}

/* ------------------------------------------------------------------ *
 * Analysis context and rule context
 * ------------------------------------------------------------------ */

export interface PunctuationAnalysisContext {
  /** Site origin, for per-site behaviour and diagnostics. */
  origin?: string;
  /** Offset of `text` within the field, so callers can map back. */
  baseOffset?: number;
  /** Effective settings for this analysis. */
  settings: PunctuationSettings;
  /** Per-rule decision history, used only to demote - never to promote
   *  a rule the config does not already allow to be automatic. */
  stats?: Record<string, PunctuationRuleStats>;
  /** True when Harper already reported an issue at a given span; used by the
   *  overlap resolver to avoid duplicate panel entries. */
  harperSpans?: ReadonlyArray<{ start: number; end: number; replacement: string }>;
}

export interface PunctuationRuleContext {
  /** Full text handed to `analyse`. */
  text: string;
  sentence: SentenceAnalysis;
  /** Clauses detected in this sentence. */
  clauses: ClauseAnalysis[];
  settings: PunctuationSettings;
  /** Convenience: sentence tokens. */
  tokens: AnalysedToken[];
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface PunctuationSettings {
  enabled: boolean;
  /** Master switch for writing punctuation without asking. */
  automatic: boolean;
  oxfordComma: boolean;
  directAddress: boolean;
  introductoryClause: boolean;
  independentClause: boolean;
  simpleList: boolean;
  nonrestrictiveClause: boolean;
  suggestionThreshold: number;
  automaticThreshold: number;
  showExplanations: boolean;
  allowRulePromotion: boolean;
}

export interface PunctuationRuleStats {
  ruleId: string;
  shown: number;
  accepted: number;
  rejected: number;
  reverted: number;
  ignoredInContext: number;
}

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export interface PunctuationProvider {
  analyse(
    text: string,
    context: PunctuationAnalysisContext,
  ): Promise<PunctuationIssue[]> | PunctuationIssue[];
}

/** Rule contract. Every rule states when it fires *and* when it must not. */
export interface EssentialPunctuationRule {
  id: PunctuationRuleId;
  category: 'punctuation';
  scope: 'sentence' | 'paragraph';
  priority: number;
  defaultAction: 'automatic' | 'suggestion';
  /** Settings key gating this rule, when it has its own switch. */
  settingKey?: keyof PunctuationSettings;
  detect(context: PunctuationRuleContext): PunctuationIssue[];
  /** Return true to veto an issue this rule produced. */
  antiPatterns?: Array<(context: PunctuationRuleContext, issue: PunctuationIssue) => boolean>;
}


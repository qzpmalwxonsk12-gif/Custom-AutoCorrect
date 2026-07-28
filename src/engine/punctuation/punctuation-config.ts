/**
 * Thresholds, defaults and the closed-class word lists the classifier and
 * rules depend on.
 *
 * These lists are hand-authored from general English grammar (closed word
 * classes are finite and well known). Nothing here is copied from another
 * project - see docs/PUNCTUATION_PROVENANCE.md.
 */
import type { PunctuationSettings } from './punctuation-types.js';

/**
 * Confidence bands. Automatic is deliberately near-ceiling: a wrongly inserted
 * comma changes meaning, and the lane's whole premise is precision over recall.
 * Tuned against tests/fixtures/punctuation-corpus.ts.
 */
export const PUNCTUATION_THRESHOLDS = {
  automatic: 0.97,
  suggestion: 0.75,
} as const;

export const DEFAULT_PUNCTUATION_SETTINGS: PunctuationSettings = {
  enabled: true,
  automatic: true,
  oxfordComma: true,
  directAddress: true,
  introductoryClause: true,
  independentClause: true,
  simpleList: true,
  // Changes meaning; never automatic, and off until the user opts in.
  nonrestrictiveClause: false,
  suggestionThreshold: PUNCTUATION_THRESHOLDS.suggestion,
  automaticThreshold: PUNCTUATION_THRESHOLDS.automatic,
  showExplanations: true,
  allowRulePromotion: false,
};

// Closed-class word lists moved to src/engine/context/lexical-classes.ts.
// Re-exported so the punctuation rules keep one import site.
export * from '../context/lexical-classes.js';


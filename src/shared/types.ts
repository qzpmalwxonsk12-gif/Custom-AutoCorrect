/**
 * Core data model. Platform independent: nothing in this file may reference
 * `chrome`, `document` or `window`, so it can be reused by an Android engine.
 */
import type {
  AnalysedToken,
  ClauseAnalysis,
  TokenType,
} from '../engine/context/context-types.js';
import type { RuleModeMap } from './rules.js';
import type { WritingProfileId } from './profiles.js';
import { EMPTY_VOCABULARY, type PersonalVocabulary } from './vocabulary.js';
import { EMPTY_PAUSE, type PauseState } from './status.js';

export type CorrectionStatus =
  | 'pending' // applied, awaiting the user's review
  | 'accepted' // user explicitly kept it
  | 'auto-accepted' // aged out of review / trusted rule, kept without explicit review
  | 'reverted' // replacement undone, original text restored
  | 'rejected' // user rejected it but the text could not be restored (see failureReason)
  | 'skipped' // deferred during guided review
  | 'unresolved' // anchor can no longer be located safely
  | 'superseded'; // the corrected span was rewritten by the user afterwards

/**
 * Presentation category for a correction.
 *
 * Values are persisted in correction records, so entries written by older
 * builds ("spelling", "keyboard-proximity", ...) must keep working: the newer
 * operation-specific values are additive and every consumer falls back to a
 * generic label for anything it does not recognise.
 */
export type CorrectionType =
  | 'exact-rule' // user-authored replacement
  | 'personal-rule' // learned from this user's own edits/decisions
  | 'spelling' // common-typo table or lexicon-derived candidate
  | 'adjacent-swap' // two neighbouring letters transposed
  | 'keyboard-proximity' // candidate justified mainly by key adjacency
  | 'duplicate-letter' // an accidentally repeated letter was removed
  | 'missing-letter' // a missing letter was inserted
  | 'extra-letter' // one superfluous letter was removed
  | 'token-merge' // an accidental space inside a word was closed
  | 'token-split' // a missing space between two words was inserted
  | 'repeated-word' // the same word was typed twice in a row
  | 'missing-apostrophe' // a contraction was typed without its apostrophe
  | 'contextual' // real-word error resolved by context (form -> from)
  | 'grammar' // local grammar rule
  | 'punctuation' // essential-punctuation lane
  | 'capitalisation'; // capitalisation-only change

/** Which letter was added or removed to reach a candidate. */
export type LetterOperationEvidence =
  | { removedIndex: number; removedCharacter: string }
  | { insertedIndex: number; insertedCharacter: string };

/** Why the user rejected a correction; drives the learning update. */
export type RejectionReason =
  | 'revert-once'
  | 'lower-confidence'
  | 'never-this-pair'
  | 'never-correct-word'
  | 'not-in-this-context'
  | 'keep-no-learn';

/**
 * Everything needed to find a correction again after the surrounding text has
 * changed. All fields are *hints*; `correction-locator` scores them together
 * and refuses to guess when the evidence is weak.
 */
export interface TextAnchor {
  /** Offset at the time of the correction. A hint only - never trusted alone. */
  approximateOffset: number;
  /** Up to `contextRadius` chars immediately before the correction. */
  textBefore: string;
  originalText: string;
  replacementText: string;
  /** Up to `contextRadius` chars immediately after the correction. */
  textAfter: string;
  /** Non-cryptographic FNV-1a hash of the normalised paragraph. */
  paragraphFingerprint?: string;
  /** FNV-1a hash of the normalised sentence. */
  sentenceFingerprint?: string;
  /** Which occurrence of `replacementText` in the whole field this was (0-based). */
  occurrenceIndex: number;
  /** Legacy structural hint. New records do not persist raw DOM paths. */
  domPath?: string;
}

/**
 * Inspectable evidence for a one-character Process 3 substitution.
 * `index` is zero-based internally; presentation layers render it as a
 * one-based position.
 */
export interface KeyboardSubstitutionEvidence {
  index: number;
  typedCharacter: string;
  replacementCharacter: string;
  neighbourMapMatched: boolean;
  /** Coordinate distance is ranking evidence only, never a generation gate. */
  keyDistance?: number;
}

export interface CorrectionRecord {
  id: string;
  sessionId: string;
  originalText: string;
  replacementText: string;
  correctionType: CorrectionType;
  /** 0..1 at the moment the decision was made. */
  confidence: number;
  status: CorrectionStatus;
  createdAt: number;
  reviewedAt?: number;
  anchor: TextAnchor;
  /** Short redacted snippet for the side panel, e.g. "…I think waht happened…". */
  contextPreview: string;
  /** The two neighbouring words, kept so "don't correct in this context" can
   *  learn the right cue without re-reading the document later. */
  contextWords?: { previous: string; next: string };
  sourceRuleId?: string;
  /** Catalogue rule whose mode governs this correction, when one does. Absent
   *  for curated typo-table and personal replacements, which have their own
   *  settings and must not be switched off by a rule control. */
  controlRuleId?: string;
  /** Harper context hash for this finding, so reverting can feed the
   *  engine's ignore list. Present only on `harper:`-sourced records. */
  sourceIgnoreHash?: string;
  /** Present only for dictionary candidates produced by Process 3. */
  keyboardSubstitution?: KeyboardSubstitutionEvidence;
  /** Present for duplicate-letter, missing-letter and extra-letter fixes. */
  letterEvidence?: LetterOperationEvidence;
  /** True when the replacement was written into the field automatically. */
  autoApplied: boolean;
  /** True when this correction has already fed the learning model. */
  learningApplied: boolean;
  rejectionReason?: RejectionReason;
  /** Set when a revert/locate attempt failed, for display in the panel. */
  failureReason?: string;
  /** Best-effort live position, refreshed by the locator. Never persisted as truth. */
  lastKnownRange?: { start: number; end: number };
}

export type SessionPersistence = 'memory' | 'persisted';

export interface CorrectionSession {
  id: string;
  origin: string;
  /** Stored only when `storePageUrl` is enabled; query strings are stripped. */
  url?: string;
  fieldId: string;
  fieldKind: 'input' | 'textarea' | 'contenteditable';
  title?: string;
  /** Hash of the field text; detects "same field, entirely different document". */
  textFingerprint: string;
  createdAt: number;
  updatedAt: number;
  persistence: SessionPersistence;
  records: CorrectionRecord[];
}

/** Compact per-session counters the panel header renders. */
export interface SessionCounts {
  total: number;
  pending: number;
  accepted: number;
  reverted: number;
  unresolved: number;
}

/* ------------------------------------------------------------------ *
 * Learning model
 * ------------------------------------------------------------------ */

export type RuleMode = 'autocorrect' | 'suggestion' | 'blocked';

export type RuleSource =
  | 'builtin-typo'
  | 'builtin-context'
  | 'builtin-grammar'
  | 'lexicon'
  | 'personal-learning'
  | 'user-created';

export interface RuleContext {
  /** Words seen immediately before the original when the correction was right. */
  previousWords: string[];
  nextWords: string[];
  /** Contexts where the user said "not here". */
  blockedPrevious: string[];
  blockedNext: string[];
}

export interface CorrectionRule {
  /** `${original}->${replacement}`, both lower-cased. */
  id: string;
  original: string;
  replacement: string;
  applied: number;
  accepted: number;
  reverted: number;
  skipped: number;
  blocked: number;
  /** Learned confidence multiplier in 0..1. */
  confidence: number;
  mode: RuleMode;
  source: RuleSource;
  context: RuleContext;
  /** Per-origin override: 'off' disables the rule on that site. */
  sites: Record<string, 'off'>;
  firstSeen: number;
  lastApplied?: number;
  manual: boolean;
  enabled: boolean;
}

/** Evidence for a rule the system has not created yet. */
export interface PendingPattern {
  original: string;
  replacement: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** Accept/reject bookkeeping for one Harper rule, keyed by bare rule name.
 *  Recording only for now; promotion of low-risk rules reads this later. */
export interface GrammarRuleStats {
  offered: number;
  accepted: number;
  rejected: number;
}

/** Decision counters for one punctuation rule. Recording only: promotion of a
 *  suggestion-only rule is never automatic. */
export interface PunctuationRuleStatsRecord {
  shown: number;
  accepted: number;
  rejected: number;
  reverted: number;
  ignoredInContext: number;
}

export interface LearningData {
  version: number;
  rules: Record<string, CorrectionRule>;
  /** Words the user never wants corrected (lower-cased). */
  dictionary: string[];
  /** Rule ids that must never be applied, even as a suggestion. */
  blockedPairs: string[];
  /** Manual-edit evidence, keyed by rule id. */
  pending: Record<string, PendingPattern>;
  /** Per-Harper-rule decision counters (see GrammarRuleStats). */
  grammarStats: Record<string, GrammarRuleStats>;
  /** Per-punctuation-rule decision counters, keyed by rule id. */
  punctuationStats: Record<string, PunctuationRuleStatsRecord>;
  /** Harper context hashes (decimal strings) the user rejected in context. */
  grammarIgnoredLints: string[];
  /** Words, names, phrases and preferred/blocked pairs, with their scopes. */
  vocabulary: PersonalVocabulary;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface Settings {
  enabled: boolean;
  /** Real-word/contextual corrections at all. */
  contextualEnabled: boolean;
  /** Allow contextual corrections to auto-apply instead of only suggesting. */
  contextualAutocorrect: boolean;
  grammarEnabled: boolean;
  /** 0..1; a proposal must beat this to be written into the text. */
  autocorrectThreshold: number;
  /** 0..1; below this nothing is shown at all. */
  suggestionThreshold: number;
  learnFromDecisions: boolean;
  learnFromManualEdits: boolean;
  /** Manual-edit repeats required before a personal rule is proposed. */
  manualEditEvidence: number;
  showInlineFlash: boolean;
  showSuggestionChips: boolean;
  /** Characters of surrounding text stored per correction (0 disables context). */
  contextRadius: number;
  storePageUrl: boolean;
  persistSessions: boolean;
  sessionRetentionDays: number;
  /** Pending corrections older than this are marked auto-accepted (0 = never). */
  autoAcceptAfterMinutes: number;
  /** Accepted corrections drop out of the list. */
  hideAcceptedFromList: boolean;
  denylist: string[];
  /** Origins where history is never written to disk. */
  memoryOnlyOrigins: string[];
  /** Per-origin master switch. */
  siteOverrides: Record<string, 'off' | 'on'>;
  reviewShortcuts: Record<ReviewAction, string>;
  shortcutsEnabled: boolean;
  /** Word-boundary fixes: accidental internal spaces and missing spaces. */
  spacingCorrectionEnabled: boolean;
  /** Essential-punctuation lane (deterministic, local, no WASM). */
  punctuationEnabled: boolean;
  /** Allow the punctuation lane to write high-confidence fixes without asking. */
  punctuationAutomatic: boolean;
  punctuationOxfordComma: boolean;
  punctuationDirectAddress: boolean;
  punctuationIntroductoryClause: boolean;
  punctuationIndependentClause: boolean;
  punctuationSimpleList: boolean;
  /** Meaning-changing; suggestion-only and off by default. */
  punctuationNonrestrictiveClause: boolean;
  punctuationSuggestionThreshold: number;
  punctuationAutomaticThreshold: number;
  punctuationShowExplanations: boolean;
  punctuationAllowRulePromotion: boolean;
  /** Harper grammar engine (bundled WASM, suggestion-only). Default off. */
  harperEnabled: boolean;
  /** Apply Harper findings automatically on idle instead of offering a chip.
   *  Still gated per rule/kind and by the user's own revert history. */
  harperAutoApply: boolean;
  harperDialect: HarperDialect;
  /** Bare Harper rule names the user turned off ("never apply this rule"). */
  harperDisabledRules: string[];

  /* ---------------- pause, profiles and per-rule control ---------------- */

  /** Temporary suspension. Distinct from `enabled`, which is a decision. */
  pause: PauseState;
  /** Global per-rule modes; absent entries use the catalogue default. */
  ruleModes: RuleModeMap;
  /** Per-origin per-rule modes, the most specific layer. */
  siteRuleModes: Record<string, RuleModeMap>;
  /** The active writing profile. */
  profile: WritingProfileId;
  /** Per-origin profile assignment; absent origins use `profile`. */
  siteProfiles: Record<string, WritingProfileId>;
  /** `${origin}|${fieldId}` keys the user switched off individually. */
  disabledFields: string[];

  /* ---------------- background re-scan ---------------- */

  /**
   * Keep sweeping the whole field in the background instead of only checking
   * the word at the caret. Off by default: it does real work.
   */
  deepScanEnabled: boolean;
  /**
   * How many times each part of the text is checked. A part that completes a
   * pass with no change is credited with the remainder, since re-running a
   * deterministic check over unchanged text cannot find anything new.
   */
  deepScanPasses: number;

  /* ---------------- shadow mode ---------------- */

  /**
   * 'off'          - providers behave normally.
   * 'experimental' - only experimental rules are held back and recorded.
   * 'all'          - nothing is applied; everything is recorded.
   */
  shadowMode: 'off' | 'experimental' | 'all';
  /** Keep shadow observations across restarts. Off by default (privacy). */
  shadowPersist: boolean;

  /* ---------------- presentation ---------------- */

  historyDisplayMode: 'compact' | 'detailed';
  historyGrouping: 'none' | 'site' | 'field' | 'paragraph' | 'time';
  /** Show every correction in the field at once as struck-through → replacement. */
  markupOverlayEnabled: boolean;
  /** Explain each automatic correction in the undo badge. */
  showCorrectionExplanations: boolean;
  theme: 'system' | 'light' | 'dark' | 'high-contrast';
  /** 'system' follows prefers-reduced-motion; 'reduce' forces it on. */
  motion: 'system' | 'reduce';
}

export type HarperDialect = 'american' | 'british' | 'australian' | 'canadian' | 'indian';

export const HARPER_DIALECTS: readonly HarperDialect[] = [
  'american',
  'british',
  'australian',
  'canadian',
  'indian',
];

export type ReviewAction =
  | 'keep'
  | 'revert'
  | 'next'
  | 'previous'
  | 'dictionary'
  | 'never'
  | 'exit';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  contextualEnabled: true,
  contextualAutocorrect: false,
  grammarEnabled: true,
  autocorrectThreshold: 0.9,
  suggestionThreshold: 0.62,
  learnFromDecisions: true,
  learnFromManualEdits: true,
  manualEditEvidence: 3,
  showInlineFlash: true,
  showSuggestionChips: true,
  contextRadius: 32,
  storePageUrl: false,
  persistSessions: true,
  sessionRetentionDays: 7,
  autoAcceptAfterMinutes: 0,
  hideAcceptedFromList: false,
  denylist: [],
  memoryOnlyOrigins: [],
  siteOverrides: {},
  reviewShortcuts: {
    keep: 'ArrowRight',
    revert: 'ArrowLeft',
    next: 'ArrowDown',
    previous: 'ArrowUp',
    dictionary: 'KeyD',
    never: 'KeyN',
    exit: 'Escape',
  },
  shortcutsEnabled: true,
  spacingCorrectionEnabled: true,
  punctuationEnabled: true,
  punctuationAutomatic: true,
  punctuationOxfordComma: true,
  punctuationDirectAddress: true,
  punctuationIntroductoryClause: true,
  punctuationIndependentClause: true,
  punctuationSimpleList: true,
  punctuationNonrestrictiveClause: false,
  punctuationSuggestionThreshold: 0.75,
  punctuationAutomaticThreshold: 0.97,
  punctuationShowExplanations: true,
  punctuationAllowRulePromotion: false,
  harperEnabled: false,
  harperAutoApply: false,
  harperDialect: 'american',
  harperDisabledRules: [],
  pause: { ...EMPTY_PAUSE },
  ruleModes: {},
  siteRuleModes: {},
  profile: 'general',
  siteProfiles: {},
  disabledFields: [],
  deepScanEnabled: false,
  deepScanPasses: 3,
  shadowMode: 'off',
  shadowPersist: false,
  historyDisplayMode: 'detailed',
  historyGrouping: 'none',
  markupOverlayEnabled: false,
  showCorrectionExplanations: true,
  theme: 'system',
  motion: 'system',
};

export const EMPTY_LEARNING: LearningData = {
  version: 1,
  rules: {},
  dictionary: [],
  blockedPairs: [],
  pending: {},
  grammarStats: {},
  punctuationStats: {},
  grammarIgnoredLints: [],
  vocabulary: structuredClone(EMPTY_VOCABULARY),
};

/* ------------------------------------------------------------------ *
 * Engine input / output
 * ------------------------------------------------------------------ */

export interface EngineContext {
  /** Text before the candidate word within the same paragraph (bounded). */
  before: string;
  /** Text after the candidate word within the same paragraph (bounded). */
  after: string;
  previousWord: string;
  nextWord: string;
  isSentenceStart: boolean;
  origin: string;

  /* ---------------- shared linguistic features ---------------- */
  /*
   * Optional and best effort: these come from the shared token classifier and
   * clause detector, which the punctuation lane has always used. They are
   * ranking evidence only - a correction must never *depend* on their
   * presence, because the analysis is skipped for very long fields.
   */

  /** Part of speech of the word before the target span. */
  previousTokenType?: TokenType;
  /** Part of speech of the word after the target span. */
  nextTokenType?: TokenType;
  /** The sentence containing the target span. */
  sentenceText?: string;
  /** Classified tokens of that sentence. */
  sentenceTokens?: AnalysedToken[];
  /** Clause analysis of that sentence, when one could be derived. */
  targetClause?: ClauseAnalysis;
}

export type ProposalAction = 'autocorrect' | 'suggest' | 'none';

export interface CorrectionProposal {
  /** Range in the field text that must be replaced. Usually the typed word,
   *  but grammar rules may target the preceding word instead. */
  start: number;
  end: number;
  original: string;
  /** Case-adjusted replacement, ready to be written into the field. */
  replacement: string;
  correctionType: CorrectionType;
  /** Rule provenance used by the learning system; not inferred from the
   *  presentation-oriented correction type because dictionary and typo-table
   *  proposals can both be displayed as spelling corrections. */
  source?: RuleSource;
  confidence: number;
  action: ProposalAction;
  /** Human-readable justification shown in the review card. */
  reason: string;
  ruleId?: string;
  /** Catalogue rule governing this proposal; set by the controller's gate. */
  controlRuleId?: string;
  /** Structured evidence retained in correction history for Process 3. */
  keyboardSubstitution?: KeyboardSubstitutionEvidence;
  /** Structured evidence for letter insertion/removal processes. */
  letterEvidence?: LetterOperationEvidence;
}

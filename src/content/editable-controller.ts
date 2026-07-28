/**
 * Per-field controller: owns the correction session for one editable element,
 * applies corrections, and executes every panel command against it.
 *
 * Invariants:
 *  - programmatic edits are bracketed by `applying`, so we never react to our
 *    own input events (no feedback loops);
 *  - a correction is only recorded once the host actually shows the new text;
 *  - a revert is only performed when the locator positively identifies the
 *    target - never from a stored offset.
 */
import {
  analyze,
  buildContext,
  takeRankingComparison,
} from '../engine/correction-engine.js';
import { essentialPunctuationProvider } from '../engine/punctuation/punctuation-provider.js';
import {
  isPunctuationRuleId,
  type PunctuationIssue,
} from '../engine/punctuation/punctuation-types.js';
import {
  issueStillApplies,
  proposalFromIssue,
  punctuationKey,
  punctuationSettingsFrom,
  punctuationStatsFrom,
} from './punctuation-lane.js';
import { diffSingleWord } from '../engine/manual-edit-diff.js';
import { isWordChar, tokenizeWords, wordEndingAt } from '../engine/tokenizer.js';
import { findRepeatedWord, findRepeatedWordIn } from '../engine/repeated-words.js';
import {
  findCapitalisation,
  findCapitalisationIn,
} from '../engine/sentence-capitalisation.js';
import { SweepPlan } from './sweep-plan.js';
import { DocumentEvidence } from '../engine/context/document-evidence.js';
import {
  generateMergeCandidate,
  generateSplitCandidate,
  type SpacingCandidate,
} from '../engine/token-spacing.js';
import { createAnchor, refreshAnchor } from '../history/anchor.js';
import {
  autoAcceptStale,
  countRecords,
  findRecord,
  pendingRecords,
  textFingerprint,
} from '../history/correction-history.js';
import { createRecord, holdsReplacement, transition } from '../history/correction-record.js';
import { locate } from '../history/correction-locator.js';
import { planRevert, shiftCaret, type TextEdit } from '../history/correction-reverter.js';
import {
  advance,
  currentId,
  decisionRejectionReason,
  isComplete,
  jumpTo as reviewJumpTo,
  markHandled,
  progress,
  reconcile,
  retreat,
  startReview,
  type ReviewDecision,
  type ReviewState,
} from '../history/review-session.js';
import {
  err,
  ok,
  type ContentMessage,
  type CorrectionAction,
  type Result,
} from '../shared/messages.js';
import { fieldDisabled, resolveSettings, withProfile } from '../shared/effective-settings.js';
import { ruleIdForCorrectionType, type CorrectionRuleId } from '../shared/rules.js';
import { createObservation, type ShadowObservation } from '../shared/shadow-mode.js';
import { buildVocabularyView, type VocabularyView } from '../shared/vocabulary.js';
import {
  autoApplyDecision,
  bareHarperRule,
  deriveEdit,
  HARPER_RULE_PREFIX,
  isHarperRuleId,
  issueKey,
  validateIssue,
  widenEdit,
  type GrammarFeedback,
  type GrammarIssue,
  type LintRequest,
  type LintResponse,
} from '../shared/grammar.js';
import type {
  CorrectionProposal,
  CorrectionRecord,
  CorrectionSession,
  EngineContext,
  LearningData,
  RuleSource,
  Settings,
} from '../shared/types.js';
import { buildPreview, fnv1a, normaliseRuleText, paragraphAt } from '../shared/util.js';
import { computeFieldId, type EditableAdapter } from './adapter.js';
import type { CorrectionHighlighter } from './correction-highlighter.js';
import { describeField, guardField, type FieldKind } from './field-guard.js';

type LearnEvent = Extract<ContentMessage, { kind: 'content/learn' }>['event'];

export interface ControllerHost {
  origin: string;
  /** Tab/frame identity supplied by the background for this document. */
  documentScope: string;
  settings(): Settings;
  learning(): LearningData;
  highlighter: CorrectionHighlighter;
  learn(event: LearnEvent): void;
  changed(controller: EditableController): void;
  /** Grammar lane: forwards a paragraph to the Harper host. */
  requestLint(request: LintRequest): Promise<Result<LintResponse>>;
  /** Grammar lane: records a per-rule decision (and ignore hash) upstream. */
  grammarFeedback(feedback: GrammarFeedback): void;
  /** Punctuation lane: records a per-rule decision upstream. */
  punctuationFeedback(feedback: PunctuationFeedback): void;
  /** True while corrections are suspended by a pause. */
  isPaused(): boolean;
  /** Shadow mode: report what a provider would have done. */
  recordShadow(observations: ShadowObservation[]): void;
  /** Diagnostics: engine latency, no text. */
  reportAnalysisTime(ms: number): void;
  /** Diagnostics: a lane failed. */
  reportProviderError(provider: string, error: unknown): void;
  /** Per-rule control, e.g. "show this rule as a suggestion from now on". */
  setRuleMode(ruleId: CorrectionRuleId, mode: 'automatic' | 'suggestion' | 'disabled'): void;
  /** Adds a personal-vocabulary entry (allowed word, phrase, preferred, blocked). */
  addVocabulary(entry: {
    kind: 'allowed-word' | 'blocked' | 'preferred' | 'phrase';
    original: string;
    replacement?: string;
    scope: import('../shared/vocabulary.js').VocabularyScope;
  }): void;
}

export interface PunctuationFeedback {
  ruleId: string;
  verdict: 'shown' | 'accepted' | 'rejected' | 'reverted' | 'ignored-in-context';
}

/**
 * Result of the one correction-application path.
 *
 * `declined`   nothing was changed.
 * `applied`    text changed and exactly one record exists.
 * `rolled-back` text was changed then restored; no record, no residue.
 * `unrecorded` should never happen: text changed, rollback failed. Reported
 *              loudly so it cannot pass silently.
 */
export type ApplyCorrectionOutcome =
  | { status: 'applied'; record: CorrectionRecord }
  | { status: 'declined'; reason: string }
  | { status: 'rolled-back'; reason: string }
  | { status: 'unrecorded'; reason: string };

/**
 * Whether the host rendered what we asked for. Rich editors legitimately swap
 * a plain space for a non-breaking space (and back), which must not be treated
 * as the editor rejecting the edit - especially for token splits, whose whole
 * payload is an inserted space.
 */
/** The word token immediately before `index`, skipping a single space. */
function previousWordToken(
  text: string,
  index: number,
): { text: string; start: number; end: number } | null {
  let i = index;
  while (i > 0 && text[i - 1] === ' ') i--;
  if (i === index) return null; // no separator: not two tokens
  return wordEndingAt(text, i);
}

function renderedReplacementFor(
  before: string,
  observed: string,
  edit: TextEdit,
): string | null {
  const prefix = before.slice(0, edit.start);
  const suffix = before.slice(edit.end);
  /*
   * Supported editor normalization is deliberately local to the replacement.
   * Treating the whole field as whitespace-equivalent used to accept unrelated
   * host mutations outside the target span.
   */
  if (
    observed.length !== prefix.length + edit.insert.length + suffix.length
    || !observed.startsWith(prefix)
    || !observed.endsWith(suffix)
  ) {
    return null;
  }
  const rendered = observed.slice(edit.start, edit.start + edit.insert.length);
  if (rendered === edit.insert) return rendered;
  const normaliseSpaces = (value: string) => value.replace(/[   ]/g, ' ');
  return normaliseSpaces(rendered) === normaliseSpaces(edit.insert)
    ? rendered
    : null;
}

/**
 * How many times one committed word is re-examined after a correction changes
 * it. Four is far beyond any real chain (typo -> repeat -> capitalisation) and
 * guarantees the loop cannot run away.
 */
const MAX_COMMIT_ROUNDS = 4;

const COMMIT_TYPES = new Set(['insertText', 'insertLineBreak', 'insertParagraph']);

/** Commit characters, kept local so the hot path avoids a Set lookup miss. */
function isCommitChar(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\n' ||
    ch === '\t' ||
    ch === '.' ||
    ch === ',' ||
    ch === ';' ||
    ch === ':' ||
    ch === '!' ||
    ch === '?' ||
    ch === ')' ||
    ch === ']' ||
    ch === '}' ||
    ch === '"' ||
    ch === '”'
  );
}

function sourceFor(proposal: CorrectionProposal): RuleSource {
  if (proposal.source) return proposal.source;
  switch (proposal.correctionType) {
    case 'exact-rule':
      return 'user-created';
    case 'personal-rule':
      return 'personal-learning';
    case 'spelling':
      return 'builtin-typo';
    case 'keyboard-proximity':
      return 'lexicon';
    case 'grammar':
      return 'builtin-grammar';
    default:
      return 'builtin-context';
  }
}

const TYPE_LABEL: Record<CorrectionProposal['correctionType'], string> = {
  'exact-rule': 'Your rule',
  'personal-rule': 'Learned',
  spelling: 'Spelling',
  'adjacent-swap': 'Swapped letters',
  'keyboard-proximity': 'Typo',
  'duplicate-letter': 'Duplicate letter',
  'missing-letter': 'Missing letter',
  'extra-letter': 'Extra letter',
  'token-merge': 'Joined words',
  'token-split': 'Split words',
  'repeated-word': 'Repeated word',
  'missing-apostrophe': 'Apostrophe',
  contextual: 'Context',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  capitalisation: 'Capitalisation',
};

/**
 * The one-line "why" shown beside an automatic correction.
 *
 * Deliberately short and in plain language: the panel carries the full
 * technical reason, and a badge the user reads mid-sentence has about four
 * words' worth of their attention.
 */
export function explainCorrection(proposal: CorrectionProposal): string {
  switch (proposal.correctionType) {
    case 'duplicate-letter':
      return 'Removed duplicate letter';
    case 'missing-letter':
      return 'Inserted missing letter';
    case 'extra-letter':
      return 'Removed extra letter';
    case 'adjacent-swap':
      return 'Swapped two letters back';
    case 'keyboard-proximity':
      return 'Fixed a neighbouring-key typo';
    case 'token-merge':
      return 'Joined accidental word break';
    case 'token-split':
      return 'Added missing space';
    case 'capitalisation':
      return 'Fixed capitalisation';
    case 'exact-rule':
      return 'Your replacement rule';
    case 'personal-rule':
      return 'Learned from your edits';
    case 'contextual':
      return 'Corrected from context';
    case 'grammar':
      return proposal.reason || 'Grammar fix';
    case 'punctuation':
      return punctuationExplanation(proposal.ruleId) ?? 'Punctuation fix';
    case 'repeated-word':
      return 'Removed a repeated word';
    case 'missing-apostrophe':
      return 'Added the missing apostrophe';
    case 'spelling':
      return 'Corrected spelling';
  }
}

/**
 * The catalogue rule a proposal belongs to, or undefined when no rule control
 * governs it.
 *
 * Curated and personal replacements are deliberately *not* rule-controlled:
 * `teh -> the` comes from the shipped typo table, not from dictionary
 * similarity, and switching off "Dictionary similarity" must not silently
 * disable a curated fix that the same user's "minimal" profile explicitly
 * promises to keep. Those layers already have their own settings.
 */
export function ruleIdForProposal(proposal: CorrectionProposal): CorrectionRuleId | undefined {
  if (proposal.ruleId && isPunctuationRuleId(proposal.ruleId)) {
    return proposal.ruleId as CorrectionRuleId;
  }
  switch (proposal.source) {
    case 'builtin-typo':
    case 'user-created':
    case 'personal-learning':
      return undefined;
    default:
      break;
  }
  return ruleIdForCorrectionType(proposal.correctionType);
}

/**
 * True when the span is immediately adjacent to a character that means "this is
 * an expression, not a sentence" - a call, a member access, a path segment, an
 * assignment, or a quoted literal.
 *
 * Used only by the coding profile. Ordinary prose almost never puts these
 * characters flush against a word, so the false-positive cost is low and the
 * benefit - never rewriting an identifier - is exactly what that profile is for.
 */
export function touchesCodeDelimiter(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return /[(){}[\]<>./\\=:;$#@|&*+`"']/.test(before ?? '')
    || /[(){}[\]<>./\\=:;$#@|&*+`"']/.test(after ?? '');
}

/**
 * Rules held back by `shadowMode: 'experimental'`.
 *
 * These are the meaning-sensitive ones: getting them wrong changes what the
 * sentence says, so they are the ones worth measuring before trusting.
 */
function isExperimentalRule(ruleId: CorrectionRuleId | undefined): boolean {
  return (
    ruleId === 'punctuation:nonrestrictive-clause'
    || ruleId === 'spacing:merge'
    || ruleId === 'spacing:split'
  );
}

function providerFor(type: CorrectionProposal['correctionType']) {
  switch (type) {
    case 'token-merge':
    case 'token-split':
      return 'spacing' as const;
    case 'punctuation':
      return 'punctuation' as const;
    case 'grammar':
      return 'grammar' as const;
    case 'contextual':
      return 'context' as const;
    default:
      return 'spelling' as const;
  }
}

function punctuationExplanation(ruleId: string | undefined): string | null {
  switch (ruleId) {
    case 'punctuation:introductory-clause':
      return 'Added introductory-clause comma';
    case 'punctuation:introductory-participle':
      return 'Added introductory-phrase comma';
    case 'punctuation:direct-address':
      return 'Added comma before a name';
    case 'punctuation:simple-list':
      return 'Added list comma';
    case 'punctuation:independent-clause':
      return 'Added comma between sentences';
    case 'punctuation:nonrestrictive-clause':
      return 'Added clause commas';
    default:
      return null;
  }
}

interface RevertGuard {
  original: string;
  position: number;
  at: number;
}

/** Remembers recent replacements so an a->b / b->a pair cannot ping-pong. */
interface AppliedGuard {
  start: number;
  original: string;
  replacement: string;
}

export class EditableController {
  readonly adapter: EditableAdapter;
  readonly fieldId: string;
  readonly fieldKind: FieldKind;
  session: CorrectionSession;
  review: ReviewState | null = null;

  private readonly host: ControllerHost;
  private applying = false;
  private composing = false;
  private recentlyApplied: AppliedGuard[] = [];
  private snapshot = '';
  private attached = false;
  private revertGuards: RevertGuard[] = [];
  private suggestion: { proposal: CorrectionProposal; context: EngineContext } | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** True whenever text may have changed while the field was ineligible. */
  private blockedSinceRead = true;
  /**
   * Context-free records restored into a different document fingerprint are
   * not safe to relocate from a coincidental word alone. The stored
   * fingerprint is the evidence required before they may become actionable.
   */
  private restoredFingerprintGuards = new Map<string, string>();

  /* Grammar (Harper) lane state. All async results are re-validated against
   * the live text before anything is shown or written. */
  /** Monotonic counter bumped on every text mutation; stale responses drop. */
  private lintVersion = 0;
  /** Invalidates a request when this controller is detached and later reused. */
  private lintGeneration = 0;
  /** One-active-request-per-field queue: a second request never overlaps. */
  private lintInFlight = false;
  /** Set when text changed mid-flight so the paragraph is re-linted after. */
  private lintDirty = false;
  /** Paragraph fingerprints with no outstanding issues (insertion-ordered). */
  private lintedClean = new Map<string, true>();
  /** Paragraph fingerprints whose issues were already offered once; the
   *  background sweep skips them so a far-away chip cannot nag. The caret
   *  paragraph is always eligible again, and any edit changes the print. */
  private lintOffered = new Set<string>();
  /** Issue keys the user dismissed this session; never re-offered. */
  private dismissedIssues = new Set<string>();
  /** Issue keys already counted as 'offered' so stats are not inflated. */
  private offeredIssueKeys = new Set<string>();
  private grammarOffer:
    | {
        issue: GrammarIssue;
        key: string;
        start: number;
        end: number;
        proposal: CorrectionProposal;
      }
    | null = null;
  /** Full field text at the moment the chip was offered, so synthetic no-op
   *  input events (rich-editor state syncing) can be told from real edits. */
  private grammarOfferText: string | null = null;
  private lastLintFailureAt = 0;
  /** Punctuation issue keys the user dismissed this session. */
  private dismissedPunctuation = new Set<string>();
  /** Punctuation spans claimed this pass, so Harper skips them. */
  private punctuationClaims: Array<{ start: number; end: number; replacement: string }> = [];
  private punctuationOffer:
    | {
        issue: PunctuationIssue;
        key: string;
        start: number;
        end: number;
        proposal: CorrectionProposal;
      }
    | null = null;
  /** Consecutive responses invalidated by silent text churn; trips a backoff
   *  so a DOM-rewriting editor cannot drive an endless re-lint loop. */
  private lintDropStreak = 0;
  /** Budget for self-chained lint passes between user actions, so sweeping a
   *  pasted document terminates even if every paragraph is clean. */
  private autoLintPasses = 0;
  /** Separate, larger budget for *productive* auto-applies in one burst. Each
   *  apply changes the text so the work is self-limiting; this only exists to
   *  stop a pair of rules that undo each other from running forever. */
  private autoAppliedChain = 0;

  constructor(adapter: EditableAdapter, host: ControllerHost) {
    this.adapter = adapter;
    this.host = host;
    this.fieldKind = adapter.kind;
    this.fieldId = computeFieldId(adapter.element);
    if (this.processingBlockReason() === null) {
      try {
        this.snapshot = adapter.getText();
        this.blockedSinceRead = false;
      } catch {
        this.blockedSinceRead = true;
      }
    }

    const settings = host.settings();
    this.session = {
      id: `s_${fnv1a(
        `${host.origin}|${host.documentScope}|${fnv1a(location.pathname)}|${this.fieldId}`,
      )}`,
      origin: host.origin,
      fieldId: this.fieldId,
      fieldKind: this.fieldKind,
      textFingerprint: textFingerprint(this.snapshot),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      persistence: settings.memoryOnlyOrigins.includes(host.origin) ? 'memory' : 'persisted',
      records: [],
    };
    if (settings.storePageUrl) {
      this.session.url = `${location.origin}${location.pathname}`;
      this.session.title = document.title.slice(0, 120);
    }
  }

  /**
   * Re-evaluated before every text read. This protects against an input being
   * turned into a password/code field, or settings changing after attachment.
   */
  private processingBlockReason(): string | null {
    const settings = this.host.settings();
    if (!settings.enabled) return 'Autocorrect is disabled.';
    // A pause suspends correction without discarding the session, so history
    // and anchors survive it and resume exactly where they left off.
    if (this.host.isPaused()) return 'Autocorrect is paused.';
    if (settings.siteOverrides[this.host.origin] === 'off') {
      return 'Autocorrect is disabled on this site.';
    }
    if (fieldDisabled(settings, this.host.origin, this.fieldId)) {
      return 'Autocorrect is turned off for this field.';
    }
    const guard = guardField(this.adapter.element, settings);
    return guard.allowed ? null : guard.reason ?? 'This field is not eligible for autocorrect.';
  }

  /** Whether processing is currently allowed, without reading field content. */
  canProcess(): boolean {
    return this.processingBlockReason() === null;
  }

  /**
   * Synchronises the manual-edit baseline when a field becomes eligible again,
   * preventing edits made while blocked from becoming learning evidence.
   */
  refreshEligibility(): boolean {
    const reason = this.processingBlockReason();
    if (reason !== null) {
      this.blockedSinceRead = true;
      this.suggestion = null;
      this.host.highlighter.hideSuggestion();
      return false;
    }
    if (this.blockedSinceRead) {
      try {
        this.snapshot = this.adapter.getText();
        this.blockedSinceRead = false;
      } catch {
        this.blockedSinceRead = true;
        return false;
      }
    }
    if (this.scrubStoredContextIfDisabled()) {
      this.touchSession();
      this.host.changed(this);
    }
    return true;
  }

  private scrubStoredContextIfDisabled(): boolean {
    if (this.host.settings().contextRadius > 0) return false;
    let changed = false;
    for (const record of this.session.records) {
      if (
        record.anchor.textBefore
        || record.anchor.textAfter
        || record.anchor.paragraphFingerprint !== undefined
        || record.anchor.sentenceFingerprint !== undefined
        || record.anchor.domPath !== undefined
        || record.contextPreview
        || record.contextWords !== undefined
      ) {
        record.anchor.textBefore = '';
        record.anchor.textAfter = '';
        delete record.anchor.paragraphFingerprint;
        delete record.anchor.sentenceFingerprint;
        delete record.anchor.domPath;
        record.contextPreview = '';
        delete record.contextWords;
        changed = true;
      }
    }
    return changed;
  }

  private touchSession(text?: string): void {
    this.session.updatedAt = Date.now();
    if (text !== undefined) this.session.textFingerprint = textFingerprint(text);
  }

  /* ------------------------------ lifecycle ------------------------------ */

  attach(): void {
    if (this.attached) return;
    const el = this.adapter.element;
    el.addEventListener('input', this.onInput, true);
    el.addEventListener('keydown', this.onKeyDown, true);
    el.addEventListener('compositionstart', this.onCompositionStart, true);
    el.addEventListener('compositionend', this.onCompositionEnd, true);
    el.addEventListener('blur', this.onBlur, true);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    // Mark inactive before cleanup so a promise reaction queued in this turn
    // cannot observe a half-detached controller as live.
    this.attached = false;
    this.lintGeneration++;
    this.lintDirty = false;
    const el = this.adapter.element;
    el.removeEventListener('input', this.onInput, true);
    el.removeEventListener('keydown', this.onKeyDown, true);
    el.removeEventListener('compositionstart', this.onCompositionStart, true);
    el.removeEventListener('compositionend', this.onCompositionEnd, true);
    el.removeEventListener('blur', this.onBlur, true);
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.stopSweep();
    this.clearVisuals();
    this.adapter.dispose();
  }

  get fieldLabel(): string {
    return describeField(this.adapter.element);
  }

  /**
   * Merges a restored session into live state. Local records win when typing
   * raced the async restore, and an identity/fingerprint mismatch is rejected.
   */
  adoptSession(stored: CorrectionSession): boolean {
    if (!this.refreshEligibility()) return false;
    if (
      stored.id !== this.session.id
      || stored.origin !== this.session.origin
      || stored.fieldId !== this.session.fieldId
    ) {
      return false;
    }
    const currentText = this.adapter.getText();
    const currentFingerprint = textFingerprint(currentText);
    const anchorCarriesContext = (record: CorrectionRecord) =>
      Boolean(
        record.anchor.textBefore
        || record.anchor.textAfter
        || record.anchor.paragraphFingerprint
        || record.anchor.sentenceFingerprint,
      );
    const hasLiveAnchor = stored.records.some((record) => {
      if (!anchorCarriesContext(record)) return false;
      const target = holdsReplacement(record) ? 'replacement' : 'original';
      const result = locate(currentText, record.anchor, { target });
      return result.status === 'found' && result.score >= 0.7;
    });

    const localIds = new Set(this.session.records.map((record) => record.id));
    if (stored.textFingerprint !== currentFingerprint) {
      for (const record of stored.records) {
        if (!localIds.has(record.id) && !anchorCarriesContext(record)) {
          this.restoredFingerprintGuards.set(record.id, stored.textFingerprint);
        }
      }
    } else {
      for (const record of stored.records) this.restoredFingerprintGuards.delete(record.id);
    }

    const merged = new Map(stored.records.map((record) => [record.id, record]));
    for (const record of this.session.records) merged.set(record.id, record);
    const live = this.session;
    this.session = {
      ...stored,
      id: live.id,
      origin: live.origin,
      fieldId: live.fieldId,
      fieldKind: this.fieldKind,
      url: live.url,
      title: live.title,
      persistence: live.persistence,
      createdAt: Math.min(stored.createdAt, live.createdAt),
      records: Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt),
      textFingerprint: currentFingerprint,
      updatedAt: Math.max(stored.updatedAt, live.updatedAt, Date.now()),
    };
    // A fingerprint mismatch is not grounds to discard history: relocation
    // keeps the records visible but marks missing anchors unresolved. It is
    // never used as permission to edit the new document.
    if (stored.textFingerprint !== currentFingerprint && !hasLiveAnchor) {
      for (const record of this.session.records) delete record.lastKnownRange;
    }
    this.scrubStoredContextIfDisabled();
    this.snapshot = currentText;
    this.relocateAll();
    this.touchSession(currentText);
    return true;
  }

  /* ------------------------------ input handling ------------------------------ */

  private onCompositionStart = (): void => {
    this.composing = true;
  };

  private onCompositionEnd = (): void => {
    this.composing = false;
    // The committed IME string is not a typing slip we should second-guess.
    if (!this.refreshEligibility()) return;
    this.snapshot = this.adapter.getText();
  };

  private onBlur = (): void => {
    this.runIdleWork();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.composing || event.isComposing) return;
    if (event.key === 'Escape' && this.review) {
      this.exitReview();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Tab usually moves focus; correct before that happens.
      this.commitNearCaret();
    }
  };

  private onInput = (event: Event): void => {
    // Any input event means the text may have moved: retire in-flight lint
    // results before the early returns (our own edits fire input too).
    this.lintVersion++;
    if (this.applying) return;
    // Typing always outranks the background sweep; it resumes on the next idle
    // tick, and the plan remembers what was already checked.
    this.stopSweep();
    if (this.composing || (event instanceof InputEvent && event.isComposing)) return;
    if (!this.refreshEligibility()) return;
    // Our own programmatic edits announce themselves with this input type; a
    // late echo from a framework must never be treated as typing.
    if (event instanceof InputEvent && event.inputType === 'insertReplacementText') return;
    // Genuine user input refills both budgets. Our own programmatic edits must
    // not, or an auto-apply chain could keep renewing its own licence.
    this.autoLintPasses = 0;
    this.autoAppliedChain = 0;

    // Rich editors (and some extensions) dispatch synthetic input events for
    // internal state syncing - autosave ticks, DOM normalisation - that carry
    // no inputType and change no text. Those must not dismiss a chip the user
    // is looking at. The text comparison is only paid while a chip is up.
    const synthetic = !(event instanceof InputEvent) || !event.inputType;
    if (synthetic && this.grammarOffer && this.grammarOfferText !== null && !this.suggestion) {
      let unchanged = false;
      try {
        unchanged = this.adapter.getText() === this.grammarOfferText;
      } catch {
        /* treat as changed */
      }
      if (unchanged) {
        this.scheduleIdleWork();
        return;
      }
    }
    this.host.highlighter.hideSuggestion();
    this.suggestion = null;
    this.grammarOffer = null;
    this.grammarOfferText = null;

    if (!(event instanceof InputEvent)) {
      this.scheduleIdleWork();
      return;
    }
    const type = event.inputType;
    if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      // Never treat pasted text as typing evidence.
      this.snapshot = this.adapter.getText();
      this.scheduleIdleWork();
      return;
    }
    if (type === 'historyUndo' || type === 'historyRedo') {
      this.onHistoryNavigation();
      return;
    }
    if (!COMMIT_TYPES.has(type)) {
      this.scheduleIdleWork();
      return;
    }
    if (type === 'insertText') {
      const data = event.data ?? '';
      if (data.length !== 1 || !isCommitChar(data)) {
        this.scheduleIdleWork();
        return;
      }
    }
    this.commitNearCaret();
    this.scheduleIdleWork();
  };

  /**
   * The user pressed undo or redo.
   *
   * The browser's undo stack knows nothing about our history, so a correction
   * can vanish from the text while its record still says "applied". Two things
   * must happen: the record has to stop claiming to hold text it no longer
   * holds, and the engine must not immediately re-apply the very correction the
   * user just undid - which would make undo appear broken.
   */
  private onHistoryNavigation(): void {
    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return;
    }
    // Undo is not typing, so it is never manual-edit learning evidence.
    this.snapshot = text;
    this.lintVersion++;

    for (const record of this.session.records) {
      if (!holdsReplacement(record)) continue;
      const found = locate(text, record.anchor);
      if (found.status === 'found') {
        record.lastKnownRange = { start: found.start, end: found.end };
        continue;
      }
      // The replacement is gone: the user's undo removed it.
      transition(record, 'superseded', {
        failureReason: 'Undone with the editor’s own undo.',
      });
      this.revertGuards.push({
        original: record.originalText,
        position: record.lastKnownRange?.start ?? record.anchor.approximateOffset,
        at: Date.now(),
      });
    }
    this.touchSession(text);
    this.host.changed(this);
    if (this.markupVisible) this.refreshMarkupOverlay();
    this.scheduleIdleWork();
  }

  /**
   * Finds the word that was just finished and runs the engine on it, then
   * checks again if that changed anything.
   *
   * One correction routinely creates the conditions for the next: fixing
   * "waht" beside an existing "what" produces a repeated word that did not
   * exist a moment earlier. The old single-shot behaviour left that second
   * mistake sitting in the text - and because our own edit is bracketed by
   * `applying`, no input event ever arrived to prompt another look, so it
   * stayed there until the user typed something else.
   *
   * The loop is bounded and terminates on "text unchanged", so a chip being
   * offered (which changes nothing) ends it, as does a provider that declines.
   */
  private commitNearCaret(): void {
    for (let round = 0; round < MAX_COMMIT_ROUNDS; round++) {
      // Tab can arrive after a framework dynamically changes an ordinary
      // input into a password/code field. Gate before both reads, not only in
      // commitOnce(), so even the loop's before/after comparison stays private.
      if (!this.refreshEligibility()) return;
      let before: string;
      try {
        before = this.adapter.getText();
      } catch {
        return;
      }
      this.commitOnce();
      if (!this.refreshEligibility()) return;
      let after: string;
      try {
        after = this.adapter.getText();
      } catch {
        return;
      }
      if (after === before) return;
    }
  }

  private commitOnce(): void {
    if (!this.refreshEligibility()) return;
    let text: string;
    let caret: { start: number; end: number };
    try {
      text = this.adapter.getText();
      caret = this.adapter.getCaret();
    } catch {
      return;
    }
    let i = Math.min(caret.start, text.length);
    let hops = 0;
    while (i > 0 && !isWordChar(text[i - 1]) && hops < 4) {
      i--;
      hops++;
    }
    if (i === 0) return;
    // A repeated word spans two tokens and is unambiguous, so it is checked
    // before the single-word engine gets a chance to "fix" the second copy.
    if (this.applyRepeatedWord(text, i)) return;
    // Word-boundary fixes span two tokens, so they are found separately and
    // then weighed against the single-word result rather than pre-empting it.
    const spacing = this.findSpacingCandidate(text, i);
    if (spacing && spacing.confidence >= this.host.settings().autocorrectThreshold) {
      // An automatic-grade spacing fix wins outright: the word engine cannot
      // see the boundary error at all.
      if (this.offerOrApplySpacing(spacing, text)) return;
    }
    if (this.commitAt(text, i)) return;
    // The word engine had nothing; a spacing suggestion may still be useful.
    if (spacing) this.offerOrApplySpacing(spacing, text);
    // Capitalisation last: it only applies to a word nothing else wanted.
    this.applyCapitalisation(text, i);
  }

  /** Routes a repeated-word candidate through the shared correction path. */
  private applyRepeatedWord(text: string, wordEnd: number): boolean {
    const candidate = findRepeatedWord(text, wordEnd);
    return candidate !== null && this.applySimpleCandidate(candidate, text, 'repeated-word');
  }

  /** Routes a capitalisation candidate through the shared correction path. */
  private applyCapitalisation(text: string, wordEnd: number): boolean {
    const candidate = findCapitalisation(text, wordEnd);
    return candidate !== null && this.applySimpleCandidate(candidate, text, 'capitalisation');
  }

  /**
   * Shared plumbing for the two single-span providers that do not come from the
   * dictionary pipeline. Both still pass through `gateProposal`, so rule modes,
   * shadow mode and the personal vocabulary govern them like everything else.
   */
  private applySimpleCandidate(
    candidate: {
      start: number;
      end: number;
      originalText: string;
      replacementText: string;
      confidence: number;
      reason: string;
    },
    text: string,
    kind: 'repeated-word' | 'capitalisation',
  ): boolean {
    const settings = this.host.settings();
    const effective = resolveSettings(settings, this.host.origin);
    const draft: CorrectionProposal = {
      start: candidate.start,
      end: candidate.end,
      original: candidate.originalText,
      replacement: candidate.replacementText,
      correctionType: kind === 'repeated-word' ? 'repeated-word' : 'capitalisation',
      source: 'builtin-grammar',
      confidence: candidate.confidence,
      action:
        candidate.confidence >= effective.autocorrectThreshold ? 'autocorrect' : 'suggest',
      reason: candidate.reason,
    };
    const gated = this.gateProposal(draft);
    if (!gated) return false;
    if (this.isSuppressed(gated)) return false;

    const context = buildContext(text, gated.start, gated.end, this.host.origin);
    if (gated.action === 'autocorrect') {
      return this.applyProposal(gated, context) !== null;
    }
    if (!settings.showSuggestionChips) return false;
    this.offerSuggestion(gated, context);
    return true;
  }

  /**
   * Looks for an accidental space inside a word, or a missing space between
   * two words, at the just-completed token.
   */
  private findSpacingCandidate(text: string, wordEnd: number): SpacingCandidate | null {
    const settings = this.host.settings();
    if (!settings.spacingCorrectionEnabled) return null;
    const current = wordEndingAt(text, wordEnd);
    if (!current) return null;

    // 1. Missing space inside the completed token: "improvementability".
    const split = generateSplitCandidate({
      text,
      start: current.start,
      end: current.end,
    });
    if (split) return split;

    // 2. Accidental space between the previous token and this one.
    const previous = previousWordToken(text, current.start);
    if (!previous) return null;
    return generateMergeCandidate({
      text,
      previousStart: previous.start,
      previousEnd: previous.end,
      currentStart: current.start,
      currentEnd: current.end,
    });
  }

  /** Routes a spacing candidate through the shared correction path. */
  private offerOrApplySpacing(candidate: SpacingCandidate, text: string): boolean {
    const settings = this.host.settings();
    const effective = resolveSettings(settings, this.host.origin);
    const draft: CorrectionProposal = {
      start: candidate.start,
      end: candidate.end,
      original: candidate.originalText,
      replacement: candidate.replacementText,
      correctionType:
        candidate.source === 'accidental-space-merge' ? 'token-merge' : 'token-split',
      source: 'lexicon',
      confidence: candidate.confidence,
      action:
        candidate.confidence >= effective.autocorrectThreshold ? 'autocorrect' : 'suggest',
      reason: candidate.reason,
    };
    const gated = this.gateProposal(draft);
    if (!gated) return false;
    const proposal = gated;
    if (proposal.action === 'suggest' && !settings.showSuggestionChips) return false;
    if (this.isSuppressed(proposal)) return false;

    const context = buildContext(text, proposal.start, proposal.end, this.host.origin);
    if (proposal.action === 'autocorrect') {
      return this.applyProposal(proposal, context) !== null;
    }
    this.offerSuggestion(proposal, context);
    return true;
  }

  /** Returns true when the single-word engine applied or offered something. */
  private commitAt(text: string, wordEnd: number): boolean {
    const settings = this.host.settings();
    let result;
    const started = performance.now();
    try {
      result = analyze(
        {
          text,
          wordEnd,
          origin: this.host.origin,
          documentEvidence: this.documentEvidence,
        },
        this.host.learning(),
        withProfile(settings, this.host.origin),
      );
    } catch (e) {
      console.warn('[autocorrect] engine failed:', e);
      this.host.reportProviderError('spelling', e);
      return false;
    }
    this.host.reportAnalysisTime(performance.now() - started);

    /*
     * Ranking comparison: what would the experimental context weights have
     * chosen? Recorded whether or not a correction was made, because "the
     * experimental weights would have picked a different word here" is exactly
     * the evidence needed before raising one - and it is only produced when
     * shadow mode is on.
     */
    this.recordRankingComparison();

    if (!result) return false;

    // The coding profile widens the protected set beyond the tokenizer's own
    // identifier rules: in code, a word touching a delimiter is usually part of
    // an expression, not prose.
    if (
      resolveSettings(settings, this.host.origin).protectCode
      && touchesCodeDelimiter(text, result.proposal.start, result.proposal.end)
    ) {
      return false;
    }

    const gated = this.gateProposal(result.proposal);
    if (!gated) return false;
    const proposal = gated;
    const context = result.context;
    if (normaliseRuleText(proposal.original) === normaliseRuleText(proposal.replacement)) {
      return false;
    }
    if (this.isSuppressed(proposal)) return false;

    if (proposal.action === 'autocorrect') {
      return this.applyProposal(proposal, context) !== null;
    }
    if (proposal.action === 'suggest' && settings.showSuggestionChips) {
      this.offerSuggestion(proposal, context);
      return true;
    }
    return false;
  }

  /**
   * Applies the per-rule mode and shadow mode to a proposal, returning the
   * action that may actually be taken.
   *
   * This is the single choke point for both features: a rule set to
   * "suggestion" can never write text, a disabled rule produces nothing, and
   * in shadow mode nothing is applied at all - it is only recorded.
   */
  private gateProposal(proposal: CorrectionProposal): CorrectionProposal | null {
    const settings = this.host.settings();
    const effective = resolveSettings(settings, this.host.origin);
    const ruleId = ruleIdForProposal(proposal);

    let action = proposal.action;
    if (ruleId) {
      const mode = effective.ruleOverride(ruleId);
      if (mode === 'disabled') return null;
      if (mode === 'suggestion' && action === 'autocorrect') action = 'suggest';
    }

    // A blocked pair from the personal vocabulary outranks every rule mode:
    // the user named this exact replacement and said no.
    const view = this.vocabularyView();
    if (
      view.blocked.has(
        `${normaliseRuleText(proposal.original)}->${normaliseRuleText(proposal.replacement)}`,
      )
    ) {
      return null;
    }
    if (view.allowedWords.has(normaliseRuleText(proposal.original))) return null;
    if (this.ignoredInDocument.has(
      `${normaliseRuleText(proposal.original)}->${normaliseRuleText(proposal.replacement)}`,
    )) {
      return null;
    }

    const shadow = settings.shadowMode;
    const shadowed =
      shadow === 'all'
      || (shadow === 'experimental' && isExperimentalRule(ruleId));
    if (shadowed) {
      if (action === 'autocorrect' || action === 'suggest') {
        // Through the bounded recorder, never directly: a whole-field sweep
        // touches every word, and an unbounded path here logs one observation
        // per correction - biasing the aggregate towards whichever typo the
        // document happened to repeat most.
        this.recordObservation({
          provider: providerFor(proposal.correctionType),
          ruleId: ruleId ?? proposal.correctionType,
          originalText: proposal.original,
          replacementText: proposal.replacement,
          confidence: proposal.confidence,
          wouldHave: action,
        });
      }
      return null;
    }

    if (action === 'none') return null;
    // Stamp the governing rule onto the proposal so the history entry can offer
    // "disable this rule" without re-deriving (and possibly mis-deriving) it.
    const stamped = ruleId ? { ...proposal, controlRuleId: ruleId } : proposal;
    return action === stamped.action ? stamped : { ...stamped, action };
  }

  /** Personal vocabulary, resolved for this origin and document. */
  private vocabularyView() {
    const learning = this.host.learning();
    const source = learning.vocabulary;
    const entries = source.entries;
    const stamp = entries.length;
    if (
      this.vocabularyCache
      && this.vocabularyCache.source === source
      && this.vocabularyCache.entries === entries
      && this.vocabularyCache.stamp === stamp
    ) {
      return this.vocabularyCache.view;
    }
    const view = buildVocabularyView(source, {
      origin: this.host.origin,
      documentScope: this.host.documentScope,
    });
    this.vocabularyCache = { source, entries, stamp, view };
    return view;
  }

  private vocabularyCache: {
    source: LearningData['vocabulary'];
    entries: LearningData['vocabulary']['entries'];
    stamp: number;
    view: VocabularyView;
  } | null = null;

  private isSuppressed(proposal: CorrectionProposal): boolean {
    const now = Date.now();
    this.revertGuards = this.revertGuards.filter((g) => now - g.at < 5 * 60 * 1000);
    // The user just put this word back by hand; do not undo their decision.
    const reverted = this.revertGuards.some(
      (g) =>
        normaliseRuleText(g.original) === normaliseRuleText(proposal.original) &&
        Math.abs(g.position - proposal.start) < 200,
    );
    if (reverted) return true;

    // Loop guard: refuse a correction that is the exact inverse of one we just
    // made at the same position (a -> b -> a).
    return this.recentlyApplied.some(
      (g) =>
        g.start === proposal.start &&
        normaliseRuleText(g.replacement) === normaliseRuleText(proposal.original) &&
        normaliseRuleText(g.original) === normaliseRuleText(proposal.replacement),
    );
  }

  /* ------------------------------ applying ------------------------------ */

  /**
   * THE single path by which any correction provider may modify the field.
   *
   * Every provider - spelling, punctuation, Harper, capitalisation, token
   * merge/split, personal rules - goes through here, so "text changed" and
   * "history record exists" cannot diverge. The invariant enforced is:
   *
   *   the field's text is modified  <=>  exactly one CorrectionRecord exists
   *
   * If the host renders something other than what we asked for, the edit is
   * rolled back rather than left unrecorded. If it cannot be rolled back, the
   * record is still created (so the change stays reversible from the panel)
   * and the discrepancy is reported as a development error.
   */
  applyCorrection(request: {
    proposal: CorrectionProposal;
    context: EngineContext;
    autoApplied?: boolean;
  }): ApplyCorrectionOutcome {
    const { proposal, context } = request;
    const autoApplied = request.autoApplied ?? true;

    if (!this.refreshEligibility()) {
      return { status: 'declined', reason: 'field-not-eligible' };
    }
    const before = this.adapter.getText();
    // 1. Verify the target still holds the text this proposal was built from.
    if (before.slice(proposal.start, proposal.end) !== proposal.original) {
      return { status: 'declined', reason: 'target-text-changed' };
    }
    if (proposal.original === proposal.replacement) {
      return { status: 'declined', reason: 'no-op' };
    }

    const caret = this.adapter.getCaret();
    let edit: TextEdit = {
      start: proposal.start,
      end: proposal.end,
      insert: proposal.replacement,
    };

    // 2. Apply the replacement.
    let applied = false;
    this.applying = true;
    try {
      applied = this.adapter.replaceRange(edit.start, edit.end, edit.insert);
    } catch (e) {
      console.warn('[autocorrect] replace failed:', e);
    } finally {
      this.applying = false;
    }
    if (!applied) return { status: 'declined', reason: 'editor-refused' };

    // A page can synchronously change the field's privacy classification from
    // its input handler. Once that happens, do not read it again. We retain a
    // memory-only, context-free record based on the edit the adapter confirmed,
    // so the visible extension change still has exactly one undo handle.
    const protectedAfterApply = this.processingBlockReason() !== null;
    let finalText: string;
    let renderedReplacement: string | null;
    if (protectedAfterApply) {
      this.blockedSinceRead = true;
      this.suggestion = null;
      this.host.highlighter.hideSuggestion();
      this.session.persistence = 'memory';
      finalText =
        before.slice(0, edit.start)
        + edit.insert
        + before.slice(edit.end);
      renderedReplacement = edit.insert;
    } else {
      finalText = this.adapter.getText();
      // Verify the WHOLE field, not just the edited span: a host that appends
      // or rewrites text outside the span would otherwise pass a span-only
      // check and leave unrecorded changes behind.
      renderedReplacement = renderedReplacementFor(before, finalText, edit);
    }
    let recordedProposal = proposal;
    let recoveredHostRewrite = false;
    if (renderedReplacement === null) {
      // The host rewrote our edit (or normalised it beyond recognition). The
      // text has already changed, so leaving now would produce exactly the
      // "changed but unrecorded" state this path exists to prevent.
      const restored = this.rollback(before);
      const afterRollback = this.adapter.getText();
      finalText = afterRollback;
      this.snapshot = afterRollback;
      if (restored) return { status: 'rolled-back', reason: 'host-rewrote-edit' };

      // The rollback itself was refused or rewritten. Recover the actual
      // before/after edit so the remaining visible mutation still gets one
      // truthful, reversible record rather than a record for text that is not
      // present. Widening also makes pure insertions/deletions locatable.
      const actual = deriveEdit(before, afterRollback);
      const recoverable = actual ? widenEdit(before, actual) : null;
      if (!recoverable) {
        console.error(
          '[autocorrect] host altered a correction and no reversible history edit'
            + ' could be derived',
        );
        return { status: 'unrecorded', reason: 'host-rewrite-not-recoverable' };
      }
      edit = {
        start: recoverable.start,
        end: recoverable.end,
        insert: recoverable.replacement,
      };
      renderedReplacement = recoverable.replacement;
      recordedProposal = {
        ...proposal,
        start: edit.start,
        end: edit.end,
        original: before.slice(edit.start, edit.end),
        replacement: renderedReplacement,
      };
      recoveredHostRewrite = true;
      console.error(
        '[autocorrect] host altered a correction and it could not be rolled back;'
          + ' recording it so it stays reversible',
      );
    }

    this.recentlyApplied.push({
      start: edit.start,
      original: recordedProposal.original,
      replacement: renderedReplacement,
    });
    if (this.recentlyApplied.length > 5) this.recentlyApplied.shift();

    // 3. Preserve caret and selection.
    try {
      this.adapter.setCaret(shiftCaret(caret.start, edit), shiftCaret(caret.end, edit));
    } catch {
      /* caret restoration is best effort */
    }

    // 4/5/6. Create exactly one record, filed under this field's session.
    const settings = this.host.settings();
    const recordContextRadius = protectedAfterApply ? 0 : settings.contextRadius;
    const end = edit.start + renderedReplacement.length;
    if (!recoveredHostRewrite && renderedReplacement !== proposal.replacement) {
      recordedProposal = { ...proposal, replacement: renderedReplacement };
    }
    let record: CorrectionRecord;
    try {
      const anchor = createAnchor({
        text: finalText,
        start: edit.start,
        end,
        originalText: recordedProposal.original,
        replacementText: renderedReplacement,
        contextRadius: recordContextRadius,
      });
      record = createRecord({
        sessionId: this.session.id,
        proposal: recordedProposal,
        anchor,
        contextPreview: buildPreview(finalText, edit.start, end, recordContextRadius),
        autoApplied,
      });
      if (recordContextRadius > 0) {
        record.contextWords = { previous: context.previousWord, next: context.nextWord };
      }
    } catch (e) {
      // History construction failed: never leave modified text unrecorded.
      console.error('[autocorrect] could not build a correction record:', e);
      const restored = this.rollback(before);
      this.snapshot = this.adapter.getText();
      return {
        status: restored ? 'rolled-back' : 'unrecorded',
        reason: 'record-construction-failed',
      };
    }

    this.session.records.push(record);
    this.touchSession(finalText);
    this.snapshot = finalText;
    this.lintVersion++;

    // 7/10. Learning, without leaking user text into logs.
    if (protectedAfterApply || recoveredHostRewrite) {
      // The editor, not the provider, chose this final replacement. Recording
      // it preserves reversibility; learning it would teach false evidence.
      record.learningApplied = false;
    } else if (isHarperRuleId(proposal.ruleId) || isPunctuationRuleId(proposal.ruleId)) {
      // These feed per-rule statistics from their own lanes, never the
      // word-pair model: "and" -> ", and" must not become an exact rule.
      record.learningApplied = true;
    } else {
      this.host.learn({
        type: 'applied',
        original: proposal.original,
        replacement: proposal.replacement,
        source: sourceFor(proposal),
      });
    }

    if (!protectedAfterApply && settings.showInlineFlash) {
      try {
        this.host.highlighter.flash(this.adapter.rectsFor(edit.start, end));
      } catch {
        /* visuals are optional */
      }
    }
    // Post-hoc feedback: what changed, why, and a one-click way out. The record
    // already exists, so the correction survives the badge disappearing.
    if (!protectedAfterApply && autoApplied && settings.showCorrectionExplanations) {
      try {
        const displayedProposal = recoveredHostRewrite ? recordedProposal : proposal;
        this.host.highlighter.flashDiff({
          getRects: () => this.adapter.rectsFor(edit.start, end),
          original: displayedProposal.original,
          replacement: displayedProposal.replacement,
          explanation: explainCorrection(displayedProposal),
          onUndo: () => {
            const result = this.decide(record.id, 'revert');
            if (!result.ok) this.host.highlighter.toast(result.error, 'warn');
          },
        });
      } catch {
        /* the badge is optional */
      }
    }
    // 8. Notify the panel.
    this.host.changed(this);
    if (!protectedAfterApply && this.markupVisible) this.refreshMarkupOverlay();
    return { status: 'applied', record };
  }

  /**
   * Restores the field to `before`. Replaces the whole text rather than the
   * edited span: this path runs precisely when the host did something we did
   * not predict, so span arithmetic can no longer be trusted.
   */
  private rollback(before: string): boolean {
    this.applying = true;
    try {
      const current = this.adapter.getText();
      if (current === before) return true;
      const undone = this.adapter.replaceRange(0, current.length, before);
      if (!undone) return false;
      return this.adapter.getText() === before;
    } catch {
      return false;
    } finally {
      this.applying = false;
    }
  }

  /** Back-compatible wrapper: existing call sites expect a record or null. */
  private applyProposal(
    proposal: CorrectionProposal,
    context: EngineContext,
    autoApplied = true,
  ): CorrectionRecord | null {
    const outcome = this.applyCorrection({ proposal, context, autoApplied });
    return outcome.status === 'applied' ? outcome.record : null;
  }

  private offerSuggestion(proposal: CorrectionProposal, context: EngineContext): void {
    this.suggestion = { proposal, context };
    const rects = () => this.adapter.rectsFor(proposal.start, proposal.end);
    this.host.highlighter.showSuggestion(
      rects,
      proposal.replacement,
      () => {
        const current = this.suggestion;
        this.host.highlighter.hideSuggestion();
        this.suggestion = null;
        if (!current) return;
        if (!this.refreshEligibility()) return;
        // Re-verify before touching the text: the user kept typing.
        const text = this.adapter.getText();
        const observed = text.slice(current.proposal.start, current.proposal.end);
        if (observed !== current.proposal.original) {
          this.host.highlighter.toast('The text changed - suggestion skipped.', 'warn');
          return;
        }
        this.applyProposal(current.proposal, current.context, false);
      },
      () => {
        this.host.highlighter.hideSuggestion();
        this.suggestion = null;
      },
    );
  }

  /* ------------------------------ idle work ------------------------------ */

  private scheduleIdleWork(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.runIdleWork(), 700);
  }

  private runIdleWork(): void {
    this.idleTimer = undefined;
    if (!this.adapter.isConnected()) return;
    if (!this.refreshEligibility()) return;
    try {
      this.checkManualEdit();
      this.relocateAll();
      const stale = autoAcceptStale(this.session, this.host.settings().autoAcceptAfterMinutes);
      if (stale.length > 0) {
        this.touchSession(this.adapter.getText());
        this.host.changed(this);
      }
      // The punctuation lane runs first: it is synchronous and deterministic,
      // and its claimed spans keep the grammar lane from duplicating a fix.
      if (this.runPunctuationPass()) return;
      this.maybeRequestLint();
      // The background sweep is last: it is the lowest-priority work, and it
      // only ever looks at text the caret path has not already dealt with.
      if (this.host.settings().deepScanEnabled) this.startSweep();
    } catch (e) {
      console.warn('[autocorrect] idle work failed:', e);
    }
  }

  private checkManualEdit(): void {
    if (!this.refreshEligibility()) return;
    const settings = this.host.settings();
    if (!settings.learnFromManualEdits) {
      this.snapshot = this.adapter.getText();
      return;
    }
    const text = this.adapter.getText();
    if (text === this.snapshot) return;
    const change = diffSingleWord(this.snapshot, text);
    this.snapshot = text;
    if (!change) return;

    // Undoing one of our own corrections is a rejection, not new evidence.
    const undoesOurs = this.session.records.some(
      (r) =>
        normaliseRuleText(r.replacementText) === normaliseRuleText(change.original) &&
        normaliseRuleText(r.originalText) === normaliseRuleText(change.replacement),
    );
    if (undoesOurs) return;

    this.host.learn({
      type: 'manual-edit',
      original: change.original,
      replacement: change.replacement,
    });
  }

  /* ------------------------------ essential punctuation lane ------------------------------ */

  /**
   * Analyses the caret paragraph for essential punctuation. Synchronous, so
   * there is no stale-response window - but the span is still re-verified
   * immediately before any edit.
   *
   * Returns true when it applied or offered something, so the caller can let
   * the grammar lane wait for the next pass.
   */
  private runPunctuationPass(): boolean {
    let caret: { start: number; end: number };
    let text: string;
    try {
      text = this.adapter.getText();
      caret = this.adapter.getCaret();
    } catch {
      return false;
    }
    return this.runPunctuationOver(paragraphAt(text, caret.start), true);
  }

  /**
   * Sweep entry point: the same lane, restricted to one span and forbidden from
   * offering chips. A background sweep that popped a suggestion for every
   * sentence would be unusable, so it applies what it may and leaves the rest
   * for when the caret arrives.
   */
  private runPunctuationPassIn(start: number, end: number): boolean {
    return this.runPunctuationOver({ start, end }, false);
  }

  private runPunctuationOver(
    bounds: { start: number; end: number },
    mayOffer: boolean,
  ): boolean {
    // Claims describe only a proposal that survived every current gate. Clear
    // them before all early returns so a disabled/dismissed old issue cannot
    // suppress Harper on a later pass.
    this.punctuationClaims = [];
    const settings = withProfile(this.host.settings(), this.host.origin);
    if (!settings.enabled || !settings.punctuationEnabled) return false;
    if (this.composing || !this.canProcess()) return false;
    if (this.suggestion || this.grammarOffer) return false;

    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return false;
    }
    const paragraph = text.slice(bounds.start, bounds.end);
    if (paragraph.trim().length < 8) return false;

    let issues: PunctuationIssue[];
    try {
      issues = essentialPunctuationProvider.analyse(paragraph, {
        origin: this.host.origin,
        baseOffset: bounds.start,
        settings: punctuationSettingsFrom(settings),
        stats: punctuationStatsFrom(this.host.learning()),
      }) as PunctuationIssue[];
    } catch (e) {
      console.warn('[autocorrect] punctuation analysis failed:', e);
      return false;
    }
    if (issues.length === 0) {
      return false;
    }

    const fingerprint = fnv1a(paragraph);

    const occupied = this.session.records
      .filter((r) => holdsReplacement(r) && r.lastKnownRange)
      .map((r) => r.lastKnownRange!);

    /*
     * Every automatic issue from this analysis is applied together, right to
     * left.
     *
     * Applying one per pass and re-analysing looks safer but is actively wrong
     * here: several rules refuse to touch a construction that is already
     * partly punctuated ("never touch a list that already contains a comma").
     * The first applied comma therefore silenced the remaining two, so
     * "apples oranges bananas and grapes" only ever gained a single comma no
     * matter how many passes ran. Right-to-left keeps every earlier offset
     * valid, and each edit still becomes its own reversible record.
     */
    const automatic: Array<{ issue: PunctuationIssue; proposal: CorrectionProposal }> = [];
    const offers: Array<{
      issue: PunctuationIssue;
      key: string;
      start: number;
      end: number;
      proposal: CorrectionProposal;
    }> = [];
    const claimed: Array<{ start: number; end: number }> = [];

    for (const issue of issues) {
      const key = punctuationKey(issue, fingerprint);
      if (this.dismissedPunctuation.has(key)) continue;
      if (!issueStillApplies(text, issue, bounds.start)) continue;

      const start = bounds.start + issue.start;
      const end = bounds.start + issue.end;
      /*
       * The occupied check stops two lanes rewriting the same span. It must not
       * stop a rule that only *appends* to a span another lane already fixed:
       * capitalising "apples" and then adding its list comma compose perfectly,
       * and treating them as a conflict silently dropped the first comma of
       * every list whose opening word had been corrected.
       */
      const appendsOnly = issue.replacementText.startsWith(issue.originalText);
      if (
        !appendsOnly
        && occupied.some((range) => start < range.end && end > range.start)
      ) {
        continue;
      }
      if (claimed.some((range) => start < range.end && end > range.start)) continue;

      const gated = this.gateProposal(proposalFromIssue(issue, bounds.start, false));
      if (!gated) continue;
      const proposal = gated;
      if (this.isSuppressed(proposal)) continue;

      // The rule mode can demote an "automatic" issue to a suggestion, so the
      // gated action decides here - not the issue's own opinion.
      if (issue.action === 'automatic' && proposal.action === 'autocorrect') {
        automatic.push({ issue, proposal });
        claimed.push({ start, end });
        continue;
      }
      if (mayOffer && settings.showSuggestionChips) {
        offers.push({ issue, key, start, end, proposal });
      }
    }

    if (automatic.length > 0) {
      let applied = 0;
      // Left to right, carrying the accumulated length change. Right-to-left
      // would avoid the arithmetic but would file the records in reverse
      // document order, so the panel - and "revert the second comma" - would
      // disagree with what the user sees on screen.
      let delta = 0;
      for (const entry of [...automatic].sort((a, b) => a.proposal.start - b.proposal.start)) {
        // A host input handler can reclassify the field after an earlier comma
        // in this same batch. Stop before the next text read.
        if (!this.refreshEligibility()) break;
        const shifted: CorrectionProposal =
          delta === 0
            ? entry.proposal
            : { ...entry.proposal, start: entry.proposal.start + delta, end: entry.proposal.end + delta };
        const current = this.adapter.getText();
        if (this.applyPunctuationIssue(entry.issue, shifted, current)) {
          applied++;
          delta += shifted.replacement.length - (shifted.end - shifted.start);
        }
      }
      if (applied > 0) {
        this.scheduleIdleWork();
        return true;
      }
    }

    const offer = offers[0];
    if (!offer) return false;
    this.punctuationClaims = [{
      start: offer.proposal.start,
      end: offer.proposal.end,
      replacement: offer.proposal.replacement,
    }];
    this.offerPunctuationIssue(
      offer.issue,
      offer.key,
      offer.start,
      offer.end,
      offer.proposal,
    );
    return true;
  }

  private applyPunctuationIssue(
    issue: PunctuationIssue,
    proposal: CorrectionProposal,
    text: string,
  ): boolean {
    const context = buildContext(text, proposal.start, proposal.end, this.host.origin);
    const record = this.applyProposal(proposal, context, true);
    if (!record) return false;
    this.host.punctuationFeedback({ ruleId: issue.ruleId, verdict: 'shown' });

    const range = record.lastKnownRange ?? {
      start: proposal.start,
      end: proposal.start + proposal.replacement.length,
    };
    try {
      this.host.highlighter.flashDiff({
        getRects: () => this.adapter.rectsFor(range.start, range.end),
        original: issue.originalText,
        replacement: issue.replacementText,
        onUndo: () => {
          const result = this.decide(record.id, 'revert');
          if (!result.ok) this.host.highlighter.toast(result.error, 'warn');
        },
      });
    } catch {
      /* the badge is optional */
    }
    this.host.changed(this);
    return true;
  }

  private offerPunctuationIssue(
    issue: PunctuationIssue,
    key: string,
    start: number,
    end: number,
    proposal: CorrectionProposal,
  ): void {
    this.punctuationOffer = { issue, key, start, end, proposal };
    this.host.punctuationFeedback({ ruleId: issue.ruleId, verdict: 'shown' });

    this.host.highlighter.showSuggestion(
      () => this.adapter.rectsFor(start, end),
      issue.replacementText,
      () => this.acceptPunctuationOffer(),
      () => this.dismissPunctuationOffer(),
    );
  }

  private acceptPunctuationOffer(): void {
    const offer = this.punctuationOffer;
    this.host.highlighter.hideSuggestion();
    this.punctuationOffer = null;
    if (!offer || !this.refreshEligibility()) return;

    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return;
    }
    if (text.slice(offer.start, offer.end) !== offer.issue.originalText) {
      this.host.highlighter.toast('The text changed - suggestion skipped.', 'warn');
      return;
    }
    const proposal = this.gateProposal(offer.proposal);
    if (!proposal) return;
    const context = buildContext(text, offer.start, offer.end, this.host.origin);
    const record = this.applyProposal(proposal, context, false);
    if (!record) return;
    this.host.punctuationFeedback({ ruleId: offer.issue.ruleId, verdict: 'accepted' });
    this.host.changed(this);
    this.scheduleIdleWork();
  }

  private dismissPunctuationOffer(): void {
    const offer = this.punctuationOffer;
    this.host.highlighter.hideSuggestion();
    this.punctuationOffer = null;
    if (!offer) return;
    this.dismissedPunctuation.add(offer.key);
    this.host.punctuationFeedback({ ruleId: offer.issue.ruleId, verdict: 'rejected' });
    this.scheduleIdleWork();
  }

  /* ------------------------------ grammar (Harper) lane ------------------------------ */

  /**
   * Requests a lint of one paragraph. Runs only from idle work - never on the
   * keystroke path - and enforces one in-flight request per field. The caret
   * paragraph is checked first; remaining paragraphs (a paste, a restored
   * document) are swept one per pass via self-chained idle passes. Results
   * are re-validated in handleLintResponse.
   */
  private maybeRequestLint(): void {
    const settings = this.host.settings();
    const mayProduceOutput = settings.showSuggestionChips || settings.harperAutoApply;
    if (!settings.harperEnabled || !settings.enabled || !mayProduceOutput) return;
    if (this.composing || !this.canProcess()) return;
    if (this.lintInFlight) {
      this.lintDirty = true;
      return;
    }
    // A recent transport/engine failure backs off instead of hot-looping.
    if (Date.now() - this.lastLintFailureAt < 30_000) return;

    let text: string;
    let caret: { start: number; end: number };
    try {
      text = this.adapter.getText();
      caret = this.adapter.getCaret();
    } catch {
      return;
    }
    const target = this.nextLintTarget(text, caret.start);
    if (!target) return;

    console.debug(
      `[autocorrect] lint: requesting ${target.paragraph.length} chars at ${target.start} (fp ${target.fingerprint})`,
    );
    this.lintInFlight = true;
    this.lintDirty = false;
    const version = this.lintVersion;
    const generation = this.lintGeneration;
    void this.host
      .requestLint({ paragraph: target.paragraph, fingerprint: target.fingerprint })
      .then((res) => {
        this.handleLintResponse(res, {
          version,
          fingerprint: target.fingerprint,
          paragraphStart: target.start,
          paragraphEnd: target.end,
          generation,
        });
      })
      .catch((e) => {
        this.lastLintFailureAt = Date.now();
        console.debug('[autocorrect] lint request failed:', e);
      })
      .finally(() => {
        this.lintInFlight = false;
        const current = this.host.settings();
        if (
          this.attached
          && this.lintDirty
          && !this.composing
           && current.enabled
           && current.harperEnabled
          && (current.showSuggestionChips || current.harperAutoApply)
          && this.canProcess()
        ) {
          this.scheduleIdleWork();
        }
      });
  }

  /**
   * Picks the next paragraph worth linting: the caret paragraph when it has
   * not come back clean, otherwise the first unvisited paragraph from the
   * top. Paragraphs whose issues were already offered are skipped by the
   * sweep (but not at the caret), so an ignored chip cannot nag from afar.
   * Oversized paragraphs (single-block editors) are windowed around the
   * caret instead of being skipped.
   */
  private nextLintTarget(
    text: string,
    caretIndex: number,
  ): { start: number; end: number; paragraph: string; fingerprint: string } | null {
    const MAX_WINDOW = 4_000;
    const consider = (blockStart: number, blockEnd: number, allowOffered: boolean) => {
      let start = blockStart;
      let end = blockEnd;
      if (end - start > MAX_WINDOW) {
        // Carve a window around the caret (or the block start when the caret
        // is elsewhere), snapped to whitespace so no word is cut in half.
        const anchor =
          caretIndex >= start && caretIndex <= end ? caretIndex : start + MAX_WINDOW / 2;
        start = Math.max(blockStart, Math.floor(anchor - MAX_WINDOW / 2));
        end = Math.min(blockEnd, start + MAX_WINDOW);
        start = Math.max(blockStart, end - MAX_WINDOW);
        while (start > blockStart && start < end && !/\s/.test(text[start - 1]!)) start++;
        if (end < blockEnd) {
          while (end > start && !/\s/.test(text[end]!)) end--;
        }
        if (end <= start) return null;
      }
      const paragraph = text.slice(start, end);
      if (paragraph.trim().length < 12) return null;
      // Raw (not normalised) fingerprint: byte-identical text is required for
      // the paragraph-relative offsets in the response to be meaningful.
      const fingerprint = fnv1a(paragraph);
      if (this.lintedClean.has(fingerprint)) return null;
      if (!allowOffered && this.lintOffered.has(fingerprint)) return null;
      return { start, end, paragraph, fingerprint };
    };

    const caretBounds = paragraphAt(text, caretIndex);
    const atCaret = consider(caretBounds.start, caretBounds.end, true);
    if (atCaret) return atCaret;

    let offset = 0;
    let scanned = 0;
    while (offset <= text.length && scanned < 400) {
      let end = text.indexOf('\n', offset);
      if (end === -1) end = text.length;
      if (offset !== caretBounds.start) {
        const target = consider(offset, end, false);
        if (target) return target;
      }
      scanned++;
      if (end >= text.length) break;
      offset = end + 1;
    }
    return null;
  }

  private handleLintResponse(
    res: Result<LintResponse>,
    ctx: {
      version: number;
      fingerprint: string;
      paragraphStart: number;
      paragraphEnd: number;
      generation: number;
    },
  ): void {
    const currentSettings = this.host.settings();
    if (
      !this.attached
      || ctx.generation !== this.lintGeneration
      || this.composing
      || !currentSettings.harperEnabled
      || (!currentSettings.showSuggestionChips && !currentSettings.harperAutoApply)
      || !this.canProcess()
    ) {
      return;
    }
    if (!res.ok) {
      this.lastLintFailureAt = Date.now();
      console.debug('[autocorrect] lint declined:', res.error);
      return;
    }
    if (res.data.disabled) {
      // Settings skew: this tab believes Harper is on, the background says
      // off. Config broadcasts normally reconcile this; log it loudly enough
      // to diagnose a tab that missed one.
      console.debug('[autocorrect] lint: background reports Harper disabled');
      return;
    }
    if (!this.adapter.isConnected()) return;

    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return;
    }

    // Stale-response rejection, fingerprint-first: the response is usable iff
    // the linted slice is still byte-identical at the same offsets. A version
    // bump caused by an edit in a *different* paragraph leaves this slice
    // intact, so the paragraph-relative offsets remain valid. Rich editors
    // that fire synthetic input events constantly would otherwise starve the
    // lane of every response.
    const currentSlice = text.slice(ctx.paragraphStart, ctx.paragraphEnd);
    if (fnv1a(currentSlice) !== ctx.fingerprint) {
      this.lintDropStreak++;
      console.debug(
        `[autocorrect] lint: response dropped, paragraph changed (streak ${this.lintDropStreak})`,
      );
      if (this.lintDropStreak >= 3) {
        // The host page is rewriting text faster than we can lint it; stop
        // burning cycles and try again after the backoff window.
        this.lintDropStreak = 0;
        this.lastLintFailureAt = Date.now();
        return;
      }
      this.lintDirty = true;
      this.scheduleIdleWork();
      return;
    }
    this.lintDropStreak = 0;
    if (this.lintVersion !== ctx.version) {
      console.debug('[autocorrect] lint: response raced an edit elsewhere; slice intact, using it');
    }

    const occupiedRanges = this.session.records
      .filter((r) => holdsReplacement(r) && r.lastKnownRange)
      .map((r) => r.lastKnownRange!);

    console.debug(
      `[autocorrect] lint: ${res.data.issues.length} issue(s) in ${res.data.lintMs} ms` +
        (res.data.setupMs !== undefined ? ` (engine setup ${res.data.setupMs} ms)` : ''),
    );

    // Earliest issue in the text wins - deterministic reading order, instead
    // of whatever the engine's rule-map iteration happened to produce.
    const ordered = [...res.data.issues].sort((a, b) => a.start - b.start);
    for (const issue of ordered) {
      const key = issueKey(issue, ctx.fingerprint);
      if (this.dismissedIssues.has(key)) continue;
      const verdict = validateIssue({
        issue,
        text,
        paragraphStart: ctx.paragraphStart,
        paragraphEnd: ctx.paragraphEnd,
        learning: this.host.learning(),
        dismissed: this.dismissedIssues,
        occupiedRanges,
      });
      if (!verdict.ok) {
        console.debug(`[autocorrect] lint: skipped ${issue.ruleId} (${verdict.reason})`);
        continue;
      }
      // The punctuation lane owns this span; showing Harper's version too
      // would duplicate the panel entry.
      if (
        this.punctuationClaims.some(
          (claim) => verdict.start < claim.end && claim.start < verdict.end,
        )
      ) {
        console.debug(`[autocorrect] lint: ${issue.ruleId} deferred to the punctuation lane`);
        continue;
      }

      const decision = autoApplyDecision(issue, this.host.settings(), this.host.learning());
      if (!decision.auto) {
        if (decision.reason !== 'setting-off') {
          console.debug(
            `[autocorrect] lint: ${issue.ruleId} stays a suggestion (${decision.reason})`,
          );
        }
      }

      // Grammar goes through the same rule/vocabulary/shadow choke point as
      // every synchronous provider. The lane decides what it would do; the
      // gate may disable or demote that action, and shadow mode records it.
      const proposal = this.gateProposal(
        this.grammarProposal(
          issue,
          verdict.start,
          verdict.end,
          decision.auto ? 'autocorrect' : 'suggest',
        ),
      );
      if (!proposal) continue;

      if (proposal.action === 'autocorrect' && this.autoAppliedChain < 50) {
        // Applying changes the paragraph, so its fingerprint changes and the
        // next pass re-lints it: findings are fixed one at a time.
        if (this.applyGrammarIssue(issue, proposal)) {
          this.autoAppliedChain++;
          this.scheduleIdleWork();
          return;
        }
        console.debug(`[autocorrect] lint: auto-apply of ${issue.ruleId} was refused`);
        continue;
      }

      // Hiding suggestion chips must not disable automatic Harper corrections,
      // but a proposal that remains suggestion-only has no permitted output in
      // this mode. Continue so a later automatic issue can still be handled.
      if (!currentSettings.showSuggestionChips) continue;

      // One chip at a time; accept/dismiss schedules the pass that surfaces
      // the next issue (accepting changes the paragraph fingerprint, so the
      // paragraph is re-linted automatically).
      this.lintOffered.add(ctx.fingerprint);
      if (this.lintOffered.size > 200) this.lintOffered.clear();
      this.offerGrammarIssue(issue, key, verdict.start, verdict.end, proposal);
      return;
    }
    // Nothing (left) to offer: cache so unchanged text is never re-linted,
    // then keep sweeping while unvisited paragraphs remain (bounded budget).
    this.lintedClean.set(ctx.fingerprint, true);
    while (this.lintedClean.size > 200) {
      const oldest = this.lintedClean.keys().next().value;
      if (oldest === undefined) break;
      this.lintedClean.delete(oldest);
    }
    if (this.autoLintPasses < 12) {
      this.autoLintPasses++;
      this.scheduleIdleWork();
    }
  }

  /**
   * Builds the proposal for a validated grammar finding. Shared by the
   * auto-apply path and the chip-accept path so both produce identical records.
   */
  private grammarProposal(
    issue: GrammarIssue,
    start: number,
    end: number,
    action: 'autocorrect' | 'suggest',
  ): CorrectionProposal {
    return {
      start,
      end,
      original: issue.original,
      replacement: issue.replacement,
      correctionType: 'grammar',
      source: 'builtin-grammar',
      confidence: 0.8,
      action,
      reason: issue.message,
      ruleId: HARPER_RULE_PREFIX + issue.ruleId,
    };
  }

  /**
   * Writes a grammar finding into the text without asking, then shows a fading
   * before/after badge so the change is never silent. Returns false when the
   * edit was refused, leaving the caller free to offer a chip instead.
   */
  private applyGrammarIssue(issue: GrammarIssue, proposal: CorrectionProposal): boolean {
    const { start, end } = proposal;
    // Honour a recent manual revert of the same word at the same place.
    if (this.isSuppressed(proposal)) {
      console.debug(`[autocorrect] lint: ${issue.ruleId} suppressed by a recent revert`);
      return false;
    }
    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return false;
    }
    const context = buildContext(text, start, end, this.host.origin);
    const record = this.applyProposal(proposal, context, true);
    if (!record) return false;
    if (issue.ignoreHash) record.sourceIgnoreHash = issue.ignoreHash;

    // Auto-applied findings count as surfaced, not as accepted: only an
    // explicit keep is acceptance, and a revert still counts as a rejection.
    // That keeps the per-rule ratio an honest signal of rule quality.
    this.host.grammarFeedback({ ruleId: issue.ruleId, verdict: 'offered' });

    const range = record.lastKnownRange ?? { start, end: start + issue.replacement.length };
    try {
      this.host.highlighter.flashDiff({
        getRects: () => this.adapter.rectsFor(range.start, range.end),
        original: issue.original,
        replacement: issue.replacement,
        onUndo: () => {
          const result = this.decide(record.id, 'revert');
          if (!result.ok) this.host.highlighter.toast(result.error, 'warn');
        },
      });
    } catch {
      /* the badge is optional; the correction is already recorded */
    }
    this.host.changed(this);
    return true;
  }

  private offerGrammarIssue(
    issue: GrammarIssue,
    key: string,
    start: number,
    end: number,
    proposal: CorrectionProposal,
  ): void {
    // The word lane's chip has priority; grammar returns on a later pass.
    if (this.suggestion) {
      console.debug('[autocorrect] lint: chip deferred, word-lane suggestion is showing');
      return;
    }
    if (!this.host.settings().showSuggestionChips) return;

    console.debug(`[autocorrect] lint: offering ${issue.ruleId} at ${start}`);
    this.grammarOffer = { issue, key, start, end, proposal };
    try {
      this.grammarOfferText = this.adapter.getText();
    } catch {
      this.grammarOfferText = null;
    }
    if (!this.offeredIssueKeys.has(key)) {
      this.offeredIssueKeys.add(key);
      this.host.grammarFeedback({ ruleId: issue.ruleId, verdict: 'offered' });
    }

    this.host.highlighter.showSuggestion(
      () => this.adapter.rectsFor(start, end),
      issue.replacement,
      () => this.acceptGrammarOffer(),
      () => this.dismissGrammarOffer(),
    );
  }

  private acceptGrammarOffer(): void {
    const offer = this.grammarOffer;
    this.host.highlighter.hideSuggestion();
    this.grammarOffer = null;
    this.grammarOfferText = null;
    if (!offer) return;
    if (!this.refreshEligibility()) return;

    // Final verification against the live text - the user may have kept
    // typing between the chip appearing and the click.
    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return;
    }
    if (text.slice(offer.start, offer.end) !== offer.issue.original) {
      this.host.highlighter.toast('The text changed - suggestion skipped.', 'warn');
      return;
    }

    // The chip may have stayed visible while settings, profile, shadow mode or
    // personal vocabulary changed. Re-run the same central policy gate at the
    // click boundary rather than treating an old offer as permanent authority.
    const proposal = this.gateProposal(offer.proposal);
    if (!proposal) return;
    const context = buildContext(text, offer.start, offer.end, this.host.origin);
    const record = this.applyProposal(proposal, context, false);
    if (!record) return;
    if (offer.issue.ignoreHash) record.sourceIgnoreHash = offer.issue.ignoreHash;
    this.host.grammarFeedback({ ruleId: offer.issue.ruleId, verdict: 'accepted' });
    this.host.changed(this);
    // The paragraph changed, so its fingerprint did too: re-lint it so any
    // further issues in the same paragraph surface next.
    this.scheduleIdleWork();
  }

  private dismissGrammarOffer(): void {
    const offer = this.grammarOffer;
    this.host.highlighter.hideSuggestion();
    this.grammarOffer = null;
    this.grammarOfferText = null;
    if (!offer) return;
    this.dismissedIssues.add(offer.key);
    const feedback: GrammarFeedback = { ruleId: offer.issue.ruleId, verdict: 'rejected' };
    if (offer.issue.ignoreHash) feedback.ignoreHash = offer.issue.ignoreHash;
    this.host.grammarFeedback(feedback);
    // Surface the next issue (the dismissed one is suppressed by its key).
    this.scheduleIdleWork();
  }

  /**
   * Re-validates every record against the current text. Records whose target
   * cannot be found are marked, never silently repositioned.
   */
  relocateAll(): boolean {
    if (!this.refreshEligibility()) return false;
    const text = this.adapter.getText();
    const currentFingerprint = textFingerprint(text);
    const settings = this.host.settings();
    const records = this.session.records.slice(0, 200);
    let changed = false;

    for (const record of records) {
      if (record.status === 'superseded') continue;

      const guardedFingerprint = this.restoredFingerprintGuards.get(record.id);
      if (guardedFingerprint && guardedFingerprint !== currentFingerprint) {
        if (record.lastKnownRange) changed = true;
        delete record.lastKnownRange;
        if (
          record.status !== 'unresolved'
          && transition(record, 'unresolved', {
            failureReason:
              'This privacy-minimal history belongs to a different document state.',
          })
        ) {
          changed = true;
        }
        continue;
      }
      if (guardedFingerprint) this.restoredFingerprintGuards.delete(record.id);

      // An unresolved record may have come back on either side, so both are
      // tried; every other status has exactly one expected target.
      const targets: Array<'replacement' | 'original'> =
        record.status === 'unresolved'
          ? ['replacement', 'original']
          : [holdsReplacement(record) ? 'replacement' : 'original'];

      let located = false;
      let ambiguous = false;
      for (const target of targets) {
        const result = locate(text, record.anchor, { target });
        if (result.status === 'ambiguous') ambiguous = true;
        if (result.status !== 'found') continue;

        located = true;
        if (
          record.lastKnownRange?.start !== result.start
          || record.lastKnownRange?.end !== result.end
        ) {
          changed = true;
        }
        record.lastKnownRange = { start: result.start, end: result.end };
        if (record.status === 'unresolved') {
          transition(record, target === 'replacement' ? 'pending' : 'reverted');
          changed = true;
        }
        if (result.score > 0.85) {
          const refreshed = refreshAnchor(
            record.anchor,
            text,
            result.start,
            result.end,
            settings.contextRadius,
          );
          if (
            refreshed.approximateOffset !== record.anchor.approximateOffset
            || refreshed.textBefore !== record.anchor.textBefore
            || refreshed.textAfter !== record.anchor.textAfter
            || refreshed.paragraphFingerprint !== record.anchor.paragraphFingerprint
            || refreshed.sentenceFingerprint !== record.anchor.sentenceFingerprint
            || refreshed.occurrenceIndex !== record.anchor.occurrenceIndex
          ) {
            changed = true;
          }
          record.anchor = refreshed;
        }
        break;
      }
      if (located) continue;

      if (record.lastKnownRange) changed = true;
      delete record.lastKnownRange;
      if (ambiguous) continue; // still present, just not distinguishable

      // The expected text is gone. If the *other* side is present, the user
      // rewrote this correction themselves.
      const other = locate(text, record.anchor, {
        target: targets[0] === 'replacement' ? 'original' : 'replacement',
      });
      const next = other.status === 'found' ? 'superseded' : 'unresolved';
      if (
        record.status !== next &&
        transition(record, next, {
          failureReason:
            next === 'superseded'
              ? 'You edited this text yourself after the correction.'
              : 'The corrected text is no longer in this field.',
        })
      ) {
        changed = true;
      }
    }
    if (changed) {
      this.touchSession(text);
      this.host.changed(this);
    }
    return true;
  }

  /* ------------------------------ commands ------------------------------ */

  jumpTo(recordId: string, options: { showCard?: boolean } = {}): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) {
      this.blockedSinceRead = true;
      return err(blocked);
    }
    if (!this.refreshEligibility()) return err('This field is not available for autocorrect.');
    const record = findRecord(this.session, recordId);
    if (!record) return err('That correction is no longer in this session.');

    const text = this.adapter.getText();
    const target = holdsReplacement(record) ? 'replacement' : 'original';
    const result = locate(text, record.anchor, { target });

    if (result.status === 'missing') {
      transition(record, 'unresolved', {
        failureReason: 'The corrected text is no longer in this field.',
      });
      this.touchSession(text);
      this.host.changed(this);
      return err('That text is no longer in the field, so there is nothing to jump to.');
    }
    if (result.status === 'ambiguous') {
      this.host.highlighter.toast(
        'This word appears several times and the surrounding text changed - pick the right one in the panel.',
        'warn',
      );
      this.host.changed(this);
      return ok({
        ambiguous: true,
        candidates: result.candidates.map((c) => ({
          start: c.start,
          end: c.end,
          score: c.score,
          preview: buildPreview(text, c.start, c.end, 30),
        })),
      });
    }

    const { start, end } = result;
    record.lastKnownRange = { start, end };
    this.touchSession(text);
    this.adapter.focus();
    this.adapter.scrollRangeIntoView(start, end);
    this.adapter.setCaret(start, end);
    this.host.highlighter.hold(() => this.adapter.rectsFor(start, end));
    if (options.showCard !== false) this.showCard(record, start, end);
    this.host.changed(this);
    return ok({ start, end });
  }

  private showCard(record: CorrectionRecord, start: number, end: number): void {
    const reviewing = this.review !== null;
    const actions = [
      { id: 'keep', label: 'Keep', primary: true, hint: 'Keep the correction and learn from it' },
      { id: 'revert', label: 'Revert', hint: 'Restore the original word' },
      { id: 'never', label: 'Never this', danger: true, hint: 'Revert and never make this exact correction' },
      { id: 'dictionary', label: '+ Dictionary', hint: `Revert and never correct "${record.originalText}" again` },
    ];
    if (reviewing) {
      actions.push({ id: 'skip', label: 'Skip', hint: 'Decide later' });
      actions.push({ id: 'exit', label: 'Exit', hint: 'Leave review mode' });
    } else {
      actions.push({ id: 'close', label: 'Close', hint: 'Close this card' });
    }

    this.host.highlighter.showCard({
      getRects: () => this.adapter.rectsFor(start, end),
      original: record.originalText,
      replacement: record.replacementText,
      context: record.contextPreview,
      typeLabel: TYPE_LABEL[record.correctionType],
      confidence: record.confidence,
      reason: '',
      statusLabel: statusLabel(record),
      progress: this.review ? progress(this.review) : undefined,
      actions,
      onAction: (id) => this.onCardAction(record.id, id),
    });
  }

  private onCardAction(recordId: string, action: string): void {
    let result: Result<unknown>;
    switch (action) {
      case 'close':
        this.clearVisuals();
        return;
      case 'exit':
        this.exitReview();
        return;
      case 'keep':
        result = this.decide(recordId, 'keep');
        break;
      case 'revert':
        result = this.decide(recordId, 'revert');
        break;
      case 'never':
        result = this.decide(recordId, 'revert-never');
        break;
      case 'dictionary':
        result = this.decide(recordId, 'revert-dictionary');
        break;
      case 'skip':
        result = this.decide(recordId, 'skip');
        break;
      default:
        return;
    }
    if (!result.ok) {
      this.host.highlighter.toast(result.error, 'warn');
      return;
    }
    if (this.review) this.reviewNext();
    else this.clearVisuals();
  }

  /** Applies a review decision, including any text change it implies. */
  decide(recordId: string, decision: ReviewDecision): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) {
      this.blockedSinceRead = true;
      return err(blocked);
    }
    const record = findRecord(this.session, recordId);
    if (!record) return err('That correction is no longer in this session.');

    const reason = decisionRejectionReason(decision);
    const ctxWords = record.contextWords ?? { previous: '', next: '' };

    if (decision === 'keep' || decision === 'keep-no-learn') {
      if (record.status === 'accepted') return ok({ status: record.status });
      if (
        record.status !== 'pending'
        && record.status !== 'skipped'
        && record.status !== 'auto-accepted'
      ) {
        return err(`Cannot accept a correction that is ${record.status}.`);
      }
      if (!transition(record, 'accepted', reason ? { rejectionReason: reason } : {})) {
        return err(`Cannot accept a correction that is ${record.status}.`);
      }
      const isHarper = isHarperRuleId(record.sourceRuleId);
      const isPunctuation = isPunctuationRuleId(record.sourceRuleId);
      if (isPunctuation && decision === 'keep') {
        this.host.punctuationFeedback({ ruleId: record.sourceRuleId!, verdict: 'accepted' });
      }
      const shouldLearn =
        decision === 'keep'
        && this.host.settings().learnFromDecisions
        && !isHarper
        && !isPunctuation;
      // Harper records already fed the grammar stats when the chip was
      // accepted; keeping them must not create a word-pair rule.
      record.learningApplied = shouldLearn || (isHarper && record.learningApplied);
      if (shouldLearn) {
        this.host.learn({
          type: 'accepted',
          original: record.originalText,
          replacement: record.replacementText,
          previousWord: ctxWords.previous,
          nextWord: ctxWords.next,
        });
      }
      if (this.review) this.review = markHandled(this.review, recordId);
      this.touchSession();
      this.host.changed(this);
      return ok({ status: record.status });
    }

    if (decision === 'skip') {
      if (record.status === 'skipped') return ok({ status: record.status });
      if (record.status !== 'pending' || !transition(record, 'skipped')) {
        return err(`Cannot skip a correction that is ${record.status}.`);
      }
      if (this.host.settings().learnFromDecisions) {
        record.learningApplied = true;
        this.host.learn({
          type: 'skipped',
          original: record.originalText,
          replacement: record.replacementText,
        });
      }
      if (this.review) this.review = markHandled(this.review, recordId);
      this.touchSession();
      this.host.changed(this);
      return ok({ status: record.status });
    }

    return this.revert(record, decision, ctxWords);
  }

  private revert(
    record: CorrectionRecord,
    decision: ReviewDecision,
    ctxWords: { previous: string; next: string },
  ): Result<unknown> {
    if (!holdsReplacement(record)) {
      return err(`This correction is already ${record.status}.`);
    }
    if (!this.refreshEligibility()) return err('This field is not available for autocorrect.');
    const text = this.adapter.getText();
    const plan = planRevert(text, record);

    if (!plan.ok) {
      if (plan.reason === 'ambiguous') {
        this.host.changed(this);
        return err(plan.message);
      }
      transition(record, 'unresolved', { failureReason: plan.message });
      this.touchSession(text);
      this.host.changed(this);
      return err(plan.message);
    }

    const caret = this.adapter.getCaret();
    let applied = false;
    this.applying = true;
    try {
      applied = this.adapter.replaceRange(plan.edit.start, plan.edit.end, plan.edit.insert);
    } catch (e) {
      console.warn('[autocorrect] revert failed:', e);
    } finally {
      this.applying = false;
    }

    if (!applied) {
      transition(record, 'unresolved', {
        failureReason: 'The editor refused the edit, so nothing was changed.',
      });
      this.touchSession(text);
      this.host.changed(this);
      return err('This editor would not accept the change, so nothing was modified.');
    }

    const after = this.adapter.getText();
    const expectedAfter =
      text.slice(0, plan.edit.start)
      + plan.edit.insert
      + text.slice(plan.edit.end);
    if (after !== expectedAfter) {
      // Span-only verification is insufficient: frameworks sometimes append
      // or normalise elsewhere in response to the same input event. Restore
      // the complete pre-revert state so a failed undo leaves no collateral.
      const restored = this.rollback(text);
      const live = this.adapter.getText();
      this.snapshot = live;
      if (restored) {
        this.touchSession(live);
        this.host.changed(this);
        return err(
          'The editor changed other text while reverting, so the revert was rolled back.',
        );
      }
      transition(record, 'unresolved', {
        failureReason:
          'The editor changed other text during the revert and refused restoration.',
      });
      delete record.lastKnownRange;
      this.touchSession(live);
      this.host.changed(this);
      return err('The editor modified the text while reverting; please check it manually.');
    }

    try {
      this.adapter.setCaret(shiftCaret(caret.start, plan.edit), shiftCaret(caret.end, plan.edit));
    } catch {
      /* best effort */
    }

    const reason = decisionRejectionReason(decision) ?? 'revert-once';
    transition(record, 'reverted', { rejectionReason: reason });
    const shouldLearn =
      this.host.settings().learnFromDecisions
      || decision === 'revert-lower-confidence'
      || decision === 'revert-never'
      || decision === 'revert-dictionary'
      || decision === 'revert-context';
    record.learningApplied = shouldLearn;
    record.anchor = refreshAnchor(
      record.anchor,
      after,
      plan.edit.start,
      plan.edit.start + plan.edit.insert.length,
      this.host.settings().contextRadius,
    );
    record.lastKnownRange = {
      start: plan.edit.start,
      end: plan.edit.start + plan.edit.insert.length,
    };
    this.snapshot = after;
    this.lintVersion++;
    this.revertGuards.push({
      original: record.originalText,
      position: plan.edit.start,
      at: Date.now(),
    });

    if (shouldLearn) {
      if (isPunctuationRuleId(record.sourceRuleId)) {
        // Punctuation is learned by rule and context, never as a word pair:
        // "and" -> ", and" would be a catastrophic exact rule.
        this.host.punctuationFeedback({
          ruleId: record.sourceRuleId!,
          verdict: decision === 'revert-context' ? 'ignored-in-context' : 'reverted',
        });
      } else if (isHarperRuleId(record.sourceRuleId)) {
        // Reverting a Harper change feeds the per-rule stats and Harper's own
        // context-hash ignore list, not the word-pair model. "Never this"
        // disables the Harper rule globally.
        const feedback: GrammarFeedback = {
          ruleId: bareHarperRule(record.sourceRuleId!),
          verdict: 'rejected',
        };
        if (record.sourceIgnoreHash) feedback.ignoreHash = record.sourceIgnoreHash;
        if (decision === 'revert-never') feedback.disableRule = true;
        this.host.grammarFeedback(feedback);
        // Adding a single word to the personal dictionary still applies.
        if (reason === 'never-correct-word' && !/\s/.test(record.originalText)) {
          this.host.learn({
            type: 'rejected',
            original: record.originalText,
            replacement: record.replacementText,
            reason,
            previousWord: ctxWords.previous,
            nextWord: ctxWords.next,
          });
        }
      } else {
        this.host.learn({
          type: 'rejected',
          original: record.originalText,
          replacement: record.replacementText,
          reason,
          previousWord: ctxWords.previous,
          nextWord: ctxWords.next,
        });
      }
    }

    if (this.review) this.review = markHandled(this.review, record.id);
    this.touchSession(after);
    this.host.changed(this);
    return ok({ status: record.status, start: plan.edit.start });
  }

  acceptAll(): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) return err(blocked);
    const pending = pendingRecords(this.session.records);
    let accepted = 0;
    for (const record of pending) {
      if (this.decide(record.id, 'keep').ok) accepted++;
    }
    return ok({ accepted });
  }

  revertSelected(ids: string[]): Result<unknown> {
    const failures: string[] = [];
    let reverted = 0;
    for (const id of ids) {
      const res = this.decide(id, 'revert');
      if (res.ok) reverted++;
      else failures.push(res.error);
    }
    this.host.changed(this);
    if (reverted === 0 && failures.length > 0) return err(failures[0]!);
    return ok({ reverted, failures });
  }

  /**
   * Batch action: undo every change the extension made on its own, leaving
   * anything the user explicitly accepted alone.
   *
   * Reverts run newest-first so earlier edits keep their offsets valid while
   * later ones are removed.
   */
  revertAllAutomatic(): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) return err(blocked);
    const targets = this.session.records
      .filter((r) => r.autoApplied && holdsReplacement(r))
      .slice()
      .reverse();
    if (targets.length === 0) {
      return ok({ reverted: 0, failures: [], nothingToDo: true });
    }
    const failures: string[] = [];
    let reverted = 0;
    for (const record of targets) {
      const res = this.decide(record.id, 'revert');
      if (res.ok) reverted++;
      else failures.push(res.error);
    }
    this.host.changed(this);
    if (reverted === 0 && failures.length > 0) return err(failures[0]!);
    return ok({ reverted, failures });
  }

  /* ------------------------------ correction actions ------------------------------ */

  /** Issue keys ignored for the rest of this document's life. */
  private ignoredInDocument = new Set<string>();

  private ignoreKeyFor(record: CorrectionRecord): string {
    return `${normaliseRuleText(record.originalText)}->${normaliseRuleText(record.replacementText)}`;
  }

  /**
   * Applies one of the per-correction actions offered by the history panel.
   *
   * These differ from review decisions in that they carry a *scope*: ignoring
   * something once, in this document, or on this site are three different
   * promises, and conflating them is how a user ends up unable to get a
   * correction back.
   */
  correctionAction(recordId: string, action: CorrectionAction): Result<unknown> {
    const record = findRecord(this.session, recordId);
    if (!record) return err('That correction is no longer in this session.');
    // Only the rule stamped at creation time; never re-derived from the display
    // type, which cannot tell a curated typo from a dictionary guess.
    const ruleId = record.controlRuleId;

    switch (action) {
      case 'undo':
        return this.decide(recordId, 'revert');

      case 'always-prefer': {
        // Punctuation and grammar are per-rule, never word-pair rules: an
        // exact rule mapping "and" -> ", and" would fire everywhere.
        if (isPunctuationRuleId(record.sourceRuleId) || isHarperRuleId(record.sourceRuleId)) {
          return err('Punctuation and grammar rules are preferred per rule, not per word.');
        }
        this.pendingVocabulary({
          kind: 'preferred',
          original: record.originalText,
          replacement: record.replacementText,
          scope: { kind: 'global' },
        });
        return this.decide(recordId, 'keep');
      }

      case 'never': {
        if (isPunctuationRuleId(record.sourceRuleId) || isHarperRuleId(record.sourceRuleId)) {
          return this.decide(recordId, 'revert-never');
        }
        this.pendingVocabulary({
          kind: 'blocked',
          original: record.originalText,
          replacement: record.replacementText,
          scope: { kind: 'global' },
        });
        return this.decide(recordId, 'revert-never');
      }

      case 'suggestion-only':
        if (!ruleId) return err('This correction has no rule that can be changed.');
        this.host.setRuleMode(ruleId as CorrectionRuleId, 'suggestion');
        return ok({ ruleId, mode: 'suggestion' });

      case 'disable-rule':
        if (!ruleId) return err('This correction has no rule that can be changed.');
        this.host.setRuleMode(ruleId as CorrectionRuleId, 'disabled');
        return ok({ ruleId, mode: 'disabled' });

      case 'add-to-dictionary': {
        if (/\s/.test(record.originalText)) {
          this.pendingVocabulary({
            kind: 'phrase',
            original: record.originalText,
            scope: { kind: 'global' },
          });
        } else {
          this.pendingVocabulary({
            kind: 'allowed-word',
            original: record.originalText,
            scope: { kind: 'global' },
          });
        }
        return holdsReplacement(record)
          ? this.decide(recordId, 'revert-dictionary')
          : ok({ added: record.originalText });
      }

      case 'ignore-once':
        // Nothing persistent: reverting already installs a short-lived guard
        // that stops the same word being re-corrected at the same place.
        return this.decide(recordId, 'revert');

      case 'ignore-in-document': {
        this.ignoredInDocument.add(this.ignoreKeyFor(record));
        this.pendingVocabulary({
          kind: 'blocked',
          original: record.originalText,
          replacement: record.replacementText,
          scope: { kind: 'document', documentScope: this.host.documentScope },
        });
        return holdsReplacement(record) ? this.decide(recordId, 'revert') : ok({ ignored: true });
      }

      case 'ignore-on-site': {
        this.ignoredInDocument.add(this.ignoreKeyFor(record));
        this.pendingVocabulary({
          kind: 'blocked',
          original: record.originalText,
          replacement: record.replacementText,
          scope: { kind: 'site', origin: this.host.origin },
        });
        return holdsReplacement(record) ? this.decide(recordId, 'revert') : ok({ ignored: true });
      }
    }
  }

  private pendingVocabulary(entry: {
    kind: 'allowed-word' | 'blocked' | 'preferred' | 'phrase';
    original: string;
    replacement?: string;
    scope: import('../shared/vocabulary.js').VocabularyScope;
  }): void {
    this.host.addVocabulary(entry);
  }

  /* ------------------------------ document evidence ------------------------------ */

  /**
   * Vocabulary this field has already used correctly.
   *
   * Per controller, so it cannot leak between documents, and refreshed from the
   * field's own text rather than accumulated from keystrokes - a word the user
   * deleted should stop counting.
   */
  private readonly documentEvidence = new DocumentEvidence();
  private documentEvidenceStamp = '';

  /** Rebuilds document evidence when the text has meaningfully changed. */
  private refreshDocumentEvidence(text: string): void {
    // Fingerprint rather than full comparison: this runs during sweeps.
    const stamp = `${text.length}:${fnv1a(text.slice(0, 2_000))}`;
    if (stamp === this.documentEvidenceStamp) return;
    this.documentEvidenceStamp = stamp;
    this.documentEvidence.clear();
    this.documentEvidence.observe(text);
  }

  /* ------------------------------ shadow collection ------------------------------ */

  /** Observation keys already recorded, so a sweep cannot report duplicates. */
  private shadowSeen = new Set<string>();
  private shadowRecorded = 0;

  /** Bound per sweep: evidence, not a transcript of the document. */
  private static readonly MAX_SHADOW_PER_SWEEP = 120;

  /**
   * The one place a shadow observation is recorded.
   *
   * Every provider routes through here so the budget and the de-duplication
   * apply uniformly. De-duplication is by word pair rather than by position:
   * the same disagreement at ten places in a document is one piece of
   * evidence, and recording it ten times would bias the aggregate that context
   * weights are chosen from.
   */
  private recordObservation(input: {
    provider: ShadowObservation['provider'];
    ruleId: string;
    originalText: string;
    replacementText: string;
    confidence: number;
    wouldHave: ShadowObservation['wouldHave'];
  }): void {
    if (this.shadowRecorded >= EditableController.MAX_SHADOW_PER_SWEEP) return;

    const key = `${input.provider}|${input.originalText}>${input.replacementText}`;
    if (this.shadowSeen.has(key)) return;
    this.shadowSeen.add(key);
    this.shadowRecorded++;

    this.host.recordShadow([createObservation({ ...input, origin: this.host.origin })]);
  }

  /** Records one ranking comparison, if there is one. */
  private recordRankingComparison(): void {
    const comparison = takeRankingComparison();
    if (!comparison) return;
    this.recordObservation({
      provider: 'context',
      ruleId: `ranking:${comparison.responsibleTerms.join('+') || 'tie-break'}`,
      originalText: comparison.currentWinner,
      replacementText: comparison.experimentalWinner,
      confidence: comparison.experimentalMargin,
      wouldHave:
        comparison.experimentalAction === 'autocorrect' ? 'autocorrect' : 'suggest',
    });
  }

  /* ------------------------------ whole-field sweep ------------------------------ */

  private readonly sweep = new SweepPlan();
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;
  private sweeping = false;
  private sweepFixes = 0;

  /**
   * Checks the whole field rather than only the word at the caret.
   *
   * `force` restarts from scratch (the "Check whole text" button); otherwise the
   * plan's existing pass counts are honoured, so already-checked sentences are
   * skipped and only new or edited text is examined.
   */
  scanField(force = false, preferSelection = false): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) return err(blocked);
    if (force) {
      this.sweep.reset();
      this.sweepFixes = 0;
      // A forced scan is a fresh measurement, so the observation budget and
      // the de-duplication set start again with it.
      this.shadowSeen.clear();
      this.shadowRecorded = 0;
    }

    // "Check this selection" jumps the queue: the rest of the field is still
    // swept afterwards, so nothing is skipped - it is only reordered.
    let selection: { start: number; end: number } | null = null;
    if (preferSelection) {
      try {
        const caret = this.adapter.getCaret();
        if (caret.end > caret.start) selection = { start: caret.start, end: caret.end };
      } catch {
        selection = null;
      }
    }
    this.sweep.prioritise(selection);

    this.startSweep();
    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return err('This field could not be read.');
    }
    const progress = this.sweep.progress(text, this.sweepPasses());
    return ok({ started: true, selection: selection !== null, ...progress });
  }

  private sweepPasses(): number {
    return Math.max(1, Math.min(10, this.host.settings().deepScanPasses));
  }

  /** Queues the next tick unless one is already pending. */
  private startSweep(): void {
    if (this.sweepTimer !== undefined) return;
    // A short delay keeps the sweep behind the user's own typing; each tick
    // does at most one chunk, so a long document never blocks the main thread.
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweepTick();
    }, 30);
  }

  private stopSweep(): void {
    if (this.sweepTimer !== undefined) clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /**
   * One unit of sweep work: find the next unchecked sentence, apply at most one
   * correction inside it, and reschedule.
   *
   * Applying a single correction per tick is what keeps offsets trustworthy -
   * the edit changes the text, which changes that sentence's fingerprint, which
   * puts it back in the queue to be looked at again.
   */
  private sweepTick(): void {
    if (this.sweeping) return;
    if (!this.refreshEligibility()) return;

    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return;
    }
    // One refresh per tick, not per token: the sweep walks every word in a
    // chunk and rebuilding evidence for each would be quadratic.
    this.refreshDocumentEvidence(text);

    const passes = this.sweepPasses();
    const chunk = this.sweep.next(text, passes);
    if (!chunk) {
      // Nothing left. Report once so the panel can stop saying "scanning".
      if (this.sweepFixes > 0) this.host.changed(this);
      return;
    }

    this.sweeping = true;
    let changed = false;
    try {
      changed = this.scanChunk(text, chunk.start, chunk.end);
    } catch (e) {
      console.warn('[autocorrect] sweep failed:', e);
      this.host.reportProviderError('sweep', e);
    } finally {
      this.sweeping = false;
    }

    if (changed) {
      this.sweepFixes++;
      // The chunk's text changed, so its old fingerprint is meaningless.
      this.sweep.forget(chunk.fingerprint);
    } else {
      // A clean pass over unchanged text is deterministic, so the chunk is
      // credited with every remaining pass - unless the asynchronous grammar
      // lane might still have something to say about it.
      const grammarPending =
        this.host.settings().harperEnabled && !this.lintedClean.has(chunk.fingerprint);
      this.sweep.recordClean(chunk.fingerprint, passes, !grammarPending);
    }
    this.startSweep();
  }

  /**
   * Applies the first correction found inside one chunk, in the same priority
   * order the live path uses. Returns true when the text was changed.
   */
  private scanChunk(text: string, start: number, end: number): boolean {
    const repeated = findRepeatedWordIn(text, start, end);
    if (repeated && this.applySimpleCandidate(repeated, text, 'repeated-word')) return true;

    // Word-level spelling: walk every token in the chunk, not just the caret.
    for (const token of tokenizeWords(text)) {
      if (token.start < start || token.end > end) continue;
      const spacing = this.findSpacingCandidate(text, token.end);
      if (
        spacing
        && spacing.confidence >= resolveSettings(this.host.settings(), this.host.origin)
          .autocorrectThreshold
        && this.offerOrApplySpacing(spacing, text)
      ) {
        return true;
      }
      if (this.commitAt(text, token.end)) return true;
    }

    const capitalisation = findCapitalisationIn(text, start, end);
    if (capitalisation && this.applySimpleCandidate(capitalisation, text, 'capitalisation')) {
      return true;
    }

    return this.runPunctuationPassIn(start, end);
  }

  /* ------------------------------ markup overlay ------------------------------ */

  private markupVisible = false;

  /**
   * Draws every correction in this field at once: the original struck through,
   * an arrow, then the replacement. Nothing is written into the document - the
   * markup lives in the extension's own shadow layer, positioned over the text.
   */
  setMarkupOverlay(enabled: boolean): Result<unknown> {
    this.markupVisible = enabled;
    if (!enabled) {
      this.host.highlighter.hideMarkup();
      return ok({ shown: 0 });
    }
    return this.refreshMarkupOverlay();
  }

  private refreshMarkupOverlay(): Result<unknown> {
    if (!this.markupVisible) return ok({ shown: 0 });
    if (!this.adapter.isConnected()) {
      this.host.highlighter.hideMarkup();
      return err('This field is no longer on the page.');
    }
    if (!this.refreshEligibility()) {
      this.host.highlighter.hideMarkup();
      return err('This field is not available for autocorrect.');
    }
    let text: string;
    try {
      text = this.adapter.getText();
    } catch {
      return err('This field could not be read.');
    }

    const items = [];
    for (const record of this.session.records) {
      // Only corrections still standing in the text can be pointed at.
      if (!holdsReplacement(record)) continue;
      const found = locate(text, record.anchor);
      if (found.status !== 'found') continue;
      record.lastKnownRange = { start: found.start, end: found.end };
      items.push({
        recordId: record.id,
        original: record.originalText,
        replacement: record.replacementText,
        typeLabel: TYPE_LABEL[record.correctionType] ?? 'correction',
        getRects: () => this.adapter.rectsFor(found.start, found.end),
      });
    }
    this.host.highlighter.showMarkup(items, (recordId) => {
      const result = this.decide(recordId, 'revert');
      if (!result.ok) this.host.highlighter.toast(result.error, 'warn');
      else this.refreshMarkupOverlay();
    });
    return ok({ shown: items.length });
  }

  resolveAmbiguous(recordId: string, start: number, end: number): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) return err(blocked);
    const record = findRecord(this.session, recordId);
    if (!record) return err('That correction is no longer in this session.');
    if (!this.refreshEligibility()) return err('This field is not available for autocorrect.');
    const text = this.adapter.getText();
    const target = holdsReplacement(record) ? record.replacementText : record.originalText;
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end !== start + target.length
      || end > text.length
      || normaliseRuleText(text.slice(start, end)) !== normaliseRuleText(target)
      || isWordChar(text[start - 1])
      || isWordChar(text[end])
    ) {
      return err('That occurrence is no longer available.');
    }

    record.anchor = refreshAnchor(
      record.anchor,
      text,
      start,
      end,
      this.host.settings().contextRadius,
    );
    record.lastKnownRange = { start, end };
    this.touchSession(text);
    this.adapter.focus();
    this.adapter.scrollRangeIntoView(start, end);
    this.adapter.setCaret(start, end);
    this.host.highlighter.hold(() => this.adapter.rectsFor(start, end));
    this.showCard(record, start, end);
    this.host.changed(this);
    return ok({ start, end });
  }

  dismissUnresolved(recordId: string): Result<unknown> {
    const record = findRecord(this.session, recordId);
    if (!record) return err('That correction is no longer in this session.');
    this.session.records = this.session.records.filter((r) => r.id !== recordId);
    this.touchSession();
    this.host.changed(this);
    return ok(null);
  }

  clearHistory(): Result<unknown> {
    this.session.records = [];
    this.restoredFingerprintGuards.clear();
    this.touchSession();
    this.review = null;
    this.clearVisuals();
    this.host.changed(this);
    return ok(null);
  }

  /* ------------------------------ review mode ------------------------------ */

  beginReview(): Result<unknown> {
    const blocked = this.processingBlockReason();
    if (blocked !== null) return err(blocked);
    if (!this.relocateAll()) return err('This field is not available for autocorrect.');
    this.review = startReview(this.session.records);
    if (this.review.queue.length === 0) {
      this.review = null;
      return err('There is nothing left to review.');
    }
    const id = currentId(this.review);
    if (id) this.jumpTo(id);
    this.host.changed(this);
    return ok(progress(this.review));
  }

  reviewNext(): Result<unknown> {
    if (!this.review) return err('Review mode is not active.');
    this.review = reconcile(advance(this.review), this.session.records);
    if (isComplete(this.review)) {
      this.exitReview();
      this.host.highlighter.toast('Review complete.');
      return ok({ complete: true });
    }
    const id = currentId(this.review);
    if (id) this.jumpTo(id);
    this.host.changed(this);
    return ok(progress(this.review));
  }

  reviewPrevious(): Result<unknown> {
    if (!this.review) return err('Review mode is not active.');
    this.review = retreat(this.review);
    const id = currentId(this.review);
    if (id) this.jumpTo(id);
    this.host.changed(this);
    return ok(progress(this.review));
  }

  reviewJump(recordId: string): void {
    if (this.review) this.review = reviewJumpTo(this.review, recordId);
  }

  exitReview(): Result<unknown> {
    this.review = null;
    this.clearVisuals();
    this.host.changed(this);
    return ok(null);
  }

  clearVisuals(): void {
    this.host.highlighter.clearHold();
    this.host.highlighter.hideCard();
    this.host.highlighter.hideSuggestion();
  }

  /* ------------------------------ reporting ------------------------------ */

  counts() {
    return countRecords(this.session.records);
  }

  reviewState() {
    if (!this.review) return null;
    const p = progress(this.review);
    const id = currentId(this.review);
    return { active: true, position: p.position, total: p.total, currentId: id };
  }
}

function statusLabel(record: CorrectionRecord): string {
  switch (record.status) {
    case 'pending':
      return 'Pending review';
    case 'accepted':
      return 'Accepted';
    case 'auto-accepted':
      return 'Auto-accepted';
    case 'reverted':
      return 'Reverted';
    case 'rejected':
      return 'Rejected';
    case 'skipped':
      return 'Skipped';
    case 'unresolved':
      return 'Location unresolved';
    case 'superseded':
      return 'Superseded by a later edit';
  }
}

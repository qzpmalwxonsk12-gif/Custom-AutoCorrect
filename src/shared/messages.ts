/**
 * The message protocol. One discriminated union per direction, plus small typed
 * helpers that turn Chrome's callback errors into ordinary rejected promises.
 */
import type {
  CorrectionSession,
  LearningData,
  RejectionReason,
  SessionCounts,
  Settings,
} from './types.js';
import type { GrammarFeedback, LintRequest } from './grammar.js';
import type { ReviewDecision } from '../history/review-session.js';
import type { ExtensionState } from './status.js';
import type { CorrectionRuleId, RuleControlMode } from './rules.js';
import type { VocabularyEntry, VocabularyScope } from './vocabulary.js';
import type { ShadowObservation, ShadowSummary } from './shadow-mode.js';

/** What the side panel renders. Assembled by the content script. */
export interface PanelState {
  origin: string;
  siteLabel: string;
  fieldLabel: string;
  hasField: boolean;
  /** Stable per-field key, so "disable for this field" has something to name. */
  fieldId: string;
  enabled: boolean;
  siteEnabled: boolean;
  /** False when this specific field was switched off. */
  fieldEnabled: boolean;
  memoryOnly: boolean;
  /** True while a pause is in force for this document. */
  paused: boolean;
  /** Active writing profile for this origin. */
  profileId: string;
  profileLabel: string;
  session: CorrectionSession | null;
  counts: SessionCounts;
  review: { active: boolean; position: number; total: number; currentId?: string } | null;
  /** Set when a lane failed in a way the user should be told about. */
  errorMessage?: string;
  updatedAt: number;
}

/** Everything the toolbar popup shows, assembled in the background. */
export interface ToolbarStatus {
  state: ExtensionState;
  label: string;
  detail: string;
  origin: string;
  siteLabel: string;
  siteGranted: boolean;
  siteEnabled: boolean;
  fieldEnabled: boolean;
  enabled: boolean;
  hasField: boolean;
  fieldLabel: string;
  fieldId: string;
  /** Corrections recorded in the focused field's session. */
  sessionCorrections: number;
  pendingCorrections: number;
  historyEnabled: boolean;
  historyDetail: string;
  harper: { enabled: boolean; ready: boolean; detail: string };
  /** The future AI provider. Reported so its absence is explicit, not silent. */
  ai: { configured: boolean; ready: boolean; detail: string };
  profileId: string;
  profileLabel: string;
  shadowMode: Settings['shadowMode'];
  pauseRemainingMs: number;
  pausedForTab: boolean;
  tabId?: number;
}

export const EMPTY_COUNTS: SessionCounts = {
  total: 0,
  pending: 0,
  accepted: 0,
  reverted: 0,
  unresolved: 0,
};

export type PanelCommand =
  | { type: 'jump'; recordId: string }
  | { type: 'decide'; recordId: string; decision: ReviewDecision }
  | { type: 'review-decide'; recordId: string; decision: ReviewDecision }
  | { type: 'accept-all' }
  | { type: 'revert-selected'; recordIds: string[] }
  | { type: 'clear-session' }
  | { type: 'start-review' }
  | { type: 'exit-review' }
  | { type: 'review-next' }
  | { type: 'review-previous' }
  | { type: 'resolve-ambiguous'; recordId: string; start: number; end: number }
  | { type: 'dismiss-unresolved'; recordId: string }
  /** Show every correction in the field at once, struck through -> replacement. */
  | { type: 'set-markup-overlay'; enabled: boolean }
  /** Revert every automatic change in this session, leaving accepted ones. */
  | { type: 'revert-all-automatic' }
  /**
   * Check the whole field, not just the word at the caret.
   * `preferSelection` puts the selected text at the front of the queue.
   */
  | { type: 'scan-field'; force?: boolean; preferSelection?: boolean }
  /** Correction-level actions offered by history entries. */
  | { type: 'correction-action'; recordId: string; action: CorrectionAction };

/**
 * What a user can decide about one correction. Kept separate from
 * `ReviewDecision` because these also carry a *scope* - "not here" and "not
 * ever" are different promises.
 */
export type CorrectionAction =
  | 'undo'
  | 'always-prefer'
  | 'never'
  | 'suggestion-only'
  | 'disable-rule'
  | 'add-to-dictionary'
  | 'ignore-once'
  | 'ignore-in-document'
  | 'ignore-on-site';

/** content script -> background */
export type ContentMessage =
  | { kind: 'content/state'; state: PanelState; focused: boolean }
  | { kind: 'content/config'; }
  | {
      kind: 'content/learn';
      event:
        | {
            type: 'applied';
            original: string;
            replacement: string;
            source:
              | 'builtin-typo'
              | 'personal-learning'
              | 'user-created'
              | 'lexicon'
              | 'builtin-context'
              | 'builtin-grammar';
          }
        | { type: 'accepted'; original: string; replacement: string; previousWord: string; nextWord: string }
        | {
            type: 'rejected';
            original: string;
            replacement: string;
            reason: RejectionReason;
            previousWord: string;
            nextWord: string;
          }
        | { type: 'skipped'; original: string; replacement: string }
        | { type: 'manual-edit'; original: string; replacement: string };
    }
  | { kind: 'content/persist-session'; session: CorrectionSession }
  | { kind: 'content/drop-session'; sessionId: string }
  | { kind: 'content/restore-session'; sessionId: string }
  | { kind: 'content/lint'; request: LintRequest }
  | { kind: 'content/grammar-feedback'; feedback: GrammarFeedback }
  | {
      kind: 'content/punctuation-feedback';
      feedback: {
        ruleId: string;
        verdict: 'shown' | 'accepted' | 'rejected' | 'reverted' | 'ignored-in-context';
      };
    }
  | { kind: 'content/create-rule'; original: string; replacement: string }
  | { kind: 'content/add-dictionary'; word: string }
  /** Shadow-mode observations: what a provider would have done. */
  | { kind: 'content/shadow'; observations: ShadowObservation[] }
  /** Timing only - no text - so diagnostics can report engine latency. */
  | { kind: 'content/analysis-time'; ms: number }
  /** A lane failed; recorded for the diagnostics page. */
  | { kind: 'content/provider-error'; provider: string; message: string };

/** background -> content script */
export type BackgroundMessage =
  | { kind: 'bg/config'; settings: Settings; learning: LearningData }
  | { kind: 'bg/command'; command: PanelCommand }
  | { kind: 'bg/request-state' }
  | { kind: 'bg/clear-sessions' }
  | { kind: 'bg/access-revoked'; patterns: string[] }
  /** Context menu: ask the page to collect a replacement for the selection. */
  | { kind: 'bg/prompt-rule'; original: string }
  | { kind: 'bg/notice'; message: string; warn?: boolean }
  | { kind: 'bg/ping' };

/** side panel / popup / options -> background */
export type UiMessage =
  | { kind: 'ui/panel-ready' }
  | { kind: 'ui/request-state' }
  | { kind: 'ui/command'; command: PanelCommand }
  | { kind: 'ui/get-settings' }
  | { kind: 'ui/set-settings'; patch: Partial<Settings> }
  | { kind: 'ui/get-learning' }
  | { kind: 'ui/mutate-learning'; mutation: LearningMutation }
  | { kind: 'ui/export' }
  | { kind: 'ui/import'; payload: string }
  | { kind: 'ui/reset-learning' }
  | { kind: 'ui/list-sessions' }
  | { kind: 'ui/clear-sessions' }
  | { kind: 'ui/open-panel'; tabId: number }
  | { kind: 'ui/harper-status' }
  /* --- toolbar status and pause --- */
  | { kind: 'ui/toolbar-status' }
  | {
      kind: 'ui/pause';
      /** Minutes to pause for; omit and set `untilTabClose` for a tab pause. */
      minutes?: number;
      untilTabClose?: boolean;
      tabId?: number;
    }
  | { kind: 'ui/resume' }
  /* --- per-rule control --- */
  | {
      kind: 'ui/set-rule-mode';
      ruleId: CorrectionRuleId;
      mode: RuleControlMode;
      /** Omit for the global layer; supply an origin for a site override. */
      origin?: string;
    }
  /* --- vocabulary --- */
  | { kind: 'ui/get-vocabulary' }
  | {
      kind: 'ui/add-vocabulary';
      entry: {
        kind: VocabularyEntry['kind'];
        original: string;
        replacement?: string;
        scope: VocabularyScope;
        note?: string;
      };
    }
  | { kind: 'ui/remove-vocabulary'; id: string }
  | { kind: 'ui/import-vocabulary'; payload: string }
  | { kind: 'ui/export-vocabulary' }
  /* --- shadow mode --- */
  | { kind: 'ui/get-shadow-log' }
  | { kind: 'ui/clear-shadow-log' }
  /* --- diagnostics --- */
  | { kind: 'ui/diagnostics' };

export type LearningMutation =
  | { type: 'add-dictionary'; word: string }
  | { type: 'remove-dictionary'; word: string }
  | { type: 'create-rule'; original: string; replacement: string }
  | { type: 'delete-rule'; ruleId: string }
  | { type: 'set-rule-mode'; ruleId: string; mode: 'autocorrect' | 'suggestion' | 'blocked' }
  | { type: 'unblock'; ruleId: string; mode?: 'autocorrect' | 'suggestion' }
  | { type: 'clear-pending' };

/** background -> side panel (broadcast) */
export type PanelMessage =
  | { kind: 'panel/state'; state: PanelState | null }
  | { kind: 'panel/settings'; settings: Settings };

/** Diagnostics payload. Contains no user text, by construction. */
export interface DiagnosticsReport {
  extensionVersion: string;
  schemaVersion: number;
  dictionary: { words: number; source: string; version: string; sha256: string };
  harper: { enabled: boolean; ready: boolean; dialect: string; rules: number; setups: number;
    lastSetupMs: number; lintCount: number; averageLintMs: number };
  ai: { configured: boolean; ready: boolean; provider: string; version: string };
  site: { origin: string; granted: boolean; enabled: boolean; profileId: string;
    profileLabel: string };
  field: { present: boolean; kind: string; enabled: boolean };
  history: { enabled: boolean; persisted: boolean; sessions: number; records: number;
    retentionDays: number };
  lastAnalysisMs: number | null;
  providerErrors: Array<{ provider: string; message: string; at: number }>;
  shadow: { mode: Settings['shadowMode']; observations: number };
  /** Active context-ranking weights, so the shipped values are inspectable. */
  contextWeights: { frequency: number; partOfSpeech: number; documentReuse: number };
  storageError: string | null;
  generatedAt: number;
}

export interface ShadowLogResponse {
  observations: ShadowObservation[];
  summary: ShadowSummary;
}

export type AnyMessage = ContentMessage | BackgroundMessage | UiMessage | PanelMessage;

export interface Ok<T> {
  ok: true;
  data: T;
}
export interface Err {
  ok: false;
  error: string;
}
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}
export function err(error: unknown): Err {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * Promise wrapper around chrome.runtime.sendMessage that never throws for the
 * common "no listener" case - callers get a typed `Err` instead.
 */
export async function sendToRuntime<T>(message: AnyMessage): Promise<Result<T>> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as Result<T> | undefined;
    if (!response) return err('no response');
    return response;
  } catch (e) {
    return err(e);
  }
}

export async function sendToTab<T>(
  tabId: number,
  message: BackgroundMessage,
  frameId?: number,
): Promise<Result<T>> {
  try {
    const options = frameId === undefined ? {} : { frameId };
    const response = (await chrome.tabs.sendMessage(tabId, message, options)) as
      | Result<T>
      | undefined;
    if (!response) return err('no response');
    return response;
  } catch (e) {
    return err(e);
  }
}

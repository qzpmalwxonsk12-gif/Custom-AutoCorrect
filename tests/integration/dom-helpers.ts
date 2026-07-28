/** jsdom helpers for the integration tests. */
import type { CorrectionHighlighter } from '../../src/content/correction-highlighter.js';
import type { ControllerHost } from '../../src/content/editable-controller.js';
import type { GrammarFeedback, LintRequest, LintResponse } from '../../src/shared/grammar.js';
import type { Result } from '../../src/shared/messages.js';
import type { LearningData, Settings } from '../../src/shared/types.js';
import type { ShadowObservation } from '../../src/shared/shadow-mode.js';
import { upsertEntry } from '../../src/shared/vocabulary.js';
import { learning as makeLearning, settings as makeSettings } from '../helpers.js';

export interface LearnRecord {
  type: string;
  original?: string;
  replacement?: string;
  reason?: string;
}

export function stubHighlighter(): CorrectionHighlighter {
  const noop = () => {};
  return {
    flash: noop,
    hold: noop,
    clearHold: noop,
    showCard: noop,
    hideCard: noop,
    showSuggestion: noop,
    hideSuggestion: noop,
    flashDiff: noop,
    hideBadge: noop,
    showMarkup: noop,
    hideMarkup: noop,
    setReducedMotion: noop,
    toast: noop,
    destroy: noop,
  } as unknown as CorrectionHighlighter;
}

export interface TestHost extends ControllerHost {
  events: LearnRecord[];
  changes: number;
  setSettings(patch: Partial<Settings>): void;
  data: LearningData;
  /** Every lint request the controller issued, in order. */
  lintRequests: LintRequest[];
  /** Every grammar feedback event the controller sent, in order. */
  grammarEvents: GrammarFeedback[];
  /** Every punctuation feedback event the controller sent, in order. */
  punctuationEvents: Array<{ ruleId: string; verdict: string }>;
  /** Test seam: what the next lint requests resolve with. */
  lintResponder: (request: LintRequest) => Promise<Result<LintResponse>>;
  /** Shadow-mode observations the controller recorded, in order. */
  shadowObservations: ShadowObservation[];
  /** Rule-mode changes requested via a correction action. */
  ruleModeChanges: Array<{ ruleId: string; mode: string }>;
  /** Vocabulary entries added via a correction action. */
  vocabularyAdded: Array<{ kind: string; original: string; replacement?: string }>;
  /** Provider failures reported for diagnostics. */
  providerErrors: Array<{ provider: string; message: string }>;
  /** Test seam: pause the extension. */
  paused: boolean;
}

export function makeHost(
  overrides: { settings?: Partial<Settings>; learning?: LearningData } = {},
): TestHost {
  let settings = makeSettings(overrides.settings);
  const data = overrides.learning ?? makeLearning();
  const host: TestHost = {
    origin: 'https://example.com',
    documentScope: 'test-tab:test-frame',
    events: [],
    changes: 0,
    data,
    lintRequests: [],
    grammarEvents: [],
    punctuationEvents: [],
    lintResponder: async () => ({ ok: true, data: { issues: [], lintMs: 0 } }),
    highlighter: stubHighlighter(),
    settings: () => settings,
    learning: () => data,
    learn(event) {
      host.events.push(event as unknown as LearnRecord);
    },
    changed() {
      host.changes++;
    },
    requestLint(request) {
      host.lintRequests.push(request);
      return host.lintResponder(request);
    },
    grammarFeedback(feedback) {
      host.grammarEvents.push(feedback);
    },
    punctuationFeedback(feedback) {
      host.punctuationEvents.push(feedback);
    },
    shadowObservations: [],
    ruleModeChanges: [],
    vocabularyAdded: [],
    providerErrors: [],
    paused: false,
    isPaused() {
      return host.paused;
    },
    recordShadow(observations) {
      host.shadowObservations.push(...observations);
    },
    reportAnalysisTime() {
      /* timing is diagnostics only */
    },
    reportProviderError(provider, error) {
      host.providerErrors.push({
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    setRuleMode(ruleId, mode) {
      host.ruleModeChanges.push({ ruleId, mode });
      // Mirror the background's write so the effect is visible synchronously.
      settings = { ...settings, ruleModes: { ...settings.ruleModes, [ruleId]: mode } };
    },
    addVocabulary(entry) {
      host.vocabularyAdded.push({
        kind: entry.kind,
        original: entry.original,
        ...(entry.replacement ? { replacement: entry.replacement } : {}),
      });
      upsertEntry(data.vocabulary, entry);
    },
    setSettings(patch) {
      settings = { ...settings, ...patch };
    },
  };
  return host;
}

/** Creates an InputEvent that carries `inputType` even on older jsdom builds. */
export function inputEvent(inputType: string, data: string | null): InputEvent {
  const event = new InputEvent('input', { bubbles: true, inputType, data });
  if (event.inputType !== inputType) {
    Object.defineProperty(event, 'inputType', { value: inputType, configurable: true });
  }
  if (event.data !== data) {
    Object.defineProperty(event, 'data', { value: data, configurable: true });
  }
  return event;
}

/** Types `text` into a textarea/input one character at a time, like a user. */
export function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  for (const ch of text) {
    const caret = field.selectionStart ?? field.value.length;
    field.value = field.value.slice(0, caret) + ch + field.value.slice(caret);
    field.setSelectionRange(caret + 1, caret + 1);
    const type = ch === '\n' ? 'insertLineBreak' : 'insertText';
    field.dispatchEvent(inputEvent(type, ch === '\n' ? null : ch));
  }
}

export function makeTextarea(value = ''): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.value = value;
  document.body.appendChild(el);
  el.focus();
  el.setSelectionRange(value.length, value.length);
  return el;
}

export function makeContentEditable(html = ''): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  // jsdom does not implement isContentEditable, so back it with the attribute.
  Object.defineProperty(el, 'isContentEditable', {
    get: () => el.getAttribute('contenteditable') === 'true',
    configurable: true,
  });
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

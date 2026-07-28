/**
 * Owns every per-field controller in this frame, keeps the configuration
 * snapshot fresh, and is the only place that talks to the background.
 */
import { countRecords } from '../history/correction-history.js';
import {
  err,
  ok,
  sendToRuntime,
  type BackgroundMessage,
  type ContentMessage,
  type PanelCommand,
  type PanelState,
  type Result,
} from '../shared/messages.js';
import {
  validateRulePair,
  type GrammarFeedback,
  type LintRequest,
  type LintResponse,
} from '../shared/grammar.js';
import {
  DEFAULT_SETTINGS,
  EMPTY_LEARNING,
  type CorrectionSession,
  type LearningData,
  type Settings,
} from '../shared/types.js';
import { debounce } from '../shared/util.js';
import { isPaused } from '../shared/status.js';
import { fieldDisabled, profileFor } from '../shared/effective-settings.js';
import type { CorrectionRuleId, RuleControlMode } from '../shared/rules.js';
import type { VocabularyScope } from '../shared/vocabulary.js';
import type { ShadowObservation } from '../shared/shadow-mode.js';
import { ContentEditableAdapter } from './contenteditable-adapter.js';
import { CorrectionHighlighter } from './correction-highlighter.js';
import {
  EditableController,
  type ControllerHost,
  type PunctuationFeedback,
} from './editable-controller.js';
import { guardField } from './field-guard.js';
import { InputAdapter } from './input-adapter.js';

type LearnEvent = Extract<ContentMessage, { kind: 'content/learn' }>['event'];

export class SessionController implements ControllerHost {
  readonly origin = location.origin;
  readonly highlighter = new CorrectionHighlighter();
  documentScope = 'unconfigured';

  private settingsSnapshot: Settings = {
    ...DEFAULT_SETTINGS,
    enabled: false,
    persistSessions: false,
    learnFromDecisions: false,
    learnFromManualEdits: false,
  };
  private learningSnapshot: LearningData = structuredClone(EMPTY_LEARNING);
  private controllers = new WeakMap<HTMLElement, EditableController>();
  private live = new Set<EditableController>();
  private active: EditableController | null = null;
  private configAvailable = false;
  private ready = false;
  private configRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private configRetryDelay = 1_000;
  private persistTimers = new Map<EditableController, ReturnType<typeof setTimeout>>();
  private restoring = new WeakSet<EditableController>();
  private restored = new WeakSet<EditableController>();
  private restoreEpoch = 0;

  settings(): Settings {
    return this.settingsSnapshot;
  }

  learning(): LearningData {
    return this.learningSnapshot;
  }

  /* ------------------------------ startup ------------------------------ */

  async start(): Promise<void> {
    if (this.ready) return;
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('blur', this.onWindowFocus);
    window.addEventListener('pagehide', this.onPageHide);
    chrome.runtime.onMessage.addListener(this.onMessage);
    this.ready = true;

    if (await this.refreshConfig()) this.activateConfiguredState();
    else this.scheduleConfigRetry();
    if (window.top === window) this.pushState();
  }

  stop(): void {
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('blur', this.onWindowFocus);
    window.removeEventListener('pagehide', this.onPageHide);
    chrome.runtime.onMessage.removeListener(this.onMessage);
    if (this.configRetryTimer !== undefined) clearTimeout(this.configRetryTimer);
    this.configRetryTimer = undefined;
    this.highlighter.hidePrompt();
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    this.refreshLearningSoon.cancel();
    this.pushDebounced.cancel();
    for (const controller of this.live) controller.detach();
    this.live.clear();
    this.active = null;
    this.highlighter.destroy();
    this.ready = false;
  }

  private async refreshConfig(): Promise<boolean> {
    const res = await sendToRuntime<{
      settings: Settings;
      learning: LearningData;
      documentScope: string;
    }>({
      kind: 'content/config',
    });
    if (res.ok) {
      this.settingsSnapshot = res.data.settings;
      this.learningSnapshot = res.data.learning;
      this.documentScope = res.data.documentScope;
      this.configAvailable = true;
      this.configRetryDelay = 1_000;
      return true;
    } else {
      // Keep the fail-closed snapshot and do not attach until configuration is
      // positively loaded.
      console.warn('[autocorrect] config unavailable:', res.error);
      return this.configAvailable;
    }
  }

  private activateConfiguredState(): void {
    if (!this.ready || !this.configAvailable) return;
    if (this.configRetryTimer !== undefined) clearTimeout(this.configRetryTimer);
    this.configRetryTimer = undefined;
    // The OS preference is honoured in CSS; this carries the user's explicit
    // "always reduce motion" choice into the page overlay.
    this.highlighter.setReducedMotion(this.settingsSnapshot.motion === 'reduce');
    for (const controller of this.live) {
      controller.refreshEligibility();
      void this.restore(controller);
    }
    // Attach immediately if a field is already focused (e.g. after injection
    // or after a failed initial config request recovers).
    if (document.activeElement) this.considerElement(document.activeElement);
    this.pushState();
  }

  private scheduleConfigRetry(): void {
    if (!this.ready || this.configAvailable || this.configRetryTimer !== undefined) return;
    const delay = this.configRetryDelay;
    this.configRetryTimer = setTimeout(() => {
      this.configRetryTimer = undefined;
      void this.refreshConfig().then((available) => {
        if (available) this.activateConfiguredState();
        else {
          this.configRetryDelay = Math.min(this.configRetryDelay * 2, 30_000);
          this.scheduleConfigRetry();
        }
      });
    }, delay);
  }

  /* ------------------------------ focus tracking ------------------------------ */

  private onFocusIn = (event: FocusEvent): void => {
    const composedTarget = event.composedPath()[0];
    this.considerElement(
      composedTarget instanceof Element ? composedTarget : event.target as Element | null,
    );
    // Re-report even when this controller was already active: focus may just
    // have returned from another frame, and the background routes panel
    // commands to the most recently focused frame.
    this.pushStateNow();
  };

  private onFocusOut = (): void => {
    const leaving = this.active;
    // Defer: focus often moves between elements of the same editor.
    window.setTimeout(() => {
      if (!leaving) return;
      const el = document.activeElement;
      if (!el || !(el instanceof HTMLElement) || !leaving.adapter.element.contains(el)) {
        this.flushPersist(leaving);
      }
    }, 0);
  };

  private onWindowFocus = (): void => {
    this.pushStateNow();
  };

  private considerElement(target: Element | null): void {
    if (!this.configAvailable) return;
    if (!target || !(target instanceof HTMLElement)) return;
    if (target.closest('[data-personal-autocorrect-ui]')) return;

    const existing = this.controllers.get(target);
    if (existing) {
      this.setActive(existing);
      return;
    }

    if (
      !this.settingsSnapshot.enabled
      || this.settingsSnapshot.siteOverrides[this.origin] === 'off'
    ) {
      return;
    }
    const guard = guardField(target, this.settingsSnapshot);
    if (!guard.allowed || !guard.kind) {
      if (guard.reason && guard.reason !== 'not a supported editable') {
        // Useful when debugging why a field is skipped; never logs content.
        console.debug('[autocorrect] skipping field:', guard.reason);
      }
      return;
    }

    let controller: EditableController;
    try {
      const adapter =
        guard.kind === 'contenteditable'
          ? new ContentEditableAdapter(target)
          : new InputAdapter(target as HTMLInputElement | HTMLTextAreaElement);
      controller = new EditableController(adapter, this);
      controller.attach();
    } catch (e) {
      console.warn('[autocorrect] could not attach to field:', e);
      return;
    }

    this.controllers.set(target, controller);
    this.live.add(controller);
    this.setActive(controller);
    void this.restore(controller);
  }

  private setActive(controller: EditableController): void {
    if (this.active === controller) return;
    this.active?.clearVisuals();
    this.active?.setMarkupOverlay(false);
    this.active = controller;
    // The overlay is a per-field view, so moving focus re-draws it for the
    // field now being edited rather than leaving stale labels behind.
    if (this.settingsSnapshot.markupOverlayEnabled) controller.setMarkupOverlay(true);
    this.pushState();
  }

  private async restore(controller: EditableController): Promise<void> {
    if (
      !this.configAvailable
      || !this.settingsSnapshot.persistSessions
      || !controller.canProcess()
      || this.restoring.has(controller)
      || this.restored.has(controller)
    ) {
      return;
    }
    const epoch = this.restoreEpoch;
    this.restoring.add(controller);
    try {
      const res = await sendToRuntime<{ session: CorrectionSession | null }>({
        kind: 'content/restore-session',
        sessionId: controller.session.id,
      });
      if (!res.ok) return;
      if (
        !this.ready
        || epoch !== this.restoreEpoch
        || !this.settingsSnapshot.persistSessions
        || !controller.canProcess()
      ) {
        return;
      }
      if (!res.data.session || res.data.session.records.length === 0) {
        this.restored.add(controller);
        return;
      }
      const adopted = controller.adoptSession(res.data.session);
      this.restored.add(controller);
      if (adopted) this.pushState();
    } catch (e) {
      console.warn('[autocorrect] session restore failed:', e);
    } finally {
      this.restoring.delete(controller);
    }
  }

  /* ------------------------------ host callbacks ------------------------------ */

  learn(event: LearnEvent): void {
    void sendToRuntime({ kind: 'content/learn', event }).then((res) => {
      if (!res.ok) console.debug('[autocorrect] learn event dropped:', res.error);
      else void this.refreshLearningSoon();
    });
  }

  requestLint(request: LintRequest): Promise<Result<LintResponse>> {
    return sendToRuntime<LintResponse>({ kind: 'content/lint', request });
  }

  grammarFeedback(feedback: GrammarFeedback): void {
    void sendToRuntime({ kind: 'content/grammar-feedback', feedback }).then((res) => {
      if (!res.ok) console.debug('[autocorrect] grammar feedback dropped:', res.error);
    });
  }

  punctuationFeedback(feedback: PunctuationFeedback): void {
    void sendToRuntime({ kind: 'content/punctuation-feedback', feedback }).then((res) => {
      if (!res.ok) console.debug('[autocorrect] punctuation feedback dropped:', res.error);
      else void this.refreshLearningSoon();
    });
  }

  changed(controller: EditableController): void {
    if (controller === this.active) this.pushState();
    this.schedulePersist(controller);
  }

  private refreshLearningSoon = debounce(() => {
    void this.refreshConfig().then((available) => {
      if (available) this.activateConfiguredState();
    });
  }, 400);

  /* ------------------------------ state + persistence ------------------------------ */

  private buildState(): PanelState {
    const controller = this.active;
    const settings = this.settingsSnapshot;
    const siteEnabled = settings.siteOverrides[this.origin] !== 'off';
    const profile = profileFor(settings, this.origin);
    const base = {
      origin: this.origin,
      siteLabel: location.hostname || this.origin,
      enabled: settings.enabled,
      siteEnabled,
      memoryOnly: settings.memoryOnlyOrigins.includes(this.origin) || !settings.persistSessions,
      paused: this.isPaused(),
      profileId: profile.id,
      profileLabel: profile.label,
      ...(this.lastError ? { errorMessage: this.lastError } : {}),
      updatedAt: Date.now(),
    };
    if (!controller || !controller.adapter.isConnected()) {
      return {
        ...base,
        fieldLabel: '',
        fieldId: '',
        hasField: false,
        fieldEnabled: true,
        session: null,
        counts: countRecords([]),
        review: null,
      };
    }
    return {
      ...base,
      fieldLabel: controller.fieldLabel,
      fieldId: controller.fieldId,
      hasField: true,
      fieldEnabled: !fieldDisabled(settings, this.origin, controller.fieldId),
      session: controller.session,
      counts: controller.counts(),
      review: controller.reviewState(),
    };
  }

  /**
   * True while a pause is in force. The timer is checked rather than scheduled:
   * the content script may have been asleep when it expired.
   */
  isPaused(): boolean {
    return isPaused(this.settingsSnapshot.pause, undefined)
      || this.pausedTab;
  }

  /** Set by the background when this tab is paused until it closes. */
  private pausedTab = false;
  private lastError: string | null = null;

  /** Records a lane failure for diagnostics. Never includes user text. */
  reportProviderError(provider: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = `${provider}: ${message}`.slice(0, 200);
    void sendToRuntime({
      kind: 'content/provider-error',
      provider,
      message: message.slice(0, 200),
    });
    this.pushState();
  }

  /** Forwards shadow-mode observations upstream. */
  recordShadow(observations: ShadowObservation[]): void {
    if (observations.length === 0) return;
    void sendToRuntime({ kind: 'content/shadow', observations });
  }

  reportAnalysisTime(ms: number): void {
    void sendToRuntime({ kind: 'content/analysis-time', ms });
  }

  setRuleMode(ruleId: CorrectionRuleId, mode: RuleControlMode): void {
    void sendToRuntime({ kind: 'ui/set-rule-mode', ruleId, mode }).then((res) => {
      if (!res.ok) this.highlighter.toast(res.error, 'warn');
      else void this.refreshLearningSoon();
    });
  }

  addVocabulary(entry: {
    kind: 'allowed-word' | 'blocked' | 'preferred' | 'phrase';
    original: string;
    replacement?: string;
    scope: VocabularyScope;
  }): void {
    void sendToRuntime({ kind: 'ui/add-vocabulary', entry }).then((res) => {
      if (!res.ok) this.highlighter.toast(res.error, 'warn');
      else void this.refreshLearningSoon();
    });
  }

  private pushStateNow(): void {
    if (!this.ready) return;
    void sendToRuntime({
      kind: 'content/state',
      state: this.buildState(),
      // The top document also reports hasFocus() while focus is inside one of
      // its iframes. Treat the leaf frame containing the actual active element
      // as the owner so config broadcasts cannot steal panel routing.
      focused:
        document.hasFocus()
        && !(document.activeElement instanceof HTMLIFrameElement),
    });
  }

  private pushDebounced = debounce(() => this.pushStateNow(), 120);

  pushState(): void {
    this.pushDebounced();
  }

  private schedulePersist(controller: EditableController): void {
    const previous = this.persistTimers.get(controller);
    if (previous !== undefined) clearTimeout(previous);
    this.persistTimers.set(
      controller,
      setTimeout(() => {
        this.persistTimers.delete(controller);
        this.persist(controller);
      }, 1_000),
    );
  }

  private flushPersist(controller: EditableController): void {
    const timer = this.persistTimers.get(controller);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.persistTimers.delete(controller);
    }
    this.persist(controller);
  }

  private persist(controller: EditableController): void {
    if (
      !this.configAvailable
      || !this.settingsSnapshot.persistSessions
      || controller.session.persistence === 'memory'
      || controller.session.records.length === 0
      || !controller.canProcess()
    ) {
      return;
    }
    void sendToRuntime({ kind: 'content/persist-session', session: controller.session });
  }

  private onPageHide = (): void => {
    for (const controller of this.live) this.flushPersist(controller);
  };

  /* ------------------------------ context-menu actions ------------------------------ */

  /**
   * Collects the replacement for a selected word. The prompt is drawn in the
   * extension's own shadow root and positioned at the selection; validation
   * runs locally for instant feedback and again in the background.
   */
  private promptForRule(original: string): void {
    // Capture the selection rects now: focusing the prompt input clears the
    // page selection.
    const rects = selectionRects();
    this.highlighter.promptForRule({
      original,
      getRects: rects.length > 0 ? () => rects : undefined,
      onSubmit: (replacement) => {
        const check = validateRulePair(original, replacement);
        if (!check.ok) return check.reason;
        void sendToRuntime({
          kind: 'content/create-rule',
          original,
          replacement: replacement.trim(),
        }).then((res) => {
          if (res.ok) {
            this.highlighter.toast(`“${original}” will now become “${replacement.trim()}”.`);
            void this.refreshLearningSoon();
          } else {
            this.highlighter.toast(res.error, 'warn');
          }
        });
        return null;
      },
    });
  }

  /* ------------------------------ commands ------------------------------ */

  private onMessage = (
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: Result<unknown>) => void,
  ): boolean | undefined => {
    if (!message || typeof message.kind !== 'string' || !message.kind.startsWith('bg/')) {
      return undefined;
    }
    try {
      switch (message.kind) {
        case 'bg/config':
          this.settingsSnapshot = message.settings;
          this.learningSnapshot = message.learning;
          if (this.configAvailable) this.activateConfiguredState();
          else {
            void this.refreshConfig().then((available) => {
              if (available) this.activateConfiguredState();
              else this.scheduleConfigRetry();
            });
          }
          sendResponse(ok(null));
          return undefined;
        case 'bg/clear-sessions':
          this.restoreEpoch++;
          for (const controller of this.live) controller.clearHistory();
          for (const timer of this.persistTimers.values()) clearTimeout(timer);
          this.persistTimers.clear();
          this.pushState();
          sendResponse(ok(null));
          return undefined;
        case 'bg/access-revoked': {
          const revoked = message.patterns.some((pattern) =>
            matchesChromeOriginPattern(location.href, pattern));
          sendResponse(ok({ stopped: revoked }));
          if (revoked) this.stop();
          return undefined;
        }
        case 'bg/prompt-rule':
          this.promptForRule(message.original);
          sendResponse(ok(null));
          return undefined;
        case 'bg/notice':
          this.highlighter.toast(message.message, message.warn ? 'warn' : 'info');
          sendResponse(ok(null));
          return undefined;
        case 'bg/request-state':
          this.pushStateNow();
          sendResponse(ok(null));
          return undefined;
        case 'bg/ping':
          sendResponse(ok({ hasField: this.active !== null }));
          return undefined;
        case 'bg/command':
          sendResponse(this.runCommand(message.command));
          return undefined;
      }
    } catch (e) {
      sendResponse(err(e));
    }
    return undefined;
  };

  private runCommand(command: PanelCommand): Result<unknown> {
    const controller = this.active;
    if (!controller || !controller.adapter.isConnected()) {
      return err('No text field is focused on this page.');
    }
    switch (command.type) {
      case 'jump':
        controller.reviewJump(command.recordId);
        return controller.jumpTo(command.recordId);
      case 'decide':
        return controller.decide(command.recordId, command.decision);
      case 'review-decide': {
        const decided = controller.decide(command.recordId, command.decision);
        if (!decided.ok) return decided;
        return controller.reviewNext();
      }
      case 'accept-all':
        return controller.acceptAll();
      case 'revert-selected':
        return controller.revertSelected(command.recordIds);
      case 'clear-session':
        void sendToRuntime({ kind: 'content/drop-session', sessionId: controller.session.id });
        return controller.clearHistory();
      case 'start-review':
        return controller.beginReview();
      case 'exit-review':
        return controller.exitReview();
      case 'review-next':
        return controller.reviewNext();
      case 'review-previous':
        return controller.reviewPrevious();
      case 'resolve-ambiguous':
        return controller.resolveAmbiguous(command.recordId, command.start, command.end);
      case 'dismiss-unresolved':
        return controller.dismissUnresolved(command.recordId);
      case 'set-markup-overlay':
        return controller.setMarkupOverlay(command.enabled);
      case 'revert-all-automatic':
        return controller.revertAllAutomatic();
      case 'correction-action':
        return controller.correctionAction(command.recordId, command.action);
      case 'scan-field':
        return controller.scanField(command.force ?? false, command.preferSelection ?? false);
    }
  }
}

/** Client rects of the current selection, if it is inside this document. */
function selectionRects(): DOMRect[] {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
    return Array.from(selection.getRangeAt(0).getClientRects());
  } catch {
    return [];
  }
}

/** Minimal Chrome match-pattern check for origins reported by permissions. */
function matchesChromeOriginPattern(urlString: string, pattern: string): boolean {
  if (pattern === '<all_urls>') return true;
  const match = /^(\*|https?|file):\/\/([^/]+)(\/.*)?$/i.exec(pattern);
  if (!match) return false;
  try {
    const url = new URL(urlString);
    const scheme = match[1]!.toLowerCase();
    if (
      scheme !== '*'
      && `${scheme}:` !== url.protocol.toLowerCase()
    ) {
      return false;
    }
    if (scheme === '*' && url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const hostPattern = match[2]!.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    if (hostPattern !== '*') {
      if (hostPattern.startsWith('*.')) {
        const base = hostPattern.slice(2);
        if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
      } else if (hostname !== hostPattern) {
        return false;
      }
    }

    const pathPattern = match[3] ?? '/*';
    const pathRegex = new RegExp(
      `^${pathPattern.split('*').map(escapeRegExp).join('.*')}$`,
    );
    return pathRegex.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

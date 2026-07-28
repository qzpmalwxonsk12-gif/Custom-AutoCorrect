/**
 * Central message router.
 *
 * The background is deliberately thin: it owns configuration (single writer for
 * learning data), caches the last panel state per tab, and forwards panel
 * commands to the right frame. All correction logic lives in the content script
 * where the text actually is.
 */
import {
  addToDictionary,
  deleteRule,
  observeManualEdit,
  prunePending,
  recordAccepted,
  recordApplied,
  recordRejection,
  recordSkipped,
  removeFromDictionary,
  setRuleMode,
  unblockPair,
  upsertUserRule,
} from '../engine/personal-learning.js';
import {
  err,
  ok,
  sendToTab,
  type BackgroundMessage,
  type ContentMessage,
  type DiagnosticsReport,
  type PanelMessage,
  type PanelState,
  type Result,
  type ShadowLogResponse,
  type ToolbarStatus,
  type UiMessage,
} from '../shared/messages.js';
import { EMPTY_LEARNING, type LearningData, type Settings } from '../shared/types.js';
import { debounce } from '../shared/util.js';
import {
  deleteAllSessions,
  deleteSession,
  deleteSessionsForOrigins,
  limitSessionContext,
  loadAllSessions,
  loadSession,
  parseImportedSessions,
  pruneExpired,
  readIndex,
  saveSession,
  scrubStoredSessionContexts,
  shouldPersist,
  replaceAllSessions,
} from '../storage/session-storage.js';
import * as store from '../storage/storage.js';
import { normaliseStored } from '../storage/migrations.js';
import { KEYS, SCHEMA_VERSION, type ExportBundle } from '../storage/types.js';
import { recordGrammarFeedback, validateRulePair } from '../shared/grammar.js';
import { HarperHost, type HarperMetrics } from './harper-host.js';
import { hasAccessTo, syncContentScripts } from './site-permissions.js';
import { forgetTab, paintBadge } from './badge.js';
import { pauseRemaining, resolveStatus, type PauseState } from '../shared/status.js';
import { profileFor } from '../shared/effective-settings.js';
import { isCorrectionRuleId, RULE_CONTROL_MODES } from '../shared/rules.js';
import {
  exportVocabulary,
  parseVocabularyBundle,
  removeEntry,
  upsertEntry,
} from '../shared/vocabulary.js';
import {
  EMPTY_SHADOW_LOG,
  recordObservation,
  summariseShadowLog,
  type ShadowLog,
  type ShadowObservation,
} from '../shared/shadow-mode.js';
import { DICTIONARY_METADATA } from '../engine/data/dictionary-metadata.js';
import { DEFAULT_WEIGHTS } from '../engine/context/score-weights.js';

interface TabEntry {
  frameId: number;
  state: PanelState;
  receivedAt: number;
  focusedAt: number;
}

const tabs = new Map<number, Map<number, TabEntry>>();
let activeTabId: number | undefined;

/* ------------------------------ harper hosting ------------------------------ */

/**
 * Persisted across service-worker restarts so re-initialisation cost is
 * visible: `setups` here counts engine builds across the whole profile, which
 * is exactly the "how often does eviction make us pay again" number.
 */
const HARPER_METRICS_KEY = 'harperMetrics';

interface PersistedHarperMetrics {
  setups: number;
  lastSetupMs: number;
  lintCount: number;
  totalLintMs: number;
}

let harper: HarperHost | null = null;

function harperHost(): HarperHost {
  if (!harper) {
    harper = new HarperHost({
      wasmUrl: chrome.runtime.getURL('vendor/harper/harper_wasm_bg.wasm'),
      onMetrics: (m: HarperMetrics) => void persistHarperMetrics(m),
    });
  }
  return harper;
}

let metricsBaseline: PersistedHarperMetrics | null = null;

async function persistHarperMetrics(m: HarperMetrics): Promise<void> {
  try {
    if (!metricsBaseline) {
      metricsBaseline = (await store.getRaw<PersistedHarperMetrics>(HARPER_METRICS_KEY)) ?? {
        setups: 0,
        lastSetupMs: 0,
        lintCount: 0,
        totalLintMs: 0,
      };
    }
    const merged: PersistedHarperMetrics = {
      setups: metricsBaseline.setups + m.setups,
      lastSetupMs: m.setupMs || metricsBaseline.lastSetupMs,
      lintCount: metricsBaseline.lintCount + m.lintCount,
      totalLintMs: metricsBaseline.totalLintMs + m.totalLintMs,
    };
    await store.setRaw({ [HARPER_METRICS_KEY]: merged });
  } catch {
    /* metrics are diagnostics, never load-bearing */
  }
}

/* ------------------------------ shadow log ------------------------------ */

const SHADOW_LOG_KEY = 'shadowLog';
let shadowLog: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
let shadowLoaded = false;

async function loadShadowLog(): Promise<ShadowLog> {
  if (shadowLoaded) return shadowLog;
  shadowLoaded = true;
  try {
    const settings = await store.getSettings();
    if (settings.shadowPersist) {
      const stored = await store.getRaw<ShadowLog>(SHADOW_LOG_KEY);
      if (stored && Array.isArray(stored.observations)) shadowLog = stored;
    }
  } catch {
    /* observations are diagnostics; never load-bearing */
  }
  return shadowLog;
}

async function appendShadowObservations(observations: ShadowObservation[]): Promise<void> {
  await loadShadowLog();
  for (const observation of observations) {
    shadowLog = recordObservation(shadowLog, observation);
  }
  const settings = await store.getSettings();
  if (settings.shadowPersist) {
    try {
      await store.setRaw({ [SHADOW_LOG_KEY]: shadowLog });
    } catch {
      /* the in-memory log remains authoritative for this session */
    }
  }
}

/* ------------------------------ provider errors ------------------------------ */

interface ProviderError {
  provider: string;
  message: string;
  at: number;
}

const providerErrors: ProviderError[] = [];

/** Records a lane failure for the diagnostics page. Never records user text. */
export function noteProviderError(provider: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  providerErrors.push({ provider, message: message.slice(0, 200), at: Date.now() });
  if (providerErrors.length > 20) providerErrors.shift();
}

let lastAnalysisMs: number | null = null;

/* ------------------------------ pause ------------------------------ */

/**
 * Reads the pause state, expiring a timer that has run out. Expiry is lazy
 * rather than scheduled: a service worker can be evicted at any time, so a
 * timer that "fires" is not something the extension can rely on.
 */
async function currentPause(): Promise<PauseState> {
  const settings = await store.getSettings();
  const pause = settings.pause;
  if (pause.until > 0 && pause.until <= Date.now()) {
    const cleared: PauseState = { until: 0, tabs: pause.tabs };
    await store.updateSettings({ pause: cleared });
    return cleared;
  }
  return pause;
}

async function setPause(next: PauseState): Promise<void> {
  await store.updateSettings({ pause: next });
  broadcastConfig();
  await refreshBadgeForActiveTab();
}

/* ------------------------------ status ------------------------------ */

async function buildStatus(tab?: chrome.tabs.Tab): Promise<ToolbarStatus> {
  const settings = await store.getSettings();
  const pause = await currentPause();
  const tabId = tab?.id;
  const state = tabId !== undefined ? entryForTab(tabId)?.state ?? null : stateForActiveTab();

  const url = tab?.url;
  const origin = state?.origin ?? originOf(url) ?? '';
  const siteGranted = url ? await hasAccessTo(url) : false;
  const siteEnabled = origin ? settings.siteOverrides[origin] !== 'off' : true;
  const fieldEnabled = state?.fieldEnabled ?? true;

  const storageError = store.lastStorageError();
  const recentError = providerErrors.at(-1);
  const errorMessage =
    storageError
    ?? (recentError && Date.now() - recentError.at < 60_000
      ? `${recentError.provider}: ${recentError.message}`
      : undefined);

  const snapshot = resolveStatus({
    enabled: settings.enabled,
    siteEnabled: siteEnabled && fieldEnabled,
    siteGranted,
    configured: state !== null,
    pause,
    tabId,
    errorMessage: errorMessage ?? undefined,
  });

  const harperLive = harper?.status() ?? null;
  const profile = profileFor(settings, origin);
  const historyEnabled =
    settings.persistSessions && !settings.memoryOnlyOrigins.includes(origin);

  return {
    state: snapshot.state,
    label: snapshot.label,
    detail: snapshot.detail,
    origin,
    siteLabel: state?.siteLabel ?? hostOf(url) ?? 'this page',
    siteGranted,
    siteEnabled,
    fieldEnabled,
    enabled: settings.enabled,
    hasField: state?.hasField ?? false,
    fieldLabel: state?.fieldLabel ?? '',
    fieldId: state?.fieldId ?? '',
    sessionCorrections: state?.counts.total ?? 0,
    pendingCorrections: state?.counts.pending ?? 0,
    historyEnabled,
    historyDetail: !settings.persistSessions
      ? 'Kept in memory only (cleared on reload)'
      : settings.memoryOnlyOrigins.includes(origin)
        ? 'Memory only on this site'
        : `Saved for ${settings.sessionRetentionDays} day(s)`,
    harper: {
      enabled: settings.harperEnabled,
      ready: harperLive?.ready ?? false,
      detail: !settings.harperEnabled
        ? 'Off'
        : harperLive?.ready
          ? `Loaded (${harperLive.availableRules.length} rules)`
          : 'Enabled, loads on first use',
    },
    // No AI provider ships in this build. Reporting it as "not installed"
    // is more useful than omitting the row and leaving the user guessing.
    ai: { configured: false, ready: false, detail: 'Not installed in this build' },
    profileId: profile.id,
    profileLabel: profile.label,
    shadowMode: settings.shadowMode,
    pauseRemainingMs: pauseRemaining(pause),
    pausedForTab: tabId !== undefined && pause.tabs.includes(tabId),
    ...(tabId !== undefined ? { tabId } : {}),
  };
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function refreshBadgeForActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const status = await buildStatus(tab);
    await paintBadge(tab.id, status.state, status.detail);
  } catch {
    /* no window available */
  }
}

/* ------------------------------ panel sync ------------------------------ */

function stateForActiveTab(): PanelState | null {
  if (activeTabId === undefined) return null;
  return entryForTab(activeTabId)?.state ?? null;
}

function entryForTab(tabId: number): TabEntry | undefined {
  const frames = tabs.get(tabId);
  if (!frames) return undefined;
  return [...frames.values()].sort(
    (a, b) => b.focusedAt - a.focusedAt || b.receivedAt - a.receivedAt,
  )[0];
}

function broadcastToPanel(message: PanelMessage): void {
  // The panel may not be open; a missing receiver is normal, not an error.
  chrome.runtime.sendMessage(message).catch(() => {});
}

const pushPanelState = debounce(() => {
  broadcastToPanel({ kind: 'panel/state', state: stateForActiveTab() });
  void refreshBadgeForActiveTab();
}, 60);

export function setActiveTab(tabId: number | undefined): void {
  activeTabId = tabId;
  pushPanelState();
}

export function dropTab(tabId: number): void {
  tabs.delete(tabId);
  if (tabId === activeTabId) pushPanelState();
}

/* ------------------------------ config fan-out ------------------------------ */

const broadcastConfig = debounce(async () => {
  const { settings, learning } = await store.hydrate();
  const message: BackgroundMessage = { kind: 'bg/config', settings, learning };
  for (const tabId of tabs.keys()) {
    void sendToTab(tabId, message);
  }
  broadcastToPanel({ kind: 'panel/settings', settings });
}, 120);

/* ------------------------------ handlers ------------------------------ */

async function handleContent(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender,
): Promise<Result<unknown>> {
  const tabId = sender.tab?.id;

  switch (message.kind) {
    case 'content/config': {
      const { settings, learning } = await store.hydrate();
      const documentScope = `${tabId ?? -1}:${sender.frameId ?? 0}`;
      return ok({ settings, learning, documentScope });
    }

    case 'content/shadow': {
      const observations = Array.isArray(message.observations)
        ? message.observations.slice(0, 50)
        : [];
      if (observations.length > 0) await appendShadowObservations(observations);
      return ok({ recorded: observations.length });
    }

    case 'content/analysis-time': {
      if (typeof message.ms === 'number' && Number.isFinite(message.ms) && message.ms >= 0) {
        lastAnalysisMs = message.ms;
      }
      return ok(null);
    }

    case 'content/provider-error': {
      noteProviderError(String(message.provider).slice(0, 40), message.message);
      void refreshBadgeForActiveTab();
      return ok(null);
    }

    case 'content/state': {
      if (tabId === undefined) return err('no tab');
      const frameId = sender.frameId ?? 0;
      const frames = tabs.get(tabId) ?? new Map<number, TabEntry>();
      const previous = frames.get(frameId);
      const now = Date.now();
      frames.set(frameId, {
        frameId,
        state: message.state,
        receivedAt: now,
        focusedAt: message.focused ? now : previous?.focusedAt ?? 0,
      });
      tabs.set(tabId, frames);
      if (tabId === activeTabId) pushPanelState();
      return ok(null);
    }

    case 'content/persist-session': {
      const settings = await store.getSettings();
      const session = limitSessionContext(message.session, settings.contextRadius);
      if (!shouldPersist(session, settings)) return ok({ persisted: false });
      const persisted = await saveSession(session);
      return ok({ persisted });
    }

    case 'content/restore-session': {
      const settings = await store.getSettings();
      if (!settings.persistSessions) return ok({ session: null });
      const session = await loadSession(message.sessionId);
      if (session && settings.memoryOnlyOrigins.includes(session.origin)) {
        await deleteSession(session.id);
        return ok({ session: null });
      }
      return ok({ session: session ?? null });
    }

    case 'content/drop-session':
      await deleteSession(message.sessionId);
      return ok(null);

    case 'content/learn': {
      const settings = await store.getSettings();
      const event = message.event;
      const result = await store.mutateLearning((data: LearningData) => {
        switch (event.type) {
          case 'applied':
            recordApplied(data, event.original, event.replacement, event.source);
            return { effect: 'applied' as const };
          case 'accepted': {
            recordAccepted(
              data,
              event.original,
              event.replacement,
              { previousWord: event.previousWord, nextWord: event.nextWord },
              settings,
            );
            return { effect: 'accepted' as const };
          }
          case 'rejected': {
            const outcome = recordRejection(
              data,
              event.original,
              event.replacement,
              event.reason,
              { previousWord: event.previousWord, nextWord: event.nextWord },
              settings,
            );
            return { effect: outcome.effect };
          }
          case 'skipped':
            recordSkipped(data, event.original, event.replacement);
            return { effect: 'skipped' as const };
          case 'manual-edit': {
            const res = observeManualEdit(
              data,
              { original: event.original, replacement: event.replacement },
              settings,
            );
            return {
              effect: res.createdRule ? ('rule-created' as const) : ('evidence' as const),
              count: res.count,
            };
          }
        }
      });
      broadcastConfig();
      return ok(result);
    }

    case 'content/lint': {
      const settings = await store.getSettings();
      if (!settings.enabled || !settings.harperEnabled) {
        return ok({ issues: [], lintMs: 0, disabled: true });
      }
      const paragraph = message.request.paragraph;
      if (typeof paragraph !== 'string' || paragraph.length === 0 || paragraph.length > 20_000) {
        return err('Invalid lint request.');
      }
      const learning = await store.getLearning();
      try {
        const response = await harperHost().lint(paragraph, settings, learning);
        return ok(response);
      } catch (e) {
        console.warn('[autocorrect] harper lint failed:', e);
        return err(e);
      }
    }

    case 'content/create-rule': {
      const check = validateRulePair(message.original, message.replacement);
      if (!check.ok) return err(check.reason);
      const rule = await store.mutateLearning((data) =>
        upsertUserRule(data, message.original, message.replacement),
      );
      broadcastConfig();
      return ok({ ruleId: rule.id, original: rule.original, replacement: rule.replacement });
    }

    case 'content/add-dictionary': {
      const word = message.word.trim();
      if (!word || /\s/.test(word) || word.length > 64) return err('That is not a single word.');
      await store.mutateLearning((data) => addToDictionary(data, word));
      if (harper) void harper.importWords([word.toLowerCase()]);
      broadcastConfig();
      return ok(null);
    }

    case 'content/punctuation-feedback': {
      const { ruleId, verdict } = message.feedback;
      if (typeof ruleId !== 'string' || !ruleId.startsWith('punctuation:')) {
        return err('Invalid punctuation rule id.');
      }
      await store.mutateLearning((data) => {
        const key = ruleId.slice(0, 128);
        const stats = data.punctuationStats[key] ?? {
          shown: 0,
          accepted: 0,
          rejected: 0,
          reverted: 0,
          ignoredInContext: 0,
        };
        if (!(key in data.punctuationStats) && Object.keys(data.punctuationStats).length >= 50) {
          return;
        }
        switch (verdict) {
          case 'shown':
            stats.shown++;
            break;
          case 'accepted':
            stats.accepted++;
            break;
          case 'rejected':
            stats.rejected++;
            break;
          case 'reverted':
            stats.reverted++;
            break;
          case 'ignored-in-context':
            stats.ignoredInContext++;
            break;
        }
        data.punctuationStats[key] = stats;
      });
      broadcastConfig();
      return ok(null);
    }

    case 'content/grammar-feedback': {
      const feedback = message.feedback;
      if (!feedback || typeof feedback.ruleId !== 'string') return err('Invalid feedback.');
      await store.mutateLearning((data) => recordGrammarFeedback(data, feedback));
      if (feedback.verdict === 'rejected' && feedback.ignoreHash && harper) {
        void harper.ignoreHash(feedback.ignoreHash);
      }
      if (feedback.disableRule) {
        const settings = await store.getSettings();
        const rule = feedback.ruleId.slice(0, 128);
        if (rule && !settings.harperDisabledRules.includes(rule)) {
          await store.updateSettings({
            harperDisabledRules: [...settings.harperDisabledRules, rule],
          });
          broadcastConfig();
        }
      }
      return ok(null);
    }
  }
}

async function handleUi(message: UiMessage): Promise<Result<unknown>> {
  switch (message.kind) {
    case 'ui/panel-ready':
    case 'ui/request-state': {
      const settings = await store.getSettings();
      return ok({ state: stateForActiveTab(), settings });
    }

    case 'ui/command': {
      if (activeTabId === undefined) return err('No active tab.');
      const entry = entryForTab(activeTabId);
      if (!entry) return err('This page has no active text field yet.');
      const res = await sendToTab(activeTabId, { kind: 'bg/command', command: message.command }, entry.frameId);
      if (!res.ok) return err(`Could not reach the page: ${res.error}`);
      return res;
    }

    case 'ui/get-settings': {
      const settings = await store.getSettings();
      return ok({ settings, storageError: store.lastStorageError() });
    }

    case 'ui/set-settings': {
      const previous = await store.getSettings();
      const settings = await store.updateSettings(message.patch);
      const newlyMemoryOnly = settings.memoryOnlyOrigins.filter(
        (origin) => !previous.memoryOnlyOrigins.includes(origin),
      );
      if (newlyMemoryOnly.length > 0) {
        await deleteSessionsForOrigins(newlyMemoryOnly);
      }
      if (settings.contextRadius < previous.contextRadius) {
        await scrubStoredSessionContexts(settings.contextRadius);
      }
      broadcastConfig();
      return ok({ settings });
    }

    case 'ui/get-learning': {
      const learning = await store.getLearning();
      return ok({ learning });
    }

    case 'ui/mutate-learning': {
      const m = message.mutation;
      await store.mutateLearning((data) => {
        switch (m.type) {
          case 'add-dictionary':
            addToDictionary(data, m.word);
            break;
          case 'remove-dictionary':
            removeFromDictionary(data, m.word);
            break;
          case 'create-rule': {
            upsertUserRule(data, m.original, m.replacement);
            break;
          }
          case 'delete-rule':
            deleteRule(data, m.ruleId);
            break;
          case 'set-rule-mode':
            setRuleMode(data, m.ruleId, m.mode);
            break;
          case 'unblock':
            unblockPair(data, m.ruleId, m.mode);
            break;
          case 'clear-pending':
            data.pending = {};
            break;
        }
      });
      // Keep the live Harper dictionary in step; a full re-sync also happens
      // on every config change via applyConfig's dictionary stamp.
      if (m.type === 'add-dictionary' && harper) {
        void harper.importWords([m.word.trim().toLowerCase()].filter(Boolean));
      }
      broadcastConfig();
      const learning = await store.getLearning();
      return ok({ learning });
    }

    case 'ui/export': {
      const { settings, learning } = await store.hydrate();
      const bundle: ExportBundle = {
        format: 'personal-autocorrect',
        version: SCHEMA_VERSION,
        exportedAt: Date.now(),
        settings,
        learning,
      };
      if (settings.persistSessions) bundle.sessions = await loadAllSessions();
      return ok({ bundle });
    }

    case 'ui/import': {
      if (message.payload.length > 5_000_000) {
        return err('That import is larger than the 5 MB safety limit.');
      }
      let bundle: ExportBundle;
      try {
        bundle = JSON.parse(message.payload) as ExportBundle;
      } catch {
        return err('That file is not valid JSON.');
      }
      if (bundle.format !== 'personal-autocorrect') {
        return err('That file was not exported by Personal Autocorrect.');
      }
      if (!Number.isInteger(bundle.version) || bundle.version < 1 || bundle.version > SCHEMA_VERSION) {
        return err(`Unsupported export version: ${String(bundle.version)}.`);
      }
      if (!bundle.learning || typeof bundle.learning !== 'object') {
        return err('The file has no learning data.');
      }
      const imported = normaliseStored({
        [KEYS.settings]: bundle.settings,
        [KEYS.learning]: bundle.learning,
      });
      let importedSessions: ReturnType<typeof parseImportedSessions>;
      try {
        importedSessions = parseImportedSessions(bundle.sessions);
      } catch (e) {
        return err(e);
      }
      const sessions =
        imported.settings.persistSessions
          ? importedSessions
              .filter((session) => !imported.settings.memoryOnlyOrigins.includes(session.origin))
              .map((session) => limitSessionContext(session, imported.settings.contextRadius))
          : [];
      await store.replaceAll(imported.settings, imported.learning);
      // Clear live controllers before writing the restored history so a
      // pending content-side save cannot immediately overwrite the backup.
      await broadcastToEveryTab({ kind: 'bg/clear-sessions' });
      const restoredSessions = await replaceAllSessions(sessions);
      broadcastConfig();
      return ok({
        rules: Object.keys(imported.learning.rules).length,
        sessions: restoredSessions,
      });
    }

    case 'ui/reset-learning': {
      const settings = await store.getSettings();
      await store.replaceAll(settings, structuredClone(EMPTY_LEARNING));
      // The live engine still holds imported words/ignores; rebuild it fresh.
      if (harper) {
        const stale = harper;
        harper = null;
        void stale.dispose();
      }
      broadcastConfig();
      return ok(null);
    }

    case 'ui/harper-status': {
      const settings = await store.getSettings();
      const persisted = (await store.getRaw<{
        setups: number;
        lastSetupMs: number;
        lintCount: number;
        totalLintMs: number;
      }>(HARPER_METRICS_KEY)) ?? { setups: 0, lastSetupMs: 0, lintCount: 0, totalLintMs: 0 };
      const live = harper?.status() ?? null;
      return ok({
        enabled: settings.harperEnabled,
        dialect: settings.harperDialect,
        disabledRules: settings.harperDisabledRules,
        ready: live?.ready ?? false,
        availableRules: live?.availableRules ?? [],
        // Persisted totals span service-worker restarts; `setups` is the
        // re-initialisation count the prototype is meant to measure.
        metrics: persisted,
      });
    }

    case 'ui/list-sessions': {
      const index = await readIndex();
      return ok({ sessions: index });
    }

    case 'ui/clear-sessions': {
      let removed = await deleteAllSessions();
      await broadcastToEveryTab({ kind: 'bg/clear-sessions' });
      // Catch a persistence message that was already in flight when the first
      // deletion completed but before its tab processed the clear command.
      removed += await deleteAllSessions();
      return ok({ removed });
    }

    case 'ui/open-panel': {
      try {
        await chrome.sidePanel.open({ tabId: message.tabId });
        return ok(null);
      } catch (e) {
        return err(e);
      }
    }

    /* ------------------------------ toolbar ------------------------------ */

    case 'ui/toolbar-status': {
      let tab: chrome.tabs.Tab | undefined;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        tab = undefined;
      }
      const status = await buildStatus(tab);
      await paintBadge(tab?.id, status.state, status.detail);
      return ok({ status });
    }

    case 'ui/pause': {
      const pause = await currentPause();
      if (message.untilTabClose) {
        let tabId = message.tabId;
        if (tabId === undefined) {
          try {
            [{ id: tabId }] = await chrome.tabs.query({ active: true, currentWindow: true });
          } catch {
            tabId = undefined;
          }
        }
        if (tabId === undefined) return err('No active tab to pause.');
        const tabs = pause.tabs.includes(tabId) ? pause.tabs : [...pause.tabs, tabId].slice(-200);
        await setPause({ until: pause.until, tabs });
        return ok({ paused: true, tabId });
      }
      const minutes = Math.min(Math.max(message.minutes ?? 5, 1), 24 * 60);
      await setPause({ until: Date.now() + minutes * 60_000, tabs: pause.tabs });
      return ok({ paused: true, minutes });
    }

    case 'ui/resume': {
      let tabId: number | undefined;
      try {
        [{ id: tabId }] = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        tabId = undefined;
      }
      const pause = await currentPause();
      await setPause({
        until: 0,
        tabs: tabId === undefined ? pause.tabs : pause.tabs.filter((id) => id !== tabId),
      });
      return ok({ paused: false });
    }

    /* ------------------------------ rule modes ------------------------------ */

    case 'ui/set-rule-mode': {
      if (!isCorrectionRuleId(message.ruleId)) return err('Unknown rule.');
      if (!RULE_CONTROL_MODES.includes(message.mode)) return err('Unknown rule mode.');
      const settings = await store.getSettings();
      if (message.origin) {
        const siteRuleModes = { ...settings.siteRuleModes };
        const forSite = { ...(siteRuleModes[message.origin] ?? {}) };
        forSite[message.ruleId] = message.mode;
        siteRuleModes[message.origin] = forSite;
        await store.updateSettings({ siteRuleModes });
      } else {
        await store.updateSettings({
          ruleModes: { ...settings.ruleModes, [message.ruleId]: message.mode },
        });
      }
      broadcastConfig();
      return ok({ ruleId: message.ruleId, mode: message.mode });
    }

    /* ------------------------------ vocabulary ------------------------------ */

    case 'ui/get-vocabulary': {
      const learning = await store.getLearning();
      return ok({ vocabulary: learning.vocabulary });
    }

    case 'ui/add-vocabulary': {
      const original = message.entry.original.trim();
      if (!original) return err('That entry has no text.');
      if (original.length > 128) return err('That entry is too long.');
      const entry = await store.mutateLearning((data) =>
        upsertEntry(data.vocabulary, {
          kind: message.entry.kind,
          original,
          ...(message.entry.replacement ? { replacement: message.entry.replacement.trim() } : {}),
          scope: message.entry.scope,
          ...(message.entry.note ? { note: message.entry.note } : {}),
        }),
      );
      broadcastConfig();
      return ok({ entry });
    }

    case 'ui/remove-vocabulary': {
      const removed = await store.mutateLearning((data) =>
        removeEntry(data.vocabulary, message.id),
      );
      broadcastConfig();
      return ok({ removed });
    }

    case 'ui/export-vocabulary': {
      const learning = await store.getLearning();
      return ok({ bundle: exportVocabulary(learning.vocabulary) });
    }

    case 'ui/import-vocabulary': {
      if (message.payload.length > 2_000_000) {
        return err('That vocabulary file is larger than the 2 MB safety limit.');
      }
      let parsed;
      try {
        parsed = parseVocabularyBundle(JSON.parse(message.payload));
      } catch (e) {
        return err(e instanceof SyntaxError ? 'That file is not valid JSON.' : e);
      }
      await store.mutateLearning((data) => {
        // Merge rather than replace: an import should add the user's words, not
        // silently discard the ones they added on this device.
        for (const entry of parsed.entries) upsertEntry(data.vocabulary, entry);
      });
      broadcastConfig();
      return ok({ imported: parsed.entries.length });
    }

    /* ------------------------------ shadow mode ------------------------------ */

    case 'ui/get-shadow-log': {
      const log = await loadShadowLog();
      const response: ShadowLogResponse = {
        observations: log.observations,
        summary: summariseShadowLog(log),
      };
      return ok(response);
    }

    case 'ui/clear-shadow-log': {
      shadowLog = structuredClone(EMPTY_SHADOW_LOG);
      shadowLoaded = true;
      try {
        await store.setRaw({ [SHADOW_LOG_KEY]: shadowLog });
      } catch {
        /* the in-memory clear already took effect */
      }
      return ok({ cleared: true });
    }

    /* ------------------------------ diagnostics ------------------------------ */

    case 'ui/diagnostics': {
      const settings = await store.getSettings();
      let tab: chrome.tabs.Tab | undefined;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        tab = undefined;
      }
      const state = tab?.id !== undefined ? entryForTab(tab.id)?.state ?? null : null;
      const origin = state?.origin ?? originOf(tab?.url) ?? '';
      const profile = profileFor(settings, origin);
      const harperLive = harper?.status() ?? null;
      const metrics = (await store.getRaw<PersistedHarperMetrics>(HARPER_METRICS_KEY)) ?? {
        setups: 0,
        lastSetupMs: 0,
        lintCount: 0,
        totalLintMs: 0,
      };
      const index = await readIndex();
      const log = await loadShadowLog();

      const report: DiagnosticsReport = {
        extensionVersion: chrome.runtime.getManifest().version,
        schemaVersion: SCHEMA_VERSION,
        dictionary: {
          words: DICTIONARY_METADATA.wordCount,
          source: `${DICTIONARY_METADATA.sourceName} ${DICTIONARY_METADATA.sourceVariant}`,
          version: DICTIONARY_METADATA.sourceVersion,
          sha256: DICTIONARY_METADATA.contentSha256,
        },
        harper: {
          enabled: settings.harperEnabled,
          ready: harperLive?.ready ?? false,
          dialect: settings.harperDialect,
          rules: harperLive?.availableRules.length ?? 0,
          setups: metrics.setups,
          lastSetupMs: metrics.lastSetupMs,
          lintCount: metrics.lintCount,
          averageLintMs: metrics.lintCount > 0 ? metrics.totalLintMs / metrics.lintCount : 0,
        },
        ai: {
          configured: false,
          ready: false,
          provider: 'none',
          version: '-',
        },
        site: {
          origin,
          granted: tab?.url ? await hasAccessTo(tab.url) : false,
          enabled: origin ? settings.siteOverrides[origin] !== 'off' : true,
          profileId: profile.id,
          profileLabel: profile.label,
        },
        field: {
          present: state?.hasField ?? false,
          kind: state?.session?.fieldKind ?? '-',
          enabled: state?.fieldEnabled ?? true,
        },
        history: {
          enabled: settings.persistSessions,
          persisted: settings.persistSessions && !settings.memoryOnlyOrigins.includes(origin),
          sessions: index.length,
          records: index.reduce((sum, entry) => sum + entry.total, 0),
          retentionDays: settings.sessionRetentionDays,
        },
        lastAnalysisMs,
        providerErrors: [...providerErrors],
        shadow: { mode: settings.shadowMode, observations: log.observations.length },
        contextWeights: {
          frequency: DEFAULT_WEIGHTS.frequency,
          partOfSpeech: DEFAULT_WEIGHTS.partOfSpeech,
          documentReuse: DEFAULT_WEIGHTS.documentReuse,
        },
        storageError: store.lastStorageError(),
        generatedAt: Date.now(),
      };
      return ok({ report });
    }
  }
}

function isContentMessage(m: unknown): m is ContentMessage {
  return typeof m === 'object' && m !== null && typeof (m as { kind?: unknown }).kind === 'string'
    && (m as { kind: string }).kind.startsWith('content/');
}

function isUiMessage(m: unknown): m is UiMessage {
  return typeof m === 'object' && m !== null && typeof (m as { kind?: unknown }).kind === 'string'
    && (m as { kind: string }).kind.startsWith('ui/');
}

/** Registers every background listener. Called once from the service worker. */
export function installRouter(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const run = async (): Promise<Result<unknown>> => {
      try {
        if (isContentMessage(message)) return await handleContent(message, sender);
        if (isUiMessage(message)) return await handleUi(message);
        return err(`Unknown message: ${String((message as { kind?: string })?.kind)}`);
      } catch (e) {
        console.error('[autocorrect] message handler failed:', e);
        return err(e);
      }
    };
    run().then(sendResponse);
    return true; // async response
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    setActiveTab(tabId);
    void refreshBadgeForActiveTab();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    dropTab(tabId);
    forgetTab(tabId);
    // "Pause until this tab closes" has to end when it does, or the pause
    // becomes permanent for a tab id Chrome will eventually reuse.
    void (async () => {
      const pause = await currentPause();
      if (!pause.tabs.includes(tabId)) return;
      await store.updateSettings({
        pause: { until: pause.until, tabs: pause.tabs.filter((id) => id !== tabId) },
      });
      broadcastConfig();
    })();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // A navigation invalidates the cached state until the new page reports in.
    if (changeInfo.status === 'loading') tabs.delete(tabId);
    if (changeInfo.status === 'complete') void refreshBadgeForActiveTab();
  });

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      setActiveTab(tab?.id);
    } catch {
      /* window may already be gone */
    }
  });

  chrome.permissions.onAdded.addListener(() => void syncContentScripts());
  chrome.permissions.onRemoved.addListener((permissions) => {
    void (async () => {
      await syncContentScripts();
      const patterns = permissions.origins ?? [];
      if (patterns.length === 0) return;
      tabs.clear();
      pushPanelState();
      await broadcastToEveryTab({ kind: 'bg/access-revoked', patterns });
      await refreshActiveTab();
    })();
  });

  store.onChange(() => broadcastConfig());
}

async function broadcastToEveryTab(message: BackgroundMessage): Promise<void> {
  try {
    const openTabs = await chrome.tabs.query({});
    await Promise.all(
      openTabs
        .map((tab) => tab.id)
        .filter((id): id is number => id !== undefined)
        .map((id) => sendToTab(id, message)),
    );
  } catch {
    // Tabs may close while a privacy command is being broadcast. Stored data
    // has already been handled; remaining live tabs will be rechecked on focus.
  }
}

/** Exposed for the service worker's startup housekeeping. */
export async function housekeeping(): Promise<void> {
  const settings: Settings = await store.getSettings();
  await pruneExpired(settings);
  await store.mutateLearning((data) => prunePending(data));
}

export async function refreshActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setActiveTab(tab?.id);
    if (tab?.url && tab.id !== undefined && (await hasAccessTo(tab.url))) {
      void sendToTab(tab.id, { kind: 'bg/request-state' });
    }
  } catch {
    /* no window available (e.g. worker woke without UI) */
  }
}

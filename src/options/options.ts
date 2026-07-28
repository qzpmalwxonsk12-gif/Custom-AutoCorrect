/** Options page: settings, dictionary, rules, site access and data management. */
import { sendToRuntime, type LearningMutation } from '../shared/messages.js';
import {
  DEFAULT_SETTINGS,
  EMPTY_LEARNING,
  type CorrectionRule,
  type LearningData,
  type ReviewAction,
  type Settings,
} from '../shared/types.js';
import type { SessionIndexEntry } from '../storage/types.js';
import {
  applyTheme,
  renderProfiles,
  renderRuleControls,
  renderVocabulary,
  wireDiagnosticsLinks,
  wireProfiles,
  wireShadow,
  wireVocabulary,
  type OptionsContext,
} from './options-advanced.js';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const statusEl = must('status');
let settings: Settings = { ...DEFAULT_SETTINGS };
let learning: LearningData = structuredClone(EMPTY_LEARNING);
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(message: string, isError = false): void {
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = undefined;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  if (message && !isError) {
    statusTimer = window.setTimeout(() => {
      statusEl.textContent = '';
      statusTimer = undefined;
    }, 2500);
  }
}

/* ------------------------------ settings binding ------------------------------ */

type SettingKey = keyof Settings;

const STALE_BACKGROUND_MESSAGE =
  'The extension background is running an older build, so this setting was not saved. '
  + 'Open chrome://extensions and click Reload on Personal Autocorrect, then try again.';

/**
 * Adopts settings from the background, merged over the defaults so a missing
 * key can never blank the form.
 *
 * Unpacked extensions re-read option pages from disk on every open, but keep
 * the *previously registered* service worker until it is reloaded. A newer page
 * talking to an older worker gets settings with the newest keys stripped, which
 * used to look like "the toggle silently refuses to stay on". Returns false
 * when that skew is detected so the caller can say so out loud.
 */
function adoptSettings(incoming: Settings | undefined): boolean {
  const fresh = (incoming ?? {}) as Partial<Settings>;
  settings = { ...DEFAULT_SETTINGS, ...fresh };
  // harperEnabled is the newest key; a background that omits it predates it.
  return typeof fresh.harperEnabled === 'boolean';
}

const LIST_SETTINGS = new Set<SettingKey>(['denylist', 'memoryOnlyOrigins']);

function bindSettings(): void {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]'),
  );
  for (const input of inputs) {
    input.addEventListener('change', () => void saveFrom(input));
    if (input instanceof HTMLInputElement && input.type === 'range') {
      input.addEventListener('input', () => renderThresholdLabels());
    }
  }
}

async function saveFrom(input: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
  const key = input.dataset.setting as SettingKey | undefined;
  if (!key) return;
  let value: unknown;

  if (input instanceof HTMLInputElement && input.type === 'checkbox') value = input.checked;
  else if (input instanceof HTMLInputElement && input.type === 'number') value = Number(input.value);
  else if (input instanceof HTMLInputElement && input.type === 'range') value = Number(input.value);
  else if (LIST_SETTINGS.has(key)) {
    value = input.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } else value = input.value;

  if (typeof value === 'number' && Number.isNaN(value)) {
    setStatus('That value must be a number.', true);
    return;
  }
  const res = await sendToRuntime<{ settings: Settings }>({
    kind: 'ui/set-settings',
    patch: { [key]: value } as Partial<Settings>,
  });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  const current = adoptSettings(res.data.settings);
  // Reflect canonicalised origins, bounded numbers, and any rejected malformed
  // input immediately so the form never implies that an unsaved privacy rule
  // is active.
  fillSettings();
  setStatus(current ? 'Saved.' : STALE_BACKGROUND_MESSAGE, !current);
}

function renderThresholdLabels(): void {
  const auto = document.querySelector<HTMLInputElement>('[data-setting="autocorrectThreshold"]');
  const sugg = document.querySelector<HTMLInputElement>('[data-setting="suggestionThreshold"]');
  must('autocorrect-value').textContent = `${Math.round(Number(auto?.value ?? 0) * 100)}%`;
  must('suggestion-value').textContent = `${Math.round(Number(sugg?.value ?? 0) * 100)}%`;

  const punctAuto = document.querySelector<HTMLInputElement>(
    '[data-setting="punctuationAutomaticThreshold"]',
  );
  const punctSugg = document.querySelector<HTMLInputElement>(
    '[data-setting="punctuationSuggestionThreshold"]',
  );
  must('punctuation-automatic-value').textContent =
    `${Math.round(Number(punctAuto?.value ?? 0) * 100)}%`;
  must('punctuation-suggestion-value').textContent =
    `${Math.round(Number(punctSugg?.value ?? 0) * 100)}%`;
}

const PUNCTUATION_RULE_LABELS: Record<string, string> = {
  'punctuation:introductory-clause': 'Introductory clause',
  'punctuation:introductory-participle': 'Introductory phrase',
  'punctuation:direct-address': 'Direct address',
  'punctuation:simple-list': 'Simple list',
  'punctuation:independent-clause': 'Joined clauses',
  'punctuation:nonrestrictive-clause': 'Non-essential clause',
};

function renderPunctuationStats(): void {
  const block = must('punctuation-stats-block');
  const body = must('punctuation-stats');
  body.textContent = '';
  const entries = Object.entries(learning.punctuationStats ?? {}).sort(
    (a, b) => b[1].shown - a[1].shown,
  );
  block.hidden = entries.length === 0;
  for (const [ruleId, stats] of entries) {
    const tr = document.createElement('tr');
    const cells = [
      PUNCTUATION_RULE_LABELS[ruleId] ?? ruleId,
      String(stats.shown),
      String(stats.accepted),
      String(stats.rejected),
      String(stats.reverted),
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function fillSettings(): void {
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]'),
  )) {
    const key = input.dataset.setting as SettingKey;
    const value = settings[key];
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (Array.isArray(value)) {
      input.value = value.join('\n');
    } else {
      input.value = String(value ?? '');
    }
  }
  renderThresholdLabels();
  renderShortcuts();
  renderHarper();
}

/* ------------------------------ shortcuts ------------------------------ */

const SHORTCUT_LABELS: Record<ReviewAction, string> = {
  keep: 'Keep correction',
  revert: 'Revert correction',
  next: 'Next',
  previous: 'Previous',
  dictionary: 'Add to dictionary',
  never: 'Never apply rule',
  exit: 'Exit review',
};

function renderShortcuts(): void {
  const host = must('shortcuts');
  host.textContent = '';
  for (const action of Object.keys(SHORTCUT_LABELS) as ReviewAction[]) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = SHORTCUT_LABELS[action];
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = settings.reviewShortcuts[action];
    input.title = 'Click, then press the key you want';
    input.addEventListener('keydown', async (event) => {
      event.preventDefault();
      const code = event.code;
      if (!code) return;
      if (['Tab', 'Enter', 'Space'].includes(code)) {
        setStatus('Tab, Enter, and Space are reserved for navigation and controls.', true);
        return;
      }
      const duplicate = (Object.keys(settings.reviewShortcuts) as ReviewAction[]).find(
        (other) => other !== action && settings.reviewShortcuts[other] === code,
      );
      if (duplicate) {
        setStatus(`That key is already assigned to “${SHORTCUT_LABELS[duplicate]}”.`, true);
        return;
      }
      const next = { ...settings.reviewShortcuts, [action]: code };
      const res = await sendToRuntime<{ settings: Settings }>({
        kind: 'ui/set-settings',
        patch: { reviewShortcuts: next },
      });
      if (!res.ok) {
        setStatus(res.error, true);
        return;
      }
      settings = res.data.settings;
      input.value = code;
      setStatus('Shortcut saved.');
    });
    label.append(span, input);
    host.appendChild(label);
  }
}

/* ------------------------------ learning data ------------------------------ */

async function mutate(mutation: LearningMutation): Promise<void> {
  const res = await sendToRuntime<{ learning: LearningData }>({
    kind: 'ui/mutate-learning',
    mutation,
  });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  learning = res.data.learning;
  renderLearning();
  setStatus('Saved.');
}

function renderDictionary(): void {
  const host = must('dictionary');
  host.textContent = '';
  if (learning.dictionary.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Empty';
    host.appendChild(li);
    return;
  }
  for (const word of [...learning.dictionary].sort()) {
    const li = document.createElement('li');
    li.append(document.createTextNode(word));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = `Remove ${word}`;
    remove.addEventListener('click', () => void mutate({ type: 'remove-dictionary', word }));
    li.appendChild(remove);
    host.appendChild(li);
  }
}

function renderRules(): void {
  const body = must('rules');
  body.textContent = '';
  const rules = Object.values(learning.rules).sort(
    (a, b) => (b.lastApplied ?? b.firstSeen) - (a.lastApplied ?? a.firstSeen),
  );
  must('rules-empty').hidden = rules.length > 0;

  for (const rule of rules) {
    body.appendChild(ruleRow(rule));
  }
}

function ruleRow(rule: CorrectionRule): HTMLElement {
  const tr = document.createElement('tr');

  const correction = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = `${rule.original} → ${rule.replacement}`;
  correction.appendChild(code);
  if (learning.blockedPairs.includes(rule.id)) {
    const tag = document.createElement('span');
    tag.textContent = ' blocked';
    tag.style.color = 'var(--danger)';
    correction.appendChild(tag);
  }

  const mode = document.createElement('td');
  const select = document.createElement('select');
  for (const value of ['autocorrect', 'suggestion', 'blocked'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = rule.mode === value;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const value = select.value as CorrectionRule['mode'];
    if (value === 'blocked') void mutate({ type: 'set-rule-mode', ruleId: rule.id, mode: value });
    else if (learning.blockedPairs.includes(rule.id)) {
      void mutate({ type: 'unblock', ruleId: rule.id, mode: value });
    }
    else void mutate({ type: 'set-rule-mode', ruleId: rule.id, mode: value });
  });
  mode.appendChild(select);

  const cells = [
    String(rule.applied),
    String(rule.accepted),
    String(rule.reverted),
    `${Math.round(rule.confidence * 100)}%`,
    rule.source,
  ].map((text) => {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  });

  const actions = document.createElement('td');
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent =
    rule.source === 'user-created' || rule.source === 'personal-learning'
      ? 'Delete'
      : 'Reset statistics';
  del.addEventListener('click', () => void mutate({ type: 'delete-rule', ruleId: rule.id }));
  actions.appendChild(del);

  tr.append(correction, mode, ...cells, actions);
  return tr;
}

function renderPending(): void {
  const host = must('pending');
  host.textContent = '';
  const entries = Object.values(learning.pending);
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'None';
    host.appendChild(li);
    return;
  }
  for (const p of entries.sort((a, b) => b.count - a.count)) {
    const li = document.createElement('li');
    li.textContent = `${p.original} → ${p.replacement} (${p.count}×)`;
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.textContent = '+';
    promote.title = 'Create this rule now';
    promote.addEventListener('click', () =>
      void mutate({ type: 'create-rule', original: p.original, replacement: p.replacement }),
    );
    li.appendChild(promote);
    host.appendChild(li);
  }
}

function renderLearning(): void {
  renderDictionary();
  renderRules();
  renderPending();
  renderHarper();
  renderPunctuationStats();
}

/* ------------------------------ Harper grammar engine ------------------------------ */

interface HarperStatusPayload {
  enabled: boolean;
  ready: boolean;
  disabledRules: string[];
  metrics: { setups: number; lastSetupMs: number; lintCount: number; totalLintMs: number };
}

function wireHarper(): void {
  const dialect = must<HTMLSelectElement>('harper-dialect');
  dialect.addEventListener('change', async () => {
    const res = await sendToRuntime<{ settings: Settings }>({
      kind: 'ui/set-settings',
      patch: { harperDialect: dialect.value as Settings['harperDialect'] },
    });
    if (!res.ok) {
      setStatus(res.error, true);
      return;
    }
    const current = adoptSettings(res.data.settings);
    dialect.value = settings.harperDialect;
    setStatus(current ? 'Saved.' : STALE_BACKGROUND_MESSAGE, !current);
  });
}

function renderHarper(): void {
  must<HTMLSelectElement>('harper-dialect').value = settings.harperDialect;
  renderHarperDisabledRules();
  renderHarperStats();
  void renderHarperStatus();
}

function renderHarperDisabledRules(): void {
  const block = must('harper-disabled-block');
  const host = must('harper-disabled-rules');
  host.textContent = '';
  const rules = settings.harperDisabledRules;
  block.hidden = rules.length === 0;
  for (const rule of [...rules].sort()) {
    const li = document.createElement('li');
    li.append(document.createTextNode(rule));
    const enable = document.createElement('button');
    enable.type = 'button';
    enable.textContent = '✕';
    enable.title = `Re-enable ${rule}`;
    enable.setAttribute('aria-label', `Re-enable Harper rule ${rule}`);
    enable.addEventListener('click', async () => {
      const res = await sendToRuntime<{ settings: Settings }>({
        kind: 'ui/set-settings',
        patch: { harperDisabledRules: settings.harperDisabledRules.filter((r) => r !== rule) },
      });
      if (!res.ok) {
        setStatus(res.error, true);
        return;
      }
      settings = res.data.settings;
      renderHarperDisabledRules();
      setStatus(`Rule ${rule} re-enabled.`);
    });
    li.appendChild(enable);
    host.appendChild(li);
  }
}

function renderHarperStats(): void {
  const block = must('harper-stats-block');
  const body = must('harper-stats');
  body.textContent = '';
  const entries = Object.entries(learning.grammarStats).sort(
    (a, b) => b[1].offered - a[1].offered,
  );
  block.hidden = entries.length === 0;
  for (const [rule, stats] of entries.slice(0, 50)) {
    const tr = document.createElement('tr');
    for (const text of [rule, String(stats.offered), String(stats.accepted), String(stats.rejected)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function renderHarperStatus(): Promise<void> {
  const line = must('harper-status-line');
  const res = await sendToRuntime<HarperStatusPayload>({ kind: 'ui/harper-status' });
  if (!res.ok) {
    line.textContent = '';
    return;
  }
  const s = res.data;
  if (!s.enabled) {
    line.textContent = 'Harper is off. Nothing is loaded until you enable it.';
    return;
  }
  const m = s.metrics;
  const avg = m.lintCount > 0 ? Math.round(m.totalLintMs / m.lintCount) : 0;
  const parts = [s.ready ? 'Engine loaded.' : 'Engine loads on first use.'];
  if (m.setups > 0) {
    parts.push(
      `${m.setups} initialisation${m.setups === 1 ? '' : 's'} so far (last took ${m.lastSetupMs} ms).`,
    );
  }
  if (m.lintCount > 0) parts.push(`${m.lintCount} paragraphs checked, ~${avg} ms each.`);
  line.textContent = parts.join(' ');
}

/* ------------------------------ site access ------------------------------ */

async function renderOrigins(): Promise<void> {
  const host = must('origins');
  host.textContent = '';
  let origins: string[] = [];
  try {
    origins = (await chrome.permissions.getAll()).origins ?? [];
  } catch {
    origins = [];
  }
  if (origins.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No sites enabled yet - use the extension icon on a page.';
    host.appendChild(li);
    return;
  }
  for (const origin of origins) {
    const li = document.createElement('li');
    li.append(document.createTextNode(origin));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.title = `Remove access to ${origin}`;
    remove.addEventListener('click', async () => {
      try {
        const removed = await chrome.permissions.remove({ origins: [origin] });
        setStatus(
          removed
            ? `Access to ${origin} removed.`
            : `Chrome did not remove access to ${origin}.`,
          !removed,
        );
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), true);
      }
      void renderOrigins();
    });
    li.appendChild(remove);
    host.appendChild(li);
  }
}

/* ------------------------------ data management ------------------------------ */

async function renderDataSummary(): Promise<void> {
  const res = await sendToRuntime<{ sessions: SessionIndexEntry[] }>({ kind: 'ui/list-sessions' });
  const count = res.ok ? res.data.sessions.length : 0;
  const rules = Object.keys(learning.rules).length;
  must('data-summary').textContent =
    `${count} stored correction session${count === 1 ? '' : 's'}, ` +
    `${rules} rule${rules === 1 ? '' : 's'}, ${learning.dictionary.length} dictionary word${learning.dictionary.length === 1 ? '' : 's'}.`;
}

function wireData(): void {
  must('export').addEventListener('click', async () => {
    if (
      !confirm(
        'Exported JSON is plaintext and may include correction words, context, page details, and site settings. Continue?',
      )
    ) {
      return;
    }
    const res = await sendToRuntime<{ bundle: unknown }>({ kind: 'ui/export' });
    if (!res.ok) {
      setStatus(res.error, true);
      return;
    }
    const blob = new Blob([JSON.stringify(res.data.bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personal-autocorrect-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported.');
  });

  const file = must<HTMLInputElement>('import-file');
  must('import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      if (
        !confirm(
          'Importing replaces your current settings, learned rules, and correction history. Only import a file you trust. Continue?',
        )
      ) {
        return;
      }
      const text = await chosen.text();
      const res = await sendToRuntime<{ rules: number; sessions: number }>({
        kind: 'ui/import',
        payload: text,
      });
      if (!res.ok) {
        setStatus(res.error, true);
        return;
      }
      setStatus(`Imported ${res.data.rules} rules and ${res.data.sessions} history sessions.`);
      await loadAll();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      file.value = '';
    }
  });

  must('clear-sessions').addEventListener('click', async () => {
    if (!confirm('Delete all stored correction history? Learned rules are kept.')) return;
    const res = await sendToRuntime<{ removed: number }>({ kind: 'ui/clear-sessions' });
    setStatus(res.ok ? `Deleted ${res.data.removed} sessions.` : res.error, !res.ok);
    void renderDataSummary();
  });

  must('reset').addEventListener('click', async () => {
    if (!confirm('Delete every learned rule, dictionary word and block? This cannot be undone.')) return;
    const res = await sendToRuntime({ kind: 'ui/reset-learning' });
    if (!res.ok) {
      setStatus(res.error, true);
      return;
    }
    setStatus('Learned data reset.');
    await loadAll();
  });

  must('clear-pending').addEventListener('click', () => void mutate({ type: 'clear-pending' }));
}

function wireForms(): void {
  const dictForm = must<HTMLFormElement>('dictionary-form');
  dictForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = must<HTMLInputElement>('dictionary-input');
    const word = input.value.trim();
    if (!word) return;
    if (/\s/.test(word)) {
      setStatus('Dictionary entries must be a single word.', true);
      return;
    }
    input.value = '';
    void mutate({ type: 'add-dictionary', word });
  });

  const ruleForm = must<HTMLFormElement>('rule-form');
  ruleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const original = must<HTMLInputElement>('rule-original').value.trim();
    const replacement = must<HTMLInputElement>('rule-replacement').value.trim();
    if (!original || !replacement) {
      setStatus('Both sides of the rule are required.', true);
      return;
    }
    if (original.toLowerCase() === replacement.toLowerCase()) {
      setStatus('The two sides must differ.', true);
      return;
    }
    if (/\s/.test(original)) {
      setStatus('The typed side must be one word. Replacements may contain spaces.', true);
      return;
    }
    if (original.length > 24 || replacement.length > 80) {
      setStatus('Rules are limited to a 24-character word and an 80-character replacement.', true);
      return;
    }
    must<HTMLInputElement>('rule-original').value = '';
    must<HTMLInputElement>('rule-replacement').value = '';
    void mutate({ type: 'create-rule', original, replacement });
  });
}

/* ------------------------------ boot ------------------------------ */

async function loadAll(): Promise<void> {
  const settingsRes = await sendToRuntime<{ settings: Settings; storageError?: string | null }>({
    kind: 'ui/get-settings',
  });
  if (settingsRes.ok) {
    const current = adoptSettings(settingsRes.data.settings);
    if (settingsRes.data.storageError) setStatus(settingsRes.data.storageError, true);
    else if (!current) setStatus(STALE_BACKGROUND_MESSAGE, true);
  }
  const learningRes = await sendToRuntime<{ learning: LearningData }>({ kind: 'ui/get-learning' });
  if (learningRes.ok) learning = learningRes.data.learning;
  fillSettings();
  renderLearning();
  applyTheme(settings.theme);
  renderProfiles(advancedContext);
  renderRuleControls(advancedContext);
  renderVocabulary(advancedContext);
  await renderOrigins();
  await renderDataSummary();
}

/** Shared seam for the advanced sections; they never own settings state. */
const advancedContext: OptionsContext = {
  settings: () => settings,
  learning: () => learning,
  setStatus,
  reload: loadAll,
};

if (location.hash === '#welcome') must('welcome').hidden = false;
bindSettings();
wireForms();
wireData();
wireHarper();
wireProfiles(advancedContext);
wireShadow(advancedContext);
wireVocabulary(advancedContext);
wireDiagnosticsLinks();
void loadAll().catch((e) => setStatus(e instanceof Error ? e.message : String(e), true));

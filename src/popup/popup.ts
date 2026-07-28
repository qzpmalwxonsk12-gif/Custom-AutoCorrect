/**
 * Toolbar popup: what the extension is doing right now, and the controls that
 * change it without a trip to the settings page.
 *
 * This is also where host permission is requested - it must happen in a user
 * gesture, and the popup is the only surface where that is guaranteed.
 */
import { sendToRuntime, type ToolbarStatus } from '../shared/messages.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.js';
import { fieldKey } from '../shared/effective-settings.js';
import { formatDuration } from '../shared/status.js';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  enabled: must<HTMLInputElement>('enabled'),
  statusBlock: must('status-block'),
  statusLabel: must('status-label'),
  statusDetail: must('status-detail'),
  site: must('site'),
  siteDetail: must('site-detail'),
  grant: must<HTMLButtonElement>('grant'),
  factCorrections: must('fact-corrections'),
  factPending: must('fact-pending'),
  factHistory: must('fact-history'),
  factProfile: must('fact-profile'),
  factHarper: must('fact-harper'),
  factAi: must('fact-ai'),
  shadowNote: must('shadow-note'),
  pauseRow: must('pause-row'),
  pause5: must<HTMLButtonElement>('pause-5'),
  pause30: must<HTMLButtonElement>('pause-30'),
  pauseTab: must<HTMLButtonElement>('pause-tab'),
  resume: must<HTMLButtonElement>('resume'),
  disableField: must<HTMLButtonElement>('disable-field'),
  disableSite: must<HTMLButtonElement>('disable-site'),
  openPanel: must<HTMLButtonElement>('open-panel'),
  startReview: must<HTMLButtonElement>('start-review'),
  options: must<HTMLButtonElement>('options'),
  diagnostics: must<HTMLButtonElement>('diagnostics'),
  status: must('status'),
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let status: ToolbarStatus | null = null;
let tab: chrome.tabs.Tab | undefined;
let pattern: string | null = null;

function setStatus(text: string, isError = false): void {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function patternFor(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  const settingsRes = await sendToRuntime<{ settings: Settings }>({ kind: 'ui/get-settings' });
  if (settingsRes.ok) settings = settingsRes.data.settings;

  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = undefined;
  }
  pattern = patternFor(tab?.url);

  const res = await sendToRuntime<{ status: ToolbarStatus }>({ kind: 'ui/toolbar-status' });
  status = res.ok ? res.data.status : null;
  render();
}

function render(): void {
  els.enabled.checked = settings.enabled;

  if (!status) {
    els.statusLabel.textContent = 'Unavailable';
    els.statusDetail.textContent = 'The extension background did not respond.';
    els.statusBlock.className = 'status is-error';
    return;
  }

  els.statusBlock.className = `status is-${status.state}`;
  els.statusLabel.textContent = status.label;
  els.statusDetail.textContent = status.detail;

  if (!pattern) {
    els.site.textContent = 'Unsupported page';
    els.siteDetail.textContent = 'Autocorrect only runs on http(s) pages.';
    for (const button of [
      els.openPanel,
      els.startReview,
      els.disableField,
      els.disableSite,
      els.pause5,
      els.pause30,
      els.pauseTab,
    ]) {
      button.disabled = true;
    }
    return;
  }

  els.site.textContent = status.siteLabel;
  els.grant.hidden = status.siteGranted;
  els.siteDetail.textContent = status.siteGranted
    ? status.hasField
      ? `Editing: ${status.fieldLabel || 'text field'}`
      : 'No text field focused on this page.'
    : 'Not enabled here. Nothing on this page is read until you allow it.';

  els.factCorrections.textContent = String(status.sessionCorrections);
  els.factPending.textContent = String(status.pendingCorrections);
  els.factHistory.textContent = status.historyEnabled ? status.historyDetail : 'Off';
  els.factProfile.textContent = status.profileLabel;
  els.factHarper.textContent = status.harper.detail;
  els.factAi.textContent = status.ai.detail;

  els.shadowNote.hidden = status.shadowMode === 'off';
  els.shadowNote.textContent =
    status.shadowMode === 'all'
      ? 'Shadow mode is on: nothing is being corrected, only recorded.'
      : 'Shadow mode: experimental rules are recorded instead of applied.';

  const paused = status.pauseRemainingMs > 0 || status.pausedForTab;
  els.resume.hidden = !paused;
  els.pauseRow.hidden = paused;
  if (status.pauseRemainingMs > 0) {
    els.resume.textContent = `Resume now (${formatDuration(status.pauseRemainingMs)} left)`;
  } else {
    els.resume.textContent = 'Resume now';
  }

  els.disableField.disabled = !status.hasField;
  els.disableField.textContent = status.fieldEnabled ? 'For this field' : 'Re-enable this field';
  els.disableSite.textContent = status.siteEnabled
    ? 'For this website'
    : 'Re-enable this website';

  els.openPanel.disabled = !status.siteGranted;
  els.startReview.disabled = status.pendingCorrections === 0;
}

async function refresh(): Promise<void> {
  const res = await sendToRuntime<{ status: ToolbarStatus }>({ kind: 'ui/toolbar-status' });
  if (res.ok) status = res.data.status;
  const settingsRes = await sendToRuntime<{ settings: Settings }>({ kind: 'ui/get-settings' });
  if (settingsRes.ok) settings = settingsRes.data.settings;
  render();
}

/* ------------------------------ wiring ------------------------------ */

els.enabled.addEventListener('change', async () => {
  const res = await sendToRuntime({
    kind: 'ui/set-settings',
    patch: { enabled: els.enabled.checked },
  });
  if (!res.ok) {
    setStatus('Could not save that setting.', true);
    return;
  }
  setStatus('');
  await refresh();
});

els.grant.addEventListener('click', async () => {
  if (!pattern || !tab?.id) return;
  let allowed = false;
  try {
    allowed = await chrome.permissions.request({ origins: [pattern] });
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    return;
  }
  if (!allowed) {
    setStatus('Permission was declined.', true);
    return;
  }
  try {
    // Registration only affects future loads; inject into the open tab now.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content/content-script.js'],
    });
  } catch (e) {
    console.warn('injection failed', e);
    setStatus(
      'Access was granted, but this open page could not be started. Reload the page and try again.',
      true,
    );
    return;
  }
  window.close();
});

async function pause(options: { minutes?: number; untilTabClose?: boolean }): Promise<void> {
  const res = await sendToRuntime({
    kind: 'ui/pause',
    ...(options.minutes !== undefined ? { minutes: options.minutes } : {}),
    ...(options.untilTabClose ? { untilTabClose: true } : {}),
    ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
  });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  setStatus('');
  await refresh();
}

els.pause5.addEventListener('click', () => void pause({ minutes: 5 }));
els.pause30.addEventListener('click', () => void pause({ minutes: 30 }));
els.pauseTab.addEventListener('click', () => void pause({ untilTabClose: true }));

els.resume.addEventListener('click', async () => {
  const res = await sendToRuntime({ kind: 'ui/resume' });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  setStatus('');
  await refresh();
});

els.disableField.addEventListener('click', async () => {
  if (!status?.hasField || !status.fieldId) return;
  const key = fieldKey(status.origin, status.fieldId);
  const disabledFields = status.fieldEnabled
    ? [...settings.disabledFields, key]
    : settings.disabledFields.filter((entry) => entry !== key);
  const res = await sendToRuntime({ kind: 'ui/set-settings', patch: { disabledFields } });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  await refresh();
});

els.disableSite.addEventListener('click', async () => {
  if (!status?.origin) return;
  const overrides = { ...settings.siteOverrides };
  if (overrides[status.origin] === 'off') delete overrides[status.origin];
  else overrides[status.origin] = 'off';
  const res = await sendToRuntime({ kind: 'ui/set-settings', patch: { siteOverrides: overrides } });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  await refresh();
});

els.openPanel.addEventListener('click', async () => {
  if (tab?.id === undefined) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
});

els.startReview.addEventListener('click', async () => {
  const res = await sendToRuntime({ kind: 'ui/command', command: { type: 'start-review' } });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  if (tab?.id !== undefined) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {
      /* panel may already be open */
    }
  }
  window.close();
});

els.options.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

els.diagnostics.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics/diagnostics.html') });
  window.close();
});

void load().catch((e) => setStatus(e instanceof Error ? e.message : String(e), true));

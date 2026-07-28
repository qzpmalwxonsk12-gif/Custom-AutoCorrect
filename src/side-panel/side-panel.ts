/** Side panel: correction history, filters, search and guided review. */
import { filterRecords, groupRecords, type FilterKey } from '../history/correction-history.js';
import {
  sendToRuntime,
  type PanelCommand,
  type PanelMessage,
  type PanelState,
  type Result,
} from '../shared/messages.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.js';
import { CorrectionList, type ItemAction } from './correction-list.js';
import { ReviewMode } from './review-mode.js';

const FILTERS: Array<{ key: FilterKey; label: string; title?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'spelling', label: 'Spelling' },
  { key: 'spacing', label: 'Spacing', title: 'Joined and split words' },
  { key: 'punctuation', label: 'Punctuation' },
  { key: 'grammar', label: 'Grammar' },
  { key: 'automatic', label: 'Automatic', title: 'Applied without asking you' },
  { key: 'suggestion', label: 'Suggestion', title: 'Offered, then accepted by you' },
  { key: 'reverted', label: 'Reverted' },
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'unresolved', label: 'Unresolved' },
  {
    key: 'auto-grammar',
    label: 'Auto grammar',
    title: 'Grammar-engine findings applied without asking you',
  },
  { key: 'contextual', label: 'Context' },
  { key: 'personal', label: 'Personal' },
  { key: 'low-confidence', label: 'Low confidence' },
];

/** Said out loud after a scoped action, because the scope is the whole point. */
const CONFIRMATION: Record<string, string> = {
  'always-prefer': 'This replacement will now be preferred everywhere.',
  'suggestion-only': 'That rule will offer suggestions instead of changing text.',
  'disable-rule': 'That rule is now off.',
  'ignore-once': 'Ignored this one.',
  'ignore-in-document': 'Ignored for the rest of this document.',
  'ignore-on-site': 'Ignored on this website from now on.',
};

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  fieldLabel: must('field-label'),
  siteLabel: must('site-label'),
  counts: must('counts'),
  review: must<HTMLButtonElement>('btn-review'),
  acceptAll: must<HTMLButtonElement>('btn-accept-all'),
  revertAllAuto: must<HTMLButtonElement>('btn-revert-all-auto'),
  revertSelected: must<HTMLButtonElement>('btn-revert-selected'),
  clear: must<HTMLButtonElement>('btn-clear'),
  toggleEnabled: must<HTMLInputElement>('toggle-enabled'),
  toggleSite: must<HTMLInputElement>('toggle-site'),
  toggleMarkup: must<HTMLInputElement>('toggle-markup'),
  markupHint: must('markup-hint'),
  scan: must<HTMLButtonElement>('btn-scan'),
  toggleDeepScan: must<HTMLInputElement>('toggle-deep-scan'),
  deepScanPasses: must<HTMLInputElement>('deep-scan-passes'),
  scanHint: must('scan-hint'),
  grouping: must<HTMLSelectElement>('grouping'),
  displayMode: must<HTMLSelectElement>('display-mode'),
  groups: must('groups'),
  privacy: must('privacy-badge'),
  search: must<HTMLInputElement>('search'),
  filters: must('filters'),
  list: must('list'),
  empty: must('empty'),
  sentinel: must('sentinel'),
  status: must('status'),
};

let state: PanelState | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
let filter: FilterKey = 'all';
let query = '';
let selection: string[] = [];

const review = new ReviewMode(
  {
    bar: must('review-bar'),
    progress: must('review-progress'),
    hint: must('review-hint'),
    keep: must<HTMLButtonElement>('review-keep'),
    revert: must<HTMLButtonElement>('review-revert'),
    skip: must<HTMLButtonElement>('review-skip'),
    prev: must<HTMLButtonElement>('review-prev'),
    next: must<HTMLButtonElement>('review-next'),
    exit: must<HTMLButtonElement>('review-exit'),
  },
  () => settings,
  async (command) => (await dispatch(command)).ok,
);

const list = new CorrectionList(els.list, els.sentinel, {
  onAction: (recordId, action) => void handleItemAction(recordId, action),
  onSelectionChange: (ids) => {
    selection = ids;
    els.revertSelected.disabled = ids.length === 0;
    els.revertSelected.textContent = ids.length > 0 ? `Revert ${ids.length} selected` : 'Revert selected';
  },
});

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

async function dispatch(command: PanelCommand): Promise<Result<unknown>> {
  const res = await sendToRuntime<unknown>({ kind: 'ui/command', command });
  if (!res.ok) {
    setStatus(res.error, true);
    return res;
  }
  setStatus('');
  await refresh();
  return res;
}

async function handleItemAction(recordId: string, action: ItemAction): Promise<void> {
  switch (action) {
    case 'jump': {
      const result = await dispatch({ type: 'jump', recordId });
      if (result.ok && isAmbiguousResult(result.data)) {
        showLocationPicker(recordId, result.data.candidates);
      }
      return;
    }
    case 'accept':
      await dispatch({ type: 'decide', recordId, decision: 'keep' });
      return;
    case 'revert':
      await dispatch({ type: 'decide', recordId, decision: 'revert' });
      return;
    case 'keep-no-learn':
      await dispatch({ type: 'decide', recordId, decision: 'keep-no-learn' });
      return;
    case 'lower':
      await dispatch({ type: 'decide', recordId, decision: 'revert-lower-confidence' });
      return;
    case 'never':
      await dispatch({ type: 'decide', recordId, decision: 'revert-never' });
      return;
    case 'context':
      await dispatch({ type: 'decide', recordId, decision: 'revert-context' });
      return;
    case 'dismiss':
      await dispatch({ type: 'dismiss-unresolved', recordId });
      return;
    case 'always-prefer':
    case 'suggestion-only':
    case 'disable-rule':
    case 'ignore-once':
    case 'ignore-in-document':
    case 'ignore-on-site': {
      const result = await dispatch({ type: 'correction-action', recordId, action });
      if (result.ok) setStatus(CONFIRMATION[action]);
      return;
    }
    case 'dictionary': {
      const record = state?.session?.records.find((r) => r.id === recordId);
      if (!record) return;
      if (
        record.status === 'pending' ||
        record.status === 'skipped' ||
        record.status === 'accepted' ||
        record.status === 'auto-accepted'
      ) {
        await dispatch({ type: 'decide', recordId, decision: 'revert-dictionary' });
        return;
      }
      const res = await sendToRuntime({
        kind: 'ui/mutate-learning',
        mutation: { type: 'add-dictionary', word: record.originalText },
      });
      setStatus(
        res.ok ? `“${record.originalText}” will never be corrected again.` : res.error,
        !res.ok,
      );
      return;
    }
    default:
      return;
  }
}

interface AmbiguousCandidate {
  start: number;
  end: number;
  score: number;
  preview: string;
}

function isAmbiguousResult(
  value: unknown,
): value is { ambiguous: true; candidates: AmbiguousCandidate[] } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ambiguous?: unknown; candidates?: unknown };
  return candidate.ambiguous === true && Array.isArray(candidate.candidates);
}

function showLocationPicker(recordId: string, candidates: AmbiguousCandidate[]): void {
  document.querySelector('[data-location-picker]')?.remove();
  const dialog = document.createElement('div');
  dialog.className = 'location-picker';
  dialog.dataset.locationPicker = 'true';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Choose the correction location');

  const heading = document.createElement('strong');
  heading.textContent = 'Which occurrence is this correction?';
  const hint = document.createElement('p');
  hint.textContent = 'Choose a preview. The page will focus and highlight it before any revert.';
  const choices = document.createElement('div');
  choices.className = 'location-choices';

  for (const candidate of candidates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = candidate.preview || `Position ${candidate.start}`;
    button.addEventListener('click', async () => {
      const result = await dispatch({
        type: 'resolve-ambiguous',
        recordId,
        start: candidate.start,
        end: candidate.end,
      });
      if (result.ok) dialog.remove();
    });
    choices.appendChild(button);
  }

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.remove());
  dialog.append(heading, hint, choices, cancel);
  document.body.appendChild(dialog);
  choices.querySelector('button')?.focus();
}

function renderFilters(): void {
  els.filters.textContent = '';
  for (const f of FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = f.label;
    if (f.title) button.title = f.title;
    button.setAttribute('aria-pressed', String(filter === f.key));
    button.addEventListener('click', () => {
      filter = f.key;
      renderFilters();
      renderList();
    });
    els.filters.appendChild(button);
  }
}

function renderCounts(): void {
  els.counts.textContent = '';
  const counts = state?.counts;
  if (!counts) return;
  const chips: Array<[string, number, string]> = [
    ['corrections', counts.total, 'total'],
    ['pending', counts.pending, 'pending'],
    ['accepted', counts.accepted, 'accepted'],
    ['reverted', counts.reverted, 'reverted'],
    ['unresolved', counts.unresolved, 'unresolved'],
  ];
  for (const [label, value, cls] of chips) {
    if (value === 0 && cls !== 'total') continue;
    const chip = document.createElement('span');
    chip.className = `count ${cls}`;
    const b = document.createElement('b');
    b.textContent = String(value);
    chip.append(b, document.createTextNode(` ${label}`));
    els.counts.appendChild(chip);
  }
}

function renderList(): void {
  const records = state?.session?.records ?? [];
  const visible = filterRecords(records, filter, query)
    .filter(
      (r) =>
        !(
          settings.hideAcceptedFromList &&
          (r.status === 'accepted' || r.status === 'auto-accepted')
        ),
    )
    .slice()
    .reverse();

  const grouping = settings.historyGrouping;
  els.groups.textContent = '';
  if (grouping === 'none' || visible.length === 0) {
    els.list.hidden = false;
    list.render(visible, state?.review?.currentId);
  } else {
    // Grouped view renders its own lists, so the shared one steps aside.
    els.list.hidden = true;
    list.render([], state?.review?.currentId);
    const groups = groupRecords(visible, grouping, {
      ...(state?.siteLabel ? { siteLabel: state.siteLabel } : {}),
      ...(state?.fieldLabel ? { fieldLabel: state.fieldLabel } : {}),
    });
    for (const group of groups) {
      const section = document.createElement('section');
      section.className = 'group';
      const heading = document.createElement('h2');
      heading.className = 'group-heading';
      heading.textContent = `${group.label} (${group.records.length})`;
      const ul = document.createElement('ul');
      ul.className = 'list';
      ul.setAttribute('aria-label', `Corrections: ${group.label}`);
      section.append(heading, ul);
      els.groups.appendChild(section);
      // Each group gets its own list instance so selection, paging and the
      // expand state stay independent per group.
      const groupList = new CorrectionList(ul, els.sentinel, {
        onAction: (recordId, action) => void handleItemAction(recordId, action),
        onSelectionChange: () => {
          /* bulk revert operates on the ungrouped view */
        },
      });
      groupList.setDisplayMode(settings.historyDisplayMode);
      groupList.render(group.records, state?.review?.currentId);
    }
  }

  els.empty.hidden = visible.length > 0;
  if (visible.length === 0) els.empty.textContent = explainEmptyList(records.length);
}

/**
 * An empty panel is ambiguous: it can mean "nothing went wrong" or "your
 * settings are quietly preventing history from being kept". Saying which
 * turns a configuration problem into a readable message instead of what looks
 * like a broken feature.
 */
function explainEmptyList(recordCount: number): string {
  if (!state?.hasField) {
    return 'Focus a text field on the page to see its corrections here.';
  }
  if (recordCount > 0) {
    if (query.trim()) return `No corrections match the search "${query.trim()}".`;
    return 'No corrections match this filter. Choose "All" to see everything.';
  }
  if (!settings.enabled) {
    return 'Autocorrect is switched off, so no corrections are being recorded.';
  }
  if (!state.siteEnabled) {
    return 'Autocorrect is switched off for this site, so nothing is recorded here.';
  }
  if (state.memoryOnly) {
    return (
      'No corrections yet. History for this site is kept in memory only, so it '
      + 'is cleared whenever the page reloads - see Settings → Privacy & history.'
    );
  }
  return 'No corrections in this field yet.';
}

function render(): void {
  els.fieldLabel.textContent = state?.hasField
    ? state.fieldLabel || 'Text field'
    : 'No text field focused';
  els.siteLabel.textContent = state?.siteLabel ?? '';
  els.toggleEnabled.checked = settings.enabled;
  els.toggleSite.checked = state ? state.siteEnabled : true;
  els.toggleSite.disabled = !state;
  els.privacy.textContent = state?.memoryOnly ? 'History kept in memory only' : '';

  const pending = state?.counts.pending ?? 0;
  els.review.textContent = pending > 0 ? `Review ${pending} correction${pending === 1 ? '' : 's'}` : 'Review corrections';
  els.review.disabled = pending === 0;
  els.acceptAll.disabled = pending === 0;
  els.clear.disabled = (state?.counts.total ?? 0) === 0;

  const automatic = (state?.session?.records ?? []).filter(
    (r) => r.autoApplied && r.status !== 'reverted' && r.status !== 'rejected',
  ).length;
  els.revertAllAuto.disabled = automatic === 0;
  els.revertAllAuto.textContent =
    automatic > 0 ? `Revert ${automatic} automatic` : 'Revert all automatic';

  els.grouping.value = settings.historyGrouping;
  els.displayMode.value = settings.historyDisplayMode;
  list.setDisplayMode(settings.historyDisplayMode);
  els.toggleMarkup.checked = settings.markupOverlayEnabled;
  els.toggleMarkup.disabled = !state?.hasField;
  els.toggleDeepScan.checked = settings.deepScanEnabled;
  els.deepScanPasses.value = String(settings.deepScanPasses);
  els.deepScanPasses.disabled = !settings.deepScanEnabled;
  els.scan.disabled = !state?.hasField;

  renderCounts();
  renderList();
  review.update(state);
}

async function refresh(): Promise<void> {
  const res = await sendToRuntime<{ state: PanelState | null; settings: Settings }>({
    kind: 'ui/request-state',
  });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  state = res.data.state;
  settings = res.data.settings;
  render();
}

/* ------------------------------ wiring ------------------------------ */

els.review.addEventListener('click', () => void dispatch({ type: 'start-review' }));
els.acceptAll.addEventListener('click', () => void dispatch({ type: 'accept-all' }));

els.revertAllAuto.addEventListener('click', () => {
  const automatic = (state?.session?.records ?? []).filter((r) => r.autoApplied).length;
  if (automatic === 0) {
    setStatus('There are no automatic changes to revert.');
    return;
  }
  if (
    !confirm(
      `Undo ${automatic} automatic change${automatic === 1 ? '' : 's'} in this field? `
        + 'Corrections you accepted yourself are left alone.',
    )
  ) {
    return;
  }
  void dispatch({ type: 'revert-all-automatic' }).then((result) => {
    if (!result.ok) return;
    const data = result.data as { reverted?: number; failures?: unknown[] } | null;
    const reverted = data?.reverted ?? 0;
    const failed = Array.isArray(data?.failures) ? data.failures.length : 0;
    setStatus(
      failed > 0
        ? `Reverted ${reverted}; ${failed} could not be located and were left in place.`
        : `Reverted ${reverted} automatic change${reverted === 1 ? '' : 's'}.`,
      failed > 0,
    );
  });
});

els.toggleMarkup.addEventListener('change', () => {
  const enabled = els.toggleMarkup.checked;
  void sendToRuntime({ kind: 'ui/set-settings', patch: { markupOverlayEnabled: enabled } });
  void dispatch({ type: 'set-markup-overlay', enabled }).then((result) => {
    if (!result.ok) {
      els.markupHint.textContent = '';
      return;
    }
    const shown = (result.data as { shown?: number } | null)?.shown ?? 0;
    els.markupHint.textContent = enabled
      ? shown > 0
        ? `${shown} shown in the page`
        : 'Nothing to show yet'
      : '';
  });
});

els.scan.addEventListener('click', () => {
  els.scanHint.textContent = 'Checking…';
  void dispatch({ type: 'scan-field', force: true }).then((result) => {
    if (!result.ok) {
      els.scanHint.textContent = '';
      return;
    }
    const data = result.data as { total?: number } | null;
    els.scanHint.textContent = data?.total
      ? `Checking ${data.total} sentence${data.total === 1 ? '' : 's'}…`
      : 'Nothing to check yet';
  });
});

els.toggleDeepScan.addEventListener('change', () => {
  const deepScanEnabled = els.toggleDeepScan.checked;
  void sendToRuntime({ kind: 'ui/set-settings', patch: { deepScanEnabled } }).then(async () => {
    await refresh();
    // Turning it on should start working immediately, not on the next keystroke.
    if (deepScanEnabled) await dispatch({ type: 'scan-field' });
  });
});

els.deepScanPasses.addEventListener('change', () => {
  const deepScanPasses = Math.max(1, Math.min(10, Number(els.deepScanPasses.value) || 1));
  els.deepScanPasses.value = String(deepScanPasses);
  void sendToRuntime({ kind: 'ui/set-settings', patch: { deepScanPasses } }).then(refresh);
});

els.grouping.addEventListener('change', () => {
  const historyGrouping = els.grouping.value as Settings['historyGrouping'];
  void sendToRuntime({ kind: 'ui/set-settings', patch: { historyGrouping } }).then(refresh);
});

els.displayMode.addEventListener('change', () => {
  const historyDisplayMode = els.displayMode.value as Settings['historyDisplayMode'];
  void sendToRuntime({ kind: 'ui/set-settings', patch: { historyDisplayMode } }).then(refresh);
});
els.revertSelected.addEventListener('click', () => {
  if (selection.length === 0) return;
  void dispatch({ type: 'revert-selected', recordIds: selection }).then((result) => {
    if (!result.ok) return;
    const data = result.data as { failures?: unknown } | null;
    if (Array.isArray(data?.failures) && data.failures.length > 0) {
      setStatus(`${data.failures.length} selected correction(s) could not be reverted.`, true);
      return;
    }
    list.clearSelection();
  });
});
els.clear.addEventListener('click', () => {
  if (!confirm('Clear the correction history for this field? The text itself is not changed.')) return;
  void dispatch({ type: 'clear-session' });
});

els.toggleEnabled.addEventListener('change', () => {
  void sendToRuntime({ kind: 'ui/set-settings', patch: { enabled: els.toggleEnabled.checked } }).then(refresh);
});

els.toggleSite.addEventListener('change', () => {
  if (!state) return;
  const overrides = { ...settings.siteOverrides };
  if (els.toggleSite.checked) delete overrides[state.origin];
  else overrides[state.origin] = 'off';
  void sendToRuntime({ kind: 'ui/set-settings', patch: { siteOverrides: overrides } }).then(refresh);
});

let searchTimer: ReturnType<typeof setTimeout> | undefined;
els.search.addEventListener('input', () => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = els.search.value;
    renderList();
  }, 120);
});

chrome.runtime.onMessage.addListener((message: PanelMessage) => {
  if (!message || typeof message.kind !== 'string') return;
  if (message.kind === 'panel/state') {
    state = message.state;
    render();
  } else if (message.kind === 'panel/settings') {
    settings = message.settings;
    render();
  }
});

renderFilters();
void sendToRuntime({ kind: 'ui/panel-ready' });
void refresh();

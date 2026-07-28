/**
 * Right-click actions on selected text: teach a replacement, or add a word to
 * the personal dictionary.
 *
 * The dictionary action needs no UI, so it completes in the background. The
 * replacement action needs a value from the user, so the page is asked to
 * collect one (our own shadow-root prompt); if no content script is reachable
 * there, the options page is opened as a discoverable fallback.
 */
import { addToDictionary } from '../engine/personal-learning.js';
import { validateRulePair } from '../shared/grammar.js';
import { sendToTab } from '../shared/messages.js';
import * as store from '../storage/storage.js';

const ADD_RULE_ID = 'pa-add-correction';
const ADD_DICTIONARY_ID = 'pa-add-dictionary';
const SCAN_SELECTION_ID = 'pa-scan-selection';
const SCAN_FIELD_ID = 'pa-scan-field';

/** Selection text is untrusted page content: bound it before doing anything. */
function cleanSelection(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/gu, ' ').trim().slice(0, 64);
}

async function flashBadge(text: string, colour: string): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: colour });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2200);
  } catch {
    /* badge feedback is cosmetic */
  }
}

export async function installContextMenus(): Promise<void> {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: ADD_RULE_ID,
      title: 'Always correct "%s" to…',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: ADD_DICTIONARY_ID,
      title: 'Never correct "%s"',
      contexts: ['selection'],
    });
    // With text selected inside an editable field Chrome shows both of these;
    // "check the selection" is listed first because it is the likelier intent.
    chrome.contextMenus.create({
      id: SCAN_SELECTION_ID,
      title: 'Check "%s" now',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: SCAN_FIELD_ID,
      title: 'Check this text now',
      contexts: ['editable'],
    });
  } catch (e) {
    console.warn('[autocorrect] context menu setup failed:', e);
  }
}

export function installContextMenuHandler(): void {
  if (!chrome.contextMenus?.onClicked) return;
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleClick(info, tab).catch((e) =>
      console.warn('[autocorrect] context menu action failed:', e),
    );
  });
}

async function handleClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (info.menuItemId === SCAN_SELECTION_ID || info.menuItemId === SCAN_FIELD_ID) {
    await scan(info, tab, info.menuItemId === SCAN_SELECTION_ID);
    return;
  }

  const selection = cleanSelection(info.selectionText);
  if (!selection) return;

  if (info.menuItemId === ADD_DICTIONARY_ID) {
    if (/\s/.test(selection) || !/^[A-Za-zÀ-ɏ'’-]+$/.test(selection)) {
      await notify(tab, 'Select a single word to add it to your dictionary.', true);
      return;
    }
    await store.mutateLearning((data) => addToDictionary(data, selection));
    await flashBadge('✓', '#15803d');
    await notify(tab, `“${selection}” will never be corrected.`);
    return;
  }

  if (info.menuItemId !== ADD_RULE_ID) return;

  // Reject obviously unusable selections before opening a prompt for them.
  const shape = validateRulePair(selection, `${selection}x`);
  if (!shape.ok) {
    await notify(tab, shape.reason, true);
    return;
  }
  if (tab?.id === undefined) {
    await openOptionsFallback();
    return;
  }
  const res = await sendToTab(tab.id, { kind: 'bg/prompt-rule', original: selection }, info.frameId);
  if (!res.ok) {
    // No content script here (site not enabled, or a restricted page).
    await openOptionsFallback();
  }
}

/**
 * Runs a check immediately, prioritising the selection when there is one.
 *
 * The selection is *not* passed as text. Chrome hands us a whitespace-collapsed,
 * length-capped copy, which would not reliably match the field's real contents;
 * the content script reads the live selection range itself instead.
 */
async function scan(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  preferSelection: boolean,
): Promise<void> {
  if (tab?.id === undefined) return;
  const res = await sendToTab<{ total?: number; selection?: boolean }>(
    tab.id,
    { kind: 'bg/command', command: { type: 'scan-field', force: true, preferSelection } },
    info.frameId,
  );
  if (!res.ok) {
    await notify(tab, 'Autocorrect is not running on this text field.', true);
    return;
  }
  await flashBadge('⟳', '#2563eb');
  await notify(
    tab,
    res.data?.selection
      ? 'Checking the selected text…'
      : `Checking this field${res.data?.total ? ` (${res.data.total} sentences)` : ''}…`,
  );
}

async function notify(
  tab: chrome.tabs.Tab | undefined,
  message: string,
  warn = false,
): Promise<void> {
  if (tab?.id === undefined) return;
  const res = await sendToTab(tab.id, { kind: 'bg/notice', message, warn });
  if (!res.ok && warn) await flashBadge('!', '#b45309');
}

async function openOptionsFallback(): Promise<void> {
  await flashBadge('!', '#b45309');
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html#rules'),
    });
  } catch {
    /* nothing further we can do */
  }
}

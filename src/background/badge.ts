/**
 * Toolbar badge: the only always-visible signal of what the extension is doing.
 *
 * State is never conveyed by colour alone - every state also has distinct badge
 * text and a spelled-out tooltip, so the indicator survives both greyscale and
 * a screen reader.
 */
import { BADGE_STYLE, type ExtensionState } from '../shared/status.js';

const lastPainted = new Map<number, ExtensionState>();

/** Applies the badge for one tab. Cheap and idempotent. */
export async function paintBadge(
  tabId: number | undefined,
  state: ExtensionState,
  detail?: string,
): Promise<void> {
  const style = BADGE_STYLE[state];
  const title = detail ? `${style.title}\n${detail}` : style.title;
  try {
    if (tabId === undefined) {
      await chrome.action.setBadgeText({ text: style.text });
      await chrome.action.setBadgeBackgroundColor({ color: style.colour });
      await chrome.action.setTitle({ title });
      return;
    }
    if (lastPainted.get(tabId) === state && !detail) return;
    lastPainted.set(tabId, state);
    await chrome.action.setBadgeText({ tabId, text: style.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: style.colour });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // The tab can close between resolving the state and painting it; a badge
    // that cannot be drawn is never worth surfacing as an error.
  }
}

export function forgetTab(tabId: number): void {
  lastPainted.delete(tabId);
}

/**
 * The extension ships with **no** host permissions. The user grants a site
 * explicitly (popup -> "Enable on this site"), which is what makes the privacy
 * story real rather than aspirational.
 *
 * Granted origins are turned into a dynamically registered content script so
 * the choice survives reloads and browser restarts.
 */
const SCRIPT_ID = 'pa-content';

export async function grantedOrigins(): Promise<string[]> {
  try {
    const all = await chrome.permissions.getAll();
    return (all.origins ?? []).filter((origin) => /^(?:https?|\*):\/\//.test(origin));
  } catch (e) {
    console.warn('[autocorrect] permissions.getAll failed:', e);
    return [];
  }
}

/** "https://mail.example.com/path" -> "https://mail.example.com/*" */
export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export async function hasAccessTo(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** Re-registers the content script to exactly the currently granted origins. */
export async function syncContentScripts(): Promise<void> {
  const origins = await grantedOrigins();
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    // Nothing registered yet - that is the normal first-run path.
  }
  if (origins.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ['content/content-script.js'],
        matches: origins,
        runAt: 'document_idle',
        allFrames: true,
        world: 'ISOLATED',
      },
    ]);
  } catch (e) {
    console.warn('[autocorrect] registerContentScripts failed:', e);
  }
}

/** Injects into an already-open tab, because registration only affects loads. */
export async function injectNow(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/content-script.js'],
    });
    return true;
  } catch (e) {
    console.warn('[autocorrect] injectNow failed:', e);
    return false;
  }
}

/**
 * MV3 service worker: wiring only.
 *
 * The worker is expected to be evicted constantly, so it holds no correction
 * state that cannot be rebuilt - the content script owns the live session and
 * re-pushes it whenever the panel asks.
 */
import { installContextMenuHandler, installContextMenus } from './context-menus.js';
import { housekeeping, installRouter, refreshActiveTab } from './message-router.js';
import { syncContentScripts } from './site-permissions.js';
import { hydrate } from '../storage/storage.js';

installRouter();
// Listeners must be registered during evaluation so an evicted worker can be
// woken by the event itself.
installContextMenuHandler();

let bootstrapRun: Promise<void> | null = null;

function bootstrap(): Promise<void> {
  if (bootstrapRun) return bootstrapRun;
  bootstrapRun = (async () => {
    try {
      // Content scripts have no reason to read storage directly. Restricting
      // access keeps page-adjacent contexts away from the raw persistence API.
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await hydrate();
      await syncContentScripts();
      await housekeeping();
      await refreshActiveTab();
    } catch (e) {
      console.error('[autocorrect] bootstrap failed:', e);
    } finally {
      bootstrapRun = null;
    }
  })();
  return bootstrapRun;
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await bootstrap();
    await installContextMenus();
    try {
      await chrome.sidePanel.setOptions({ path: 'side-panel/side-panel.html', enabled: true });
      // The action opens the popup; the panel is opened from there.
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    } catch (e) {
      console.warn('[autocorrect] side panel setup failed:', e);
    }
    if (details.reason === 'install') {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#welcome') });
      } catch {
        /* opening the welcome page is best-effort */
      }
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
  // Menu registrations do not always survive a browser restart; re-assert them.
  void installContextMenus();
});

// Cold start of the worker for any other reason.
void bootstrap();

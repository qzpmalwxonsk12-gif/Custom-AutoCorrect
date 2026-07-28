/**
 * Content script entry point.
 *
 * Injected only into origins the user has explicitly granted. Runs in every
 * frame; each frame manages its own fields and reports independently, so a
 * same-origin iframe editor works without any extra plumbing. Cross-origin
 * frames simply never receive this script unless their origin was granted too.
 */
import { SessionController } from './session-controller.js';

declare global {
  interface Window {
    __personalAutocorrectLoaded?: boolean;
  }
}

function main(): void {
  // Guard against double injection (dynamic registration + explicit inject).
  if (window.__personalAutocorrectLoaded) return;
  window.__personalAutocorrectLoaded = true;

  const controller = new SessionController();
  void controller.start().catch((e) => {
    console.warn('[autocorrect] failed to start:', e);
  });

  // Extension reloads invalidate this context; clean up rather than throwing on
  // every subsequent message.
  window.addEventListener('unload', () => {
    try {
      controller.stop();
    } catch {
      /* page is going away anyway */
    }
  });
}

try {
  main();
} catch (e) {
  console.warn('[autocorrect] content script error:', e);
}

/**
 * Extension run state: the single source of truth behind the toolbar badge,
 * the popup header and the diagnostics page.
 *
 * `paused` is deliberately distinct from `disabled`: pausing is temporary and
 * self-reversing, disabling is a decision that persists. Showing them with one
 * indicator would make "why is nothing happening?" unanswerable.
 */

export type ExtensionState = 'active' | 'paused' | 'disabled' | 'loading' | 'error';

export interface PauseState {
  /** Epoch ms; 0 or absent means "not paused by a timer". */
  until: number;
  /** Tab ids paused until they close. */
  tabs: number[];
}

export const EMPTY_PAUSE: PauseState = { until: 0, tabs: [] };

export interface StatusSnapshot {
  state: ExtensionState;
  /** Short label for the badge tooltip and popup header. */
  label: string;
  /** One sentence explaining the state, and how to leave it. */
  detail: string;
  /** Milliseconds remaining on a timed pause, when that is the reason. */
  pauseRemainingMs?: number;
}

export interface StatusInput {
  enabled: boolean;
  siteEnabled: boolean;
  /** False when the extension has no host permission for this page. */
  siteGranted: boolean;
  /** False until the content script has its configuration. */
  configured: boolean;
  pause: PauseState;
  tabId?: number;
  /** Set when a provider or storage failure needs surfacing. */
  errorMessage?: string;
  now?: number;
}

export function pauseRemaining(pause: PauseState, now = Date.now()): number {
  return pause.until > now ? pause.until - now : 0;
}

export function isPaused(pause: PauseState, tabId: number | undefined, now = Date.now()): boolean {
  if (pauseRemaining(pause, now) > 0) return true;
  return tabId !== undefined && pause.tabs.includes(tabId);
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 minutes';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${hours}h ${rest}m`;
}

/**
 * Resolves the state. Order matters: an error is reported even when the
 * extension is also paused, because a silent failure is the thing a user is
 * least able to diagnose on their own.
 */
export function resolveStatus(input: StatusInput): StatusSnapshot {
  const now = input.now ?? Date.now();

  if (input.errorMessage) {
    return {
      state: 'error',
      label: 'Error',
      detail: input.errorMessage,
    };
  }
  if (!input.enabled) {
    return {
      state: 'disabled',
      label: 'Disabled',
      detail: 'Autocorrect is switched off everywhere. Turn it back on in the popup or settings.',
    };
  }
  if (!input.siteGranted) {
    return {
      state: 'disabled',
      label: 'Not enabled here',
      detail: 'This site has not been allowed yet. Nothing on the page is read until you allow it.',
    };
  }
  if (!input.siteEnabled) {
    return {
      state: 'disabled',
      label: 'Off for this site',
      detail: 'Autocorrect is switched off for this website. Turn it back on from the popup.',
    };
  }

  const remaining = pauseRemaining(input.pause, now);
  if (remaining > 0) {
    return {
      state: 'paused',
      label: 'Paused',
      detail: `Paused for another ${formatDuration(remaining)}. Corrections resume automatically.`,
      pauseRemainingMs: remaining,
    };
  }
  if (input.tabId !== undefined && input.pause.tabs.includes(input.tabId)) {
    return {
      state: 'paused',
      label: 'Paused',
      detail: 'Paused until this tab is closed. Use “Resume” to end it sooner.',
    };
  }

  if (!input.configured) {
    return {
      state: 'loading',
      label: 'Starting',
      detail: 'Loading the dictionary and settings for this page.',
    };
  }
  return {
    state: 'active',
    label: 'Active',
    detail: 'Watching text fields on this page.',
  };
}

/**
 * Badge appearance. Text is never the *only* signal - the tooltip always spells
 * the state out, so the badge does not rely on colour vision.
 */
export const BADGE_STYLE: Record<ExtensionState, { text: string; colour: string; title: string }> = {
  active: { text: '', colour: '#2563eb', title: 'Personal Autocorrect: active' },
  paused: { text: '❚❚', colour: '#b45309', title: 'Personal Autocorrect: paused' },
  disabled: { text: 'OFF', colour: '#6b7280', title: 'Personal Autocorrect: off' },
  loading: { text: '…', colour: '#2563eb', title: 'Personal Autocorrect: starting' },
  error: { text: '!', colour: '#b91c1c', title: 'Personal Autocorrect: error' },
};

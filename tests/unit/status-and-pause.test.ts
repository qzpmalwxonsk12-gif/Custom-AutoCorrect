import { describe, expect, it } from 'vitest';
import {
  BADGE_STYLE,
  formatDuration,
  isPaused,
  pauseRemaining,
  resolveStatus,
  type StatusInput,
} from '../../src/shared/status.js';

const NOW = 1_700_000_000_000;

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    enabled: true,
    siteEnabled: true,
    siteGranted: true,
    configured: true,
    pause: { until: 0, tabs: [] },
    now: NOW,
    ...overrides,
  };
}

describe('resolveStatus', () => {
  it('reports active when everything is in order', () => {
    expect(resolveStatus(input()).state).toBe('active');
  });

  it('reports loading before the content script has configuration', () => {
    expect(resolveStatus(input({ configured: false })).state).toBe('loading');
  });

  it('distinguishes globally disabled from off-for-this-site', () => {
    const global = resolveStatus(input({ enabled: false }));
    const site = resolveStatus(input({ siteEnabled: false }));
    expect(global.state).toBe('disabled');
    expect(site.state).toBe('disabled');
    expect(global.detail).not.toBe(site.detail);
  });

  it('reports "not enabled here" when the site was never granted', () => {
    const status = resolveStatus(input({ siteGranted: false }));
    expect(status.state).toBe('disabled');
    expect(status.label).toBe('Not enabled here');
  });

  it('reports a timed pause with the time remaining', () => {
    const status = resolveStatus(input({ pause: { until: NOW + 5 * 60_000, tabs: [] } }));
    expect(status.state).toBe('paused');
    expect(status.pauseRemainingMs).toBe(5 * 60_000);
    expect(status.detail).toContain('5 minutes');
  });

  it('treats an expired pause as no pause at all', () => {
    const status = resolveStatus(input({ pause: { until: NOW - 1, tabs: [] } }));
    expect(status.state).toBe('active');
  });

  it('reports a per-tab pause only for that tab', () => {
    const pause = { until: 0, tabs: [7] };
    expect(resolveStatus(input({ pause, tabId: 7 })).state).toBe('paused');
    expect(resolveStatus(input({ pause, tabId: 8 })).state).toBe('active');
  });

  /**
   * A silent failure is the state a user can least diagnose, so it must win
   * even when something else would also explain the quiet.
   */
  it('reports an error ahead of every other state', () => {
    const status = resolveStatus(
      input({ enabled: false, errorMessage: 'storage is full', pause: { until: NOW + 60_000, tabs: [] } }),
    );
    expect(status.state).toBe('error');
    expect(status.detail).toContain('storage is full');
  });
});

describe('pause helpers', () => {
  it('computes the remaining time and never returns a negative', () => {
    expect(pauseRemaining({ until: NOW + 1000, tabs: [] }, NOW)).toBe(1000);
    expect(pauseRemaining({ until: NOW - 1000, tabs: [] }, NOW)).toBe(0);
  });

  it('detects both timed and per-tab pauses', () => {
    expect(isPaused({ until: NOW + 1, tabs: [] }, undefined, NOW)).toBe(true);
    expect(isPaused({ until: 0, tabs: [3] }, 3, NOW)).toBe(true);
    expect(isPaused({ until: 0, tabs: [3] }, 4, NOW)).toBe(false);
    expect(isPaused({ until: 0, tabs: [] }, 3, NOW)).toBe(false);
  });

  it('formats durations the way a person would say them', () => {
    expect(formatDuration(0)).toBe('0 minutes');
    expect(formatDuration(60_000)).toBe('1 minute');
    expect(formatDuration(5 * 60_000)).toBe('5 minutes');
    expect(formatDuration(60 * 60_000)).toBe('1 hour');
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
  });
});

describe('badge styling', () => {
  it('gives every state a distinct badge text, so colour is never the only cue', () => {
    const texts = Object.values(BADGE_STYLE).map((style) => style.text);
    // 'active' is deliberately blank: a clean badge means nothing is wrong.
    expect(BADGE_STYLE.active.text).toBe('');
    expect(new Set(texts).size).toBe(texts.length);
    for (const [state, style] of Object.entries(BADGE_STYLE)) {
      expect(style.title.toLowerCase(), state).toContain(
        state === 'loading' ? 'starting' : state === 'disabled' ? 'off' : state,
      );
    }
  });
});

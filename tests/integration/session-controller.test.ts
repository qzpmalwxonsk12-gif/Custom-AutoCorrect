import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../src/content/session-controller.js';
import type { BackgroundMessage, ContentMessage, Result } from '../../src/shared/messages.js';
import { learning, settings } from '../helpers.js';
import { makeTextarea, typeInto } from './dom-helpers.js';

type RuntimeListener = (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Result<unknown>) => void,
) => boolean | undefined;

interface RuntimeHarness {
  sent: ContentMessage[];
  removeListener: ReturnType<typeof vi.fn>;
  inbound(message: BackgroundMessage): Result<unknown> | undefined;
}

const running: SessionController[] = [];
const originalChrome = globalThis.chrome;

afterEach(() => {
  for (const controller of running.splice(0)) controller.stop();
  vi.useRealTimers();
  document.body.textContent = '';
  Object.defineProperty(globalThis, 'chrome', {
    value: originalChrome,
    configurable: true,
    writable: true,
  });
});

function installRuntime(
  configResponses: Array<Result<{
    settings: ReturnType<typeof settings>;
    learning: ReturnType<typeof learning>;
    documentScope: string;
  }>> = [{
    ok: true,
    data: {
      settings: settings(),
      learning: learning(),
      documentScope: 'tab-1:frame-0',
    },
  }],
): RuntimeHarness {
  const sent: ContentMessage[] = [];
  let listener: RuntimeListener | undefined;
  let configIndex = 0;
  const removeListener = vi.fn((candidate: RuntimeListener) => {
    if (candidate === listener) listener = undefined;
  });
  const sendMessage = vi.fn(async (message: ContentMessage) => {
    sent.push(message);
    if (message.kind === 'content/config') {
      return configResponses[Math.min(configIndex++, configResponses.length - 1)]!;
    }
    if (message.kind === 'content/restore-session') {
      return { ok: true, data: { session: null } };
    }
    return { ok: true, data: null };
  });
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn((candidate: RuntimeListener) => {
            listener = candidate;
          }),
          removeListener,
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    sent,
    removeListener,
    inbound(message) {
      let response: Result<unknown> | undefined;
      listener?.(
        message,
        {} as chrome.runtime.MessageSender,
        (value) => {
          response = value;
        },
      );
      return response;
    },
  };
}

async function startController(): Promise<SessionController> {
  const controller = new SessionController();
  running.push(controller);
  await controller.start();
  await Promise.resolve();
  return controller;
}

describe('SessionController lifecycle and persistence', () => {
  it('keeps a separate pending persistence timer for every controller', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const first = makeTextarea();
    await startController();
    const second = makeTextarea();
    second.focus();
    await vi.advanceTimersByTimeAsync(0);
    runtime.sent.length = 0;

    typeInto(first, 'teh ');
    typeInto(second, 'waht ');
    await vi.advanceTimersByTimeAsync(1_000);

    const persisted = runtime.sent.filter(
      (message): message is Extract<ContentMessage, { kind: 'content/persist-session' }> =>
        message.kind === 'content/persist-session',
    );
    expect(new Set(persisted.map((message) => message.session.id)).size).toBe(2);
  });

  it('flushes the field losing focus and every live field on pagehide', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const first = makeTextarea();
    await startController();
    typeInto(first, 'teh ');
    const second = makeTextarea();
    second.focus();
    await vi.advanceTimersByTimeAsync(0);

    const beforeHide = runtime.sent.filter(
      (message) => message.kind === 'content/persist-session',
    );
    expect(beforeHide).toHaveLength(1);
    const firstId = beforeHide[0]!.session.id;

    typeInto(second, 'waht ');
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    const afterHide = runtime.sent.filter(
      (message) => message.kind === 'content/persist-session',
    );
    expect(afterHide.some((message) => message.session.id !== firstId)).toBe(true);
  });

  it('clears all live histories and stops immediately when access is revoked', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const first = makeTextarea();
    await startController();
    typeInto(first, 'teh ');
    const second = makeTextarea();
    second.focus();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(second, 'waht ');
    runtime.sent.length = 0;

    expect(runtime.inbound({ kind: 'bg/clear-sessions' })).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.sent.some((message) => message.kind === 'content/persist-session')).toBe(false);

    typeInto(second, 'teh ');
    runtime.sent.length = 0;
    const pattern = `${location.protocol}//${location.hostname}/*`;
    expect(runtime.inbound({ kind: 'bg/access-revoked', patterns: [pattern] })).toEqual({
      ok: true,
      data: { stopped: true },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.removeListener).toHaveBeenCalled();
    expect(runtime.sent.some((message) => message.kind === 'content/persist-session')).toBe(false);

    typeInto(second, ' waht ');
    expect(second.value.endsWith(' waht ')).toBe(true);
  });

  it('does not attach or read text until an unavailable initial config recovers', async () => {
    vi.useFakeTimers();
    installRuntime([
      { ok: false, error: 'worker restarting' },
      {
        ok: true,
        data: {
          settings: settings(),
          learning: learning(),
          documentScope: 'tab-2:frame-0',
        },
      },
    ]);
    const field = makeTextarea();
    await startController();
    typeInto(field, 'waht ');
    expect(field.value).toBe('waht ');

    await vi.advanceTimersByTimeAsync(1_000);
    typeInto(field, 'teh ');
    expect(field.value).toBe('waht the ');
  });

  it('handles a review decision and advances it as one background command', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const field = makeTextarea();
    await startController();
    typeInto(field, 'teh cat adn ');
    await vi.advanceTimersByTimeAsync(120);
    const state = runtime.sent
      .filter(
        (message): message is Extract<ContentMessage, { kind: 'content/state' }> =>
          message.kind === 'content/state',
      )
      .at(-1)!.state;
    const ids = state.session!.records.map((record) => record.id);
    expect(ids).toHaveLength(2);
    expect(runtime.inbound({
      kind: 'bg/command',
      command: { type: 'start-review' },
    })).toMatchObject({ ok: true });

    const result = runtime.inbound({
      kind: 'bg/command',
      command: { type: 'review-decide', recordId: ids[0]!, decision: 'keep' },
    });
    expect(result).toEqual({
      ok: true,
      data: { position: 2, total: 2 },
    });
  });

  it('discovers an editable inside an open shadow root from the composed focus path', async () => {
    installRuntime();
    const outside = makeTextarea();
    await startController();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const field = document.createElement('textarea');
    shadow.appendChild(field);
    document.body.appendChild(host);
    field.focus();
    expect(document.activeElement).toBe(host);

    typeInto(field, 'teh ');
    expect(field.value).toBe('The ');
    outside.remove();
  });
});

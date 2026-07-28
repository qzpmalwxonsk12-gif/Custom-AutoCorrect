/**
 * DIAGNOSTIC (session level): does a correction reach the panel state and the
 * persistence layer through the real SessionController?
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../src/content/session-controller.js';
import type { BackgroundMessage, ContentMessage, PanelState, Result } from '../../src/shared/messages.js';
import { learning, settings } from '../helpers.js';
import { makeTextarea, typeInto } from './dom-helpers.js';

type RuntimeListener = (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Result<unknown>) => void,
) => boolean | undefined;

const running: SessionController[] = [];
const originalChrome = globalThis.chrome;

afterEach(() => {
  for (const c of running.splice(0)) c.stop();
  vi.useRealTimers();
  document.body.textContent = '';
  Object.defineProperty(globalThis, 'chrome', {
    value: originalChrome,
    configurable: true,
    writable: true,
  });
});

function installRuntime() {
  const sent: ContentMessage[] = [];
  let listener: RuntimeListener | undefined;
  const sendMessage = vi.fn(async (message: ContentMessage) => {
    sent.push(message);
    if (message.kind === 'content/config') {
      return {
        ok: true,
        data: {
          settings: settings({ punctuationEnabled: false }),
          learning: learning(),
          documentScope: 'tab-1:frame-0',
        },
      };
    }
    if (message.kind === 'content/restore-session') return { ok: true, data: { session: null } };
    return { ok: true, data: null };
  });
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn((c: RuntimeListener) => { listener = c; }),
          removeListener: vi.fn(),
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    sent,
    states: () =>
      sent.filter(
        (m): m is Extract<ContentMessage, { kind: 'content/state' }> => m.kind === 'content/state',
      ),
    inbound(message: BackgroundMessage) {
      let response: Result<unknown> | undefined;
      listener?.(message, {} as chrome.runtime.MessageSender, (v) => { response = v; });
      return response;
    },
  };
}

async function start(): Promise<SessionController> {
  const controller = new SessionController();
  running.push(controller);
  await controller.start();
  await Promise.resolve();
  return controller;
}

function latestSession(states: Array<{ state: PanelState }>) {
  for (let i = states.length - 1; i >= 0; i--) {
    const session = states[i]!.state.session;
    if (session) return session;
  }
  return null;
}

describe('history reaches the panel through SessionController', () => {
  it('pushes a state containing the new record after a correction', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const field = makeTextarea();
    await start();
    field.focus();
    await vi.advanceTimersByTimeAsync(0);
    runtime.sent.length = 0;

    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think what ');

    await vi.advanceTimersByTimeAsync(500);
    const session = latestSession(runtime.states());
    expect(session, 'no panel state carried a session').not.toBeNull();
    expect(session!.records).toHaveLength(1);
    expect(session!.records[0]!.originalText).toBe('waht');
  });

  it('persists the session containing the record', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const field = makeTextarea();
    await start();
    field.focus();
    await vi.advanceTimersByTimeAsync(0);

    typeInto(field, 'I think waht ');
    await vi.advanceTimersByTimeAsync(1_500);

    const persisted = runtime.sent.filter(
      (m): m is Extract<ContentMessage, { kind: 'content/persist-session' }> =>
        m.kind === 'content/persist-session',
    );
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.at(-1)!.session.records).toHaveLength(1);
  });

  it('a bg/request-state refresh reports the same single record', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const field = makeTextarea();
    await start();
    field.focus();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(field, 'I think waht ');
    await vi.advanceTimersByTimeAsync(500);
    runtime.sent.length = 0;

    runtime.inbound({ kind: 'bg/request-state' });
    const session = latestSession(runtime.states());
    expect(session!.records).toHaveLength(1);
  });

  it('a config broadcast does not wipe existing records', async () => {
    vi.useFakeTimers();
    const runtime = installRuntime();
    const field = makeTextarea();
    await start();
    field.focus();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(field, 'I think waht ');
    await vi.advanceTimersByTimeAsync(500);

    runtime.inbound({
      kind: 'bg/config',
      settings: settings({ punctuationEnabled: false }),
      learning: learning(),
    });
    await vi.advanceTimersByTimeAsync(500);

    runtime.sent.length = 0;
    runtime.inbound({ kind: 'bg/request-state' });
    expect(latestSession(runtime.states())!.records).toHaveLength(1);
  });
});

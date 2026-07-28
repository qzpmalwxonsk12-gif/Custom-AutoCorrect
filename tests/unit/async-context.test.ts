/**
 * Stage 5: the asynchronous provider slot.
 *
 * No model ships, so these test the safety machinery around one - which is the
 * part that must be right before a model is allowed anywhere near the text.
 */
import { describe, expect, it } from 'vitest';
import {
  AsyncRankingQueue,
  ASYNC_MAX_ACTION,
  capAsyncAction,
  fingerprintOf,
  verifyResponse,
  type AsyncRankingRequest,
} from '../../src/engine/context/async-context.js';

const SENTENCE = 'I think teh cat sat.';

function request(overrides: Partial<AsyncRankingRequest> = {}): AsyncRankingRequest {
  return {
    requestId: 'r1',
    sessionId: 's1',
    fieldId: 'f1',
    sentenceText: SENTENCE,
    baseOffset: 0,
    fingerprint: fingerprintOf(SENTENCE),
    targetText: 'teh',
    targetStart: 8,
    targetEnd: 11,
    createdAt: 0,
    ...overrides,
  };
}

describe('response verification', () => {
  it('accepts an answer for unchanged text', () => {
    expect(
      verifyResponse({
        request: request(),
        currentText: SENTENCE,
        activeRequestId: 'r1',
        currentSessionId: 's1',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects an answer that was superseded', () => {
    expect(
      verifyResponse({
        request: request(),
        currentText: SENTENCE,
        activeRequestId: 'r2',
        currentSessionId: 's1',
      }),
    ).toEqual({ ok: false, cause: 'superseded' });
  });

  it('rejects an answer for a field that has gone', () => {
    expect(
      verifyResponse({
        request: request(),
        currentText: null,
        activeRequestId: 'r1',
        currentSessionId: 's1',
      }),
    ).toEqual({ ok: false, cause: 'field-gone' });
  });

  it('rejects an answer for a different session', () => {
    expect(
      verifyResponse({
        request: request(),
        currentText: SENTENCE,
        activeRequestId: 'r1',
        currentSessionId: 's2',
      }),
    ).toEqual({ ok: false, cause: 'field-changed' });
  });

  it('rejects an answer when the sentence changed', () => {
    expect(
      verifyResponse({
        request: request(),
        currentText: 'I think the cat sat.',
        activeRequestId: 'r1',
        currentSessionId: 's1',
      }).ok,
    ).toBe(false);
  });

  /**
   * The check that actually protects the text: everything else can pass while
   * the span itself has been edited to something the provider never saw.
   */
  it('rejects an answer when the target span no longer matches', () => {
    const sentence = 'I think teh cat sat.';
    const edited = 'I think hat cat sat.';
    expect(
      verifyResponse({
        request: request({ fingerprint: fingerprintOf(edited), sentenceText: edited }),
        currentText: edited,
        activeRequestId: 'r1',
        currentSessionId: 's1',
      }),
    ).toEqual({ ok: false, cause: 'target-moved' });
    expect(sentence).not.toBe(edited);
  });
});

describe('request queue', () => {
  it('allows one request per field at a time', () => {
    const queue = new AsyncRankingQueue();
    expect(queue.canRequest('f1')).toBe(true);
    queue.begin('f1', 'r1');
    expect(queue.canRequest('f1')).toBe(false);
    // A different field is unaffected.
    expect(queue.canRequest('f2')).toBe(true);
  });

  it('clears on a successful settle', () => {
    const queue = new AsyncRankingQueue();
    queue.begin('f1', 'r1');
    expect(queue.settle('f1', true)).toBe(false);
    expect(queue.canRequest('f1')).toBe(true);
  });

  it('backs off after repeated stale answers', () => {
    const queue = new AsyncRankingQueue();
    const now = 1_000;
    for (let i = 1; i < AsyncRankingQueue.STALE_LIMIT; i++) {
      queue.begin('f1', `r${i}`);
      expect(queue.settle('f1', false, now)).toBe(false);
    }
    queue.begin('f1', 'rN');
    expect(queue.settle('f1', false, now)).toBe(true);
    expect(queue.canRequest('f1', now)).toBe(false);
    expect(queue.canRequest('f1', now + AsyncRankingQueue.BACKOFF_MS)).toBe(true);
  });

  it('a success resets the streak', () => {
    const queue = new AsyncRankingQueue();
    queue.begin('f1', 'r1');
    queue.settle('f1', false);
    queue.begin('f1', 'r2');
    queue.settle('f1', true);
    queue.begin('f1', 'r3');
    // Streak was reset, so this is the first failure again.
    expect(queue.settle('f1', false)).toBe(false);
  });

  it('tracks the active request id', () => {
    const queue = new AsyncRankingQueue();
    queue.begin('f1', 'r1');
    expect(queue.activeRequest('f1')).toBe('r1');
    queue.cancel('f1');
    expect(queue.activeRequest('f1')).toBeUndefined();
  });
});

describe('action ceiling', () => {
  it('never lets an asynchronous provider apply text automatically', () => {
    expect(ASYNC_MAX_ACTION).toBe('suggest');
    expect(capAsyncAction('autocorrect')).toBe('suggest');
    expect(capAsyncAction('suggest')).toBe('suggest');
    expect(capAsyncAction('none')).toBe('none');
  });
});

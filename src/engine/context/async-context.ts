/**
 * The slot a future model plugs into.
 *
 * No model ships in this build. What ships is the contract and the safety
 * machinery around it, so adding one is an implementation of
 * `AsyncContextProvider` rather than a redesign of the spelling engine.
 *
 * The rules an asynchronous provider must obey are all here rather than in the
 * provider, because they are the ones that keep the correction history honest
 * and a provider is not the right place to trust with them:
 *
 *   - it ranks candidates the deterministic engine produced; it does not invent
 *     replacement text;
 *   - its answer is verified against the live text before use, by fingerprint
 *     *and* by exact target span;
 *   - a superseded answer is discarded, never applied late;
 *   - it never writes text - it returns proposals, and `applyCorrection()`
 *     remains the only path that modifies a field.
 */
import type { ProposalAction } from '../../shared/types.js';
import { fnv1a } from '../../shared/util.js';
import type { AsyncContextProvider, ContextDecision } from './context-provider.js';

export interface AsyncRankingRequest {
  requestId: string;
  sessionId: string;
  fieldId: string;
  /** Sentence being ranked, not the whole field. */
  sentenceText: string;
  /** Offset of `sentenceText` within the field. */
  baseOffset: number;
  /** Fingerprint of `sentenceText` at request time. */
  fingerprint: string;
  /** Exact text of the span being corrected, re-verified before any edit. */
  targetText: string;
  targetStart: number;
  targetEnd: number;
  createdAt: number;
}

export interface AsyncRankingResponse {
  requestId: string;
  decision: ContextDecision;
  /** Milliseconds spent in the provider, for diagnostics. */
  elapsedMs: number;
}

export function fingerprintOf(sentence: string): string {
  return fnv1a(sentence);
}

/**
 * Why a response was rejected. Every value here has been an actual source of
 * wrong edits in the grammar lane at some point, which is why each is checked
 * separately rather than collapsed into one "stale" flag.
 */
export type RejectionCause =
  | 'superseded'
  | 'field-changed'
  | 'sentence-changed'
  | 'target-moved'
  | 'field-gone';

export interface VerificationInput {
  request: AsyncRankingRequest;
  /** Current text of the field, or null when the field has gone. */
  currentText: string | null;
  /** Request id the field is currently waiting on. */
  activeRequestId: string | undefined;
  /** Session the field currently holds. */
  currentSessionId: string;
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; cause: RejectionCause };

/**
 * Decides whether an asynchronous answer may still be used.
 *
 * Deliberately strict and deliberately ordered: the cheapest, most decisive
 * checks run first, and the target-span check runs last because it is the one
 * that actually protects the text.
 */
export function verifyResponse(input: VerificationInput): VerificationResult {
  const { request, currentText } = input;

  if (currentText === null) return { ok: false, cause: 'field-gone' };
  if (input.activeRequestId !== request.requestId) {
    return { ok: false, cause: 'superseded' };
  }
  if (input.currentSessionId !== request.sessionId) {
    return { ok: false, cause: 'field-changed' };
  }

  const sentence = currentText.slice(
    request.baseOffset,
    request.baseOffset + request.sentenceText.length,
  );
  if (fingerprintOf(sentence) !== request.fingerprint) {
    return { ok: false, cause: 'sentence-changed' };
  }

  // The span must still hold exactly the text the provider was told about.
  // Everything above can pass while this fails, if the user edited inside the
  // span and back out again to the same length.
  const target = currentText.slice(request.targetStart, request.targetEnd);
  if (target !== request.targetText) return { ok: false, cause: 'target-moved' };

  return { ok: true };
}

/**
 * One request in flight per field, with backoff after repeated staleness.
 *
 * A page that rewrites its own text constantly (rich editors do) will
 * invalidate every answer. Without the backoff the lane spends the user's CPU
 * producing results it must then throw away.
 */
export class AsyncRankingQueue {
  private active = new Map<string, string>();
  private staleStreak = new Map<string, number>();
  private backoffUntil = new Map<string, number>();

  /** Streak length at which a field is rested. */
  static readonly STALE_LIMIT = 3;
  /** How long a rested field is left alone. */
  static readonly BACKOFF_MS = 5_000;

  canRequest(fieldId: string, now = Date.now()): boolean {
    if (this.active.has(fieldId)) return false;
    return (this.backoffUntil.get(fieldId) ?? 0) <= now;
  }

  begin(fieldId: string, requestId: string): void {
    this.active.set(fieldId, requestId);
  }

  activeRequest(fieldId: string): string | undefined {
    return this.active.get(fieldId);
  }

  /** Records the outcome and returns whether the field is now in backoff. */
  settle(fieldId: string, accepted: boolean, now = Date.now()): boolean {
    this.active.delete(fieldId);
    if (accepted) {
      this.staleStreak.delete(fieldId);
      this.backoffUntil.delete(fieldId);
      return false;
    }
    const streak = (this.staleStreak.get(fieldId) ?? 0) + 1;
    this.staleStreak.set(fieldId, streak);
    if (streak >= AsyncRankingQueue.STALE_LIMIT) {
      this.staleStreak.set(fieldId, 0);
      this.backoffUntil.set(fieldId, now + AsyncRankingQueue.BACKOFF_MS);
      return true;
    }
    return false;
  }

  cancel(fieldId: string): void {
    this.active.delete(fieldId);
  }
}

/**
 * The strongest action an asynchronous provider may ever request.
 *
 * Suggestion-only, without exception, until a specific label has been measured
 * in shadow mode and promoted deliberately. A provider cannot raise this by
 * returning a higher action: the value is applied to whatever it returns.
 */
export const ASYNC_MAX_ACTION: ProposalAction = 'suggest';

export function capAsyncAction(action: ProposalAction): ProposalAction {
  return action === 'autocorrect' ? ASYNC_MAX_ACTION : action;
}

/** Nothing implements this yet; the registry exists so wiring one is additive. */
export const asyncContextProviders: AsyncContextProvider[] = [];

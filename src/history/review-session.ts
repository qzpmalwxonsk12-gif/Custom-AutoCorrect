/**
 * Guided-review state machine. Pure and serialisable so the side panel, the
 * content script and the tests all agree on "which correction is item 4 of 15".
 */
import type { CorrectionRecord } from '../shared/types.js';

export interface ReviewState {
  /** Ordered record ids captured when review started. */
  queue: string[];
  index: number;
  /** Ids the user has acted on during this review. */
  handled: string[];
  startedAt: number;
}

export type ReviewDecision =
  | 'keep'
  | 'keep-no-learn'
  | 'revert'
  | 'revert-lower-confidence'
  | 'revert-never'
  | 'revert-dictionary'
  | 'revert-context'
  | 'skip';

export function startReview(records: readonly CorrectionRecord[]): ReviewState {
  const queue = records
    .filter((r) => r.status === 'pending' || r.status === 'skipped')
    .slice()
    .sort((a, b) => a.anchor.approximateOffset - b.anchor.approximateOffset)
    .map((r) => r.id);
  return { queue, index: 0, handled: [], startedAt: Date.now() };
}

export function currentId(state: ReviewState): string | undefined {
  return state.queue[state.index];
}

export function progress(state: ReviewState): { position: number; total: number } {
  return { position: Math.min(state.index + 1, state.queue.length), total: state.queue.length };
}

export function isComplete(state: ReviewState): boolean {
  return state.queue.length === 0 || state.index >= state.queue.length;
}

export function advance(state: ReviewState): ReviewState {
  return { ...state, index: Math.min(state.index + 1, state.queue.length) };
}

export function retreat(state: ReviewState): ReviewState {
  return { ...state, index: Math.max(state.index - 1, 0) };
}

export function markHandled(state: ReviewState, id: string): ReviewState {
  return state.handled.includes(id) ? state : { ...state, handled: [...state.handled, id] };
}

export function jumpTo(state: ReviewState, id: string): ReviewState {
  const i = state.queue.indexOf(id);
  return i === -1 ? state : { ...state, index: i };
}

/**
 * Drops ids that are no longer reviewable (e.g. the record was deleted), while
 * keeping the caret on the nearest surviving item.
 */
export function reconcile(state: ReviewState, records: readonly CorrectionRecord[]): ReviewState {
  const alive = new Set(records.map((r) => r.id));
  const currentIdBefore = state.queue[state.index];
  const queue = state.queue.filter((id) => alive.has(id));
  if (queue.length === state.queue.length) return state;
  const idx = currentIdBefore ? queue.indexOf(currentIdBefore) : -1;
  return { ...state, queue, index: idx >= 0 ? idx : Math.min(state.index, queue.length) };
}

/** Maps a review decision to the record status it produces. */
export function decisionStatus(decision: ReviewDecision): CorrectionRecord['status'] {
  switch (decision) {
    case 'keep':
    case 'keep-no-learn':
      return 'accepted';
    case 'skip':
      return 'skipped';
    default:
      return 'reverted';
  }
}

/** Maps a review decision to the learning signal it carries. */
export function decisionRejectionReason(
  decision: ReviewDecision,
): CorrectionRecord['rejectionReason'] | undefined {
  switch (decision) {
    case 'keep':
      return undefined;
    case 'keep-no-learn':
      return 'keep-no-learn';
    case 'revert':
      return 'revert-once';
    case 'revert-lower-confidence':
      return 'lower-confidence';
    case 'revert-never':
      return 'never-this-pair';
    case 'revert-dictionary':
      return 'never-correct-word';
    case 'revert-context':
      return 'not-in-this-context';
    case 'skip':
      return undefined;
  }
}

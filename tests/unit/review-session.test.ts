import { describe, expect, it } from 'vitest';
import {
  advance,
  currentId,
  decisionRejectionReason,
  decisionStatus,
  isComplete,
  jumpTo,
  markHandled,
  progress,
  reconcile,
  retreat,
  startReview,
} from '../../src/history/review-session.js';
import { transition } from '../../src/history/correction-record.js';
import { recordAt } from '../helpers.js';

const TEXT = 'One what here. Two what there. Three what everywhere.';

function queueOf(n: number) {
  const records = [];
  for (let i = 0; i < n; i++) {
    const index = TEXT.indexOf('what', i === 0 ? 0 : TEXT.indexOf('what') + i);
    records.push(recordAt(TEXT, index === -1 ? 4 : index, 'waht', 'what'));
  }
  return records;
}

describe('startReview', () => {
  it('queues only reviewable records, in document order', () => {
    const records = queueOf(3);
    records[0]!.anchor.approximateOffset = 40;
    records[1]!.anchor.approximateOffset = 4;
    records[2]!.anchor.approximateOffset = 20;
    transition(records[2]!, 'accepted');

    const state = startReview(records);
    expect(state.queue).toEqual([records[1]!.id, records[0]!.id]);
    expect(progress(state)).toEqual({ position: 1, total: 2 });
  });

  it('includes skipped records so they come back around', () => {
    const records = queueOf(2);
    transition(records[0]!, 'skipped');
    expect(startReview(records).queue).toHaveLength(2);
  });

  it('produces an empty queue when nothing is pending', () => {
    const records = queueOf(1);
    transition(records[0]!, 'accepted');
    const state = startReview(records);
    expect(state.queue).toHaveLength(0);
    expect(isComplete(state)).toBe(true);
  });
});

describe('navigation', () => {
  it('walks forwards and backwards without leaving the queue', () => {
    const records = queueOf(3);
    let state = startReview(records);
    expect(progress(state).position).toBe(1);
    state = advance(state);
    expect(progress(state)).toEqual({ position: 2, total: 3 });
    state = retreat(retreat(state));
    expect(progress(state).position).toBe(1);
    state = advance(advance(advance(state)));
    expect(isComplete(state)).toBe(true);
    expect(currentId(state)).toBeUndefined();
  });

  it('jumps to a specific record', () => {
    const records = queueOf(3);
    const state = jumpTo(startReview(records), records[2]!.id);
    expect(currentId(state)).toBe(records[2]!.id);
  });

  it('ignores a jump to an unknown id', () => {
    const state = startReview(queueOf(2));
    expect(jumpTo(state, 'nope')).toBe(state);
  });

  it('tracks handled records once each', () => {
    let state = startReview(queueOf(2));
    const id = currentId(state)!;
    state = markHandled(markHandled(state, id), id);
    expect(state.handled).toEqual([id]);
  });
});

describe('reconcile', () => {
  it('drops deleted records and keeps the caret sensible', () => {
    const records = queueOf(3);
    let state = advance(startReview(records));
    const surviving = [records[0]!, records[2]!];
    state = reconcile(state, surviving);
    expect(state.queue).toHaveLength(2);
    expect(state.index).toBeLessThanOrEqual(state.queue.length);
  });

  it('is a no-op when nothing was removed', () => {
    const records = queueOf(2);
    const state = startReview(records);
    expect(reconcile(state, records)).toBe(state);
  });
});

describe('decision mapping', () => {
  it('maps decisions to statuses', () => {
    expect(decisionStatus('keep')).toBe('accepted');
    expect(decisionStatus('keep-no-learn')).toBe('accepted');
    expect(decisionStatus('skip')).toBe('skipped');
    expect(decisionStatus('revert')).toBe('reverted');
    expect(decisionStatus('revert-never')).toBe('reverted');
  });

  it('maps decisions to learning signals', () => {
    expect(decisionRejectionReason('keep')).toBeUndefined();
    expect(decisionRejectionReason('keep-no-learn')).toBe('keep-no-learn');
    expect(decisionRejectionReason('revert')).toBe('revert-once');
    expect(decisionRejectionReason('revert-lower-confidence')).toBe('lower-confidence');
    expect(decisionRejectionReason('revert-never')).toBe('never-this-pair');
    expect(decisionRejectionReason('revert-dictionary')).toBe('never-correct-word');
    expect(decisionRejectionReason('revert-context')).toBe('not-in-this-context');
  });
});

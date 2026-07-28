import { describe, expect, it } from 'vitest';
import { SweepPlan, chunksOf } from '../../src/content/sweep-plan.js';
import { findRepeatedWord, findRepeatedWordIn } from '../../src/engine/repeated-words.js';
import {
  findCapitalisation,
  findCapitalisationIn,
} from '../../src/engine/sentence-capitalisation.js';

describe('chunksOf', () => {
  it('splits text into sentences', () => {
    const chunks = chunksOf('One here. Two here. Three here.');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.start).toBe(0);
  });

  it('gives identical text identical fingerprints', () => {
    const a = chunksOf('The cat sat.');
    const b = chunksOf('The cat sat.');
    expect(a[0]!.fingerprint).toBe(b[0]!.fingerprint);
  });

  it('gives different text different fingerprints', () => {
    const a = chunksOf('The cat sat.')[0]!;
    const b = chunksOf('The dog sat.')[0]!;
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('skips whitespace-only fragments', () => {
    expect(chunksOf('   \n\n   ')).toHaveLength(0);
  });
});

describe('SweepPlan', () => {
  const text = 'One here. Two here. Three here.';

  it('hands out chunks in document order', () => {
    const plan = new SweepPlan();
    const first = plan.next(text, 1)!;
    expect(first.start).toBe(0);
  });

  it('stops handing out a chunk once it reaches the pass target', () => {
    const plan = new SweepPlan();
    const chunk = plan.next(text, 1)!;
    plan.recordClean(chunk.fingerprint, 1);
    expect(plan.next(text, 1)!.fingerprint).not.toBe(chunk.fingerprint);
  });

  it('reports progress and completion', () => {
    const plan = new SweepPlan();
    expect(plan.progress(text, 1)).toEqual({ done: 0, total: 3, complete: false });
    for (const chunk of chunksOf(text)) plan.recordClean(chunk.fingerprint, 1);
    expect(plan.progress(text, 1)).toEqual({ done: 3, total: 3, complete: true });
    expect(plan.next(text, 1)).toBeNull();
  });

  /**
   * The whole point of the design: appending text must not re-check text that
   * has already been checked.
   */
  it('only queues newly added sentences', () => {
    const plan = new SweepPlan();
    for (const chunk of chunksOf(text)) plan.recordClean(chunk.fingerprint, 3);
    expect(plan.progress(text, 3).complete).toBe(true);

    const longer = `${text} Four here.`;
    const progress = plan.progress(longer, 3);
    expect(progress).toEqual({ done: 3, total: 4, complete: false });
    // And the one it hands back is the new one.
    expect(plan.next(longer, 3)!.start).toBeGreaterThan(text.length - 1);
  });

  it('re-queues a sentence that was edited', () => {
    const plan = new SweepPlan();
    for (const chunk of chunksOf(text)) plan.recordClean(chunk.fingerprint, 3);
    const edited = 'One there. Two here. Three here.';
    expect(plan.progress(edited, 3).done).toBe(2);
    expect(plan.next(edited, 3)!.start).toBe(0);
  });

  /**
   * A clean pass over unchanged text is deterministic, so repeating it cannot
   * find anything new. Crediting the remaining passes at once is what keeps a
   * 5-pass setting from costing five times the work.
   */
  it('credits every remaining pass when a chunk comes back clean', () => {
    const plan = new SweepPlan();
    const chunk = chunksOf(text)[0]!;
    plan.recordClean(chunk.fingerprint, 5);
    expect(plan.passesFor(chunk.fingerprint)).toBe(5);
  });

  it('credits only one pass when a provider has not answered yet', () => {
    const plan = new SweepPlan();
    const chunk = chunksOf(text)[0]!;
    plan.recordClean(chunk.fingerprint, 5, false);
    expect(plan.passesFor(chunk.fingerprint)).toBe(1);
    plan.recordClean(chunk.fingerprint, 5, false);
    expect(plan.passesFor(chunk.fingerprint)).toBe(2);
  });

  it('forgets a chunk that was changed', () => {
    const plan = new SweepPlan();
    const chunk = chunksOf(text)[0]!;
    plan.recordClean(chunk.fingerprint, 3);
    plan.forget(chunk.fingerprint);
    expect(plan.passesFor(chunk.fingerprint)).toBe(0);
  });

  it('reset queues everything again', () => {
    const plan = new SweepPlan();
    for (const chunk of chunksOf(text)) plan.recordClean(chunk.fingerprint, 3);
    plan.reset();
    expect(plan.progress(text, 3).done).toBe(0);
  });

  /** "Check this selection" jumps the queue without skipping anything. */
  it('finishes a prioritised range before the rest of the field', () => {
    const plan = new SweepPlan();
    const third = chunksOf(text)[2]!;
    plan.prioritise({ start: third.start, end: third.end });

    expect(plan.next(text, 1)!.fingerprint).toBe(third.fingerprint);
    plan.recordClean(third.fingerprint, 1);

    // Range exhausted, so the sweep returns to document order.
    expect(plan.next(text, 1)!.start).toBe(0);
    expect(plan.hasPriority()).toBe(false);
  });

  it('includes a chunk the range only partly overlaps', () => {
    const plan = new SweepPlan();
    // A selection rarely lands exactly on a sentence boundary.
    plan.prioritise({ start: 12, end: 14 });
    expect(plan.next(text, 1)!.start).toBe(10);
  });

  it('ignores an empty or reversed range', () => {
    const plan = new SweepPlan();
    plan.prioritise({ start: 10, end: 10 });
    expect(plan.hasPriority()).toBe(false);
    plan.prioritise(null);
    expect(plan.next(text, 1)!.start).toBe(0);
  });

  it('treats a pass target below one as one', () => {
    const plan = new SweepPlan();
    const chunk = chunksOf(text)[0]!;
    plan.recordClean(chunk.fingerprint, 0);
    expect(plan.progress(text, 0).done).toBe(1);
  });
});

describe('findRepeatedWord', () => {
  it('finds the repeat ending at the given position', () => {
    const text = 'What what are you doing';
    const found = findRepeatedWord(text, 9);
    expect(found).toMatchObject({ start: 0, end: 9, replacementText: 'What' });
  });

  it('returns nothing when the words differ', () => {
    expect(findRepeatedWord('What when are', 9)).toBeNull();
  });

  it('ignores legitimate doubles', () => {
    expect(findRepeatedWord('I had had enough', 9)).toBeNull();
    expect(findRepeatedWord('said that that was', 14)).toBeNull();
  });

  it('requires whitespace between the two words', () => {
    // A comma means the repetition is structural, not a stutter.
    expect(findRepeatedWord('New York, York here', 14)).toBeNull();
  });

  it('is case-insensitive but keeps the first spelling', () => {
    const found = findRepeatedWord('The the cat', 7);
    expect(found?.replacementText).toBe('The');
  });

  it('scans a range and returns the first repeat', () => {
    const text = 'One one here and two two there';
    const found = findRepeatedWordIn(text, 0, text.length);
    expect(found?.originalText).toBe('One one');
  });

  it('respects range bounds', () => {
    const text = 'One one here and two two there';
    const found = findRepeatedWordIn(text, 13, text.length);
    expect(found?.originalText).toBe('two two');
  });
});

describe('findCapitalisation', () => {
  it('capitalises the standalone pronoun i', () => {
    const found = findCapitalisation('what if i was', 9);
    expect(found).toMatchObject({ replacementText: 'I', kind: 'pronoun-i' });
  });

  it('capitalises a sentence start', () => {
    const found = findCapitalisation('Hello. there we go', 12);
    expect(found).toMatchObject({ replacementText: 'There', kind: 'sentence-start' });
  });

  it('leaves a mid-sentence word alone', () => {
    expect(findCapitalisation('the cat sat', 7)).toBeNull();
  });

  it('does not capitalise after an abbreviation', () => {
    expect(findCapitalisation('Meet Dr. smith now', 13)).toBeNull();
    expect(findCapitalisation('Apples etc. and more', 15)).toBeNull();
  });

  /**
   * "Sat." is Saturday but "he sat." ends a sentence. Only the capitalised
   * form is treated as an abbreviation.
   */
  it('still capitalises after a word that merely looks like an abbreviation', () => {
    expect(findCapitalisation('He sat. then he left.', 12)?.replacementText).toBe('Then');
    expect(findCapitalisation('Meet Sat. then leave.', 14)).toBeNull();
  });

  it('leaves mixed-case styles alone', () => {
    expect(findCapitalisation('The iPhone here', 10)).toBeNull();
  });

  it('leaves an already-capitalised word alone', () => {
    expect(findCapitalisation('Hello. There we go', 12)).toBeNull();
  });

  it('scans a range and returns the first fix', () => {
    const text = 'The cat sat. then i left.';
    const found = findCapitalisationIn(text, 0, text.length);
    expect(found?.replacementText).toBe('Then');
  });
});

describe('repeated single letters', () => {
  it('finds a repeated one-letter word', () => {
    // The spelling engine ignores one-letter tokens by design; that floor must
    // not stop a duplicate being noticed.
    const found = findRepeatedWord('what if i i was', 11);
    expect(found).toMatchObject({ originalText: 'i i', replacementText: 'i' });
  });

  it('still respects the other protections', () => {
    expect(findRepeatedWord('see a/a here', 5)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { applyEdit, planReapply, planRevert, shiftCaret } from '../../src/history/correction-reverter.js';
import { recordAt } from '../helpers.js';

describe('planRevert', () => {
  it('restores the original word', () => {
    const text = 'I think what happened was fine.';
    const record = recordAt(text, 8, 'waht', 'what');
    const outcome = planRevert(text, record);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(applyEdit(text, outcome.edit)).toBe('I think waht happened was fine.');
  });

  it('preserves the capitalisation actually present in the document', () => {
    const text = 'What happened was fine.';
    const record = recordAt(text, 0, 'waht', 'what');
    const outcome = planRevert(text, record);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Recorded original was lower-case; the document shows title case.
    expect(applyEdit(text, outcome.edit)).toBe('Waht happened was fine.');
  });

  it('reverts only the intended occurrence when the word repeats', () => {
    const text = 'I know what you mean. I think what happened was fine. Ask what next.';
    const target = text.indexOf('what happened');
    const record = recordAt(text, target, 'waht', 'what');
    const outcome = planRevert(text, record);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = applyEdit(text, outcome.edit);
    expect(after).toBe('I know what you mean. I think waht happened was fine. Ask what next.');
    expect(after.match(/waht/g)).toHaveLength(1);
  });

  it('still works after the surrounding paragraph moved', () => {
    const text = 'I think what happened was fine.';
    const record = recordAt(text, 8, 'waht', 'what');
    const edited = 'A brand new opening paragraph.\n\nI think what happened was fine.';
    const outcome = planRevert(edited, record);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(applyEdit(edited, outcome.edit)).toContain('I think waht happened');
  });

  it('refuses when the replacement is gone', () => {
    const text = 'I think what happened was fine.';
    const record = recordAt(text, 8, 'waht', 'what');
    const outcome = planRevert('Completely different text now.', record);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('missing');
    expect(outcome.message).toContain('what');
  });

  it('refuses when duplicates cannot be told apart', () => {
    const text = 'what what what what';
    const record = recordAt(text, 5, 'waht', 'what', 0);
    const outcome = planRevert(`${'filler '.repeat(80)}${text}`, record);
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== 'ambiguous') throw new Error('expected ambiguity');
    expect(outcome.candidates.length).toBeGreaterThan(1);
  });

  it('never reverts from a stale offset alone', () => {
    // The offset still points inside the text, but at different content.
    const text = 'I think what happened was fine.';
    const record = recordAt(text, 8, 'waht', 'what');
    const rewritten = 'I think that nothing at all happened here today.';
    const outcome = planRevert(rewritten, record);
    expect(outcome.ok).toBe(false);
  });

});

describe('planReapply', () => {
  it('puts the replacement back after a revert', () => {
    const corrected = 'I think what happened was fine.';
    const record = recordAt(corrected, 8, 'waht', 'what');
    const reverted = 'I think waht happened was fine.';
    const outcome = planReapply(reverted, record);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(applyEdit(reverted, outcome.edit)).toBe(corrected);
  });
});

describe('shiftCaret', () => {
  const edit = { start: 8, end: 12, insert: 'waht' };

  it('leaves a caret before the edit alone', () => {
    expect(shiftCaret(3, edit)).toBe(3);
  });

  it('shifts a caret after the edit by the length delta', () => {
    expect(shiftCaret(20, { start: 8, end: 12, insert: 'wa' })).toBe(18);
    expect(shiftCaret(20, { start: 8, end: 12, insert: 'whatever' })).toBe(24);
  });

  it('collapses a caret inside the edit to the end of the insert', () => {
    expect(shiftCaret(10, edit)).toBe(12);
  });
});

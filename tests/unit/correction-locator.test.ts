import { describe, expect, it } from 'vitest';
import { createAnchor, occurrenceIndexOf, refreshAnchor } from '../../src/history/anchor.js';
import { findWholeWordOccurrences, locate } from '../../src/history/correction-locator.js';

/** Builds the anchor for the nth occurrence of `word` in `text`. */
function anchorFor(text: string, word: string, original: string, nth = 0, radius = 32) {
  let index = -1;
  for (let i = 0; i <= nth; i++) index = text.indexOf(word, index + 1);
  return createAnchor({
    text,
    start: index,
    end: index + word.length,
    originalText: original,
    replacementText: word,
    contextRadius: radius,
  });
}

describe('anchor creation', () => {
  it('captures bounded context on both sides', () => {
    const text = 'I think what happened was interesting';
    const anchor = anchorFor(text, 'what', 'waht');
    expect(anchor.textBefore).toBe('I think ');
    expect(anchor.textAfter.startsWith(' happened')).toBe(true);
    expect(anchor.approximateOffset).toBe(8);
    expect(anchor.paragraphFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('stores nothing but the words when the radius is zero', () => {
    const anchor = anchorFor('I think what happened', 'what', 'waht', 0, 0);
    expect(anchor.textBefore).toBe('');
    expect(anchor.textAfter).toBe('');
    expect(anchor.originalText).toBe('waht');
  });

  it('records which occurrence it was', () => {
    const text = 'what a what a what';
    expect(anchorFor(text, 'what', 'waht', 0).occurrenceIndex).toBe(0);
    expect(anchorFor(text, 'what', 'waht', 2).occurrenceIndex).toBe(2);
    expect(occurrenceIndexOf(text, 'what', text.length)).toBe(3);
  });
});

describe('locate', () => {
  const text = 'I think what happened was fine.';
  const anchor = anchorFor(text, 'what', 'waht');

  it('finds an untouched correction', () => {
    const result = locate(text, anchor);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.start).toBe(8);
      expect(result.end).toBe(12);
      expect(result.score).toBeGreaterThan(0.9);
    }
  });

  it('finds it after text is inserted above', () => {
    const shifted = 'A new first paragraph.\n\nAnother line here.\n\n' + text;
    const result = locate(shifted, anchor);
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(shifted.slice(result.start, result.end)).toBe('what');
  });

  it('finds it after nearby words change', () => {
    const edited = 'I really think what actually happened was fine.';
    const result = locate(edited, anchor);
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.start).toBe(edited.indexOf('what'));
  });

  it('reports missing when the word is gone', () => {
    expect(locate('I think something else happened.', anchor).status).toBe('missing');
  });

  it('picks the right one of several identical words', () => {
    const many =
      'What a day. I think what happened was fine. He asked what happened next, and what a mess.';
    const target = many.indexOf('what happened was');
    const a = createAnchor({
      text: many,
      start: target,
      end: target + 4,
      originalText: 'waht',
      replacementText: 'what',
      contextRadius: 32,
    });
    const result = locate(many, a);
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.start).toBe(target);
  });

  it('refuses to guess when duplicates are indistinguishable', () => {
    // Same word, same surrounding words, no stored context to tell them apart.
    const repeated = 'what what what what';
    const a = createAnchor({
      text: repeated,
      start: 5,
      end: 9,
      originalText: 'waht',
      replacementText: 'what',
      contextRadius: 0,
    });
    const rewritten = 'x '.repeat(300) + repeated;
    const result = locate(rewritten, a);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('can search for the original text after a revert', () => {
    const reverted = 'I think waht happened was fine.';
    const result = locate(reverted, anchor, { target: 'original' });
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(reverted.slice(result.start, result.end)).toBe('waht');
  });

  it('matches case-insensitively but reports exact case', () => {
    const capitalised = 'I think What happened was fine.';
    const result = locate(capitalised, anchor);
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.exactCase).toBe(false);
  });

  it('uses the searched original text for exact-case scoring', () => {
    const a = {
      approximateOffset: 3,
      textBefore: '',
      originalText: 'Waht',
      replacementText: 'what',
      textAfter: '',
      occurrenceIndex: 99,
    };
    const result = locate('waht  Waht', a, {
      target: 'original',
      minScore: 0,
      margin: 0,
    });
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.start).toBe(6);
  });

  it('considers a strongly anchored occurrence after the first 400 matches', () => {
    const text = Array.from(
      { length: 450 },
      (_, index) => `row ${index} has what marker ${index}`,
    ).join('\n');
    const target = text.indexOf('what', text.indexOf('row 430'));
    const a = createAnchor({
      text,
      start: target,
      end: target + 4,
      originalText: 'waht',
      replacementText: 'what',
      contextRadius: 32,
    });
    const result = locate(text, a);
    expect(result.status).toBe('found');
    if (result.status === 'found') expect(result.start).toBe(target);
  });

  it('ignores substrings inside larger words', () => {
    expect(findWholeWordOccurrences('somewhat whatever what', 'what', 10)).toEqual([18]);
  });
});

describe('refreshAnchor', () => {
  it('re-reads the context after the text moved', () => {
    const text = 'I think what happened was fine.';
    const anchor = anchorFor(text, 'what', 'waht');
    const moved = 'Intro line.\n\nI think what happened was fine.';
    const start = moved.indexOf('what');
    const next = refreshAnchor(anchor, moved, start, start + 4, 32);
    expect(next.approximateOffset).toBe(start);
    expect(next.textBefore.endsWith('I think ')).toBe(true);
    expect(next.originalText).toBe('waht');
  });

  it('clears previously stored context when the radius becomes zero', () => {
    const text = 'I think what happened was fine.';
    const anchor = anchorFor(text, 'what', 'waht');
    const start = text.indexOf('what');
    const next = refreshAnchor(anchor, text, start, start + 4, 0);
    expect(next.textBefore).toBe('');
    expect(next.textAfter).toBe('');
  });
});

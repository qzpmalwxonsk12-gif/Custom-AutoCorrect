import { describe, expect, it } from 'vitest';
import { classifyEdit, damerauLevenshtein, isTransposition } from '../../src/engine/edit-distance.js';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('what', 'what')).toBe(0);
  });

  it('counts an adjacent transposition as one edit', () => {
    expect(damerauLevenshtein('waht', 'what')).toBe(1);
    expect(damerauLevenshtein('teh', 'the')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(damerauLevenshtein('lettter', 'letter')).toBe(1);
    expect(damerauLevenshtein('wrd', 'word')).toBe(1);
    expect(damerauLevenshtein('seperate', 'separate')).toBe(1);
    expect(damerauLevenshtein('accomodate', 'accommodate')).toBe(1);
  });

  it('treats the classic vowel swaps as a single transposition', () => {
    // "becuase"/"recieve" look like two errors but are one swap.
    expect(damerauLevenshtein('becuase', 'because')).toBe(1);
    expect(damerauLevenshtein('recieve', 'receive')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
  });

  it('short-circuits above the bound', () => {
    expect(damerauLevenshtein('abcdefgh', 'zyxwvuts', 2)).toBe(3);
    // Length difference alone can exceed the bound.
    expect(damerauLevenshtein('a', 'abcdefghij', 3)).toBe(4);
  });

  it('agrees with the unbounded result when under the bound', () => {
    expect(damerauLevenshtein('waht', 'what', 3)).toBe(1);
  });
});

describe('classifyEdit', () => {
  it('identifies transpositions', () => {
    expect(classifyEdit('waht', 'what')).toBe('transposition');
    expect(classifyEdit('teh', 'the')).toBe('transposition');
    expect(classifyEdit('recieve', 'receive')).toBe('transposition');
    expect(isTransposition('adn', 'and')).toBe(true);
  });

  it('identifies doubled letters separately from plain deletions', () => {
    expect(classifyEdit('lettter', 'letter')).toBe('doubled');
    expect(classifyEdit('worlkd', 'world')).toBe('deletion');
  });

  it('identifies missing letters', () => {
    expect(classifyEdit('wrd', 'word')).toBe('insertion');
  });

  it('identifies substitutions', () => {
    expect(classifyEdit('wodd', 'word')).toBe('substitution');
  });

  it('falls back to other for multi-edit differences', () => {
    expect(classifyEdit('abc', 'xyz')).toBe('other');
    expect(classifyEdit('hello', 'goodbye')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(classifyEdit('Waht', 'what')).toBe('transposition');
  });
});

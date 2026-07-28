import { describe, expect, it } from 'vitest';
import { diffSingleWord } from '../../src/engine/manual-edit-diff.js';

describe('diffSingleWord', () => {
  it('detects a single retyped word', () => {
    const before = 'I think waht happened was fine.';
    const after = 'I think what happened was fine.';
    expect(diffSingleWord(before, after)).toMatchObject({ original: 'waht', replacement: 'what' });
  });

  it('expands partial edits to whole words', () => {
    // The user deleted one character and typed another inside the word.
    expect(diffSingleWord('the recieve line', 'the receive line')).toMatchObject({
      original: 'recieve',
      replacement: 'receive',
    });
  });

  it('returns null for identical text', () => {
    expect(diffSingleWord('same', 'same')).toBeNull();
  });

  it('ignores large pastes and bulk deletions', () => {
    const before = 'short text';
    const after = `short text ${'lorem ipsum '.repeat(10)}`;
    expect(diffSingleWord(before, after)).toBeNull();
    expect(diffSingleWord(after, before)).toBeNull();
  });

  it('ignores multi-word rewrites', () => {
    expect(diffSingleWord('I think so', 'I believe not')).toBeNull();
  });

  it('ignores changes involving numbers, code and URLs', () => {
    expect(diffSingleWord('value is 12', 'value is 13')).toBeNull();
    expect(diffSingleWord('call getX()', 'call getY()')).toBeNull();
    expect(diffSingleWord('see http://a.example', 'see http://b.example')).toBeNull();
  });

  it('ignores a pure insertion of a new word', () => {
    // Nothing was corrected; a word was added.
    const result = diffSingleWord('I think happened', 'I think it happened');
    expect(result?.original === result?.replacement || result === null).toBe(true);
  });

  it('handles an edit at the very start of the text', () => {
    expect(diffSingleWord('teh start', 'the start')).toMatchObject({
      original: 'teh',
      replacement: 'the',
    });
  });

  it('handles an edit at the very end of the text', () => {
    expect(diffSingleWord('at the end teh', 'at the end the')).toMatchObject({
      original: 'teh',
      replacement: 'the',
    });
  });
});

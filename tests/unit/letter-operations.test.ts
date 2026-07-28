/**
 * Duplicate-letter removal, missing-letter insertion, extra-letter deletion,
 * and the operation-cost ranking that keeps a one-edit explanation ahead of a
 * superficially similar same-length bucket match.
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/engine/correction-engine.js';
import {
  createCandidateDiagnostics,
  generateCandidates,
  generateDeletionCandidates,
  generateDuplicateLetterCandidates,
  generateInsertionCandidates,
  OPERATION_COST,
} from '../../src/engine/candidate-generator.js';
import { isKnownWord, normaliseDictionaryWord } from '../../src/engine/data/dictionary.js';
import { learning, settings } from '../helpers.js';

/** Runs the full engine on the word ending the given text. */
function correctWord(word: string, sentence = `I will ${word} `) {
  const index = sentence.indexOf(word);
  const result = analyze(
    { text: sentence, wordEnd: index + word.length, origin: 'https://example.com' },
    learning(),
    settings(),
  );
  return result?.proposal ?? null;
}

describe('duplicate-letter removal', () => {
  for (const [typo, expected] of [
    ['punctuatioon', 'punctuation'],
    ['commmon', 'common'],
    ['helllo', 'hello'],
    ['adddress', 'address'],
  ] as const) {
    it(`${typo} -> ${expected}`, () => {
      const proposal = correctWord(typo);
      expect(proposal?.replacement).toBe(expected);
      expect(proposal?.correctionType).toBe('duplicate-letter');
    });
  }

  it('reports which character was removed', () => {
    const candidates = generateDuplicateLetterCandidates('punctuatioon');
    const hit = candidates.find((c) => c.word === 'punctuation');
    expect(hit?.duplicateLetter).toEqual({ removedIndex: 10, removedCharacter: 'o' });
    expect(hit?.operationCost).toBe(OPERATION_COST.duplicateLetter);
  });

  it('explains the operation in the proposal reason', () => {
    const proposal = correctWord('punctuatioon');
    expect(proposal?.reason).toContain('duplicate letter');
    expect(proposal?.letterEvidence).toEqual({ removedIndex: 10, removedCharacter: 'o' });
  });

  for (const valid of ['book', 'coffee', 'letter', 'address', 'success', 'committee']) {
    it(`leaves the valid word "${valid}" unchanged`, () => {
      expect(isKnownWord(normaliseDictionaryWord(valid))).toBe(true);
      expect(correctWord(valid)).toBeNull();
    });
  }

  it('generates nothing when no letter repeats', () => {
    expect(generateDuplicateLetterCandidates('improve')).toEqual([]);
  });
});

describe('missing-letter insertion', () => {
  for (const [typo, expected] of [
    ['iprove', 'improve'],
    ['becuse', 'because'],
    ['thnks', 'thanks'],
  ] as const) {
    it(`${typo} -> ${expected}`, () => {
      expect(correctWord(typo)?.replacement).toBe(expected);
    });
  }

  it('generates both readings of an ambiguous insertion', () => {
    // "thnks" admits "thanks" and "thinks" as equally simple insertions, and
    // "thinks" carries the higher frequency prior. Structure alone cannot
    // decide it, so the exact-typo table resolves this pair instead.
    const words = generateInsertionCandidates('thnks').map((c) => c.word);
    expect(words).toEqual(expect.arrayContaining(['thanks', 'thinks']));
  });

  it('does not rewrite "woks", which is itself a valid word', () => {
    // The brief lists woks -> works, but "woks" is in the dictionary (plural
    // of wok). Rewriting a valid word would breach the stronger invariant
    // that a recognised word is never altered by the spelling layer.
    expect(isKnownWord(normaliseDictionaryWord('woks'))).toBe(true);
    expect(correctWord('woks')).toBeNull();
  });

  it('reports which character was inserted and where', () => {
    const candidates = generateInsertionCandidates('iprove');
    const hit = candidates.find((c) => c.word === 'improve');
    expect(hit?.missingLetter).toEqual({ insertedIndex: 1, insertedCharacter: 'm' });
    expect(hit?.operationCost).toBe(OPERATION_COST.missingLetter);
  });

  it('uses exact membership lookups, never a dictionary scan', () => {
    const diagnostics = createCandidateDiagnostics();
    generateInsertionCandidates('iprove', undefined, diagnostics);
    // 7 positions x 26 letters, minus duplicates that were already seen.
    expect(diagnostics.missingLetterGenerated).toBe(7 * 26);
    expect(diagnostics.membershipChecks).toBeLessThanOrEqual(7 * 26);
  });

  it('preserves the user capitalisation', () => {
    expect(correctWord('Iprove', 'Iprove the code ')?.replacement).toBe('Improve');
    expect(correctWord('IPROVE', 'I will IPROVE it ')?.replacement).toBe('IMPROVE');
  });
});

describe('extra-letter deletion', () => {
  it('removes a superfluous letter that is not a repeat', () => {
    const candidates = generateDeletionCandidates('worlkd');
    expect(candidates.map((c) => c.word)).toContain('world');
    const hit = candidates.find((c) => c.word === 'world');
    expect(hit?.extraLetter?.removedCharacter).toBe('k');
    expect(hit?.operationCost).toBe(OPERATION_COST.extraLetter);
  });

  it('leaves repeated-letter runs to the duplicate-letter process', () => {
    // "helllo" is handled by process 4, so process 6 must not also claim it.
    expect(generateDeletionCandidates('helllo').map((c) => c.word)).not.toContain('hello');
  });
});

describe('operation-cost ranking', () => {
  it('iprove becomes improve, never iphone', () => {
    const proposal = correctWord('iprove');
    expect(proposal?.replacement).toBe('improve');
    expect(proposal?.replacement).not.toBe('iphone');
  });

  it('ranks the one-insertion candidate above the same-length bucket match', () => {
    const candidates = generateCandidates('iprove', 10);
    const improve = candidates.findIndex((c) => c.word === 'improve');
    const iphone = candidates.findIndex((c) => c.word === 'iphone');
    expect(improve).toBeGreaterThanOrEqual(0);
    if (iphone >= 0) expect(improve).toBeLessThan(iphone);
  });

  it('assigns a higher cost to a multi-substitution bucket match', () => {
    const candidates = generateCandidates('iprove', 10);
    const improve = candidates.find((c) => c.word === 'improve');
    const iphone = candidates.find((c) => c.word === 'iphone');
    expect(improve!.operationCost).toBe(OPERATION_COST.missingLetter);
    if (iphone) expect(iphone.operationCost).toBeGreaterThan(improve!.operationCost);
  });

  it('a weak earlier process does not suppress a later one', () => {
    // Process 1 produces bucket noise for this word; the insertion candidate
    // must still be generated and must still win.
    const candidates = generateCandidates('iprove', 10);
    expect(candidates[0]!.word).toBe('improve');
    expect(candidates[0]!.process).toBe(5);
  });

  it('still prefers an adjacent swap when one exists', () => {
    expect(correctWord('owrks')?.replacement).toBe('works');
    expect(correctWord('owrks')?.correctionType).toBe('adjacent-swap');
  });
});

describe('valid words are never rewritten', () => {
  for (const word of ['improve', 'thanks', 'works', 'because', 'punctuation']) {
    it(`${word} is left alone`, () => {
      expect(correctWord(word)).toBeNull();
    });
  }
});

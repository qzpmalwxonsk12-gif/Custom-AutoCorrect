/**
 * Part 6: character-bigram plausibility.
 *
 * Weak ranking evidence. The tests below are mostly about what it must *not*
 * do — a signal that can prune candidates or outweigh a cheaper edit would be
 * far more dangerous than one that is merely useless.
 */
import { describe, expect, it } from 'vitest';
import {
  BIGRAM_METADATA,
  bigramScore,
  bigramTable,
  characterContextScore,
  wordPlausibility,
} from '../../src/engine/context/character-context.js';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';

const CHAR_ON = { ...DEFAULT_WEIGHTS, characterContext: 0.03 };

describe('the bigram table', () => {
  it('is a complete 26x26 grid', () => {
    expect(bigramTable().length).toBe(676);
    expect(BIGRAM_METADATA.tableSize).toBe(676);
    expect(BIGRAM_METADATA.distinctPairs).toBe(676);
  });

  it('records provenance', () => {
    expect(BIGRAM_METADATA.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(BIGRAM_METADATA.invalidEntries).toBe(0);
    expect(BIGRAM_METADATA.scale).toBe('log');
  });

  it('ranks common pairs above rare ones', () => {
    // "th" is the most common English bigram by a wide margin.
    expect(bigramScore('t', 'h')).toBeGreaterThan(bigramScore('q', 'z'));
    expect(bigramScore('h', 'e')).toBeGreaterThan(bigramScore('x', 'j'));
    expect(bigramScore('i', 'n')).toBeGreaterThan(bigramScore('v', 'q'));
  });

  it('returns 0 outside the alphabet rather than throwing', () => {
    expect(bigramScore("'", 'a')).toBe(0);
    expect(bigramScore('a', '1')).toBe(0);
    expect(bigramScore('', '')).toBe(0);
  });
});

describe('word plausibility', () => {
  it('scores ordinary English above letter salad', () => {
    expect(wordPlausibility('the')).toBeGreaterThan(wordPlausibility('qxz'));
    expect(wordPlausibility('information')).toBeGreaterThan(wordPlausibility('zqxjkv'));
  });

  it('stays inside 0..1', () => {
    for (const word of ['a', 'the', 'information', 'zzzz', '']) {
      const score = wordPlausibility(word);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  /** An apostrophe is structure; treating it as a rare pair would punish
   *  every contraction. */
  it('ignores non-letters rather than penalising them', () => {
    expect(wordPlausibility("didn't")).toBeGreaterThan(0.2);
    expect(wordPlausibility("didn't")).toBeCloseTo(wordPlausibility('didnt'), 5);
  });

  it('gives a neutral score to something too short to have pairs', () => {
    expect(wordPlausibility('a')).toBe(0.5);
  });
});

describe('character context as a score term', () => {
  it('is signed relative to the typed word', () => {
    // Replacing a rare pair with a common one is positive evidence.
    expect(characterContextScore('teh', 'the')).toBeGreaterThan(0);
  });

  it('stays inside -1..1', () => {
    for (const [typed, candidate] of [
      ['teh', 'the'],
      ['the', 'qxz'],
      ['zzzz', 'the'],
      ['information', 'information'],
    ] as const) {
      const score = characterContextScore(typed, candidate);
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('contributes nothing at weight zero', () => {
    const candidates = generateCandidates('teh', 5);
    const ranked = rankCandidates(candidates, DEFAULT_WEIGHTS, { typedWord: 'teh' });
    for (const scored of ranked) expect(scored.terms.characterContext).toBe(0);
  });

  it('contributes once its weight is raised', () => {
    const candidates = generateCandidates('teh', 5);
    const ranked = rankCandidates(candidates, CHAR_ON, { typedWord: 'teh' });
    expect(ranked.some((s) => s.terms.characterContext !== 0)).toBe(true);
  });

  /** The two safety properties, asserted rather than described. */
  it('never removes a candidate', () => {
    const candidates = generateCandidates('punctuatioon', 10);
    const ranked = rankCandidates(candidates, CHAR_ON, { typedWord: 'punctuatioon' });
    expect(ranked).toHaveLength(candidates.length);
  });

  it('never overrides a cheaper edit', () => {
    for (const word of ['iprove', 'punctuatioon', 'mastter', 'teh', 'worlkd']) {
      const candidates = generateCandidates(word, 10);
      if (candidates.length === 0) continue;
      const lowestCost = Math.min(...candidates.map((c) => c.operationCost));
      const ranked = rankCandidates(candidates, CHAR_ON, { typedWord: word });
      expect(ranked[0]!.candidate.operationCost, word).toBeLessThanOrEqual(lowestCost);
    }
  });

  it('does not disturb the shipped ranking while its weight is zero', () => {
    const candidates = generateCandidates('iprove', 10);
    const withTerm = rankCandidates(candidates, DEFAULT_WEIGHTS, { typedWord: 'iprove' });
    const without = rankCandidates(candidates, DEFAULT_WEIGHTS);
    expect(withTerm.map((s) => s.candidate.word)).toEqual(
      without.map((s) => s.candidate.word),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  createCandidateDiagnostics,
  generateAdjacentSwapCandidates,
  generateCandidates,
  generateKeyboardCandidates,
  generateSameLengthCandidates,
  type CandidateDictionary,
} from '../../src/engine/candidate-generator.js';
import { confidenceBand, decideAction, personalFactor, scoreSpelling } from '../../src/engine/confidence-scorer.js';
import { settings } from '../helpers.js';
import type { CorrectionRule } from '../../src/shared/types.js';

describe('generateCandidates', () => {
  it.each([
    ['owrks', 'works'],
    ['hte', 'the'],
    ['waht', 'what'],
    ['nromal', 'normal'],
  ])('process 2 finds the adjacent swap %s -> %s', (typed, expected) => {
    const candidate = generateAdjacentSwapCandidates(typed).find(
      ({ word }) => word === expected,
    );
    expect(candidate).toMatchObject({
      word: expected,
      process: 2,
      shape: 'transposition',
    });
  });

  it('process 2 generates exactly n - 1 adjacent swaps', () => {
    const diagnostics = createCandidateDiagnostics();
    generateAdjacentSwapCandidates('letter', undefined, diagnostics);
    expect(diagnostics.adjacentSwapsGenerated).toBe(5);
    expect(diagnostics.membershipChecks).toBe(5);
  });

  it.each([
    ['eorks', 'works'],
    ['gello', 'hello'],
    ['tge', 'the'],
  ])('process 3 finds the one-key substitution %s -> %s', (typed, expected) => {
    const candidate = generateKeyboardCandidates(typed).find(
      ({ word }) => word === expected,
    );
    expect(candidate).toMatchObject({
      word: expected,
      process: 3,
      shape: 'substitution',
    });
  });

  it('generates and ranks surrounding from surriunding with map evidence', () => {
    const candidates = generateKeyboardCandidates('surriunding');
    expect(candidates.map(({ word }) => word)).toContain('surrounding');
    expect(candidates[0]).toMatchObject({
      word: 'surrounding',
      process: 3,
      shape: 'substitution',
      keyboardSubstitution: {
        index: 4,
        typedCharacter: 'i',
        replacementCharacter: 'o',
        neighbourMapMatched: true,
        keyDistance: 1,
      },
    });
  });

  it('normalises uppercase input before generating keyboard candidates', () => {
    expect(generateKeyboardCandidates('SURRIUNDING')[0]).toMatchObject({
      word: 'surrounding',
      keyboardSubstitution: {
        typedCharacter: 'i',
        replacementCharacter: 'o',
      },
    });
  });

  it('process 1 uses only the same-length and first-letter bucket', () => {
    const lengthBuckets = new Map<number, ReadonlyMap<string, readonly string[]>>([
      [6, new Map([['n', ['normal', 'nxxxxx']], ['x', ['xormal']]])],
    ]);
    const source: CandidateDictionary = {
      words: { has: () => false },
      byLengthAndFirstLetter: lengthBuckets,
    };
    const diagnostics = createCandidateDiagnostics();

    const candidates = generateSameLengthCandidates('nromal', source, diagnostics);
    expect(diagnostics.process1Examined).toBe(2);
    expect(candidates.map(({ word }) => word)).toEqual(['normal']);
  });

  it('applies personal-history evidence before the process 1 top-ten cutoff', () => {
    const highSimilarity = 'fghijklmnop'.split('').map((last) => `abcd${last}`);
    const personallyPreferred = 'abcxx';
    const source: CandidateDictionary = {
      words: { has: () => false },
      byLengthAndFirstLetter: new Map([
        [5, new Map([['a', [...highSimilarity, personallyPreferred]]])],
      ]),
    };

    const withoutHistory = generateCandidates('abcde', 10, source);
    let adjustmentCalls = 0;
    const withHistory = generateCandidates(
      'abcde',
      10,
      source,
      undefined,
      (candidate) => {
        adjustmentCalls++;
        return candidate.word === personallyPreferred ? 1 : 0;
      },
    );

    expect(withoutHistory.map(({ word }) => word)).not.toContain(personallyPreferred);
    expect(withHistory.map(({ word }) => word)).toContain(personallyPreferred);
    expect(adjustmentCalls).toBe(highSimilarity.length + 1);
  });

  it('never scans or iterates the full dictionary', () => {
    let membershipChecks = 0;
    const source: CandidateDictionary = {
      words: {
        has(word: string) {
          membershipChecks++;
          return word === 'works';
        },
      },
      byLengthAndFirstLetter: new Map([
        [5, new Map([['o', []]])],
      ]),
    };
    const diagnostics = createCandidateDiagnostics();
    const candidates = generateCandidates('owrks', 10, source, diagnostics);

    expect(candidates[0]?.word).toBe('works');
    expect(diagnostics.process1Examined).toBe(0);
    expect(membershipChecks).toBe(diagnostics.membershipChecks);
    // Bounded by the word's length, not by the dictionary's size. Insertion
    // costs (n + 1) x 26 lookups, which for a 5-letter word is ~156 - three
    // orders of magnitude below the 107,901-word list.
    expect(membershipChecks).toBeLessThan(400);
  });

  it('generates single-letter insertion and deletion candidates', () => {
    // Idea Version 1 deliberately omitted these; they are now Processes 5 & 6.
    expect(generateCandidates('wrd').map(({ word }) => word)).toContain('word');
    expect(generateCandidates('worrd').map(({ word }) => word)).toContain('word');
  });

  it('does not return the input itself', () => {
    expect(generateCandidates('word').map((c) => c.word)).not.toContain('word');
  });

  it('ignores very short and very long words', () => {
    expect(generateCandidates('ab')).toEqual([]);
    expect(generateCandidates('a'.repeat(30))).toEqual([]);
  });

  it('respects the requested result limit and the hard cap of ten', () => {
    const results = generateCandidates('hte', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(generateCandidates('stone', 100).length).toBeLessThanOrEqual(10);
  });
});

describe('confidence scoring', () => {
  const rule = (over: Partial<CorrectionRule>): CorrectionRule => ({
    id: 'a->b',
    original: 'a',
    replacement: 'b',
    applied: 0,
    accepted: 0,
    reverted: 0,
    skipped: 0,
    blocked: 0,
    confidence: 0.5,
    mode: 'autocorrect',
    source: 'personal-learning',
    context: { previousWords: [], nextWords: [], blockedPrevious: [], blockedNext: [] },
    sites: {},
    firstSeen: 0,
    manual: false,
    enabled: true,
    ...over,
  });

  it('starts neutral with no evidence', () => {
    expect(personalFactor(undefined)).toBe(0.5);
  });

  it('rises with acceptances and falls with reverts', () => {
    expect(personalFactor(rule({ accepted: 10 }))).toBeGreaterThan(0.7);
    expect(personalFactor(rule({ accepted: 8, reverted: 4 }))).toBeLessThan(
      personalFactor(rule({ accepted: 8 })),
    );
    expect(personalFactor(rule({ reverted: 5 }))).toBeLessThan(0.25);
  });

  it('weighs an explicit block most heavily', () => {
    expect(personalFactor(rule({ accepted: 5, blocked: 1 }))).toBeLessThan(
      personalFactor(rule({ accepted: 5, reverted: 1 })),
    );
  });

  it('scores an adjacent swap above a keyboard substitution with equal priors', () => {
    const transposition = generateAdjacentSwapCandidates('hosue').find(
      ({ word }) => word === 'house',
    );
    const substitution = generateKeyboardCandidates('wprd').find(
      ({ word }) => word === 'word',
    );
    expect(scoreSpelling({ candidate: transposition!, originalIsWord: false })).toBeGreaterThan(
      scoreSpelling({ candidate: substitution!, originalIsWord: false }),
    );
  });

  it('heavily penalises correcting a word that is itself valid', () => {
    const [candidate] = generateCandidates('form');
    if (!candidate) return;
    expect(scoreSpelling({ candidate, originalIsWord: true })).toBeLessThan(
      scoreSpelling({ candidate, originalIsWord: false }),
    );
  });

  it('maps confidence onto actions using the thresholds', () => {
    const s = settings();
    expect(decideAction(0.95, 'default', s)).toBe('autocorrect');
    expect(decideAction(0.75, 'default', s)).toBe('suggest');
    expect(decideAction(0.3, 'default', s)).toBe('none');
    expect(decideAction(0.99, 'suggestion', s)).toBe('suggest');
    expect(decideAction(0.99, 'blocked', s)).toBe('none');
  });

  it('describes confidence bands for the UI', () => {
    expect(confidenceBand(0.95)).toBe('high');
    expect(confidenceBand(0.75)).toBe('medium');
    expect(confidenceBand(0.5)).toBe('low');
  });
});

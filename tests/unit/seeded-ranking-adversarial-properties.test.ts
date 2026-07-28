/**
 * Deterministic adversarial properties for candidate generation and ranking.
 *
 * These are deliberately generated from a fixed seed rather than random test
 * data: every failure must be replayable from the reported typo/target pair.
 */
import { describe, expect, it } from 'vitest';
import {
  createCandidateDiagnostics,
  generateApostropheCandidates,
  generateCandidates,
  generateKeyboardCandidates,
  generateSameLengthCandidates,
  type CandidateDictionary,
  type CandidateProcess,
} from '../../src/engine/candidate-generator.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import {
  DEFAULT_WEIGHTS,
  type ScoreWeights,
} from '../../src/engine/context/score-weights.js';
import { frequencyRank } from '../../src/engine/data/frequency.js';
import { neighbours } from '../../src/engine/keyboard-distance.js';

const SEED = 0x5eed_c0de;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

const ZERO_SIGNAL_WEIGHTS: ScoreWeights = Object.freeze({
  editOperation: 1,
  frequency: 0,
  partOfSpeech: 0,
  wordContext: 0,
  sentencePosition: 0,
  documentReuse: 0,
  personalHistory: 0,
  knownPhrase: 0,
  characterContext: 0,
});

const WORDS = [
  'works',
  'planet',
  'garden',
  'silver',
  'orange',
  'thread',
  'basket',
  'winter',
  'friend',
  'master',
  'normal',
  'prompt',
  'algorithm',
  'workflow',
  'privacy',
  'local',
  'deterministic',
  'extension',
  'correction',
  'engine',
] as const;

const CONTRACTIONS = [
  "don't",
  "didn't",
  "doesn't",
  "aren't",
  "they're",
  "that's",
  "o'clock",
] as const;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function dictionaryOf(words: readonly string[]): CandidateDictionary {
  const canonical = [...new Set(words.map((word) => word.toLowerCase()))];
  const wordSet = new Set(canonical);
  const buckets = new Map<number, Map<string, string[]>>();

  for (const word of canonical) {
    const first = word[0]!;
    let byFirst = buckets.get(word.length);
    if (!byFirst) {
      byFirst = new Map();
      buckets.set(word.length, byFirst);
    }
    const bucket = byFirst.get(first) ?? [];
    bucket.push(word);
    byFirst.set(first, bucket);
  }

  return {
    words: wordSet,
    byLengthAndFirstLetter: buckets,
  };
}

function interiorIndex(word: string, random: () => number): number {
  return 1 + Math.floor(random() * (word.length - 2));
}

function differentLetter(
  original: string,
  random: () => number,
  additionallyBlocked: readonly string[] = [],
): string {
  const blocked = new Set([original, ...additionallyBlocked]);
  return pick([...ALPHABET].filter((letter) => !blocked.has(letter)), random);
}

interface Mutation {
  target: string;
  typed: string;
  expectedProcess: CandidateProcess;
}

function mutateForProcess(
  process: CandidateProcess,
  random: () => number,
): Mutation {
  if (process === 7) {
    const target = pick(CONTRACTIONS, random);
    return {
      target,
      typed: target.replace("'", ''),
      expectedProcess: 7,
    };
  }

  const target = pick(WORDS, random);
  const index = interiorIndex(target, random);

  switch (process) {
    case 1: {
      const original = target[index]!;
      const replacement = differentLetter(
        original,
        random,
        neighbours(original),
      );
      return {
        target,
        typed: target.slice(0, index) + replacement + target.slice(index + 1),
        expectedProcess: 1,
      };
    }
    case 2: {
      const swappable = Array.from(
        { length: target.length - 2 },
        (_, offset) => offset + 1,
      ).filter((at) => target[at] !== target[at + 1]);
      const at = pick(swappable, random);
      return {
        target,
        typed:
          target.slice(0, at)
          + target[at + 1]
          + target[at]
          + target.slice(at + 2),
        expectedProcess: 2,
      };
    }
    case 3: {
      const original = target[index]!;
      const replacement = pick(neighbours(original), random);
      return {
        target,
        typed: target.slice(0, index) + replacement + target.slice(index + 1),
        expectedProcess: 3,
      };
    }
    case 4:
      return {
        target,
        typed: target.slice(0, index) + target[index] + target.slice(index),
        expectedProcess: 4,
      };
    case 5:
      return {
        target,
        typed: target.slice(0, index) + target.slice(index + 1),
        expectedProcess: 5,
      };
    case 6: {
      const inserted = differentLetter(
        target[index]!,
        random,
        [target[index - 1]!],
      );
      return {
        target,
        typed: target.slice(0, index) + inserted + target.slice(index),
        expectedProcess: 6,
      };
    }
  }
}

function boundedRecoveryTrace(seed: number): {
  trace: Array<readonly [string, string, CandidateProcess, readonly string[]]>;
  seenProcesses: CandidateProcess[];
} {
  const random = seededRandom(seed);
  const source = dictionaryOf([...WORDS, ...CONTRACTIONS]);
  const seen = new Set<CandidateProcess>();
  const trace: Array<readonly [string, string, CandidateProcess, readonly string[]]> = [];

  for (let iteration = 0; iteration < 70; iteration++) {
    const requestedProcess = ((iteration % 7) + 1) as CandidateProcess;
    const mutation = mutateForProcess(requestedProcess, random);
    const diagnostics = createCandidateDiagnostics();
    const candidates = generateCandidates(
      mutation.typed,
      100,
      source,
      diagnostics,
    );
    const recovered = candidates.find((candidate) => candidate.word === mutation.target);

    expect(
      recovered,
      `${mutation.typed} did not recover ${mutation.target} via process ${requestedProcess}`,
    ).toBeDefined();
    expect(
      recovered!.process,
      `${mutation.typed} recovered ${mutation.target} with weaker merged evidence`,
    ).toBe(mutation.expectedProcess);

    seen.add(recovered!.process);
    expect(candidates.length).toBeLessThanOrEqual(10);
    expect(diagnostics.adjacentSwapsGenerated).toBe(mutation.typed.length - 1);
    expect(diagnostics.keyboardSubstitutionsGenerated)
      .toBeLessThanOrEqual(mutation.typed.length * 8);
    expect(diagnostics.duplicateLetterGenerated)
      .toBeLessThanOrEqual(mutation.typed.length - 1);
    expect(diagnostics.missingLetterGenerated)
      .toBeLessThanOrEqual((mutation.typed.length + 1) * 26);
    expect(diagnostics.extraLetterGenerated).toBeLessThanOrEqual(mutation.typed.length);
    expect(diagnostics.apostropheGenerated).toBeLessThanOrEqual(mutation.typed.length - 1);

    const bucketSize =
      source.byLengthAndFirstLetter
        .get(mutation.typed.length)
        ?.get(mutation.typed[0]!)
        ?.length ?? 0;
    expect(diagnostics.process1Examined).toBeLessThanOrEqual(bucketSize);

    const generatedMembershipCandidates =
      diagnostics.adjacentSwapsGenerated
      + diagnostics.keyboardSubstitutionsGenerated
      + diagnostics.duplicateLetterGenerated
      + diagnostics.missingLetterGenerated
      + diagnostics.extraLetterGenerated
      + diagnostics.apostropheGenerated;
    expect(diagnostics.membershipChecks)
      .toBeLessThanOrEqual(generatedMembershipCandidates);

    trace.push([
      mutation.typed,
      mutation.target,
      recovered!.process,
      candidates.map((candidate) => candidate.word),
    ]);
  }

  return {
    trace,
    seenProcesses: [...seen].sort((a, b) => a - b),
  };
}

describe('seeded one-edit recovery properties', () => {
  it('recovers the original through all seven bounded processes reproducibly', () => {
    const first = boundedRecoveryTrace(SEED);
    const replay = boundedRecoveryTrace(SEED);

    expect(replay.trace).toEqual(first.trace);
    expect(first.seenProcesses).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('merges duplicate hits while preserving the stronger direct evidence', () => {
    const source = dictionaryOf(['works']);
    expect(generateSameLengthCandidates('wprks', source).map((candidate) => candidate.word))
      .toContain('works');
    expect(generateKeyboardCandidates('wprks', source).map((candidate) => candidate.word))
      .toContain('works');

    const merged = generateCandidates('wprks', 10, source)
      .filter((candidate) => candidate.word === 'works');
    expect(merged).toHaveLength(1);
    expect(merged[0]!.process).toBe(3);
    expect(merged[0]!.keyboardSubstitution).toMatchObject({
      typedCharacter: 'p',
      replacementCharacter: 'o',
      neighbourMapMatched: true,
    });
  });

  it('orders the same candidate set identically regardless of dictionary insertion order', () => {
    const forward = dictionaryOf(['works', 'dorks', 'forks']);
    const reverse = dictionaryOf(['forks', 'dorks', 'works']);

    const describe = (source: CandidateDictionary) =>
      generateCandidates('eorks', 10, source).map((candidate) => ({
        word: candidate.word,
        process: candidate.process,
        score: rankCandidates([candidate], DEFAULT_WEIGHTS)[0]!.rawScore,
      }));

    expect(describe(reverse)).toEqual(describe(forward));
    // `f` is also in `e`'s physical-neighbour set, so this adversarial input
    // has three valid Process-3 readings, not only the two obvious ones.
    expect(describe(forward).map(({ word }) => word)).toEqual([
      'works',
      'dorks',
      'forks',
    ]);
  });
});

describe('adversarial scorer and comparator invariants', () => {
  it('makes every zero-weight signal inert, even when hostile evidence is supplied', () => {
    const candidates = generateCandidates('mastter', 10);
    const ordinary = rankCandidates(candidates, ZERO_SIGNAL_WEIGHTS);
    const context = buildContext(
      'The mastter signed the form.',
      4,
      11,
      'https://example.com',
    );
    const inaccessibleContext = new Proxy(context, {
      get() {
        throw new Error('a zero-weight context signal was evaluated');
      },
    });
    const hostileDocumentEvidence = {
      boostFor(): number {
        throw new Error('zero-weight document evidence was evaluated');
      },
    };

    const supplied = rankCandidates(candidates, ZERO_SIGNAL_WEIGHTS, {
      context: inaccessibleContext,
      typedWord: 'mastter',
      documentEvidence: hostileDocumentEvidence,
    });

    expect(supplied.map(({ candidate, rawScore, terms }) => ({
      word: candidate.word,
      rawScore,
      terms,
    }))).toEqual(ordinary.map(({ candidate, rawScore, terms }) => ({
      word: candidate.word,
      rawScore,
      terms,
    })));
    for (const { terms } of supplied) {
      expect(terms).toMatchObject({
        frequency: 0,
        partOfSpeech: 0,
        wordContext: 0,
        sentencePosition: 0,
        documentReuse: 0,
        personalHistory: 0,
        knownPhrase: 0,
        characterContext: 0,
      });
    }
  });

  it('orders on raw scores above the confidence ceiling instead of clamping into a tie', () => {
    const candidates = generateCandidates('thats', 10)
      .filter((candidate) => candidate.word === "that's" || candidate.word === 'that');
    const ranked = rankCandidates(candidates, ZERO_SIGNAL_WEIGHTS, {
      rankAdjustment: () => 1,
    });
    const apostrophe = ranked.find(({ candidate }) => candidate.word === "that's");
    const deletion = ranked.find(({ candidate }) => candidate.word === 'that');

    expect(apostrophe).toBeDefined();
    expect(deletion).toBeDefined();
    expect(apostrophe!.rawScore).toBeGreaterThan(1);
    expect(deletion!.rawScore).toBeGreaterThan(1);
    expect(apostrophe!.rawScore).toBeGreaterThan(deletion!.rawScore);
    expect(ranked[0]!.candidate.word).toBe("that's");
    expect('that' < "that's").toBe(true);
  });

  it('keeps edit evidence ahead of frequency for iprove and records the mastter limit', () => {
    const iprove = generateCandidates('iprove', 10);
    const improve = iprove.find((candidate) => candidate.word === 'improve');
    const iphone = iprove.find((candidate) => candidate.word === 'iphone');

    expect(improve).toBeDefined();
    expect(iphone).toBeDefined();
    expect(improve!.operationCost).toBeLessThan(iphone!.operationCost);
    expect(rankCandidates(iprove, DEFAULT_WEIGHTS)[0]!.candidate.word).toBe('improve');

    const mastter = generateCandidates('mastter', 10);
    expect(frequencyRank('matter')).toBeGreaterThan(frequencyRank('master'));
    expect(rankCandidates(mastter, DEFAULT_WEIGHTS)[0]!.candidate.word).toBe('master');
    expect(
      rankCandidates(mastter, { ...DEFAULT_WEIGHTS, frequency: 0.06 })[0]!.candidate.word,
    ).toBe('matter');
  });

  it('accepts real dropped apostrophes but rejects the mi possessive counterexample', () => {
    expect(generateApostropheCandidates('didnt').map((candidate) => candidate.word))
      .toContain("didn't");
    expect(generateApostropheCandidates('mis').map((candidate) => candidate.word))
      .not.toContain("mi's");
    expect(generateCandidates('mis', 10).map((candidate) => candidate.word))
      .not.toContain("mi's");
  });
});

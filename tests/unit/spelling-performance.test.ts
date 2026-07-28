/**
 * Performance budget for the spelling pipeline, measured after the dictionary
 * is loaded (the load itself is a one-off cost paid at content-script start).
 *
 * Ceilings are loose because CI machines vary; the medians are printed so the
 * figures quoted in the documentation are reproducible rather than asserted.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateCandidates,
  generateDeletionCandidates,
  generateDuplicateLetterCandidates,
  generateInsertionCandidates,
} from '../../src/engine/candidate-generator.js';
import {
  generateMergeCandidate,
  generateSplitCandidate,
} from '../../src/engine/token-spacing.js';
import { analyze, buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import { compareRankings } from '../../src/engine/context/shadow-comparison.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';
import { frequencyRank } from '../../src/engine/data/frequency.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';
import { learning, settings } from '../helpers.js';

function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

function time(runs: number, fn: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

beforeAll(() => {
  // Force the lazy dictionary to build before anything is timed.
  isKnownWord('warmup');
});

describe('spelling performance', () => {
  it('duplicate-letter generation stays under 1 ms', () => {
    const ms = time(200, () => generateDuplicateLetterCandidates('punctuatioon'));
    console.info(`[spelling] duplicate-letter: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('missing-letter insertion stays under 3 ms', () => {
    const ms = time(200, () => generateInsertionCandidates('iprove'));
    console.info(`[spelling] missing-letter: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(3);
  });

  it('extra-letter deletion stays under 1 ms', () => {
    const ms = time(200, () => generateDeletionCandidates('worlkd'));
    console.info(`[spelling] extra-letter: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('single token split search stays under 1 ms', () => {
    const text = 'the improvementability here';
    const ms = time(200, () =>
      generateSplitCandidate({ text, start: 4, end: 4 + 'improvementability'.length }),
    );
    console.info(`[spelling] token split: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('two-token merge check stays under 1 ms', () => {
    const text = 'the impro vement here';
    const ms = time(200, () =>
      generateMergeCandidate({
        text,
        previousStart: 4,
        previousEnd: 9,
        currentStart: 10,
        currentEnd: 16,
      }),
    );
    console.info(`[spelling] token merge: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('a complete spelling decision stays under 15 ms', () => {
    const data = learning();
    const config = settings();
    const cases = [
      'punctuatioon',
      'iprove',
      'improvementability',
      'qwrtyuiopasdfgh', // long invalid token with no candidate
      'waht',
    ];
    for (const word of cases) {
      const text = `I will ${word} `;
      const ms = time(50, () => {
        analyze(
          { text, wordEnd: 7 + word.length, origin: 'https://example.com' },
          data,
          config,
        );
      });
      console.info(`[spelling] full decision "${word}": median ${ms.toFixed(3)} ms`);
      expect(ms, word).toBeLessThan(15);
    }
  });

  it('the worst case stays under the 30 ms weak-device target', () => {
    const data = learning();
    const config = settings();
    // 24 characters is the engine's maximum analysed token length.
    const word = 'abcdefghijklmnopqrstuvwx';
    const text = `I will ${word} `;
    const ms = time(30, () => {
      analyze({ text, wordEnd: 7 + word.length, origin: 'https://example.com' }, data, config);
    });
    console.info(`[spelling] worst case (24 chars): median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(30);
  });

  it('candidate generation is bounded by word length, not dictionary size', () => {
    const short = time(100, () => generateCandidates('waht', 10));
    const long = time(100, () => generateCandidates('punctuatioon', 10));
    console.info(
      `[spelling] generateCandidates: 4 chars ${short.toFixed(3)} ms, 12 chars ${long.toFixed(3)} ms`,
    );
    expect(short).toBeLessThan(15);
    expect(long).toBeLessThan(15);
  });
});

/**
 * Stage 0 added sentence tokenisation and POS classification to `buildContext`,
 * which runs on every committed word. That is the most performance-sensitive
 * change in the context work, so it is measured rather than assumed.
 */
describe('context feature performance', () => {
  it('building a context stays well under the per-word budget', () => {
    const text = 'I think the quick brown fox jumps over the lazy dog today.';
    const ms = time(200, () => buildContext(text, 12, 15, 'https://example.com'));
    console.info(`[context] buildContext: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(3);
  });

  it('stays bounded on a long paragraph', () => {
    const text = `${'The quick brown fox jumps over the lazy dog. '.repeat(20)}`;
    const ms = time(100, () => buildContext(text, 4, 9, 'https://example.com'));
    console.info(`[context] buildContext (long paragraph): median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(8);
  });

  it('declines instantly on a field past the analysis limit', () => {
    // Above MAX_ANALYSIS_LENGTH the features are skipped, so this must be fast.
    const huge = 'word '.repeat(2_000);
    const ms = time(50, () => buildContext(huge, 0, 4, 'https://example.com'));
    console.info(`[context] buildContext (over limit): median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('ranking a full candidate set is cheap', () => {
    const candidates = generateCandidates('punctuatioon', 10);
    const ms = time(200, () => rankCandidates(candidates, DEFAULT_WEIGHTS));
    console.info(`[context] rankCandidates: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('the shadow comparison costs one extra ranking pass', () => {
    const candidates = generateCandidates('thats', 10);
    const context = buildContext('I think thats right.', 8, 13, 'https://example.com');
    const ms = time(200, () =>
      compareRankings({
        originalText: 'thats',
        start: 8,
        end: 13,
        candidates,
        context,
        weights: DEFAULT_WEIGHTS,
      }),
    );
    console.info(`[context] compareRankings: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(2);
  });

  it('frequency lookup is a map hit', () => {
    const ms = time(500, () => {
      frequencyRank('the');
      frequencyRank('working');
      frequencyRank('ghats');
    });
    console.info(`[context] frequencyRank x3: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(0.5);
  });
});

/**
 * Performance budget for the punctuation lane. It runs synchronously inside
 * the content script's idle pass, so a slow analysis would be felt directly.
 *
 * The asserted ceilings are deliberately loose (CI machines vary wildly); the
 * measured medians are printed so the numbers quoted in the docs are
 * reproducible rather than claimed.
 */
import { describe, expect, it } from 'vitest';
import { EssentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { DEFAULT_PUNCTUATION_SETTINGS } from '../../src/engine/punctuation/punctuation-config.js';

const SENTENCE = 'Although it was raining we continued and the team finished the work.';
const PARAGRAPH = [
  'After I finished the report I went home.',
  'I was tired but I kept working.',
  'The build finished and the tests passed.',
  'I bought apples oranges bananas and grapes.',
  'Having completed the test she left.',
  'The quick brown fox jumps over the lazy dog near the river bank today.',
  'When the download finished I opened the file and checked the contents.',
  'She wanted to leave yet she stayed until the very end of the meeting.',
].join(' ');

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Times `runs` uncached analyses; a fresh provider per run defeats the cache. */
function timeUncached(text: string, runs: number): number[] {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const provider = new EssentialPunctuationProvider();
    // Distinct text each run so no cache anywhere can help.
    const unique = `${text} ${'x'.repeat(i)}`;
    const started = performance.now();
    provider.analyse(unique, { settings: DEFAULT_PUNCTUATION_SETTINGS });
    samples.push(performance.now() - started);
  }
  return samples;
}

describe('punctuation performance', () => {
  it('analyses a single sentence well under the 10 ms budget', () => {
    const samples = timeUncached(SENTENCE, 50);
    const p50 = median(samples);
    console.info(
      `[punctuation] sentence: median ${p50.toFixed(2)} ms, max ${Math.max(...samples).toFixed(2)} ms`,
    );
    expect(p50).toBeLessThan(10);
  });

  it('analyses a full paragraph well under the 30 ms budget', () => {
    const samples = timeUncached(PARAGRAPH, 30);
    const p50 = median(samples);
    console.info(
      `[punctuation] paragraph (${PARAGRAPH.length} chars): median ${p50.toFixed(2)} ms, ` +
        `max ${Math.max(...samples).toFixed(2)} ms`,
    );
    expect(p50).toBeLessThan(30);
  });

  it('serves repeated analysis of unchanged text from the cache', () => {
    const provider = new EssentialPunctuationProvider();
    const context = { settings: DEFAULT_PUNCTUATION_SETTINGS };
    provider.analyse(PARAGRAPH, context); // prime

    const started = performance.now();
    for (let i = 0; i < 100; i++) provider.analyse(PARAGRAPH, context);
    const perCall = (performance.now() - started) / 100;
    console.info(`[punctuation] cached re-analysis: ${perCall.toFixed(3)} ms per call`);
    expect(perCall).toBeLessThan(1);
  });

  it('stays bounded on a long document', () => {
    const long = `${PARAGRAPH} `.repeat(12).slice(0, 4000);
    const samples = timeUncached(long, 10);
    const p50 = median(samples);
    console.info(`[punctuation] 4000-char block: median ${p50.toFixed(2)} ms`);
    expect(p50).toBeLessThan(120);
  });
});

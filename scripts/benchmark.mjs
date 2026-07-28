#!/usr/bin/env node
/**
 * Deterministic local benchmark for the ESDB Idea Version 1 pipeline.
 *
 * This uses the project's existing esbuild development dependency only to
 * load the real TypeScript modules in Node. Bundle preparation is explicitly
 * excluded from every reported runtime measurement. No network access,
 * random input or benchmark package is used.
 *
 * Usage:
 *   node scripts/benchmark.mjs
 *   node scripts/benchmark.mjs --enforce
 */
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checksum = 0;
const enforce = process.argv.includes('--enforce');
const unknownArguments = process.argv.slice(2).filter((value) => value !== '--enforce');
if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'personal-autocorrect-benchmark-'));
  try {
    const setupStarted = performance.now();
    const [dictionaryBundle, engineBundle] = await Promise.all([
      bundle(`
        export { dictionary, DICTIONARY_METADATA }
          from './src/engine/data/dictionary.ts';
      `),
      bundle(`
        export { analyze } from './src/engine/correction-engine.ts';
        export { buildContext } from './src/engine/correction-engine.ts';
        export {
          generateAdjacentSwapCandidates,
          generateApostropheCandidates,
          generateCandidates,
          generateDeletionCandidates,
          generateDuplicateLetterCandidates,
          generateInsertionCandidates,
          generateKeyboardCandidates,
          generateSameLengthCandidates
        } from './src/engine/candidate-generator.ts';
        export {
          generateMergeCandidate,
          generateSplitCandidate
        } from './src/engine/token-spacing.ts';
        export { rankCandidates } from './src/engine/context/candidate-scoring.ts';
        export { compareRankings } from './src/engine/context/shadow-comparison.ts';
        export { DEFAULT_WEIGHTS } from './src/engine/context/score-weights.ts';
        export { dictionary, DICTIONARY_METADATA }
          from './src/engine/data/dictionary.ts';
        export { frequencyRank } from './src/engine/data/frequency.ts';
        export { EssentialPunctuationProvider }
          from './src/engine/punctuation/punctuation-provider.ts';
        export { DEFAULT_PUNCTUATION_SETTINGS }
          from './src/engine/punctuation/punctuation-config.ts';
        export { createAnchor } from './src/history/anchor.ts';
        export { createRecord } from './src/history/correction-record.ts';
        export { planRevert } from './src/history/correction-reverter.ts';
        export { DEFAULT_SETTINGS, EMPTY_LEARNING }
          from './src/shared/types.ts';
      `),
    ]);
    const setupMs = performance.now() - setupStarted;

    const dictionaryPath = path.join(temporaryDirectory, 'dictionary-benchmark.mjs');
    const enginePath = path.join(temporaryDirectory, 'engine-benchmark.mjs');
    const coldRunnerPath = path.join(temporaryDirectory, 'cold-runner.mjs');
    await Promise.all([
      writeFile(dictionaryPath, dictionaryBundle),
      writeFile(enginePath, engineBundle),
      writeFile(
        coldRunnerPath,
        `
          import { performance } from 'node:perf_hooks';
          const started = performance.now();
          const loaded = await import(process.argv[2]);
          const elapsedMs = performance.now() - started;
          console.log(JSON.stringify({
            elapsedMs,
            wordCount: loaded.DICTIONARY_METADATA.wordCount,
            bucketCount: loaded.DICTIONARY_METADATA.bucketCount,
            contentSha256: loaded.DICTIONARY_METADATA.contentSha256
          }));
        `,
      ),
    ]);

    const cold = measureColdImport(coldRunnerPath, dictionaryPath);
    const engineImportStarted = performance.now();
    const engine = await import(pathToFileURL(enginePath).href);
    const engineImportMs = performance.now() - engineImportStarted;

    const busiest = busiestMisspellings(engine.dictionary, 6);
    const longPrefix = 'ordinary prose '.repeat(
      Math.ceil((5 * 1024 * 1024) / 'ordinary prose '.length),
    ).slice(0, 5 * 1024 * 1024);
    const longText = `${longPrefix} nromal`;
    const paragraph = [
      'After I finished the report I went home.',
      'I was tired but I kept working.',
      'The build finished and the tests passed.',
      'I bought apples oranges bananas and grapes.',
      'Having completed the test she left.',
      'The quick brown fox jumps over the lazy dog near the river bank today.',
      'When the download finished I opened the file and checked the contents.',
      'She wanted to leave yet she stayed until the very end of the meeting.',
    ].join(' ');
    const punctuationSentence =
      'Although it was raining we continued and the team finished the work.';
    const punctuationLong = `${paragraph} `.repeat(12).slice(0, 4_000);
    const rankingCandidates = engine.generateCandidates('punctuatioon', 10);
    const rankingContext = engine.buildContext(
      'I think punctuatioon matters in this document.',
      8,
      21,
      'https://benchmark.invalid',
    );
    const shadowCandidates = engine.generateCandidates('thats', 10);
    const shadowContext = engine.buildContext(
      'I think thats right.',
      8,
      13,
      'https://benchmark.invalid',
    );
    const correctedText = 'I think what happened was fine.';
    const revertRecord = recordAt(engine, correctedText, 8, 'waht', 'what');
    const cachedPunctuation = new engine.EssentialPunctuationProvider();
    cachedPunctuation.analyse(paragraph, {
      settings: engine.DEFAULT_PUNCTUATION_SETTINGS,
    });

    const metrics = [
      measure(
        'Dictionary Set lookup',
        cycle(['the', 'algorithm', 'workflow', "can't", 'can’t', 'zzzzzzzzzz'], (word) =>
          engine.dictionary.words.has(word),
        ),
        { warmup: 5_000, samples: 240, operationsPerSample: 1_000, targetMs: 1 },
      ),
      measure(
        'Process 2 adjacent swap',
        cycle(['owrks', 'hte', 'waht', 'nromal', 'alogrithm'], (word) =>
          engine.generateAdjacentSwapCandidates(word),
        ),
        { warmup: 2_000, samples: 220, operationsPerSample: 200, targetMs: 1 },
      ),
      measure(
        'Full correction, typical',
        cycle(
          ['owrks', 'eorks', 'nromal', 'alogrithm', 'waht', 'hte', 'tge', 'workflor'],
          (word) => analyzeWord(engine, word),
        ),
        { warmup: 300, samples: 180, operationsPerSample: 10, targetMs: 15 },
      ),
      measure(
        'Full correction, busiest buckets',
        cycle(
          busiest.map((entry) => entry.word),
          (word) => analyzeWord(engine, word),
        ),
        {
          warmup: 60,
          samples: 240,
          operationsPerSample: 1,
          targetMs: 30,
          enforceStatistic: 'p99',
        },
      ),
      measure(
        'Full correction, 5 MiB field',
        () => analyzeText(engine, longText, longText.length),
        {
          warmup: 5,
          samples: 120,
          operationsPerSample: 1,
          targetMs: 30,
          enforceStatistic: 'p99',
        },
      ),
      measure(
        'Process 1 same-length bucket',
        () => engine.generateSameLengthCandidates(busiest[0]?.word ?? 'smirkinq'),
        { warmup: 60, samples: 160, operationsPerSample: 1 },
      ),
      measure(
        'Process 3 keyboard neighbour',
        cycle(['eorks', 'gello', 'tge', 'wprks'], (word) =>
          engine.generateKeyboardCandidates(word),
        ),
        { warmup: 1_000, samples: 180, operationsPerSample: 50 },
      ),
      measure(
        'Process 4 duplicate letter',
        cycle(['punctuatioon', 'commment', 'mastter'], (word) =>
          engine.generateDuplicateLetterCandidates(word),
        ),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Process 5 missing letter',
        cycle(['iprove', 'hve', 'thnks'], (word) =>
          engine.generateInsertionCandidates(word),
        ),
        { warmup: 300, samples: 160, operationsPerSample: 20 },
      ),
      measure(
        'Process 6 extra letter',
        cycle(['worlkd', 'recievee', 'algoriuthm'], (word) =>
          engine.generateDeletionCandidates(word),
        ),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Process 7 apostrophe',
        cycle(['dont', 'didnt', 'arent', 'doesnt', 'oclock'], (word) =>
          engine.generateApostropheCandidates(word),
        ),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Complete candidate generation',
        cycle(['punctuatioon', 'iprove', 'eorks', 'improvementability'], (word) =>
          engine.generateCandidates(word, 10),
        ),
        { warmup: 80, samples: 160, operationsPerSample: 1 },
      ),
      measure(
        'Single-token split',
        () =>
          engine.generateSplitCandidate({
            text: 'the improvementability here',
            start: 4,
            end: 22,
          }),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Two-token merge',
        () =>
          engine.generateMergeCandidate({
            text: 'the impro vement here',
            previousStart: 4,
            previousEnd: 9,
            currentStart: 10,
            currentEnd: 16,
          }),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Frequency lookup',
        cycle(['the', 'working', 'ghats', "can't", 'unknownword'], (word) =>
          engine.frequencyRank(word),
        ),
        { warmup: 5_000, samples: 220, operationsPerSample: 1_000 },
      ),
      measure(
        'Context construction',
        () =>
          engine.buildContext(
            'I think the quick brown fox jumps over the lazy dog today.',
            12,
            15,
            'https://benchmark.invalid',
          ),
        { warmup: 500, samples: 180, operationsPerSample: 50 },
      ),
      measure(
        'Candidate ranking',
        () => engine.rankCandidates(rankingCandidates, engine.DEFAULT_WEIGHTS, {
          context: rankingContext,
          typedWord: 'punctuatioon',
        }),
        { warmup: 500, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Shadow ranking comparison',
        () =>
          engine.compareRankings({
            originalText: 'thats',
            start: 8,
            end: 13,
            candidates: shadowCandidates,
            context: shadowContext,
            weights: engine.DEFAULT_WEIGHTS,
          }),
        { warmup: 500, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Sentence punctuation',
        () =>
          new engine.EssentialPunctuationProvider().analyse(punctuationSentence, {
            settings: engine.DEFAULT_PUNCTUATION_SETTINGS,
          }),
        { warmup: 30, samples: 100, operationsPerSample: 1 },
      ),
      measure(
        'Paragraph punctuation',
        () =>
          new engine.EssentialPunctuationProvider().analyse(paragraph, {
            settings: engine.DEFAULT_PUNCTUATION_SETTINGS,
          }),
        { warmup: 20, samples: 80, operationsPerSample: 1 },
      ),
      measure(
        '4,000-char punctuation',
        () =>
          new engine.EssentialPunctuationProvider().analyse(punctuationLong, {
            settings: engine.DEFAULT_PUNCTUATION_SETTINGS,
          }),
        { warmup: 5, samples: 40, operationsPerSample: 1 },
      ),
      measure(
        'Cached punctuation',
        () =>
          cachedPunctuation.analyse(paragraph, {
            settings: engine.DEFAULT_PUNCTUATION_SETTINGS,
          }),
        { warmup: 1_000, samples: 200, operationsPerSample: 100 },
      ),
      measure(
        'History record creation',
        () => recordAt(engine, correctedText, 8, 'waht', 'what'),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
      measure(
        'Revert planning',
        () => engine.planRevert(correctedText, revertRecord),
        { warmup: 1_000, samples: 180, operationsPerSample: 100 },
      ),
    ];

    console.log('Personal Autocorrect deterministic benchmark');
    console.log(`Node ${process.version} · ${process.platform}/${process.arch}`);
    console.log(
      `Dictionary ${cold.wordCount.toLocaleString('en-US')} words · ` +
        `${cold.bucketCount.toLocaleString('en-US')} buckets · sha256 ${cold.contentSha256}`,
    );
    console.log('');
    console.log('One-time setup (not included in hot-path results)');
    console.log(`  Harness bundle preparation: ${formatMs(setupMs)} ms`);
    console.log(
      `  Cold dictionary import + Set/index initialization: ${formatMs(cold.elapsedMs)} ms`,
    );
    console.log(`  Full engine module import + initialization: ${formatMs(engineImportMs)} ms`);
    console.log('');
    console.log('Warmed hot path (milliseconds per operation; sub-ms cases are batched)');
    console.log(
      '  Measurement                         samples x ops     median       p95       p99       max     target',
    );
    for (const metric of metrics) {
      const hasTarget = Number.isFinite(metric.targetMs);
      const enforcedValue = hasTarget ? metric[metric.enforceStatistic] : 0;
      const target = hasTarget
        ? `<${metric.targetMs} ms ${metric.enforceStatistic} ${
            enforcedValue < metric.targetMs ? 'PASS' : 'OVER'
          }`
        : 'informational';
      console.log(
        `  ${metric.name.padEnd(33)} ` +
          `${`${metric.samples} x ${metric.operationsPerSample}`.padStart(13)}  ` +
          `${formatMs(metric.median).padStart(8)}  ` +
          `${formatMs(metric.p95).padStart(8)}  ` +
          `${formatMs(metric.p99).padStart(8)}  ` +
          `${formatMs(metric.max).padStart(8)}  ` +
          target,
      );
    }
    console.log('');
    console.log(
      `Busiest-bucket inputs: ${busiest
        .map((entry) => `${entry.word} (${entry.key}: ${entry.bucketSize})`)
        .join(', ')}`,
    );
    console.log('Demo decisions (default settings)');
    for (const word of ['owrks', 'eorks', 'nromal', 'prrompt', 'workflor', 'alogrithm']) {
      const proposal = analyzeWord(engine, word)?.proposal;
      console.log(
        `  ${word.padEnd(10)} -> ${(proposal?.replacement ?? word).padEnd(10)} ` +
          `${proposal?.action ?? 'unchanged'}${
            proposal ? ` (${proposal.confidence.toFixed(3)})` : ''
          }`,
      );
    }
    console.log(
      'Method: fixed inputs, warm-up before sampling, no network. Results are ' +
        'machine- and runtime-dependent observations, not universal Chrome guarantees.',
    );
    console.log(`Checksum: ${checksum}`);

    if (
      enforce &&
      metrics.some(
        (metric) =>
          Number.isFinite(metric.targetMs)
          && metric[metric.enforceStatistic] >= metric.targetMs,
      )
    ) {
      process.exitCode = 1;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function bundle(contents) {
  const result = await esbuild.build({
    stdin: {
      contents,
      loader: 'ts',
      resolveDir: root,
      sourcefile: 'benchmark-entry.ts',
    },
    absWorkingDir: root,
    bundle: true,
    define: { __DEV__: 'false' },
    format: 'esm',
    legalComments: 'none',
    minify: true,
    platform: 'node',
    sourcemap: false,
    target: ['node20'],
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild did not produce a benchmark module');
  return output.contents;
}

function measureColdImport(runnerPath, dictionaryPath) {
  const result = spawnSync(
    process.execPath,
    [runnerPath, pathToFileURL(dictionaryPath).href],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Cold dictionary import failed: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout.trim());
}

function analyzeWord(engine, word) {
  const text = `Try ${word}`;
  return analyzeText(engine, text, text.length);
}

function analyzeText(engine, text, wordEnd) {
  return engine.analyze(
    { text, wordEnd, origin: 'https://benchmark.invalid' },
    engine.EMPTY_LEARNING,
    engine.DEFAULT_SETTINGS,
  );
}

function recordAt(engine, text, index, original, replacement) {
  const end = index + replacement.length;
  const anchor = engine.createAnchor({
    text,
    start: index,
    end,
    originalText: original,
    replacementText: replacement,
    contextRadius: 32,
  });
  return engine.createRecord({
    sessionId: 's_benchmark',
    proposal: {
      start: index,
      end,
      original,
      replacement,
      correctionType: 'spelling',
      confidence: 0.96,
      action: 'autocorrect',
      reason: 'benchmark fixture',
    },
    anchor,
    contextPreview: text.slice(Math.max(0, index - 20), end + 20),
    autoApplied: true,
  });
}

function consume(value) {
  if (typeof value === 'boolean') {
    checksum = (checksum + (value ? 3 : 1)) >>> 0;
  } else if (Array.isArray(value)) {
    checksum = (checksum + value.length * 7 + (value[0]?.word?.length ?? 0)) >>> 0;
  } else if (value?.proposal) {
    checksum =
      (checksum +
        value.proposal.replacement.length * 11 +
        Math.round(value.proposal.confidence * 100)) >>>
      0;
  } else {
    checksum = (checksum + 1) >>> 0;
  }
}

function cycle(values, operation) {
  if (values.length === 0) throw new Error('Benchmark workload must not be empty');
  let index = 0;
  return () => {
    const value = operation(values[index]);
    index = (index + 1) % values.length;
    return value;
  };
}

function measure(name, operation, options) {
  for (let index = 0; index < options.warmup; index++) consume(operation());

  const samples = [];
  for (let sample = 0; sample < options.samples; sample++) {
    const started = performance.now();
    for (let operationIndex = 0; operationIndex < options.operationsPerSample; operationIndex++) {
      consume(operation());
    }
    samples.push((performance.now() - started) / options.operationsPerSample);
  }

  samples.sort((left, right) => left - right);
  return {
    name,
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    max: samples.at(-1) ?? 0,
    targetMs: options.targetMs,
    enforceStatistic: options.enforceStatistic ?? 'p95',
    samples: options.samples,
    operationsPerSample: options.operationsPerSample,
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function formatMs(value) {
  return value < 1 ? value.toFixed(4) : value.toFixed(3);
}

function busiestMisspellings(dictionary, limit) {
  const buckets = [];
  for (const [length, byFirstLetter] of dictionary.byLengthAndFirstLetter) {
    if (length < 5 || length > 12) continue;
    for (const [firstLetter, words] of byFirstLetter) {
      if (!/^[a-z]$/.test(firstLetter) || words.length === 0) continue;
      const word = deriveUnknownWord(words, dictionary.words);
      if (word) {
        buckets.push({
          word,
          key: `${length}/${firstLetter}`,
          bucketSize: words.length,
        });
      }
    }
  }
  buckets.sort(
    (left, right) =>
      right.bucketSize - left.bucketSize ||
      left.key.localeCompare(right.key, 'en'),
  );
  return buckets.slice(0, limit);
}

function deriveUnknownWord(words, dictionaryWords) {
  const base = words[Math.floor(words.length / 2)];
  if (!base || !/^[a-z]+$/.test(base)) return undefined;
  for (const replacement of ['q', 'z', 'x', 'j', 'v']) {
    const candidate = `${base.slice(0, -1)}${replacement}`;
    if (candidate !== base && !dictionaryWords.has(candidate)) return candidate;
  }
  return undefined;
}

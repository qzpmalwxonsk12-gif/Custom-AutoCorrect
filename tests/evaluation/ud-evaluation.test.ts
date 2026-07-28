/**
 * Measurement run over the real UD English EWT corpus.
 *
 * Development only: invoked by `npm run evaluate`, never by `npm run check`,
 * and `vendor/evaluation/` is outside every esbuild entry point so none of it
 * reaches the extension.
 *
 * This measures the engine; it does not assert opinions about English. The
 * thresholds are loose on purpose - the printed reports are the deliverable,
 * and the evidence a context weight is raised on. A tight assertion would
 * become a hostage to the corpus, which is the mistake the frequency inflection
 * test already made once.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCleanSentence, readConllu, reconstruct } from './conllu.js';
import { evaluate, type EvaluationResult } from './evaluator.js';
import {
  writeFalsePositiveReport,
  writeRegressionReport,
  writeWeightSweep,
  type WeightRow,
} from './report.js';
import {
  DEFAULT_WEIGHTS,
  FREQUENCY_WEIGHT,
} from '../../src/engine/context/score-weights.js';
import { learning, settings } from '../helpers.js';

const CORPUS = path.resolve('vendor/evaluation/UD_English-EWT/en_ewt-ud-dev.conllu');
const REVIEW = path.resolve('tests/evaluation/review.json');
const available = existsSync(CORPUS);

/** Manual classifications, keyed by `sentenceId|token`. */
function loadReview(): Record<string, string> {
  if (!existsSync(REVIEW)) return {};
  try {
    return JSON.parse(readFileSync(REVIEW, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** One sample, one seed, so every weight is compared against the same input. */
const SAMPLE_LIMIT = 300;
const SEED = 20_260_728;
const FREQUENCY_BASELINE = Object.freeze({
  ...DEFAULT_WEIGHTS,
  frequency: 0,
});
const TESTED_FREQUENCY_WEIGHTS = Object.freeze([
  0.02,
  FREQUENCY_WEIGHT,
  0.06,
  0.08,
  0.1,
]);

describe('frequency sweep configuration', () => {
  it('uses an explicit zero-frequency baseline and includes production', () => {
    expect(FREQUENCY_BASELINE).toEqual({
      ...DEFAULT_WEIGHTS,
      frequency: 0,
    });
    expect(FREQUENCY_BASELINE.frequency).toBe(0);
    expect(DEFAULT_WEIGHTS.frequency).toBe(FREQUENCY_WEIGHT);
    expect(TESTED_FREQUENCY_WEIGHTS).toContain(FREQUENCY_WEIGHT);
    expect(new Set(TESTED_FREQUENCY_WEIGHTS).size).toBe(TESTED_FREQUENCY_WEIGHTS.length);
  });
});

describe.skipIf(!available)('UD English EWT evaluation', () => {
  const sentences = available ? readConllu(CORPUS) : [];
  const review = loadReview();

  const run = (frequency: number): EvaluationResult =>
    evaluate({
      sentences,
      settings: settings(),
      learning: learning(),
      limit: SAMPLE_LIMIT,
      seed: SEED,
      corrupt: true,
      review,
      baseline: FREQUENCY_BASELINE,
      experimental: { ...DEFAULT_WEIGHTS, frequency },
    });

  it('parses the real corpus', () => {
    expect(sentences.length).toBeGreaterThan(1_000);
    const clean = sentences.filter(isCleanSentence);
    console.info(
      `[ud] ${sentences.length} sentences parsed, ${clean.length} usable as clean prose`,
    );
    expect(clean.length).toBeGreaterThan(50);
  });

  it('reconstructs text that matches the corpus text field', () => {
    let checked = 0;
    let matched = 0;
    for (const sentence of sentences.slice(0, 2_000)) {
      if (!sentence.textFromFile) continue;
      checked++;
      if (reconstruct(sentence.tokens) === sentence.text) matched++;
    }
    const rate = matched / checked;
    console.info(`[ud] reconstruction matches the text field for ${(rate * 100).toFixed(1)}%`);
    expect(rate).toBeGreaterThan(0.9);
  }, 60_000);

  /* ------------------------------ Parts 1 and 3 ------------------------------ */

  it('writes the regression and false-positive reports', () => {
    const result = run(0.08);

    const regressions = writeRegressionReport(result);
    const falsePositives = writeFalsePositiveReport(result);

    console.info(`[ud] ${result.sentencesUsed} clean sentences used`);
    console.info(
      `[ud] corruptions: ${result.corruptionsAttempted} attempted, `
        + `${result.restored} restored, ${result.wrongCorrection} wrong, ${result.missed} missed`,
    );
    console.info(
      `[ud] false positives: ${result.falsePositives} raw, `
        + `${result.confirmedFalsePositives} confirmed after review`,
    );
    console.info(`[ud] wrote ${regressions}`);
    console.info(`[ud] wrote ${falsePositives}`);

    // Print the regressions inline so they are visible without opening a file.
    for (const d of result.disagreements.filter((x) => x.verdict === 'worse')) {
      console.info(
        `[worse] "${d.token}" baseline=${d.currentWinner} tested=${d.experimentalWinner} `
          + `expected=${d.expected} costDominant=${d.costStillDominant}`,
      );
      for (const c of d.candidates.slice(0, 5)) {
        console.info(
          `[worse]     ${c.word.padEnd(14)} ${c.operation.padEnd(24)} `
            + `cost=${c.operationCost} base=${c.baseScore.toFixed(4)} `
            + `freq=${c.frequencyRank} exp=${c.experimentalScore.toFixed(4)}`,
        );
      }
    }
    for (const c of result.falsePositiveCases) {
      console.info(
        `[fp] ${c.sentenceId} "${c.token}" -> "${c.proposedCorrection}" `
          + `(${c.correctionType}, conf ${c.confidence.toFixed(2)}, inDict=${c.originalInDictionary})`,
      );
    }

    expect(result.sentencesUsed).toBeGreaterThan(20);
  }, 180_000);

  /* ------------------------------ Part 4 ------------------------------ */

  it('sweeps frequency weights', () => {
    const rows: WeightRow[] = [];

    for (const weight of TESTED_FREQUENCY_WEIGHTS) {
      const result = run(weight);
      expect(result.baselineWeights).toEqual(FREQUENCY_BASELINE);
      expect(result.experimentalWeights.frequency).toBe(weight);
      const disagreements = result.disagreements;
      const costOverrides = disagreements.filter((d) => !d.costStillDominant).length;
      const actionChanges = disagreements.filter(
        (d) => d.currentAction !== d.experimentalAction,
      ).length;
      const validWordChanges = disagreements.filter(
        (d) => d.riskClass === 'valid-word-replacement',
      ).length;
      const marginDelta =
        disagreements.length > 0
          ? disagreements.reduce((sum, d) => sum + (d.experimentalMargin - d.currentMargin), 0)
            / disagreements.length
          : 0;

      rows.push({
        weight,
        disagreements: disagreements.length,
        better: result.experimentalBetter,
        worse: result.experimentalWorse,
        neutral: result.experimentalNeutral,
        confirmedFalsePositives: result.confirmedFalsePositives,
        validWordSuggestionChanges: validWordChanges,
        actionChanges,
        costOverrides,
        averageMarginChange: marginDelta,
      });

      console.info(
        `[sweep] w=${weight.toFixed(2)} disagree=${disagreements.length} `
          + `better=${result.experimentalBetter} worse=${result.experimentalWorse} `
          + `neutral=${result.experimentalNeutral} costOverrides=${costOverrides} `
          + `actionChanges=${actionChanges} avgMarginDelta=${marginDelta.toFixed(4)}`,
      );
    }

    // The non-negotiable property, checked at every weight.
    for (const row of rows) {
      expect(row.costOverrides, `weight ${row.weight} overrode operation cost`).toBe(0);
    }

    const production = rows.find((row) => row.weight === FREQUENCY_WEIGHT);
    expect(production, 'production frequency weight was not evaluated').toBeDefined();
    expect(
      production!.disagreements,
      'production must be compared with zero frequency, not with itself',
    ).toBeGreaterThan(0);

    const noRegression = rows.find((row) => row.worse === 0 && row.better > 0);
    const decision = [
      `Current production weight **${FREQUENCY_WEIGHT.toFixed(2)}** was measured against `
        + `the explicit zero-frequency baseline: ${production!.better} better, `
        + `${production!.worse} worse, ${production!.costOverrides} cost overrides.`,
      noRegression
        ? `Lowest tested weight with gains and no regressions: **${noRegression.weight.toFixed(2)}**.`
        : 'No tested non-zero weight produced gains with zero regressions.',
      'This diagnostic report does not change production weights.',
    ].join(' ');
    const path = writeWeightSweep(
      rows,
      decision,
      {
        baselineWeights: FREQUENCY_BASELINE,
        testedWeights: TESTED_FREQUENCY_WEIGHTS,
        productionWeight: FREQUENCY_WEIGHT,
        seed: SEED,
        sampleLimit: SAMPLE_LIMIT,
      },
    );
    console.info(`[sweep] wrote ${path}`);
  }, 300_000);
});

/**
 * Ground-truth evaluation of the character-bigram signal.
 *
 * The unit tests establish that the signal is *safe*. This establishes whether
 * it is *useful*, which is a separate question and the one that decides its
 * production weight. Synthetic corruptions of UD English EWT sentences give a
 * known right answer, so a winner change can be judged rather than counted.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';
import { BIGRAM_METADATA, bigramTable } from '../../src/engine/context/character-context.js';
import { isCleanSentence, readConllu } from './conllu.js';
import { corruptSentence, seededRandom } from './evaluator.js';
import { writeSignalReport } from './report.js';
import {
  categoryTable,
  commonalityTable,
  processTable,
  summaryTable,
  sweepWeight,
  worseCaseDetail,
  type SweepCase,
  type SweepRow,
} from './weight-sweep.js';

const CORPUS = path.resolve('vendor/evaluation/UD_English-EWT/en_ewt-ud-dev.conllu');
const available = existsSync(CORPUS);

const WEIGHTS = [0, 0.005, 0.01, 0.02, 0.04];

function buildCases(limit: number): SweepCase[] {
  const sentences = readConllu(CORPUS).filter(isCleanSentence).slice(0, limit);
  const random = seededRandom(20_260_801);
  const cases: SweepCase[] = [];
  for (const sentence of sentences) {
    const corruption = corruptSentence(sentence.text, random);
    if (!corruption) continue;
    cases.push({
      sentence: corruption.sentence,
      corrupted: corruption.corrupted,
      expected: corruption.original.toLowerCase(),
      start: corruption.start,
      end: corruption.end,
      kind: corruption.kind,
      category: corruption.kind,
    });
  }
  return cases;
}

describe('character-context implementation properties', () => {
  it('covers all 676 letter pairs and records reproducible provenance', () => {
    expect(bigramTable()).toHaveLength(676);
    expect(BIGRAM_METADATA.distinctPairs).toBe(676);
    expect(BIGRAM_METADATA.invalidEntries).toBe(0);
    // `npm run check:chardata` regenerates from this source and compares.
    expect(BIGRAM_METADATA.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decodes lazily and caches', () => {
    // Same object identity on the second call: decoded once, not per score.
    expect(bigramTable()).toBe(bigramTable());
  });

  it('reproduces the shipped ranking exactly at weight 0', () => {
    for (const word of ['iprove', 'mastter', 'teh', 'punctuatioon', 'recieve', 'woks']) {
      const candidates = generateCandidates(word, 10);
      if (candidates.length < 2) continue;
      const shipped = rankCandidates(candidates, DEFAULT_WEIGHTS, { typedWord: word });
      const explicitZero = rankCandidates(
        candidates,
        { ...DEFAULT_WEIGHTS, characterContext: 0 },
        { typedWord: word },
      );
      expect(explicitZero.map((s) => s.candidate.word), word).toEqual(
        shipped.map((s) => s.candidate.word),
      );
      for (const scored of explicitZero) expect(scored.terms.characterContext).toBe(0);
    }
  });

  it('never adds or removes a candidate at any evaluated weight', () => {
    for (const weight of WEIGHTS) {
      for (const word of ['iprove', 'mastter', 'teh', 'punctuatioon']) {
        const candidates = generateCandidates(word, 10);
        const ranked = rankCandidates(
          candidates,
          { ...DEFAULT_WEIGHTS, characterContext: weight },
          { typedWord: word },
        );
        expect(ranked).toHaveLength(candidates.length);
        expect(new Set(ranked.map((s) => s.candidate.word)).size).toBe(candidates.length);
      }
    }
  });
});

describe.skipIf(!available)('character-context ground-truth evaluation', () => {
  it('sweeps character-context weights against known corruptions', () => {
    const cases = buildCases(1200);
    expect(cases.length).toBeGreaterThan(200);

    const rows: SweepRow[] = WEIGHTS.map((weight) =>
      sweepWeight('characterContext', weight, cases),
    );

    for (const row of rows) {
      console.info(
        `[char-gt] w=${row.weight.toFixed(3)} cases=${row.cases} `
          + `evidence=${row.withEvidence} changes=${row.winnerChanges} `
          + `better=${row.better} worse=${row.worse} neutral=${row.neutral} `
          + `costOverrides=${row.costOverrides} actionChanges=${row.actionChanges} `
          + `avgMargin=${row.avgMarginChange.toFixed(5)}`,
      );
    }

    const active = rows.filter((r) => r.weight > 0);
    const totalBetter = active.reduce((s, r) => s + r.better, 0);
    const totalWorse = active.reduce((s, r) => s + r.worse, 0);
    const uncommonHarm = active.reduce((s, r) => s + r.byCommonality.uncommon.worse, 0);
    const favourable = totalBetter >= totalWorse * 2 && totalBetter > 0;

    const report = [
      '# Character-context ground-truth evaluation',
      '',
      `Corpus: UD English EWT dev. Cases: ${cases.length}. Seed fixed across weights,`,
      'so every weight sees an identical corruption set. Production weights are the',
      'shipped ones (`frequency = 0.04`), with only `characterContext` varied, so this',
      'measures the signal in combination with what already ships rather than alone.',
      '',
      '## Implementation properties verified',
      '',
      '| property | result |',
      '|---|---|',
      `| All 676 letter pairs represented | yes (${BIGRAM_METADATA.distinctPairs}/676) |`,
      '| Generated reproducibly | yes — `npm run check:chardata` regenerates and compares |',
      '| Runtime decoding lazy | yes — decoded on first score, then cached |',
      '| Score relative to typed token | yes — `plausibility(candidate) - plausibility(typed)` |',
      '| Generates or removes candidates | no |',
      '| Prunes rare candidates | no |',
      '| Can override a cheaper edit | no — operation cost outranks it in the comparator |',
      '| Weight 0 reproduces shipped ranking | yes |',
      '| Appears in ranking diagnostics | yes — non-zero terms are emitted as evidence |',
      '| Appears in shadow observations | yes — listed in `responsibleTerms` |',
      '',
      '## Results by weight',
      '',
      ...summaryTable(rows),
      '',
      '## By candidate-generation process',
      '',
      ...processTable(rows),
      '',
      '## By corruption kind',
      '',
      ...categoryTable(rows),
      '',
      '## Common versus uncommon expected words',
      '',
      'Common = frequency band ≥ 128. Uncommon valid words are the population most',
      'at risk from a signal that rewards typical letter sequences.',
      '',
      ...commonalityTable(rows),
      '',
      '## Regressions in full',
      '',
      ...worseCaseDetail(rows, 'characterContext'),
      '',
      '## Verdict',
      '',
      favourable && uncommonHarm === 0
        ? `Across active weights: **${totalBetter} better, ${totalWorse} worse**. `
          + 'Ratio is favourable and uncommon words are unharmed; activate at the '
          + 'lowest weight that captures the gain.'
        : `Across active weights: **${totalBetter} better, ${totalWorse} worse**`
          + `${uncommonHarm > 0 ? `, with ${uncommonHarm} uncommon-word regressions` : ''}. `
          + 'This is not a clearly favourable ratio, so the production weight stays '
          + '**0**. The signal remains implemented, tested and available in shadow '
          + 'mode; it is switched off because the measurement did not support it, '
          + 'not because it is unfinished.',
      '',
    ].join('\n');

    console.info(`[char-gt] wrote ${writeSignalReport('character-context.md', report)}`);

    // Safety properties, whatever the quality verdict.
    for (const row of active) {
      expect(row.costOverrides, `weight ${row.weight} overrode operation cost`).toBe(0);
    }
    // Weight 0 must be a no-op against the shipped ranking.
    expect(rows[0]!.winnerChanges).toBe(0);
    expect(rows[0]!.withEvidence).toBe(0);
  }, 300_000);
});

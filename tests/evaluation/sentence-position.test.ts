/**
 * Ground-truth evaluation of the sentence-position signal.
 *
 * Two case sources, because neither alone is enough:
 *
 *   - UD English EWT corruptions give volume and an unbiased distribution of
 *     positions, but few of them land in the positions this signal cares about.
 *   - Hand-written cases cover the positions deliberately, including the ones
 *     the signal must *not* have an opinion about (abbreviations, decimals,
 *     dialogue openings), which random corruption almost never produces.
 *
 * Both are reported separately as well as together, so a good score on easy
 * synthetic cases cannot hide a bad score on real text.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/engine/correction-engine.js';
import { sentenceSlot } from '../../src/engine/context/sentence-position.js';
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

/**
 * Controlled cases, one per position the signal claims to understand.
 *
 * `[sentence, corrupted token, expected word, category]`. Several of these are
 * *negative* controls: positions where the correct behaviour is to have no
 * opinion at all.
 */
const CONTROLLED: ReadonlyArray<readonly [string, string, string, string]> = [
  // Sentence-initial lowercase corruptions.
  ['teh cat sat on the mat.', 'teh', 'the', 'sentence-initial'],
  ['hse went home early.', 'hse', 'she', 'pronoun-at-start'],
  ['thier plan finally worked.', 'thier', 'their', 'sentence-initial'],

  // Words before terminal punctuation.
  ['I walked over to the shpo.', 'shpo', 'shop', 'before-terminal'],
  ['He handed the letter to hte.', 'hte', 'the', 'before-terminal'],
  ['She said it was a mis.', 'mis', 'miss', 'before-terminal'],

  // Proper nouns at sentence start and mid-sentence.
  ['I need to iprove it soon.', 'iprove', 'improve', 'proper-noun-mid'],
  ['Iprove it now, please.', 'Iprove', 'improve', 'proper-noun-at-start'],
  ['We met in marhc last year.', 'marhc', 'march', 'proper-noun-mid'],

  // Words after quotation marks and brackets.
  ['He said "teh door is open" quietly.', 'teh', 'the', 'after-quote'],
  ['The result (teh best one) arrived.', 'teh', 'the', 'after-bracket'],
  ['"Teh door is open," she said.', 'Teh', 'the', 'dialogue-opening'],

  // Headings and fragments.
  ['Notes about teh project', 'teh', 'the', 'fragment'],
  ['Chapter four: teh long road', 'teh', 'the', 'fragment'],

  // Contractions near sentence boundaries.
  ['I dont.', 'dont', "don't", 'contraction-at-boundary'],
  ['dont go there now.', 'dont', "don't", 'contraction-at-boundary'],

  // Valid but uncommon sentence openings.
  ['Nevertheless teh plan worked.', 'teh', 'the', 'uncommon-opening'],
  ['Accordingly hte team agreed.', 'hte', 'the', 'uncommon-opening'],

  // Negative controls: an abbreviation is not a sentence boundary, so the
  // signal must treat these exactly as mid-sentence.
  ['We sell fruit, e.g. teh apples and pears.', 'teh', 'the', 'after-abbreviation'],
  ['The rule, i.e. teh second one, applies.', 'teh', 'the', 'after-abbreviation'],
  ['Call Dr. Smtih about the invoice.', 'Smtih', 'smith', 'after-abbreviation'],

  // Negative controls: decimals and versions are not sentence boundaries.
  ['The build is 3.5 and teh result is fine.', 'teh', 'the', 'after-decimal'],
  ['Version 2.1.4 fixed teh crash we saw.', 'teh', 'the', 'after-decimal'],
];

function controlledCases(): SweepCase[] {
  const cases: SweepCase[] = [];
  for (const [sentence, corrupted, expected, category] of CONTROLLED) {
    const start = sentence.indexOf(corrupted);
    if (start < 0) throw new Error(`"${corrupted}" not in "${sentence}"`);
    cases.push({
      sentence,
      corrupted,
      expected,
      start,
      end: start + corrupted.length,
      kind: 'controlled',
      category,
    });
  }
  return cases;
}

/** Labels a corpus corruption by the slot it happens to occupy. */
function slotCategory(sweepCase: Omit<SweepCase, 'category'>): string {
  const context = buildContext(
    sweepCase.sentence,
    sweepCase.start,
    sweepCase.end,
    'https://evaluation.local',
  );
  const slot = sentenceSlot(context);
  if (slot.isSentenceStart) return 'corpus:sentence-initial';
  if (slot.isSentenceEnd) return 'corpus:before-terminal';
  if (slot.beforeClauseBreak) return 'corpus:before-clause-break';
  if (slot.afterClauseBreak) return 'corpus:after-clause-break';
  if (slot.isFragment) return 'corpus:fragment';
  return 'corpus:mid-sentence';
}

function corpusCases(limit: number): SweepCase[] {
  const sentences = readConllu(CORPUS).filter(isCleanSentence).slice(0, limit);
  const random = seededRandom(20_260_802);
  const cases: SweepCase[] = [];
  for (const sentence of sentences) {
    const corruption = corruptSentence(sentence.text, random);
    if (!corruption) continue;
    const base = {
      sentence: corruption.sentence,
      corrupted: corruption.corrupted,
      expected: corruption.original.toLowerCase(),
      start: corruption.start,
      end: corruption.end,
      kind: corruption.kind,
    };
    cases.push({ ...base, category: slotCategory(base) });
  }
  return cases;
}

describe.skipIf(!available)('sentence-position ground-truth evaluation', () => {
  it('sweeps sentence-position weights against known corruptions', () => {
    const controlled = controlledCases();
    const corpus = corpusCases(1200);
    const all = [...controlled, ...corpus];
    expect(corpus.length).toBeGreaterThan(200);

    const rows: SweepRow[] = WEIGHTS.map((w) => sweepWeight('sentencePosition', w, all));
    const controlledRows: SweepRow[] = WEIGHTS.map((w) =>
      sweepWeight('sentencePosition', w, controlled),
    );
    const corpusRows: SweepRow[] = WEIGHTS.map((w) => sweepWeight('sentencePosition', w, corpus));

    for (const row of rows) {
      console.info(
        `[pos-slot] w=${row.weight.toFixed(3)} cases=${row.cases} `
          + `evidence=${row.withEvidence} changes=${row.winnerChanges} `
          + `better=${row.better} worse=${row.worse} neutral=${row.neutral} `
          + `costOverrides=${row.costOverrides} actionChanges=${row.actionChanges} `
          + `avgMargin=${row.avgMarginChange.toFixed(5)}`,
      );
    }

    const active = rows.filter((r) => r.weight > 0);
    const totalBetter = active.reduce((s, r) => s + r.better, 0);
    const totalWorse = active.reduce((s, r) => s + r.worse, 0);
    const corpusHarm = corpusRows.reduce((s, r) => s + r.worse, 0);
    const corpusGain = corpusRows.reduce((s, r) => s + r.better, 0);

    const report = [
      '# Sentence-position ground-truth evaluation',
      '',
      `Controlled cases: ${controlled.length}. Corpus corruptions: ${corpus.length}.`,
      'Production weights are the shipped ones (`frequency = 0.04`) with only',
      '`sentencePosition` varied, so this measures the signal in combination with',
      'what already ships.',
      '',
      '## Implementation notes',
      '',
      '- Position comes from `EngineContext` and the shared sentence analysis.',
      '  No second tokenizer, sentence detector, POS classifier or clause detector',
      '  was written for this signal.',
      '- Every rule is a *prohibition* (a position that rules a class out), never',
      '  a preference. The only capitalisation rule is a penalty, and it is',
      '  switched off at sentence start where case carries no information.',
      '- Fixed while implementing: `isSentenceStart` treated every full stop as a',
      '  boundary, so `Dr.`, `e.g.`, `i.e.` and `Fig.` produced false sentence',
      '  starts. The abbreviation check now lives once in `tokenizer.ts` and is',
      '  shared with the capitalisation lane.',
      '',
      '## Results by weight — all cases',
      '',
      ...summaryTable(rows),
      '',
      '## Results by weight — controlled cases only',
      '',
      ...summaryTable(controlledRows),
      '',
      '## Results by weight — corpus corruptions only',
      '',
      ...summaryTable(corpusRows),
      '',
      '## By sentence-position category',
      '',
      ...categoryTable(rows),
      '',
      '## By candidate-generation process',
      '',
      ...processTable(rows),
      '',
      '## Common versus uncommon expected words',
      '',
      ...commonalityTable(rows),
      '',
      '## Regressions in full',
      '',
      ...worseCaseDetail(rows, 'sentencePosition'),
      '',
      '## Verdict',
      '',
      totalBetter > totalWorse && corpusHarm === 0
        ? `Across active weights: **${totalBetter} better, ${totalWorse} worse**, with `
          + `${corpusGain} corpus gains and no corpus regressions. Activate at the `
          + 'lowest weight that captures the gain.'
        : `Across active weights: **${totalBetter} better, ${totalWorse} worse** `
          + `(corpus: ${corpusGain} better, ${corpusHarm} worse). The production `
          + 'weight stays **0**: the signal is implemented, tested and available in '
          + 'shadow mode, and will be reconsidered when shadow observations from '
          + 'real writing accumulate.',
      '',
    ].join('\n');

    console.info(`[pos-slot] wrote ${writeSignalReport('sentence-position.md', report)}`);

    for (const row of active) {
      expect(row.costOverrides, `weight ${row.weight} overrode operation cost`).toBe(0);
    }
    expect(rows[0]!.winnerChanges).toBe(0);
    expect(rows[0]!.withEvidence).toBe(0);
  }, 300_000);
});

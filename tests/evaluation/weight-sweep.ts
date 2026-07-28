/**
 * A shared weight sweep for a single context term.
 *
 * Both remaining signals - character context and sentence position - need the
 * same measurement: rank a known corruption under production weights, rank it
 * again with one term raised, and judge the difference against the word that
 * was actually corrupted. Counting winner *changes* is not evidence; only
 * better-against-worse is.
 *
 * Everything here is development-only and never reaches the bundle.
 */
import { generateCandidates, type Candidate } from '../../src/engine/candidate-generator.js';
import { rankCandidates, type ScoredCandidate } from '../../src/engine/context/candidate-scoring.js';
import {
  applyPolicy,
  classifyRisk,
  type CorrectionRiskClass,
} from '../../src/engine/context/correction-policy.js';
import { RANKING_MARGIN } from '../../src/engine/context/rule-context-provider.js';
import { DEFAULT_WEIGHTS, type ScoreWeights } from '../../src/engine/context/score-weights.js';
import { frequencyRank } from '../../src/engine/data/frequency.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { operationOf } from './evaluator.js';

/** Terms this harness can sweep. */
export type SweepTerm = keyof ScoreWeights;

export interface SweepCase {
  /** Sentence with the corruption already in place. */
  sentence: string;
  /** The corrupted token as typed. */
  corrupted: string;
  /** The word that should win. */
  expected: string;
  start: number;
  end: number;
  /** How the corruption was produced, or the hand-written scenario name. */
  kind: string;
  /** Grouping label for the by-category breakdown. */
  category: string;
}

/** A candidate as it appeared in both rankings, for the worse-case dumps. */
export interface CandidateLine {
  word: string;
  process: number;
  operation: string;
  operationCost: number;
  baseScore: number;
  termContribution: number;
  finalScore: number;
}

export interface WorseCase {
  sentence: string;
  corrupted: string;
  expected: string;
  productionWinner: string;
  experimentalWinner: string;
  candidates: CandidateLine[];
  productionMargin: number;
  experimentalMargin: number;
  riskClass: CorrectionRiskClass;
  productionAction: string;
  experimentalAction: string;
  /** How much score the wrong winner gained relative to the right one. */
  swing: number;
}

export interface Tally {
  better: number;
  worse: number;
}

export interface SweepRow {
  weight: number;
  cases: number;
  withEvidence: number;
  winnerChanges: number;
  better: number;
  worse: number;
  neutral: number;
  costOverrides: number;
  actionChanges: number;
  byProcess: Record<string, Tally>;
  byCategory: Record<string, Tally>;
  byCommonality: Record<'common' | 'uncommon', Tally>;
  avgMarginChange: number;
  worseCases: WorseCase[];
}

/**
 * A word counts as common when the frequency table puts it in the upper half of
 * its quantised range. Uncommon valid words are the population most at risk
 * from any signal that rewards typicality, so they are reported separately.
 */
const COMMON_RANK = 128;

function isCommon(word: string): boolean {
  return frequencyRank(word) >= COMMON_RANK;
}

function marginOf(ranked: readonly ScoredCandidate[]): number {
  const best = ranked[0];
  if (!best) return 0;
  const second = ranked[1];
  return second ? best.rawScore - second.rawScore : best.rawScore;
}

function bump(map: Record<string, Tally>, key: string, better: boolean): void {
  map[key] ??= { better: 0, worse: 0 };
  if (better) map[key]!.better++;
  else map[key]!.worse++;
}

function actionFor(
  winner: ScoredCandidate,
  margin: number,
  typed: string,
): { action: string; riskClass: CorrectionRiskClass } {
  const riskClass = classifyRisk({
    originalIsValidWord: isKnownWord(typed),
    candidate: winner.candidate,
    correctionType: 'spelling',
  });
  const decision = applyPolicy({
    riskClass,
    score: winner.rawScore,
    margin,
    proposedAction: margin >= RANKING_MARGIN ? 'autocorrect' : 'suggest',
  });
  return { action: decision.action, riskClass };
}

function lines(
  production: readonly ScoredCandidate[],
  experimental: readonly ScoredCandidate[],
  term: SweepTerm,
): CandidateLine[] {
  const experimentalByWord = new Map(experimental.map((s) => [s.candidate.word, s]));
  return production.map((scored) => {
    const exp = experimentalByWord.get(scored.candidate.word);
    return {
      word: scored.candidate.word,
      process: scored.candidate.process,
      operation: operationOf(scored.candidate),
      operationCost: scored.candidate.operationCost,
      baseScore: scored.rawScore,
      termContribution: exp ? exp.terms[term] : 0,
      finalScore: exp ? exp.rawScore : scored.rawScore,
    };
  });
}

export interface SweepOptions {
  /** Extra ranking inputs, for signals that need more than the context. */
  candidatesFor?: (input: SweepCase) => Candidate[];
  /** Cap on stored worse-case dumps, so a bad weight cannot flood the report. */
  maxWorseCases?: number;
}

/**
 * Sweeps one term at one weight over a fixed case set.
 *
 * The production side is always the real shipped weight set, so this measures
 * the term *in combination with* frequency at 0.04 rather than in isolation.
 */
export function sweepWeight(
  term: SweepTerm,
  weight: number,
  cases: readonly SweepCase[],
  options: SweepOptions = {},
): SweepRow {
  const maxWorse = options.maxWorseCases ?? 25;
  const row: SweepRow = {
    weight,
    cases: 0,
    withEvidence: 0,
    winnerChanges: 0,
    better: 0,
    worse: 0,
    neutral: 0,
    costOverrides: 0,
    actionChanges: 0,
    byProcess: {},
    byCategory: {},
    byCommonality: { common: { better: 0, worse: 0 }, uncommon: { better: 0, worse: 0 } },
    avgMarginChange: 0,
    worseCases: [],
  };

  const experimentalWeights: ScoreWeights = { ...DEFAULT_WEIGHTS, [term]: weight };
  let marginDelta = 0;

  for (const sweepCase of cases) {
    const candidates =
      options.candidatesFor?.(sweepCase) ?? generateCandidates(sweepCase.corrupted, 10);
    if (candidates.length < 2) continue;
    row.cases++;

    const context = buildContext(
      sweepCase.sentence,
      sweepCase.start,
      sweepCase.end,
      'https://evaluation.local',
    );
    const rankingInput = { context, typedWord: sweepCase.corrupted };

    const production = rankCandidates(candidates, DEFAULT_WEIGHTS, rankingInput);
    const experimental = rankCandidates(candidates, experimentalWeights, rankingInput);

    if (experimental.some((scored) => scored.terms[term] !== 0)) row.withEvidence++;

    const productionMargin = marginOf(production);
    const experimentalMargin = marginOf(experimental);
    marginDelta += experimentalMargin - productionMargin;

    const before = production[0]!;
    const after = experimental[0]!;
    if (before.candidate.word === after.candidate.word) continue;
    row.winnerChanges++;

    // The safety property: weak evidence must never buy a costlier edit.
    const lowestCost = Math.min(...candidates.map((c) => c.operationCost));
    if (after.candidate.operationCost > lowestCost) row.costOverrides++;

    const beforeAction = actionFor(before, productionMargin, sweepCase.corrupted);
    const afterAction = actionFor(after, experimentalMargin, sweepCase.corrupted);
    if (beforeAction.action !== afterAction.action) row.actionChanges++;

    const expected = sweepCase.expected.toLowerCase();
    const beforeRight = before.candidate.word === expected;
    const afterRight = after.candidate.word === expected;

    if (afterRight && !beforeRight) {
      row.better++;
      bump(row.byProcess, operationOf(after.candidate), true);
      bump(row.byCategory, sweepCase.category, true);
      row.byCommonality[isCommon(expected) ? 'common' : 'uncommon'].better++;
    } else if (beforeRight && !afterRight) {
      row.worse++;
      bump(row.byProcess, operationOf(after.candidate), false);
      bump(row.byCategory, sweepCase.category, false);
      row.byCommonality[isCommon(expected) ? 'common' : 'uncommon'].worse++;

      if (row.worseCases.length < maxWorse) {
        const rightUnderExperimental = experimental.find(
          (scored) => scored.candidate.word === expected,
        );
        row.worseCases.push({
          sentence: sweepCase.sentence,
          corrupted: sweepCase.corrupted,
          expected,
          productionWinner: before.candidate.word,
          experimentalWinner: after.candidate.word,
          candidates: lines(production, experimental, term),
          productionMargin,
          experimentalMargin,
          riskClass: afterAction.riskClass,
          productionAction: beforeAction.action,
          experimentalAction: afterAction.action,
          swing: after.rawScore - (rightUnderExperimental?.rawScore ?? after.rawScore),
        });
      }
    } else {
      // Both wrong, or both right by different spellings: a real change, but
      // not one ground truth can call an improvement.
      row.neutral++;
    }
  }

  row.avgMarginChange = row.cases > 0 ? marginDelta / row.cases : 0;
  row.worseCases.sort((a, b) => b.swing - a.swing);
  return row;
}

/* ------------------------------- reporting ------------------------------- */

export function summaryTable(rows: readonly SweepRow[]): string[] {
  return [
    '| weight | cases | with evidence | winner changes | better | worse | neutral |'
      + ' cost overrides | action changes | avg margin change |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.weight.toFixed(3)} | ${r.cases} | ${r.withEvidence} | ${r.winnerChanges} | `
        + `**${r.better}** | **${r.worse}** | ${r.neutral} | ${r.costOverrides} | `
        + `${r.actionChanges} | ${r.avgMarginChange >= 0 ? '+' : ''}`
        + `${r.avgMarginChange.toFixed(5)} |`,
    ),
  ];
}

function breakdown(
  rows: readonly SweepRow[],
  pick: (row: SweepRow) => Record<string, Tally>,
  label: string,
): string[] {
  const active = rows.filter((r) => r.weight > 0 && Object.keys(pick(r)).length > 0);
  if (active.length === 0) return [`_No winner changes to break down by ${label}._`];
  return [
    `| weight | ${label} | better | worse |`,
    '|---:|---|---:|---:|',
    ...active.flatMap((r) =>
      Object.entries(pick(r)).map(
        ([key, tally]) =>
          `| ${r.weight.toFixed(3)} | ${key} | ${tally.better} | ${tally.worse} |`,
      ),
    ),
  ];
}

export function processTable(rows: readonly SweepRow[]): string[] {
  return breakdown(rows, (r) => r.byProcess, 'process');
}

export function categoryTable(rows: readonly SweepRow[]): string[] {
  return breakdown(rows, (r) => r.byCategory, 'category');
}

export function commonalityTable(rows: readonly SweepRow[]): string[] {
  const active = rows.filter((r) => r.weight > 0);
  return [
    '| weight | common better | common worse | uncommon better | uncommon worse |',
    '|---:|---:|---:|---:|---:|',
    ...active.map(
      (r) =>
        `| ${r.weight.toFixed(3)} | ${r.byCommonality.common.better} | `
        + `${r.byCommonality.common.worse} | ${r.byCommonality.uncommon.better} | `
        + `${r.byCommonality.uncommon.worse} |`,
    ),
  ];
}

/** Full dump of every regression, as required for manual inspection. */
export function worseCaseDetail(rows: readonly SweepRow[], term: SweepTerm): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.worseCases.length === 0) continue;
    out.push(`### Regressions at weight ${row.weight}`, '');
    for (const [index, worse] of row.worseCases.entries()) {
      out.push(
        `#### ${index + 1}. \`${worse.corrupted}\` — expected \`${worse.expected}\``,
        '',
        `- Original sentence: \`${worse.sentence}\``,
        `- Corrupted token: \`${worse.corrupted}\``,
        `- Expected word: \`${worse.expected}\``,
        `- Production winner: \`${worse.productionWinner}\``,
        `- Experimental winner: \`${worse.experimentalWinner}\``,
        `- Production margin: ${worse.productionMargin.toFixed(5)}`,
        `- Experimental margin: ${worse.experimentalMargin.toFixed(5)}`,
        `- Risk class: \`${worse.riskClass}\``,
        `- Action: \`${worse.productionAction}\` → \`${worse.experimentalAction}\``,
        '',
        `| candidate | process | operation | op cost | base score | ${term} | final score |`,
        '|---|---:|---|---:|---:|---:|---:|',
        ...worse.candidates.map(
          (line) =>
            `| \`${line.word}\` | ${line.process} | ${line.operation} | `
            + `${line.operationCost} | ${line.baseScore.toFixed(5)} | `
            + `${line.termContribution >= 0 ? '+' : ''}${line.termContribution.toFixed(5)} | `
            + `${line.finalScore.toFixed(5)} |`,
        ),
        '',
      );
    }
  }
  return out.length > 0 ? out : ['_No regressions at any evaluated weight._'];
}

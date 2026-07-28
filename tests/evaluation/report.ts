/**
 * Writes the evaluation artefacts a human actually reads.
 *
 * Development only. Output goes to `artifacts/context-evaluation/`, which is
 * outside every esbuild entry point, so none of it can reach the extension.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type {
  CandidateDetail,
  Disagreement,
  EvaluationResult,
  FalsePositiveCase,
} from './evaluator.js';
import type { ScoreWeights } from '../../src/engine/context/score-weights.js';

const OUTPUT_DIR = 'artifacts/context-evaluation';

function write(name: string, content: string): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const path = `${OUTPUT_DIR}/${name}`;
  writeFileSync(path, content, 'utf8');
  return path;
}

function formatWeights(weights: ScoreWeights): string {
  return Object.entries(weights)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
}

function candidateTable(candidates: readonly CandidateDetail[], winner: string, rival: string): string {
  const rows = candidates.map((c) => {
    const mark = c.word === winner ? ' **←tested**' : c.word === rival ? ' **←baseline**' : '';
    return `| \`${c.word}\`${mark} | ${c.operation} | ${c.operationCost} | `
      + `${c.baseScore.toFixed(4)} | ${c.frequencyRank} | `
      + `${c.frequencyContribution.toFixed(4)} | ${c.experimentalScore.toFixed(4)} |`;
  });
  return [
    '| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function disagreementSection(d: Disagreement, index: number): string {
  return [
    `## Case ${index + 1} — \`${d.token}\``,
    '',
    `**Sentence id:** \`${d.sentenceId}\``,
    '',
    d.originalSentence
      ? `**Original sentence:**\n\n> ${d.originalSentence}\n`
      : '',
    `**Input sentence${d.originalSentence ? ' (corrupted)' : ''}:**`,
    '',
    `> ${d.sentence}`,
    '',
    `| field | value |`,
    `|---|---|`,
    `| Target token | \`${d.token}\` |`,
    `| Expected correction | ${d.expected ? `\`${d.expected}\`` : '(none — unmodified text)'} |`,
    `| Baseline winner | \`${d.currentWinner}\` |`,
    `| Tested winner | \`${d.experimentalWinner}\` |`,
    `| Baseline raw score | ${d.currentScore.toFixed(4)} |`,
    `| Tested raw score | ${d.experimentalScore.toFixed(4)} |`,
    `| Baseline margin | ${d.currentMargin.toFixed(4)} |`,
    `| Tested margin | ${d.experimentalMargin.toFixed(4)} |`,
    `| Baseline action | ${d.currentAction} |`,
    `| Tested action | ${d.experimentalAction} |`,
    `| Correction-risk class | \`${d.riskClass}\` |`,
    `| Operation cost still dominant | ${d.costStillDominant ? 'yes' : '**NO**'} |`,
    '',
    '### Candidate set',
    '',
    candidateTable(d.candidates, d.experimentalWinner, d.currentWinner),
    '',
    '### Why the evaluator called this worse',
    '',
    d.verdictReason,
    '',
  ].filter(Boolean).join('\n');
}

export function writeRegressionReport(result: EvaluationResult): string {
  const worse = result.disagreements.filter((d) => d.verdict === 'worse');
  const content = [
    '# Frequency ranking regressions',
    '',
    'Every case where the tested frequency-informed ranking chose a *different* word',
    'than the explicit baseline, and the baseline happened to be the one matching the',
    'synthetic corruption\'s known original.',
    '',
    `Baseline weights: \`${formatWeights(result.baselineWeights)}\``,
    '',
    `Tested weights: \`${formatWeights(result.experimentalWeights)}\``,
    '',
    `Generated from UD English EWT. Cases: **${worse.length}**.`,
    '',
    '> These are candidates for classification, not confirmed engine faults.',
    '> A synthetic corruption has exactly one "expected" answer by construction,',
    '> which is not the same as having exactly one *correct* answer.',
    '',
    '---',
    '',
    worse.length === 0
      ? '_No regressions in this run._'
      : worse.map((d, i) => disagreementSection(d, i)).join('\n---\n\n'),
    '',
  ].join('\n');
  return write('frequency-regressions.md', content);
}

function falsePositiveSection(c: FalsePositiveCase, index: number): string {
  return [
    `## Case ${index + 1} — \`${c.token}\``,
    '',
    `**Sentence id:** \`${c.sentenceId}\``,
    '',
    `> ${c.sentence}`,
    '',
    '| field | value |',
    '|---|---|',
    `| Target token | \`${c.token}\` |`,
    `| Proposed correction | \`${c.proposedCorrection}\` |`,
    `| Provider | ${c.provider} |`,
    `| Rule id | ${c.ruleId} |`,
    `| Correction type | ${c.correctionType} |`,
    `| Confidence | ${c.confidence.toFixed(4)} |`,
    `| Action | ${c.action} |`,
    `| Correction-risk class | \`${c.riskClass}\` |`,
    `| Token in ESDB | ${c.originalInDictionary ? 'yes' : '**no**'} |`,
    '',
    c.candidates.length > 0
      ? `### Candidate scores\n\n${candidateTable(c.candidates, c.proposedCorrection.toLowerCase(), '')}\n`
      : '_No dictionary candidates; the correction came from another layer._\n',
    '**Why the evaluator counted it:** the engine returned an `autocorrect`',
    'action on text taken unmodified from the corpus, and the evaluator treats',
    'any automatic change to unmodified text as an apparent false positive.',
    '',
  ].join('\n');
}

export function writeFalsePositiveReport(result: EvaluationResult): string {
  const cases = result.falsePositiveCases;
  const content = [
    '# Apparent false positives on unmodified UD English EWT text',
    '',
    `Cases: **${cases.length}** raw, **${result.confirmedFalsePositives}** confirmed`,
    'after applying the manual review file.',
    '',
    `Candidate-score baseline: \`${formatWeights(result.baselineWeights)}\``,
    '',
    `Candidate-score test weights: \`${formatWeights(result.experimentalWeights)}\``,
    '',
    '> "Apparent" is the operative word. UD English Web Treebank is a *web*',
    '> treebank: it contains genuine misspellings, informal spellings, product',
    '> names and abbreviations. An automatic correction here is not necessarily',
    '> an engine fault — it may be the engine correctly flagging bad text.',
    '',
    'Classifications live in `tests/evaluation/review.json`, keyed by',
    '`sentenceId|token` so the evaluation stays reproducible. Nothing is',
    'excluded from this report; the review only affects the *confirmed* count.',
    '',
    '---',
    '',
    cases.length === 0
      ? '_No apparent false positives in this run._'
      : cases.map((c, i) => falsePositiveSection(c, i)).join('\n---\n\n'),
    '',
  ].join('\n');
  return write('ud-apparent-false-positives.md', content);
}

export interface WeightRow {
  weight: number;
  disagreements: number;
  better: number;
  worse: number;
  neutral: number;
  confirmedFalsePositives: number;
  validWordSuggestionChanges: number;
  actionChanges: number;
  costOverrides: number;
  averageMarginChange: number;
}

export interface WeightSweepContext {
  baselineWeights: ScoreWeights;
  testedWeights: readonly number[];
  productionWeight: number;
  seed: number;
  sampleLimit: number;
}

export function writeWeightSweep(
  rows: readonly WeightRow[],
  chosen: string,
  context: WeightSweepContext,
): string {
  const productionIncluded = context.testedWeights.includes(context.productionWeight);
  const content = [
    '# Frequency weight sweep',
    '',
    'Each weight run over the same UD English EWT sample with the same seed, so',
    'the only variable is the weight itself.',
    '',
    `Baseline weights: \`${formatWeights(context.baselineWeights)}\``,
    '',
    `Tested frequency weights: \`${context.testedWeights.map((weight) => weight.toFixed(2)).join(', ')}\``,
    '',
    `Current production frequency weight: **${context.productionWeight.toFixed(2)}** `
      + `(${productionIncluded ? 'included in this sweep' : 'NOT INCLUDED'})`,
    '',
    `Seed: \`${context.seed}\`. Clean-sentence sample limit: \`${context.sampleLimit}\`.`,
    '',
    '| weight | disagree | better | worse | neutral | confirmed FP | valid-word changes | action changes | cost overrides | avg margin Δ |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.weight.toFixed(2)} | ${r.disagreements} | ${r.better} | ${r.worse} | `
        + `${r.neutral} | ${r.confirmedFalsePositives} | ${r.validWordSuggestionChanges} | `
        + `${r.actionChanges} | **${r.costOverrides}** | ${r.averageMarginChange.toFixed(4)} |`,
    ),
    '',
    '`cost overrides` is the safety column: the number of disagreements where the',
    'frequency-informed winner did **not** have the lowest operation cost. It must',
    'be zero.',
    '',
    '## Decision',
    '',
    chosen,
    '',
  ].join('\n');
  return write('frequency-weight-sweep.md', content);
}

export function writeSignalReport(name: string, content: string): string {
  return write(name, content);
}

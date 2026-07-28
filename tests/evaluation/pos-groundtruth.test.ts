/**
 * Part 5: does part-of-speech evidence actually help?
 *
 * The previous run showed POS firing on roughly half of all candidate sets and
 * changing nine winners — but on *unmodified* corpus text, where there is no
 * right answer to compare against. "It changes decisions" is not evidence.
 *
 * This sweeps POS weights over synthetic corruptions, where the original word
 * is known, and counts better against worse the way the frequency sweep did.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import { classifyWord } from '../../src/engine/context/pos-compatibility.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';
import { isCleanSentence, readConllu } from './conllu.js';
import { corruptSentence, operationOf, seededRandom } from './evaluator.js';
import { writeSignalReport } from './report.js';

const CORPUS = path.resolve('vendor/evaluation/UD_English-EWT/en_ewt-ud-dev.conllu');
const available = existsSync(CORPUS);

interface PosRow {
  weight: number;
  corruptions: number;
  withEvidence: number;
  winnerChanges: number;
  better: number;
  worse: number;
  neutral: number;
  costOverrides: number;
  actionChanges: number;
  byClass: Record<string, { better: number; worse: number }>;
  byProcess: Record<string, { better: number; worse: number }>;
}

describe.skipIf(!available)('part-of-speech ground-truth evaluation', () => {
  it('sweeps POS weights against known corruptions', () => {
    const sentences = readConllu(CORPUS).filter(isCleanSentence).slice(0, 400);
    const weights = [0, 0.01, 0.02, 0.03, 0.04];
    const rows: PosRow[] = [];
    const samples: string[] = [];

    for (const weight of weights) {
      const random = seededRandom(20_260_728);
      const row: PosRow = {
        weight,
        corruptions: 0,
        withEvidence: 0,
        winnerChanges: 0,
        better: 0,
        worse: 0,
        neutral: 0,
        costOverrides: 0,
        actionChanges: 0,
        byClass: {},
        byProcess: {},
      };

      for (const sentence of sentences) {
        const corruption = corruptSentence(sentence.text, random);
        if (!corruption) continue;

        const candidates = generateCandidates(corruption.corrupted, 10);
        if (candidates.length < 2) continue;
        row.corruptions++;

        const context = buildContext(
          corruption.sentence,
          corruption.start,
          corruption.end,
          'https://evaluation.local',
        );
        const baseline = rankCandidates(candidates, DEFAULT_WEIGHTS, {
          context,
          typedWord: corruption.corrupted,
        });
        const withPos = rankCandidates(
          candidates,
          { ...DEFAULT_WEIGHTS, partOfSpeech: weight },
          { context, typedWord: corruption.corrupted },
        );
        if (withPos.some((c) => c.terms.partOfSpeech !== 0)) row.withEvidence++;

        const before = baseline[0]!;
        const after = withPos[0]!;
        if (before.candidate.word === after.candidate.word) continue;
        row.winnerChanges++;

        const lowestCost = Math.min(...candidates.map((c) => c.operationCost));
        if (after.candidate.operationCost > lowestCost) row.costOverrides++;

        const marginOf = (r: typeof baseline) =>
          r.length > 1 ? r[0]!.rawScore - r[1]!.rawScore : r[0]!.rawScore;
        if ((marginOf(baseline) >= 0.06) !== (marginOf(withPos) >= 0.06)) {
          row.actionChanges++;
        }

        const expected = corruption.original.toLowerCase();
        const beforeRight = before.candidate.word === expected;
        const afterRight = after.candidate.word === expected;
        const cls = classifyWord(after.candidate.word);
        const proc = operationOf(after.candidate);
        row.byClass[cls] ??= { better: 0, worse: 0 };
        row.byProcess[proc] ??= { better: 0, worse: 0 };

        if (afterRight && !beforeRight) {
          row.better++;
          row.byClass[cls]!.better++;
          row.byProcess[proc]!.better++;
        } else if (beforeRight && !afterRight) {
          row.worse++;
          row.byClass[cls]!.worse++;
          row.byProcess[proc]!.worse++;
        } else {
          row.neutral++;
        }

        if (weight === 0.02 && samples.length < 10) {
          samples.push(
            `| \`${corruption.corrupted}\` | \`${before.candidate.word}\` | `
              + `\`${after.candidate.word}\` | \`${expected}\` | ${cls} | `
              + `${afterRight ? 'better' : beforeRight ? 'worse' : 'neutral'} |`,
          );
        }
      }

      rows.push(row);
      console.info(
        `[pos-gt] w=${weight.toFixed(2)} corruptions=${row.corruptions} `
          + `evidence=${row.withEvidence} changes=${row.winnerChanges} `
          + `better=${row.better} worse=${row.worse} neutral=${row.neutral} `
          + `costOverrides=${row.costOverrides} actionChanges=${row.actionChanges}`,
      );
    }

    const active = rows.filter((r) => r.weight > 0);
    const totalBetter = active.reduce((s, r) => s + r.better, 0);
    const totalWorse = active.reduce((s, r) => s + r.worse, 0);
    const anyOverride = active.some((r) => r.costOverrides > 0);

    const report = [
      '# Part-of-speech ground-truth evaluation',
      '',
      'Synthetic corruptions of UD English EWT sentences, where the original',
      'word is known, so a winner change can be judged rather than merely',
      'counted. Same seed at every weight.',
      '',
      '| weight | corruptions | with POS evidence | winner changes | better | worse | neutral | cost overrides | action changes |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map(
        (r) =>
          `| ${r.weight.toFixed(2)} | ${r.corruptions} | ${r.withEvidence} | `
          + `${r.winnerChanges} | ${r.better} | ${r.worse} | ${r.neutral} | `
          + `**${r.costOverrides}** | ${r.actionChanges} |`,
      ),
      '',
      samples.length > 0
        ? [
            '## Sample winner changes at weight 0.02',
            '',
            '| corrupted | without POS | with POS | expected | class | verdict |',
            '|---|---|---|---|---|---|',
            ...samples,
            '',
          ].join('\n')
        : '_No winner changes at 0.02._\n',
      '## By word class',
      '',
      '| weight | class | better | worse |',
      '|---:|---|---:|---:|',
      ...active.flatMap((r) =>
        Object.entries(r.byClass).map(
          ([cls, v]) => `| ${r.weight.toFixed(2)} | ${cls} | ${v.better} | ${v.worse} |`,
        ),
      ),
      '',
      '## By correction process',
      '',
      '| weight | process | better | worse |',
      '|---:|---|---:|---:|',
      ...active.flatMap((r) =>
        Object.entries(r.byProcess).map(
          ([proc, v]) => `| ${r.weight.toFixed(2)} | ${proc} | ${v.better} | ${v.worse} |`,
        ),
      ),
      '',
      '## Known limitation, retained',
      '',
      'POS cannot distinguish `improve` from `prove`, because both are verbs.',
      'No weight changes that: the signal has nothing to say when two candidates',
      'share a word class, which is the common case among the near-ties that',
      'actually matter.',
      '',
      '## Verdict',
      '',
      totalBetter > totalWorse && !anyOverride
        ? `Across all active weights: **${totalBetter} better, ${totalWorse} worse**, `
          + 'no operation-cost overrides. A weight may be justified; pick the '
          + 'lowest one that captures the gain.'
        : `Across all active weights: **${totalBetter} better, ${totalWorse} worse**`
          + `${anyOverride ? ', and at least one operation-cost override' : ''}. `
          + 'Not sufficient evidence to activate. POS stays at weight **0**.',
      '',
    ].join('\n');
    console.info(`[pos-gt] wrote ${writeSignalReport('pos-ground-truth.md', report)}`);

    // The safety property, whatever the quality verdict turns out to be.
    for (const row of active) {
      expect(row.costOverrides, `POS weight ${row.weight} overrode operation cost`).toBe(0);
    }
    expect(rows[0]!.winnerChanges).toBe(0);
  }, 300_000);
});

/** Ground truth cannot resolve this, and no weight should pretend otherwise. */
describe('the documented POS limitation', () => {
  it('cannot separate improve from prove', () => {
    const context = buildContext('I need to iprove it.', 10, 16, 'https://example.com');
    const candidates = generateCandidates('iprove', 10);
    const improve = candidates.find((c) => c.word === 'improve');
    const prove = candidates.find((c) => c.word === 'prove');
    expect(improve && prove).toBeTruthy();
    expect(classifyWord('improve')).toBe(classifyWord('prove'));

    const ranked = rankCandidates(candidates, { ...DEFAULT_WEIGHTS, partOfSpeech: 0.04 }, {
      context,
      typedWord: 'iprove',
    });
    const a = ranked.find((s) => s.candidate.word === 'improve')!;
    const b = ranked.find((s) => s.candidate.word === 'prove')!;
    expect(a.terms.partOfSpeech).toBe(b.terms.partOfSpeech);
    expect(isKnownWord('iprove')).toBe(false);
  });
});

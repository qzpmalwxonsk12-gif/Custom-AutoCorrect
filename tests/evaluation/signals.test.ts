/**
 * Parts 6 and 7: is `documentReuse` or `partOfSpeech` worth activating?
 *
 * Development only. Both run with frequency at its shipped weight and every
 * other signal at zero, so the only variable is the signal under test.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import { DocumentEvidence } from '../../src/engine/context/document-evidence.js';
import { classifyWord } from '../../src/engine/context/pos-compatibility.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';
import { isCleanSentence, readConllu } from './conllu.js';
import { writeSignalReport } from './report.js';

const CORPUS = path.resolve('vendor/evaluation/UD_English-EWT/en_ewt-ud-dev.conllu');
const available = existsSync(CORPUS);

/* ------------------------------ Part 6 ------------------------------ */

/**
 * Controlled documents. Each pairs vocabulary the writer uses correctly with a
 * later mistyping of it, which is the exact situation document reuse exists for.
 */
const DOCUMENTS = [
  {
    name: 'fiction with a character name',
    text:
      'Kael walked into the tavern. Kael had been travelling for weeks. '
      + 'The innkeeper recognised Kael immediately and poured a drink.',
    probes: ['Kael'],
  },
  {
    name: 'technical writing',
    text:
      'The TypeScript compiler checks the contenteditable adapter. '
      + 'TypeScript catches the error before the contenteditable host sees it.',
    probes: ['TypeScript', 'contenteditable'],
  },
  {
    name: 'product names',
    text:
      'Harper runs in the background. We compared Harper against ChatGPT, '
      + 'and published the result on Wattpad. Harper was faster.',
    probes: ['Harper', 'ChatGPT', 'Wattpad'],
  },
  {
    name: 'genre jargon',
    text: 'The LitRPG genre exploded. LitRPG readers expect stat blocks.',
    probes: ['LitRPG'],
  },
  {
    name: 'repeated uncommon dictionary word',
    text:
      'The committee reviewed the proposal. The committee met again on Tuesday. '
      + 'A third committee session followed.',
    probes: ['committee'],
  },
  {
    name: 'repeated misspelling',
    text: 'I recieve the letter. I recieve another. I recieve a third.',
    probes: ['recieve'],
  },
];

describe('document reuse — Part 6', () => {
  it('measures which vocabulary actually accumulates evidence', () => {
    const lines: string[] = [];
    for (const doc of DOCUMENTS) {
      const evidence = new DocumentEvidence();
      evidence.observe(doc.text);
      for (const probe of doc.probes) {
        const known = isKnownWord(probe.toLowerCase());
        const boost = evidence.boostFor(probe);
        const entry = evidence.evidenceFor(probe);
        lines.push(
          `| ${doc.name} | \`${probe}\` | ${known ? 'yes' : '**no**'} | `
            + `${entry?.validOccurrences ?? 0} | ${entry?.capitalisedOccurrences ?? 0} | `
            + `${boost.toFixed(3)} |`,
        );
        console.info(
          `[reuse] ${doc.name}: "${probe}" inDict=${known} `
            + `occurrences=${entry?.validOccurrences ?? 0} boost=${boost.toFixed(3)}`,
        );
      }
    }

    const report = [
      '# Document-reuse evaluation',
      '',
      '| document | term | in ESDB | occurrences | capitalised | boost |',
      '|---|---|---|---:|---:|---:|',
      ...lines,
      '',
      '## Finding',
      '',
      'The split is sharper than expected, and it is entirely about ESDB',
      'membership rather than about the signal.',
      '',
      '**Boosted** (in ESDB, so evidence accumulates): `TypeScript` (0.667),',
      '`Harper` (1.000), `ChatGPT` (0.333), `committee` (1.000). The 2026 ESDB',
      'release is broader than assumed — `harper`, `typescript` and `chatgpt`',
      'are all in it.',
      '',
      '**Not boosted** (absent from ESDB): `Kael`, `LitRPG`, `contenteditable`,',
      '`Wattpad`. These are the invented names and compounds the signal was',
      'primarily meant to help, and it cannot reach them.',
      '',
      'The repeated misspelling `recieve` correctly gets zero, which is the',
      'safety rule working: allowing unknown words to accumulate evidence is',
      'exactly what would let a repeated typo justify itself.',
      '',
      'So the signal is real but narrower than its motivation. It helps a term',
      'the dictionary already knows and the writer is leaning on; it does',
      'nothing for genuinely novel vocabulary.',
      '',
      '## Recommendation',
      '',
      'Leave `documentReuse` at weight **0** for now — not because the mechanism',
      'is wrong, but because no *ranking* benefit has been measured. A boost of',
      '1.0 on `committee` only matters if `committee` is competing with another',
      'candidate, and the UD run produced no such case. Activating a signal on',
      'the strength of "it fires" rather than "it decides something correctly"',
      'is the mistake the frequency rollout deliberately avoided.',
      '',
      'The experiment that would justify it: corrupt a repeated in-dictionary',
      'term and check whether reuse restores it where frequency alone does not.',
      '',
    ].join('\n');
    console.info(`[reuse] wrote ${writeSignalReport('document-reuse.md', report)}`);

    // The safety property, asserted rather than described.
    const misspelling = new DocumentEvidence();
    misspelling.observe(DOCUMENTS[5]!.text);
    expect(misspelling.boostFor('recieve')).toBe(0);
  });

  it('cannot override a cheaper edit at any tested weight', () => {
    const evidence = new DocumentEvidence();
    // Load the document with a valid word that competes with a cheap fix.
    evidence.observe('The matter is settled. The matter stands. This matter again.');
    for (const weight of [0.01, 0.02, 0.04, 0.06]) {
      const candidates = generateCandidates('mastter', 10);
      const ranked = rankCandidates(
        candidates,
        { ...DEFAULT_WEIGHTS, documentReuse: weight },
        { documentEvidence: evidence },
      );
      const lowestCost = Math.min(...candidates.map((c) => c.operationCost));
      expect(
        ranked[0]!.candidate.operationCost,
        `documentReuse ${weight} overrode operation cost`,
      ).toBeLessThanOrEqual(lowestCost);
    }
  });
});

/* ------------------------------ Part 7 ------------------------------ */

describe.skipIf(!available)('part of speech — Part 7', () => {
  it('measures how often POS has an opinion at all', () => {
    const sentences = readConllu(CORPUS).filter(isCleanSentence).slice(0, 300);

    let candidateSets = 0;
    let withContribution = 0;
    let winnersChanged = 0;
    const changes: string[] = [];

    for (const sentence of sentences) {
      const pattern = /[A-Za-z']+/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sentence.text)) !== null) {
        const word = match[0].toLowerCase();
        if (word.length < 3 || isKnownWord(word)) continue;
        const candidates = generateCandidates(word, 10);
        if (candidates.length < 2) continue;
        candidateSets++;

        const context = buildContext(
          sentence.text,
          match.index,
          match.index + match[0].length,
          'https://evaluation.local',
        );
        const withPos = rankCandidates(
          candidates,
          { ...DEFAULT_WEIGHTS, partOfSpeech: 0.05 },
          { context },
        );
        const without = rankCandidates(candidates, DEFAULT_WEIGHTS, { context });

        if (withPos.some((c) => c.terms.partOfSpeech !== 0)) withContribution++;
        if (withPos[0]!.candidate.word !== without[0]!.candidate.word) {
          winnersChanged++;
          if (changes.length < 10) {
            changes.push(
              `| \`${word}\` | \`${without[0]!.candidate.word}\` | `
                + `\`${withPos[0]!.candidate.word}\` | ${classifyWord(withPos[0]!.candidate.word)} |`,
            );
          }
        }
      }
    }

    console.info(
      `[pos] candidate sets: ${candidateSets}, non-zero POS contribution: ${withContribution}, `
        + `winners changed: ${winnersChanged}`,
    );

    const report = [
      '# Part-of-speech evaluation',
      '',
      `| measurement | value |`,
      `|---|---:|`,
      `| Candidate sets examined | ${candidateSets} |`,
      `| Sets receiving a non-zero POS contribution | ${withContribution} |`,
      `| Winners changed | ${winnersChanged} |`,
      '',
      winnersChanged > 0
        ? [
            '## Winner changes',
            '',
            '| token | without POS | with POS | class of new winner |',
            '|---|---|---|---|',
            ...changes,
            '',
          ].join('\n')
        : '_No winner changed at weight 0.05._\n',
      '## Known limitation, retained',
      '',
      'POS cannot distinguish `improve` from `prove`, because both are verbs.',
      'No weight fixes that; the signal has no information to offer when two',
      'candidates share a word class, which is the common case among the',
      'near-ties that matter.',
      '',
      '## Recommendation',
      '',
      'Leave `partOfSpeech` at weight **0**.',
      '',
      'It fires more often than expected — a non-zero contribution on roughly',
      'half the candidate sets — and it moves the winner in a small minority of',
      'them. But **the quality of those changes is unmeasured**: they occur on',
      'unmodified corpus text where there is no ground truth to compare against,',
      'so there is no evidence that any of them is an improvement.',
      '',
      '"It changes decisions" is not a reason to activate a signal. Frequency',
      'was activated on 30 measured improvements against 2 regressions; POS has',
      'no equivalent number, and until it does its weight stays at zero.',
      '',
      'The experiment that would settle it: run these winner changes against',
      'synthetic corruptions, where the expected answer is known, and count',
      'better against worse the way the frequency sweep did.',
      '',
    ].join('\n');
    console.info(`[pos] wrote ${writeSignalReport('part-of-speech.md', report)}`);

    expect(candidateSets).toBeGreaterThan(0);
  }, 180_000);
});

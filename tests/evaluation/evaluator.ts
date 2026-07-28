/**
 * Development-only evaluator: measures the engine against UD English EWT.
 *
 * Two questions, kept separate because they fail in opposite directions:
 *
 *   FALSE POSITIVES  given correct text, does the engine change it?
 *   TRUE POSITIVES   given a known corruption, does it restore the original?
 *
 * The corpus is never modified. Corruptions are generated in memory from a
 * seeded PRNG, so a run is reproducible and a disagreement can be re-examined.
 */
import { analyze, buildContext, takeRankingComparison } from '../../src/engine/correction-engine.js';
import { generateCandidates, type Candidate } from '../../src/engine/candidate-generator.js';
import { rankCandidates, scoreCandidate } from '../../src/engine/context/candidate-scoring.js';
import { classifyRisk } from '../../src/engine/context/correction-policy.js';
import {
  DEFAULT_WEIGHTS,
  EXPERIMENTAL_WEIGHTS,
  type ScoreWeights,
} from '../../src/engine/context/score-weights.js';
import { frequencyRank } from '../../src/engine/data/frequency.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';
import type { EngineContext, LearningData, Settings } from '../../src/shared/types.js';
import { isCleanSentence, type ConlluSentence } from './conllu.js';

/** Deterministic PRNG so a run can be repeated exactly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export interface Corruption {
  original: string;
  corrupted: string;
  kind: 'transpose' | 'duplicate' | 'drop' | 'neighbour' | 'insert' | 'apostrophe';
  /** Offsets of the corrupted word inside `sentence`. */
  start: number;
  end: number;
  sentence: string;
}

const KEYBOARD_NEIGHBOUR: Record<string, string> = {
  a: 's', s: 'd', d: 'f', e: 'r', r: 't', t: 'y', o: 'i', i: 'o', n: 'm', m: 'n',
};

/**
 * Corrupts one word in a sentence.
 *
 * Only words the dictionary knows are corrupted, and only when the result is
 * *not* a real word — otherwise the "correct" answer is ambiguous and the
 * measurement is meaningless.
 */
export function corruptSentence(
  sentence: string,
  random: () => number,
): Corruption | null {
  const words: Array<{ text: string; start: number }> = [];
  const pattern = /[A-Za-z][A-Za-z']{3,}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sentence)) !== null) {
    words.push({ text: match[0], start: match.index });
  }
  if (words.length === 0) return null;

  const kinds: Corruption['kind'][] = [
    'transpose',
    'duplicate',
    'drop',
    'neighbour',
    'insert',
    'apostrophe',
  ];
  // Try a few words before giving up on this sentence.
  for (let attempt = 0; attempt < 8; attempt++) {
    const word = words[Math.floor(random() * words.length)]!;
    const lower = word.text.toLowerCase();
    if (!isKnownWord(lower) || lower.length < 4) continue;

    const kind = kinds[Math.floor(random() * kinds.length)]!;
    const at = 1 + Math.floor(random() * (lower.length - 2));
    let corrupted: string | null = null;

    switch (kind) {
      case 'transpose':
        corrupted = lower.slice(0, at) + lower[at + 1]! + lower[at]! + lower.slice(at + 2);
        break;
      case 'duplicate':
        corrupted = lower.slice(0, at) + lower[at]! + lower.slice(at);
        break;
      case 'drop':
        corrupted = lower.slice(0, at) + lower.slice(at + 1);
        break;
      case 'neighbour': {
        const replacement = KEYBOARD_NEIGHBOUR[lower[at]!];
        if (!replacement) continue;
        corrupted = lower.slice(0, at) + replacement + lower.slice(at + 1);
        break;
      }
      case 'insert': {
        // A stray letter that is *not* a duplicate of its neighbours, so this
        // exercises extra-letter deletion rather than duplicate removal.
        const letter = String.fromCharCode(97 + Math.floor(random() * 26));
        if (letter === lower[at] || letter === lower[at - 1]) continue;
        corrupted = lower.slice(0, at) + letter + lower.slice(at);
        break;
      }
      case 'apostrophe': {
        // Only applicable to words that have one.
        if (!lower.includes("'")) continue;
        corrupted = lower.replace("'", '');
        break;
      }
    }
    // A corruption that lands on another real word has no single right answer.
    if (!corrupted || corrupted === lower || isKnownWord(corrupted)) continue;

    return {
      original: word.text,
      corrupted,
      kind,
      start: word.start,
      end: word.start + corrupted.length,
      sentence:
        sentence.slice(0, word.start) + corrupted + sentence.slice(word.start + word.text.length),
    };
  }
  return null;
}

/** Everything needed to judge one candidate by eye. */
export interface CandidateDetail {
  word: string;
  /** Candidate-generation process that produced it. */
  process: number;
  operation: string;
  operationCost: number;
  /** Score with the explicitly selected comparison baseline. */
  baseScore: number;
  frequencyRank: number;
  /** The frequency term's contribution under the experimental weights. */
  frequencyContribution: number;
  experimentalScore: number;
}

export interface Disagreement {
  sentenceId: string;
  sentence: string;
  /** The uncorrupted sentence, when this came from a corruption run. */
  originalSentence?: string;
  token: string;
  candidates: CandidateDetail[];
  currentWinner: string;
  experimentalWinner: string;
  currentScore: number;
  experimentalScore: number;
  currentMargin: number;
  experimentalMargin: number;
  currentAction: string;
  experimentalAction: string;
  /** True when the winner still has the lowest operation cost. */
  costStillDominant: boolean;
  riskClass: string;
  /** Present for corruption runs: the word that was actually corrupted. */
  expected?: string;
  /** Why the evaluator called this better, worse or neutral. */
  verdict: 'better' | 'worse' | 'neutral' | 'unlabelled';
  verdictReason: string;
}

/** One correct-text token the engine wanted to change. */
export interface FalsePositiveCase {
  sentenceId: string;
  sentence: string;
  token: string;
  proposedCorrection: string;
  provider: string;
  ruleId: string;
  confidence: number;
  action: string;
  riskClass: string;
  correctionType: string;
  /** Whether the token as typed is in the bundled dictionary. */
  originalInDictionary: boolean;
  candidates: CandidateDetail[];
}

export interface EvaluationResult {
  /** Exact weights used for the comparison baseline in this run. */
  baselineWeights: ScoreWeights;
  /** Exact weights tested against the baseline in this run. */
  experimentalWeights: ScoreWeights;
  sentencesConsidered: number;
  sentencesUsed: number;
  /** Correct sentences the engine wanted to change (false positives). */
  falsePositives: number;
  /** Corruptions the engine restored exactly. */
  restored: number;
  /** Corruptions it changed to something else. */
  wrongCorrection: number;
  /** Corruptions it left alone. */
  missed: number;
  corruptionsAttempted: number;
  /** Every correct-text token the engine wanted to change, in full. */
  falsePositiveCases: FalsePositiveCase[];
  /** False positives remaining after the manual review file is applied. */
  confirmedFalsePositives: number;
  /** Ranking differences between the explicit baseline and tested weights. */
  disagreements: Disagreement[];
  /** Disagreements where the tested winner matched the true original. */
  experimentalBetter: number;
  /** Disagreements where the baseline matched and the tested weights did not. */
  experimentalWorse: number;
  /** Disagreements where neither matched. */
  experimentalNeutral: number;
}

function tokensOf(sentence: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /[A-Za-z']+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sentence)) !== null) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/** Names the edit that explains a candidate. */
export function operationOf(candidate: Candidate): string {
  if (candidate.missingApostrophe) return 'apostrophe-insertion';
  if (candidate.duplicateLetter) return 'duplicate-letter-removal';
  if (candidate.missingLetter) return 'missing-letter-insertion';
  if (candidate.extraLetter) return 'extra-letter-deletion';
  if (candidate.keyboardSubstitution) return 'keyboard-substitution';
  if (candidate.process === 2) return 'adjacent-swap';
  return 'bucket-similarity';
}

/** Per-candidate detail under both weight sets. */
export function describeCandidates(
  candidates: readonly Candidate[],
  context: EngineContext,
  experimental: ScoreWeights,
  baseline: ScoreWeights = DEFAULT_WEIGHTS,
): CandidateDetail[] {
  return candidates.map((candidate) => {
    const base = scoreCandidate({ candidate, weights: baseline, context });
    const exp = scoreCandidate({ candidate, weights: experimental, context });
    return {
      word: candidate.word,
      process: candidate.process,
      operation: operationOf(candidate),
      operationCost: candidate.operationCost,
      baseScore: base.rawScore,
      frequencyRank: frequencyRank(candidate.word),
      frequencyContribution: exp.terms.frequency,
      experimentalScore: exp.rawScore,
    };
  });
}

/**
 * Compares two weight sets over one token, recording a disagreement with enough
 * evidence to judge it by eye.
 */
function compareToken(
  sentenceId: string,
  sentence: string,
  token: { text: string; start: number; end: number },
  baseline: ScoreWeights,
  experimental: ScoreWeights,
  expected?: string,
  originalSentence?: string,
): Disagreement | null {
  const lower = token.text.toLowerCase();
  if (lower.length < 3 || isKnownWord(lower)) return null;

  const candidates = generateCandidates(lower, 10);
  if (candidates.length < 2) return null;

  const context = buildContext(sentence, token.start, token.end, 'https://evaluation.local');
  const current = rankCandidates(candidates, baseline, { context });
  const next = rankCandidates(candidates, experimental, { context });

  const currentBest = current[0];
  const nextBest = next[0];
  if (!currentBest || !nextBest) return null;
  if (currentBest.candidate.word === nextBest.candidate.word) return null;

  const marginOf = (ranked: typeof current) =>
    ranked.length > 1 ? ranked[0]!.rawScore - ranked[1]!.rawScore : ranked[0]!.rawScore;

  const lowestCost = Math.min(...candidates.map((c) => c.operationCost));

  const disagreement: Disagreement = {
    sentenceId,
    sentence,
    token: token.text,
    candidates: describeCandidates(candidates, context, experimental, baseline),
    currentWinner: currentBest.candidate.word,
    experimentalWinner: nextBest.candidate.word,
    currentScore: currentBest.rawScore,
    experimentalScore: nextBest.rawScore,
    currentMargin: marginOf(current),
    experimentalMargin: marginOf(next),
    currentAction: marginOf(current) >= 0.06 ? 'autocorrect' : 'suggest',
    experimentalAction: marginOf(next) >= 0.06 ? 'autocorrect' : 'suggest',
    costStillDominant: nextBest.candidate.operationCost <= lowestCost,
    riskClass: classifyRisk({
      originalIsValidWord: false,
      candidate: nextBest.candidate,
    }),
    verdict: 'unlabelled',
    verdictReason: 'no expected answer for this token',
  };
  if (expected !== undefined) disagreement.expected = expected;
  if (originalSentence !== undefined) disagreement.originalSentence = originalSentence;
  return disagreement;
}

export interface EvaluateOptions {
  sentences: readonly ConlluSentence[];
  settings: Settings;
  learning: LearningData;
  /** Cap so a run stays quick enough for a test. */
  limit?: number;
  seed?: number;
  /** Explicit comparison baseline; defaults to current production weights. */
  baseline?: ScoreWeights;
  experimental?: ScoreWeights;
  /** Also generate synthetic corruptions and measure recovery. */
  corrupt?: boolean;
  /**
   * Manual classifications keyed by `sentenceId|token`, so a reviewed case is
   * not counted against the engine twice. Cases stay in the report either way.
   */
  review?: Record<string, string>;
}

export function evaluate(options: EvaluateOptions): EvaluationResult {
  const limit = options.limit ?? 400;
  const random = seededRandom(options.seed ?? 20_260_728);
  const baseline = options.baseline ?? DEFAULT_WEIGHTS;
  const experimental = options.experimental ?? EXPERIMENTAL_WEIGHTS;
  const reviewed = options.review ?? {};

  const result: EvaluationResult = {
    baselineWeights: { ...baseline },
    experimentalWeights: { ...experimental },
    sentencesConsidered: 0,
    sentencesUsed: 0,
    falsePositives: 0,
    falsePositiveCases: [],
    confirmedFalsePositives: 0,
    restored: 0,
    wrongCorrection: 0,
    missed: 0,
    corruptionsAttempted: 0,
    disagreements: [],
    experimentalBetter: 0,
    experimentalWorse: 0,
    experimentalNeutral: 0,
  };

  for (const sentence of options.sentences) {
    if (result.sentencesUsed >= limit) break;
    result.sentencesConsidered++;
    if (!isCleanSentence(sentence)) continue;
    result.sentencesUsed++;

    // 1. Correct text must be left alone.
    for (const token of tokensOf(sentence.text)) {
      const proposal = analyze(
        { text: sentence.text, wordEnd: token.end, origin: 'https://evaluation.local' },
        options.learning,
        options.settings,
      );
      // Drain any shadow comparison the engine recorded so it cannot leak into
      // the next iteration.
      takeRankingComparison();

      if (proposal && proposal.proposal.action === 'autocorrect') {
        result.falsePositives++;
        const lower = token.text.toLowerCase();
        const context = buildContext(
          sentence.text,
          token.start,
          token.end,
          'https://evaluation.local',
        );
        const candidates = generateCandidates(lower, 10);
        result.falsePositiveCases.push({
          sentenceId: sentence.sentId,
          sentence: sentence.text,
          token: token.text,
          proposedCorrection: proposal.proposal.replacement,
          provider: proposal.proposal.source ?? 'unknown',
          ruleId: proposal.proposal.ruleId ?? '-',
          confidence: proposal.proposal.confidence,
          action: proposal.proposal.action,
          riskClass: classifyRisk({
            originalIsValidWord: isKnownWord(lower),
            correctionType: proposal.proposal.correctionType,
            ruleId: proposal.proposal.ruleId,
          }),
          correctionType: proposal.proposal.correctionType,
          originalInDictionary: isKnownWord(lower),
          candidates: describeCandidates(candidates, context, experimental, baseline),
        });
        // A case the review file has classified as anything other than an
        // engine fault is not counted against the engine - but it is still
        // listed above, so nothing is silently excluded.
        const verdict = reviewed[`${sentence.sentId}|${token.text}`];
        if (verdict === undefined || verdict === 'Actual engine false positive') {
          result.confirmedFalsePositives++;
        }
      }

      const disagreement = compareToken(
        sentence.sentId,
        sentence.text,
        token,
        baseline,
        experimental,
      );
      if (disagreement) result.disagreements.push(disagreement);
    }

    // 2. Known corruptions should be restored.
    if (options.corrupt) {
      const corruption = corruptSentence(sentence.text, random);
      if (corruption) {
        result.corruptionsAttempted++;
        const proposal = analyze(
          {
            text: corruption.sentence,
            wordEnd: corruption.end,
            origin: 'https://evaluation.local',
          },
          options.learning,
          options.settings,
        );
        takeRankingComparison();

        const expected = corruption.original.toLowerCase();
        if (!proposal) result.missed++;
        else if (proposal.proposal.replacement.toLowerCase() === expected) result.restored++;
        else result.wrongCorrection++;

        const disagreement = compareToken(
          sentence.sentId,
          corruption.sentence,
          { text: corruption.corrupted, start: corruption.start, end: corruption.end },
          baseline,
          experimental,
          expected,
          sentence.text,
        );
        if (disagreement) {
          const currentRight = disagreement.currentWinner === expected;
          const nextRight = disagreement.experimentalWinner === expected;
          if (nextRight && !currentRight) {
            result.experimentalBetter++;
            disagreement.verdict = 'better';
            disagreement.verdictReason =
              `tested weights picked the expected "${expected}"; baseline picked `
              + `"${disagreement.currentWinner}"`;
          } else if (currentRight && !nextRight) {
            result.experimentalWorse++;
            disagreement.verdict = 'worse';
            disagreement.verdictReason =
              `baseline picked the expected "${expected}"; tested weights picked `
              + `"${disagreement.experimentalWinner}"`;
          } else {
            result.experimentalNeutral++;
            disagreement.verdict = 'neutral';
            disagreement.verdictReason = nextRight
              ? 'both picked the expected word'
              : `neither picked the expected "${expected}"`;
          }
          result.disagreements.push(disagreement);
        }
      }
    }
  }

  return result;
}

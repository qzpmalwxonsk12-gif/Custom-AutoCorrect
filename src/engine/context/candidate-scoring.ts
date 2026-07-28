/**
 * The one candidate score and the one comparator.
 *
 * Before this module there were three sort sites - two comparators in the
 * candidate generator and a third in the correction engine - and the engine's
 * sort ran on a value that had already been clamped to 0.99. Two genuinely
 * different candidates could therefore arrive at the ceiling, tie, and be
 * separated by *alphabetical order*: that is how "thats" resolved to "that"
 * instead of "that's".
 *
 * Everything here operates on an unclamped score. Clamping into a confidence
 * value happens once, after ranking and after the margin has been measured.
 */
import { candidateGenerationScore, type Candidate } from '../candidate-generator.js';
import { compareByScore } from './candidate-order.js';
import { classifyWord, posCompatibility } from './pos-compatibility.js';
import { characterContextScore } from './character-context.js';
import { sentencePositionScore } from './sentence-position.js';
import type { DocumentEvidenceSource } from './document-evidence.js';
import { frequencyWeight } from '../data/frequency.js';
import type { EngineContext } from '../../shared/types.js';
import type { ScoreWeights } from './score-weights.js';

/**
 * Each term's contribution, already multiplied by its weight.
 *
 * Kept as a breakdown rather than a single number so diagnostics can say *why*
 * a candidate won, and so a term at weight zero is visibly zero rather than
 * merely absent.
 */
export interface ScoreTerms {
  /** The existing generation score: operation cost, similarity, priors. */
  editOperation: number;
  frequency: number;
  partOfSpeech: number;
  wordContext: number;
  sentencePosition: number;
  documentReuse: number;
  personalHistory: number;
  knownPhrase: number;
  characterContext: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  terms: ScoreTerms;
  /** Sum of every term. **Never clamped.** */
  rawScore: number;
  /**
   * The pre-existing personal/context nudge applied before the top-ten cutoff.
   * Not a new signal and not weighted: it is current behaviour, preserved.
   */
  rankAdjustment: number;
}

const EMPTY_TERMS: ScoreTerms = {
  editOperation: 0,
  frequency: 0,
  partOfSpeech: 0,
  wordContext: 0,
  sentencePosition: 0,
  documentReuse: 0,
  personalHistory: 0,
  knownPhrase: 0,
  characterContext: 0,
};

export interface ScoringInput {
  candidate: Candidate;
  weights: ScoreWeights;
  context?: EngineContext | undefined;
  /** Existing pre-cutoff nudge from personal rules; applied unweighted. */
  rankAdjustment?: number;
  /** Document-local vocabulary evidence, when the caller has any. */
  documentEvidence?: DocumentEvidenceSource;
  /** The word as typed, for signals that compare a candidate against it. */
  typedWord?: string | undefined;
}

/**
 * Scores one candidate.
 *
 * The production defaults combine the existing generation score with the
 * measured frequency term. All other context signals remain at zero until they
 * have evidence supporting a rollout.
 */
export function scoreCandidate(input: ScoringInput): ScoredCandidate {
  const { candidate, weights } = input;
  const rankAdjustment = input.rankAdjustment ?? 0;

  const terms: ScoreTerms = {
    ...EMPTY_TERMS,
    editOperation: candidateGenerationScore(candidate) * weights.editOperation,
  };

  // Every term below is skipped entirely when its weight is zero: a signal that
  // is switched off must cost nothing, not merely contribute nothing.
  if (weights.frequency !== 0) {
    terms.frequency = frequencyWeight(candidate.word) * weights.frequency;
  }

  if (weights.partOfSpeech !== 0 && input.context) {
    terms.partOfSpeech =
      posCompatibility(
        classifyWord(candidate.word),
        input.context.previousTokenType,
        input.context.nextTokenType,
        input.context.isSentenceStart,
      ) * weights.partOfSpeech;
  }

  if (weights.documentReuse !== 0 && input.documentEvidence) {
    terms.documentReuse =
      input.documentEvidence.boostFor(candidate.word) * weights.documentReuse;
  }

  if (weights.characterContext !== 0 && input.typedWord) {
    terms.characterContext =
      characterContextScore(input.typedWord, candidate.word) * weights.characterContext;
  }

  if (weights.sentencePosition !== 0 && input.context) {
    terms.sentencePosition =
      sentencePositionScore(candidate.word, input.context, input.typedWord)
      * weights.sentencePosition;
  }

  // The remaining terms are declared, summed and diagnosed, and stay zero until
  // each is implemented and its weight deliberately raised.

  const rawScore =
    terms.editOperation
    + terms.frequency
    + terms.partOfSpeech
    + terms.wordContext
    + terms.sentencePosition
    + terms.documentReuse
    + terms.personalHistory
    + terms.knownPhrase
    + terms.characterContext
    + rankAdjustment;

  return { candidate, terms, rawScore, rankAdjustment };
}

/**
 * The single comparator. Ascending order: `a` before `b` means `a` ranks higher.
 *
 * Tie-break sequence, most meaningful first:
 *   1. higher raw score
 *   2. lower operation cost
 *   3. stronger direct edit evidence
 *   4. higher contextual support
 *   5. higher frequency
 *   6. lexical order, purely so the result is deterministic
 *
 * Lexical order is last on purpose. It carries no information about which
 * correction is right, and letting it decide anything else is precisely the bug
 * this module was written to remove.
 */
export function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  const scores = new WeakMap<Candidate, number>([
    [a.candidate, a.rawScore],
    [b.candidate, b.rawScore],
  ]);
  const support = new WeakMap<Candidate, number>([
    [a.candidate, contextualSupport(a)],
    [b.candidate, contextualSupport(b)],
  ]);
  return compareByScore(
    a.candidate,
    b.candidate,
    (candidate) => scores.get(candidate) ?? 0,
    (candidate) => support.get(candidate) ?? 0,
  );
}

function contextualSupport(scored: ScoredCandidate): number {
  return (
    scored.terms.wordContext
    + scored.terms.partOfSpeech
    + scored.terms.knownPhrase
    + scored.terms.personalHistory
    + scored.terms.sentencePosition
  );
}

/** Scores and ranks a whole candidate set with one comparator. */
export function rankCandidates(
  candidates: readonly Candidate[],
  weights: ScoreWeights,
  options: {
    context?: EngineContext | undefined;
    rankAdjustment?: ((candidate: Candidate) => number) | undefined;
    documentEvidence?: DocumentEvidenceSource;
    /** The word as typed, for signals that compare a candidate against it. */
    typedWord?: string | undefined;
  } = {},
): ScoredCandidate[] {
  const scored = candidates.map((candidate) =>
    scoreCandidate({
      candidate,
      weights,
      context: options.context,
      rankAdjustment: options.rankAdjustment?.(candidate) ?? 0,
      documentEvidence: options.documentEvidence ?? null,
      typedWord: options.typedWord,
    }),
  );
  return scored.sort(compareScored);
}

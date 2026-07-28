/**
 * Runs the production ranking and an experimental ranking side by side.
 *
 * This is the whole evaluation mechanism for context signals. A weight is
 * raised only when this has shown, on real writing, what raising it does:
 * which candidate changes, whether the *action* changes, and by how much.
 *
 * It costs one extra ranking pass over at most ten candidates, and it only runs
 * when shadow mode is on.
 */
import { rankCandidates, type ScoredCandidate } from './candidate-scoring.js';
import type { ContextRankingInput } from './context-provider.js';
import { RANKING_MARGIN } from './rule-context-provider.js';
import { DEFAULT_WEIGHTS, EXPERIMENTAL_WEIGHTS, type ScoreWeights } from './score-weights.js';

export interface RankingComparison {
  /** Word the shipping weights choose. */
  currentWinner: string;
  /** Word the experimental weights choose. */
  experimentalWinner: string;
  /** True when the two disagree about the winner. */
  winnerChanged: boolean;
  currentScore: number;
  experimentalScore: number;
  currentMargin: number;
  experimentalMargin: number;
  /** Provisional action under each weight set. */
  currentAction: 'autocorrect' | 'suggest';
  experimentalAction: 'autocorrect' | 'suggest';
  actionChanged: boolean;
  /** Which term moved the result, when one did. */
  responsibleTerms: string[];
}

function provisionalAction(margin: number): 'autocorrect' | 'suggest' {
  return margin >= RANKING_MARGIN ? 'autocorrect' : 'suggest';
}

function marginOf(ranked: ScoredCandidate[]): number {
  const best = ranked[0];
  if (!best) return 0;
  const second = ranked[1];
  return second ? best.rawScore - second.rawScore : best.rawScore;
}

/** Terms that differ between the two scorings of the winning candidate. */
function responsibleTerms(current: ScoredCandidate, experimental: ScoredCandidate): string[] {
  const moved: string[] = [];
  for (const key of Object.keys(current.terms) as Array<keyof typeof current.terms>) {
    if (current.terms[key] !== experimental.terms[key]) moved.push(key);
  }
  return moved;
}

/**
 * Compares two weight sets over the same candidates.
 *
 * Returns null when there is nothing to compare, or when the weights are
 * identical - recording "nothing changed" for every keystroke would bury the
 * cases that did.
 */
export function compareRankings(
  input: ContextRankingInput,
  experimental: ScoreWeights = EXPERIMENTAL_WEIGHTS,
  production: ScoreWeights = DEFAULT_WEIGHTS,
): RankingComparison | null {
  if (input.candidates.length === 0) return null;

  const currentRanked = rankCandidates(input.candidates, production, {
    context: input.context,
    rankAdjustment: input.rankAdjustment,
    documentEvidence: input.documentEvidence ?? null,
    typedWord: input.originalText,
  });
  const experimentalRanked = rankCandidates(input.candidates, experimental, {
    context: input.context,
    rankAdjustment: input.rankAdjustment,
    documentEvidence: input.documentEvidence ?? null,
    typedWord: input.originalText,
  });

  const current = currentRanked[0];
  const next = experimentalRanked[0];
  if (!current || !next) return null;

  const currentMargin = marginOf(currentRanked);
  const experimentalMargin = marginOf(experimentalRanked);
  const currentAction = provisionalAction(currentMargin);
  const experimentalAction = provisionalAction(experimentalMargin);

  const winnerChanged = current.candidate.word !== next.candidate.word;
  const actionChanged = currentAction !== experimentalAction;
  if (!winnerChanged && !actionChanged) return null;

  // Re-score the *current* winner under the experimental weights so the term
  // breakdown compares like with like.
  const currentUnderExperimental =
    experimentalRanked.find((entry) => entry.candidate.word === current.candidate.word)
    ?? next;

  return {
    currentWinner: current.candidate.word,
    experimentalWinner: next.candidate.word,
    winnerChanged,
    currentScore: current.rawScore,
    experimentalScore: next.rawScore,
    currentMargin,
    experimentalMargin,
    currentAction,
    experimentalAction,
    actionChanged,
    responsibleTerms: responsibleTerms(current, currentUnderExperimental),
  };
}

/**
 * The deterministic context provider.
 *
 * With the default weights it combines the existing generation score with the
 * measured frequency term. Its job is to be the single place ranking happens,
 * so later signals have somewhere to live that is already measured.
 */
import { rankCandidates, type ScoredCandidate } from './candidate-scoring.js';
import type {
  ContextDecision,
  ContextEvidence,
  ContextRankingInput,
  SyncContextProvider,
} from './context-provider.js';
import { describeSentencePosition } from './sentence-position.js';
import { isNeutral } from './score-weights.js';

/**
 * Minimum lead the ranking layer itself asks for before calling a result
 * unambiguous. The correction-risk policy applies its own, stricter margin per
 * class afterwards; this one only separates "clear winner" from "toss-up".
 */
export const RANKING_MARGIN = 0.06;

export class RuleContextProvider implements SyncContextProvider {
  readonly id = 'rules';

  rank(input: ContextRankingInput): ContextDecision {
    const ranked = rankCandidates(input.candidates, input.weights, {
      context: input.context,
      rankAdjustment: input.rankAdjustment,
      documentEvidence: input.documentEvidence ?? null,
      typedWord: input.originalText,
    });

    const best = ranked[0] ?? null;
    const second = ranked[1] ?? null;
    if (!best) {
      return {
        rankedCandidates: [],
        bestCandidate: null,
        secondBestCandidate: null,
        margin: 0,
        action: 'none',
        evidence: [],
      };
    }

    // Unclamped throughout: this margin is what the policy layer tests, and
    // computing it from a clamped confidence is what previously let two very
    // different candidates look identical.
    const margin = second ? best.rawScore - second.rawScore : best.rawScore;

    return {
      rankedCandidates: ranked,
      bestCandidate: best,
      secondBestCandidate: second,
      margin,
      // Provisional only. The engine's thresholds and the correction-risk
      // policy both get a say before anything is applied.
      action: margin >= RANKING_MARGIN ? 'autocorrect' : 'suggest',
      evidence: describe(best, second, input),
    };
  }
}

function describe(
  best: ScoredCandidate,
  second: ScoredCandidate | null,
  input: ContextRankingInput,
): ContextEvidence[] {
  const evidence: ContextEvidence[] = [
    {
      source: 'editOperation',
      detail:
        `process ${best.candidate.process}, operation cost ${best.candidate.operationCost}`,
      contribution: best.terms.editOperation,
    },
  ];

  for (const [source, contribution] of Object.entries(best.terms)) {
    if (source === 'editOperation' || contribution === 0) continue;
    // Sentence position can say *why* it had an opinion; the rest cannot yet.
    const detail =
      source === 'sentencePosition' && input.context
        ? describeSentencePosition(best.candidate.word, input.context, input.originalText)
        : `${source} term`;
    evidence.push({ source, detail, contribution });
  }

  if (second) {
    evidence.push({
      source: 'margin',
      detail: `runner-up "${second.candidate.word}"`,
      contribution: best.rawScore - second.rawScore,
    });
  }
  if (isNeutral(input.weights)) {
    evidence.push({
      source: 'weights',
      detail: 'no unmeasured context weights are enabled',
    });
  }
  return evidence;
}

/** Shared instance; the provider holds no per-call state. */
export const ruleContextProvider = new RuleContextProvider();

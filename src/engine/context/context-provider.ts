/**
 * The context-ranking contract.
 *
 * A provider *ranks candidates the spelling engine already produced*. It never
 * invents a replacement of its own — that separation is what keeps a future
 * model from proposing arbitrary text, and what lets the deterministic engine
 * stay the source of truth about what a plausible correction even is.
 *
 * Two interfaces, deliberately:
 *
 *   SyncContextProvider   runs inline on the keystroke that finishes a word
 *   AsyncContextProvider  runs on idle, for anything that cannot answer instantly
 *
 * The spelling hot path must stay synchronous. Making it async would mean a
 * correction lands after the user has typed the next word, and every offset
 * would need revalidating — the exact problem the grammar lane already solves
 * with fingerprints, stale-response rejection and backoff. An asynchronous
 * provider reuses that machinery rather than duplicating it into the hot path.
 */
import type { Candidate } from '../candidate-generator.js';
import type { EngineContext, ProposalAction } from '../../shared/types.js';
import type { ScoredCandidate } from './candidate-scoring.js';
import type { ScoreWeights } from './score-weights.js';
import type { DocumentEvidenceSource } from './document-evidence.js';

export interface ContextRankingInput {
  /** The word as typed. */
  originalText: string;
  /** Offsets of the target span within `context`'s text. */
  start: number;
  end: number;
  /**
   * Complete candidate objects, not flattened replacements: process, operation
   * cost, edit locations and generator evidence all inform ranking.
   */
  candidates: readonly Candidate[];
  context: EngineContext;
  weights: ScoreWeights;
  /** Existing personal/context nudge, applied unweighted. */
  rankAdjustment?: ((candidate: Candidate) => number) | undefined;
  /** Document-local vocabulary evidence, when the caller has any. */
  documentEvidence?: DocumentEvidenceSource;
}

export interface ContextEvidence {
  /** Score term or rule that produced this note. */
  source: string;
  detail: string;
  /** Signed contribution, when the evidence is numeric. */
  contribution?: number;
}

export interface ContextDecision {
  rankedCandidates: ScoredCandidate[];
  bestCandidate: ScoredCandidate | null;
  secondBestCandidate: ScoredCandidate | null;
  /**
   * Best minus second best on the **unclamped** scale. This is the number the
   * policy layer tests, so it must not be computed from clamped confidences.
   */
  margin: number;
  /** Provisional action; the correction-risk policy may lower it further. */
  action: ProposalAction;
  evidence: ContextEvidence[];
}

export interface SyncContextProvider {
  readonly id: string;
  rank(input: ContextRankingInput): ContextDecision;
}

export interface AsyncContextProvider {
  readonly id: string;
  rank(input: ContextRankingInput): Promise<ContextDecision>;
}

export const EMPTY_DECISION: ContextDecision = Object.freeze({
  rankedCandidates: [],
  bestCandidate: null,
  secondBestCandidate: null,
  margin: 0,
  action: 'none' as ProposalAction,
  evidence: [],
});

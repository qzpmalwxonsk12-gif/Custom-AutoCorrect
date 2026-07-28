/**
 * Turns evidence into a single 0..1 confidence, then into an action.
 *
 * The personal term is a smoothed acceptance ratio, so one rejection does not
 * kill a rule that has been accepted forty times, but four rejections out of
 * twelve pull it below the autocorrect threshold - which is exactly the
 * behaviour the "form -> from" example needs.
 */
import { clamp } from '../shared/util.js';
import type { CorrectionRule, ProposalAction, Settings } from '../shared/types.js';
import {
  candidateGenerationScore,
  type Candidate,
} from './candidate-generator.js';

/** Beta-smoothed acceptance ratio in 0..1; 0.5 with no evidence. */
export function personalFactor(rule: CorrectionRule | undefined): number {
  if (!rule) return 0.5;
  const accepted = rule.accepted;
  // Reverts weigh double: an explicit "no" is stronger evidence than silence.
  const rejected = rule.reverted * 2 + rule.blocked * 4;
  const alpha = 2;
  const beta = 2;
  return (accepted + alpha) / (accepted + rejected + alpha + beta);
}

export interface SpellingEvidence {
  candidate: Candidate;
  /** True when the typed word is itself in the dictionary (real-word error). */
  originalIsWord: boolean;
  rule?: CorrectionRule;
  /** 0..1 evidence that this pair was accepted in the same local context. */
  contextSupport?: number;
}

/** Confidence for a dictionary-derived spelling candidate. */
export function scoreSpelling(ev: SpellingEvidence): number {
  const { candidate } = ev;
  const personal = personalFactor(ev.rule);
  let base =
    candidateGenerationScore(candidate) +
    (personal - 0.5) * 0.14 +
    Math.min(1, Math.max(0, ev.contextSupport ?? 0)) * 0.06;

  // A typed word that is itself valid must not be "fixed" by spelling rules.
  if (ev.originalIsWord) base -= 0.45;
  return clamp(base, 0, 0.99);
}

/** Confidence for a context-driven real-word correction. */
export function scoreContextual(
  contextScore: number,
  rule: CorrectionRule | undefined,
  support: number,
): number {
  if (contextScore <= 0) return 0;
  // Two independent cues (prev + next word) are needed to reach the top band.
  const base = 0.55 + Math.min(contextScore, 2) * 0.14 + Math.min(support, 1) * 0.08;
  const personal = personalFactor(rule);
  return clamp(base * (0.75 + 0.5 * personal), 0, 0.95);
}

/** Confidence for an exact typo-table or user-authored rule. */
export function scoreExact(
  source: 'builtin-typo' | 'user-created' | 'personal-rule',
  rule: CorrectionRule | undefined,
): number {
  const base = source === 'user-created' ? 0.99 : source === 'builtin-typo' ? 0.96 : 0.9;
  const personal = personalFactor(rule);
  // A user-created rule is not second-guessed by statistics.
  if (source === 'user-created') return base;
  return clamp(base * (0.65 + 0.7 * personal), 0, 0.99);
}

export function decideAction(
  confidence: number,
  mode: CorrectionRule['mode'] | 'default',
  settings: Settings,
): ProposalAction {
  if (mode === 'blocked') return 'none';
  if (confidence < settings.suggestionThreshold) return 'none';
  if (mode === 'suggestion') return 'suggest';
  return confidence >= settings.autocorrectThreshold ? 'autocorrect' : 'suggest';
}

/** Human-friendly confidence band for the UI. */
export function confidenceBand(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.9) return 'high';
  if (c >= 0.7) return 'medium';
  return 'low';
}

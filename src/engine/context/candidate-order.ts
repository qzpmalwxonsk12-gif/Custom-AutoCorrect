/**
 * The one tie-break sequence.
 *
 * Extracted so the candidate generator's pre-cutoff ordering and the context
 * provider's final ranking cannot drift apart. Both call `compareByScore`; the
 * only thing that differs is which score function they pass in.
 *
 * The `Candidate` import is type-only, so this module creates no runtime
 * dependency on the generator and no import cycle.
 */
import type { Candidate } from '../candidate-generator.js';

/**
 * Strength of the direct edit evidence attached to a candidate.
 *
 * A candidate that can name the exact character it added or removed is better
 * evidenced than one that merely resembles the typed word.
 */
export function editEvidence(candidate: Candidate): number {
  if (candidate.missingApostrophe) return 3;
  if (candidate.duplicateLetter || candidate.missingLetter || candidate.extraLetter) return 2;
  if (candidate.keyboardSubstitution) return 1;
  return 0;
}

export function compareWords(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ascending order: `a` before `b` means `a` ranks higher.
 *
 * Sequence, most meaningful first:
 *   1. higher score
 *   2. lower operation cost
 *   3. stronger direct edit evidence
 *   4. higher contextual support (zero until an unmeasured signal is enabled)
 *   5. higher frequency
 *   6. lexical order, purely for determinism
 *
 * Lexical order is last deliberately. It says nothing about which correction is
 * right, and letting it decide anything earlier is the bug that turned "thats"
 * into "that" rather than "that's".
 */
export function compareByScore(
  a: Candidate,
  b: Candidate,
  scoreOf: (candidate: Candidate) => number,
  contextOf: (candidate: Candidate) => number = () => 0,
): number {
  const score = scoreOf(b) - scoreOf(a);
  if (score !== 0) return score;

  if (a.operationCost !== b.operationCost) return a.operationCost - b.operationCost;

  const evidence = editEvidence(b) - editEvidence(a);
  if (evidence !== 0) return evidence;

  const context = contextOf(b) - contextOf(a);
  if (context !== 0) return context;

  const frequency = b.frequency - a.frequency;
  if (frequency !== 0) return frequency;

  return compareWords(a.word, b.word);
}

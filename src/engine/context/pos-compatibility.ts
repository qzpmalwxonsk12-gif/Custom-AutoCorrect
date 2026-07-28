/**
 * Part-of-speech plausibility for a candidate in its slot.
 *
 * Uses the shared Stage 0 classifier — there is exactly one POS implementation
 * in this repository and this is not a second one.
 *
 * The signal is deliberately weak. It answers "does this word's class fit after
 * a determiner / before a verb?", which separates `woks` from `works` in some
 * sentences and separates nothing at all when both candidates are the same part
 * of speech. Expecting more from it than that is how a small heuristic becomes a
 * confident wrong answer.
 */
import { classifyToken } from './token-classifier.js';
import type { AnalysedToken, TokenType } from './context-types.js';

/** Classifies a bare word with no sentence around it. */
export function classifyWord(word: string): TokenType {
  const token: AnalysedToken = {
    text: word,
    normalised: word.toLowerCase(),
    start: 0,
    end: word.length,
    type: 'unknown',
    index: 0,
  };
  return classifyToken(token).type;
}

/**
 * How well a candidate's class fits the slot, in -1..1.
 *
 * Zero means "no opinion", which is the common case and the correct default:
 * most slots constrain nothing, and a signal that always has an opinion is a
 * signal that is often wrong.
 */
export function posCompatibility(
  candidateType: TokenType,
  previous: TokenType | undefined,
  next: TokenType | undefined,
  isSentenceStart: boolean,
): number {
  let score = 0;

  // A determiner opens a noun phrase: "the woks" wants a noun, not a verb.
  if (previous === 'determiner') {
    if (candidateType === 'noun' || candidateType === 'adjective') score += 1;
    else if (candidateType === 'verb') score -= 1;
  }

  // An adjective before it points the same way.
  if (previous === 'adjective' && candidateType === 'noun') score += 0.5;

  // A pronoun or proper noun subject expects a verb next: "the extension works".
  if ((previous === 'pronoun' || previous === 'proper-noun') && candidateType === 'verb') {
    score += 0.75;
  }

  // "to <verb>": the infinitive slot.
  if (previous === 'preposition' && candidateType === 'verb') score += 0.25;

  // An adverb after suggests the slot held a verb: "works correctly".
  if (next === 'adverb') {
    if (candidateType === 'verb') score += 0.75;
    else if (candidateType === 'noun') score -= 0.5;
  }

  // A noun before and a determiner after is a clause boundary; a verb fits.
  if (next === 'determiner' && candidateType === 'verb') score += 0.25;

  // Sentence-initial slots are weakly biased away from bare verbs, since most
  // English sentences open with a subject.
  if (isSentenceStart && candidateType === 'verb') score -= 0.25;

  return Math.max(-1, Math.min(1, score));
}

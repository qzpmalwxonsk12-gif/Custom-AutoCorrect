/**
 * Clause detection.
 *
 * The single question every comma rule reduces to: does this token span
 * contain a subject and a finite verb? That is what separates
 *
 *   "I was tired but I kept working."   (two independent clauses -> comma)
 *   "I was tired but determined."       (one clause -> no comma)
 *   "I opened and tested the extension." (shared subject -> no comma)
 *
 * Deliberately conservative: an unclear span reports low confidence rather
 * than guessing, and rules require high confidence before acting.
 */
import { CORRELATIVE_FIRST } from './lexical-classes.js';
import type { AnalysedToken, ClauseAnalysis } from './context-types.js';

/**
 * Extends a subject head leftwards over the determiners and adjectives that
 * belong to its noun phrase, so a comma is placed before "the build", not
 * between "the" and "build".
 */
export function nounPhraseStart(tokens: AnalysedToken[], subjectIndex: number): number {
  let start = subjectIndex;
  for (let i = subjectIndex - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.type === 'punctuation') break;
    if (token.type === 'determiner' || token.type === 'adjective') {
      start = i;
      continue;
    }
    break;
  }
  return start;
}

/** Words that can head a subject noun phrase. */
function canStartSubject(token: AnalysedToken): boolean {
  if (token.type === 'determiner') return true;
  if (token.type === 'pronoun') return token.isSubjectCandidate === true;
  if (token.type === 'proper-noun' || token.type === 'noun') return true;
  if (token.type === 'adjective') return true; // "Small dogs bark."
  return false;
}

/**
 * Finds a subject + finite verb in `[from, to)` (token indices, `to`
 * exclusive). Returns indices and a confidence reflecting how much guessing
 * was involved.
 */
export function analyseClause(
  tokens: AnalysedToken[],
  from: number,
  to: number,
): ClauseAnalysis {
  const result: ClauseAnalysis = {
    startToken: from,
    endToken: to,
    hasSubject: false,
    hasFiniteVerb: false,
    isIndependent: false,
    isDependent: false,
    confidence: 0,
  };
  if (to <= from) return result;

  let leadingSubordinator = false;
  let scanStart = from;
  for (let i = from; i < to; i++) {
    const token = tokens[i]!;
    if (token.type === 'punctuation') continue;
    if (token.isSubordinator) {
      leadingSubordinator = true;
      scanStart = i + 1;
    }
    break;
  }

  // Verb first, then the *nearest* subject candidate before it. Scanning for
  // the subject first would let a determiner deep inside an object phrase
  // ("After finishing |the| report I went home") masquerade as the subject of
  // a later verb.
  let verbToken = -1;
  for (let i = scanStart; i < to; i++) {
    const token = tokens[i]!;
    if (token.type === 'punctuation') continue;
    if (token.isFiniteVerb) {
      verbToken = i;
      break;
    }
  }

  let subjectToken = -1;
  if (verbToken !== -1) {
    for (let i = verbToken - 1; i >= scanStart; i--) {
      const token = tokens[i]!;
      if (token.type === 'punctuation') continue;
      if (canStartSubject(token)) {
        subjectToken = i;
        break;
      }
    }
  } else {
    for (let i = scanStart; i < to; i++) {
      const token = tokens[i]!;
      if (token.type === 'punctuation') continue;
      if (canStartSubject(token)) {
        subjectToken = i;
        break;
      }
    }
  }

  let guessed = 0;
  if (subjectToken !== -1 && tokens[subjectToken]!.isGuess) guessed++;
  if (verbToken !== -1 && tokens[verbToken]!.isGuess) guessed++;

  result.hasSubject = subjectToken !== -1;
  result.hasFiniteVerb = verbToken !== -1;
  if (subjectToken !== -1) result.subjectToken = subjectToken;
  if (verbToken !== -1) result.verbToken = verbToken;

  const complete = result.hasSubject && result.hasFiniteVerb && verbToken > subjectToken;
  result.isDependent = leadingSubordinator && complete;
  result.isIndependent = complete && !leadingSubordinator;

  if (complete) {
    result.confidence = guessed === 0 ? 0.95 : guessed === 1 ? 0.82 : 0.65;
  } else if (result.hasFiniteVerb || result.hasSubject) {
    result.confidence = 0.35;
  }
  return result;
}

/**
 * True when the span looks like a bare predicate/complement continuation
 * rather than a clause: "but determined", "and carefully", "or leave".
 */
export function looksLikeSharedContinuation(
  tokens: AnalysedToken[],
  from: number,
  to: number,
): boolean {
  const words = [];
  for (let i = from; i < to; i++) {
    const token = tokens[i]!;
    if (token.type !== 'punctuation') words.push(token);
  }
  if (words.length === 0) return true;
  const first = words[0]!;
  // "and carefully", "but determined", "and tested the extension"
  if (first.type === 'adjective' || first.type === 'adverb') return true;
  if (first.type === 'verb' && first.isFiniteVerb !== true) return true;
  // Bare verb sharing the earlier subject: "I opened and tested ...".
  if (first.type === 'verb' && words.length <= 4 && !words.some((w) => w.isSubjectCandidate)) {
    return true;
  }
  return false;
}

/** True when a correlative construction makes a comma wrong. */
export function inCorrelativeConstruction(
  tokens: AnalysedToken[],
  coordinatorIndex: number,
): boolean {
  for (let i = Math.max(0, coordinatorIndex - 6); i < coordinatorIndex; i++) {
    const token = tokens[i]!;
    if (CORRELATIVE_FIRST.has(token.normalised)) return true;
  }
  return false;
}

/**
 * Locates the boundary between a sentence-initial dependent clause and the
 * main clause: the token index where the main clause starts, or -1.
 *
 * Strategy: find the dependent clause's finite verb, then walk forward to the
 * first token that can start a new subject *and* is followed by its own finite
 * verb. Requiring the second verb is what keeps "After dinner was enjoyable"
 * (one clause) from being split.
 */
export function findMainClauseStart(tokens: AnalysedToken[], subordinatorEnd: number): number {
  const dependent = analyseClause(tokens, 0, tokens.length);
  const dependentVerb = dependent.verbToken ?? -1;
  if (dependentVerb === -1) return -1;

  for (let i = dependentVerb + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'punctuation') continue;
    if (i <= subordinatorEnd) continue;
    if (!canStartSubject(token)) continue;
    const rest = analyseClause(tokens, i, tokens.length);
    // The candidate must itself be the subject of the following clause, not
    // merely sit somewhere before one.
    if (rest.isIndependent && rest.subjectToken === i && rest.confidence >= 0.6) {
      return nounPhraseStart(tokens, i);
    }
  }
  return -1;
}


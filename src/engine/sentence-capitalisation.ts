/**
 * Standalone capitalisation fixes: the pronoun "i", and the first word of a
 * sentence.
 *
 * Until now capitalisation only ever rode along with some *other* correction
 * (via `fit()` in the engine), so a correctly-spelled lowercase sentence start
 * was never fixed. This provides it as a correction in its own right.
 *
 * Pure: no DOM, no chrome APIs.
 */
import { capitalise } from './capitalization.js';
import {
  analyzeToken,
  followsAbbreviation,
  isSentenceStart,
  tokenizeWords,
  type Token,
} from './tokenizer.js';

export interface CapitalisationCandidate {
  start: number;
  end: number;
  originalText: string;
  replacementText: string;
  confidence: number;
  reason: string;
  kind: 'pronoun-i' | 'sentence-start';
}

/** Unambiguous: the English first-person pronoun is always capitalised. */
const PRONOUN_CONFIDENCE = 0.98;
/** Sentence starts are near-certain, but abbreviations make them not perfect. */
const SENTENCE_CONFIDENCE = 0.95;

function eligible(text: string, token: Token): boolean {
  // minLength 1: the whole point of the pronoun rule is a one-letter word, and
  // every other protection (code, URLs, sticky punctuation) still applies.
  const guard = analyzeToken(text, token.start, token.end, { minLength: 1 });
  if (guard.protected) return false;
  // Only plain lowercase letters. Anything else is either already capitalised,
  // an identifier, or a deliberate style ("iPhone", "eBay").
  return /^[\p{Ll}]+$/u.test(token.text);
}

/**
 * Contractions of the pronoun "I". The apostrophe process produces these in
 * lower case ("ive" -> "i've"), and they need the same capital the bare
 * pronoun does.
 */
const PRONOUN_CONTRACTIONS = new Set(["i'm", "i've", "i'll", "i'd"]);

function candidateFor(text: string, token: Token): CapitalisationCandidate | null {
  if (PRONOUN_CONTRACTIONS.has(token.text)) {
    return {
      start: token.start,
      end: token.end,
      originalText: token.text,
      replacementText: capitalise(token.text),
      confidence: PRONOUN_CONFIDENCE,
      reason: 'the pronoun “I” is always capitalised',
      kind: 'pronoun-i',
    };
  }

  // The pronoun "i" is capitalised wherever it appears, so it does not depend
  // on sentence detection at all.
  if (token.text === 'i') {
    if (!eligible(text, token)) return null;
    return {
      start: token.start,
      end: token.end,
      originalText: token.text,
      replacementText: 'I',
      confidence: PRONOUN_CONFIDENCE,
      reason: 'the pronoun “I” is always capitalised',
      kind: 'pronoun-i',
    };
  }

  if (!isSentenceStart(text, token.start)) return null;
  if (followsAbbreviation(text, token.start)) return null;
  if (!eligible(text, token)) return null;

  return {
    start: token.start,
    end: token.end,
    originalText: token.text,
    replacementText: capitalise(token.text),
    confidence: SENTENCE_CONFIDENCE,
    reason: 'a sentence starts with a capital letter',
    kind: 'sentence-start',
  };
}

/** Checks the word that was just completed. */
export function findCapitalisation(
  text: string,
  wordEnd: number,
): CapitalisationCandidate | null {
  const tokens = tokenizeWords(text);
  const token = tokens.find((t) => t.end === wordEnd);
  return token ? candidateFor(text, token) : null;
}

/** Scans a range and returns the first capitalisation fix inside it. */
export function findCapitalisationIn(
  text: string,
  start: number,
  end: number,
): CapitalisationCandidate | null {
  for (const token of tokenizeWords(text)) {
    if (token.start < start || token.end > end) continue;
    const candidate = candidateFor(text, token);
    if (candidate) return candidate;
  }
  return null;
}

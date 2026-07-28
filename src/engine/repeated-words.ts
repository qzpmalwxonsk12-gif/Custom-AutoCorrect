/**
 * Accidentally repeated words: "what what are you doing" -> "what are you doing".
 *
 * This is a separate concern from duplicate *letters* (`punctuatioon`), and it
 * is implemented locally rather than delegated to the grammar engine so it works
 * with Harper switched off - which is the default.
 *
 * Pure: no DOM, no chrome APIs.
 */
import { analyzeToken, tokenizeWords, type Token } from './tokenizer.js';

export interface RepeatedWordCandidate {
  /** Start of the first of the two words. */
  start: number;
  /** End of the second word. */
  end: number;
  originalText: string;
  replacementText: string;
  confidence: number;
  reason: string;
}

/**
 * Doubles that are ordinary English rather than mistakes.
 *
 * "I had had enough", "he said that that was wrong", "what it is is unclear" -
 * removing one of these changes the sentence from correct to wrong, which is a
 * far worse failure than leaving a genuine stutter in place.
 */
const LEGITIMATE_DOUBLES = new Set([
  'had',
  'that',
  'is',
  'was',
  'has',
  'do',
  'did',
  // Deliberate repetition in ordinary writing and speech.
  'no',
  'very',
  'so',
  'ha',
  'ho',
  'hee',
  'bye',
  'night',
  'hear',
  'blah',
  'chop',
  'win',
  'yeah',
  'now',
]);

/** Confidence for a plain accidental repeat. */
const REPEAT_CONFIDENCE = 0.96;

function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Only whitespace may separate the two words. Anything else - a comma, a full
 * stop, a dash - means the repetition is structural ("New York, New York") and
 * not a slip of the keyboard.
 */
function separatorIsWhitespace(text: string, from: number, to: number): boolean {
  if (to <= from) return false;
  const between = text.slice(from, to);
  return /^[ \t]+$/.test(between);
}

function eligible(text: string, token: Token): boolean {
  // minLength 1: a repeated single letter ("i i", "a a") is a stutter, and the
  // default two-character floor exists to stop the *spelling* engine guessing
  // at one-letter words - not to hide a duplicate. Every other protection
  // (code, URLs, digits, sticky punctuation) still applies.
  const guard = analyzeToken(text, token.start, token.end, { minLength: 1 });
  if (guard.protected) return false;
  // Digits, symbols and mixed-case identifiers are handled by the guard; what
  // remains to exclude is anything that is not plain letters.
  return /^[\p{L}']+$/u.test(token.text);
}

/**
 * Finds an accidental repeat ending at `wordEnd`, i.e. the word that was just
 * completed is the same as the one before it.
 */
export function findRepeatedWord(text: string, wordEnd: number): RepeatedWordCandidate | null {
  const tokens = tokenizeWords(text);
  const index = tokens.findIndex((token) => token.end === wordEnd);
  if (index < 1) return null;
  return check(text, tokens[index - 1]!, tokens[index]!);
}

/** Scans a range and returns the first accidental repeat inside it. */
export function findRepeatedWordIn(
  text: string,
  start: number,
  end: number,
): RepeatedWordCandidate | null {
  const tokens = tokenizeWords(text).filter(
    (token) => token.start >= start && token.end <= end,
  );
  for (let i = 1; i < tokens.length; i++) {
    const candidate = check(text, tokens[i - 1]!, tokens[i]!);
    if (candidate) return candidate;
  }
  return null;
}

function check(text: string, first: Token, second: Token): RepeatedWordCandidate | null {
  if (!sameWord(first.text, second.text)) return null;
  if (!separatorIsWhitespace(text, first.end, second.start)) return null;
  if (LEGITIMATE_DOUBLES.has(first.text.toLowerCase())) return null;
  if (!eligible(text, first) || !eligible(text, second)) return null;

  return {
    start: first.start,
    end: second.end,
    originalText: text.slice(first.start, second.end),
    // Keep the first occurrence: it carries the sentence's capitalisation.
    replacementText: first.text,
    confidence: REPEAT_CONFIDENCE,
    reason: `the word “${second.text}” was typed twice`,
  };
}

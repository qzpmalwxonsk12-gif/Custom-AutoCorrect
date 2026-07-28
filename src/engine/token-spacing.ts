/**
 * Word-boundary corrections: an accidental space inside one word, and a
 * missing space between two words.
 *
 * These span more than one token, so they cannot live in the single-word
 * candidate API. They are pure functions over text + offsets, which keeps them
 * testable and lets the controller turn a whole spacing fix into ONE reversible
 * correction record rather than two word records.
 *
 * Both directions are deliberately conservative: changing spaces can change
 * meaning ("a part" / "apart", "in to" / "into"), so anything short of
 * overwhelming evidence is a suggestion or nothing at all.
 */
import { isKnownWord, frequencyScore, normaliseDictionaryWord } from './data/dictionary.js';
import { analyzeToken } from './tokenizer.js';

export interface SpacingCandidate {
  /** Absolute offsets into the analysed text. */
  start: number;
  end: number;
  originalText: string;
  replacementText: string;
  source: 'accidental-space-merge' | 'missing-space-split';
  /** 0..1. The controller maps this onto automatic / suggestion / nothing. */
  confidence: number;
  reason: string;
}

function known(word: string): boolean {
  return isKnownWord(normaliseDictionaryWord(word));
}

/** Letters only: digits, symbols and code shapes are never spacing-corrected. */
const PLAIN_WORD = /^[A-Za-z]+$/;

/**
 * Words so short that merging or splitting them is usually wrong. "a", "I",
 * "in", "to", "on" combine into far too many spurious compounds.
 */
const MIN_FRAGMENT = 2;

/**
 * Splitting is much more dangerous than merging: a 107k-word dictionary
 * contains enough two- and three-letter entries to decompose almost any
 * misspelling ("waht" -> "wa" + "ht", "iprove" -> "ip" + "rove"). Requiring a
 * long word and substantial fragments is what keeps ordinary typos in the
 * letter-level processes where they belong.
 */
const MIN_SPLIT_WORD_LENGTH = 8;
const MIN_SPLIT_FRAGMENT = 3;

/* ------------------------------------------------------------------ *
 * Accidental internal space:  "impro vement" -> "improvement"
 * ------------------------------------------------------------------ */

export interface MergeInput {
  text: string;
  /** Offsets of the previous word. */
  previousStart: number;
  previousEnd: number;
  /** Offsets of the just-completed word. */
  currentStart: number;
  currentEnd: number;
}

/**
 * Proposes closing an accidental space. Requires the joined form to be a real
 * word, and refuses when both halves are themselves ordinary words unless the
 * evidence is overwhelming - "ice cream" and "New York" must survive.
 */
export function generateMergeCandidate(input: MergeInput): SpacingCandidate | null {
  const { text, previousStart, previousEnd, currentStart, currentEnd } = input;
  const previous = text.slice(previousStart, previousEnd);
  const current = text.slice(currentStart, currentEnd);
  const separator = text.slice(previousEnd, currentStart);

  // Exactly one plain space, nothing else, and no punctuation crossed.
  if (separator !== ' ') return null;
  if (!PLAIN_WORD.test(previous) || !PLAIN_WORD.test(current)) return null;
  if (previous.length < MIN_FRAGMENT || current.length < MIN_FRAGMENT) return null;

  // Either fragment being protected (URL, code, identifier) rules this out.
  if (analyzeToken(text, previousStart, previousEnd).protected) return null;
  if (analyzeToken(text, currentStart, currentEnd).protected) return null;

  const merged = previous + current;
  if (!known(merged)) return null;

  const previousIsWord = known(previous);
  const currentIsWord = known(current);

  // Two valid words either side is the "ice cream" shape: never automatic.
  if (previousIsWord && currentIsWord) {
    // Only offer it at all when the compound is clearly more frequent than
    // the pair, otherwise stay silent.
    const compound = frequencyScore(normaliseDictionaryWord(merged));
    const pair = Math.min(
      frequencyScore(normaliseDictionaryWord(previous)),
      frequencyScore(normaliseDictionaryWord(current)),
    );
    if (compound <= pair) return null;
    return {
      start: previousStart,
      end: currentEnd,
      originalText: `${previous} ${current}`,
      replacementText: applyMergeCase(previous, current, merged),
      source: 'accidental-space-merge',
      confidence: 0.8,
      reason: `"${previous} ${current}" may be the single word "${merged}"`,
    };
  }

  // One side is not a word on its own: the space is almost certainly a slip.
  return {
    start: previousStart,
    end: currentEnd,
    originalText: `${previous} ${current}`,
    replacementText: applyMergeCase(previous, current, merged),
    source: 'accidental-space-merge',
    confidence: 0.97,
    reason:
      `"${previousIsWord ? current : previous}" is not a word on its own, ` +
      `and "${merged}" is`,
  };
}

/** Keeps the leading capital the user typed: "Impro vement" -> "Improvement". */
function applyMergeCase(previous: string, _current: string, merged: string): string {
  if (previous === previous.toUpperCase() && previous.length > 1) return merged.toUpperCase();
  if (previous[0] === previous[0]?.toUpperCase()) {
    return merged.charAt(0).toUpperCase() + merged.slice(1);
  }
  return merged;
}

/* ------------------------------------------------------------------ *
 * Missing space:  "improvementability" -> "improvement ability"
 * ------------------------------------------------------------------ */

export interface SplitOption {
  left: string;
  right: string;
  splitIndex: number;
  score: number;
}

/** Every split of `word` into two dictionary words, best first. */
export function generateSplitOptions(word: string): SplitOption[] {
  const w = normaliseDictionaryWord(word);
  const options: SplitOption[] = [];
  for (
    let index = MIN_SPLIT_FRAGMENT;
    index <= w.length - MIN_SPLIT_FRAGMENT;
    index++
  ) {
    const left = w.slice(0, index);
    const right = w.slice(index);
    if (!known(left) || !known(right)) continue;
    const balance = 1 - Math.abs(left.length - right.length) / w.length;
    const rarity = Math.min(frequencyScore(left), frequencyScore(right));
    options.push({
      left,
      right,
      splitIndex: index,
      // Prefer balanced splits made of words that are not vanishingly rare.
      score: rarity * 0.6 + balance * 0.4,
    });
  }
  return options.sort((a, b) => b.score - a.score || a.splitIndex - b.splitIndex);
}

export interface SplitInput {
  text: string;
  start: number;
  end: number;
}

/**
 * Proposes inserting a missing space. Never splits a word the dictionary
 * already knows ("another", "software", "without"), and refuses when several
 * splits are similarly plausible.
 */
export function generateSplitCandidate(input: SplitInput): SpacingCandidate | null {
  const { text, start, end } = input;
  const word = text.slice(start, end);
  if (!PLAIN_WORD.test(word)) return null;
  if (word.length < MIN_SPLIT_WORD_LENGTH) return null;
  // A word that exists is never split apart.
  if (known(word)) return null;
  if (analyzeToken(text, start, end).protected) return null;

  const options = generateSplitOptions(word);
  if (options.length === 0) return null;

  const best = options[0]!;
  const second = options[1];
  // Several similarly good splits mean we cannot tell which was intended.
  const margin = second ? best.score - second.score : 1;

  const replacement = applySplitCase(word, best.left, best.right);
  // Long, clearly-separable compounds are the confident case; short ones
  // ("helloworld", "webbrowser") stay suggestions.
  const confident = word.length >= 12 && best.left.length >= 4 && best.right.length >= 4;
  const confidence = confident && margin >= 0.08 ? 0.96 : 0.8;

  return {
    start,
    end,
    originalText: word,
    replacementText: replacement,
    source: 'missing-space-split',
    confidence,
    reason: `"${word}" reads as "${best.left}" + "${best.right}"`,
  };
}

/** "Improvementability" -> "Improvement ability". */
function applySplitCase(word: string, left: string, right: string): string {
  if (word === word.toUpperCase() && word.length > 1) {
    return `${left.toUpperCase()} ${right.toUpperCase()}`;
  }
  if (word[0] === word[0]?.toUpperCase()) {
    return `${left.charAt(0).toUpperCase()}${left.slice(1)} ${right}`;
  }
  return `${left} ${right}`;
}

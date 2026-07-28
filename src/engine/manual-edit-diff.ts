/**
 * Detects "the user manually changed exactly one word" between two snapshots.
 *
 * Everything larger - pastes, deleted paragraphs, multi-word rewrites - returns
 * null, because those are not evidence of a typing habit and must never create
 * a rule.
 */
import { analyzeToken, isWordChar } from './tokenizer.js';

export interface SingleWordChange {
  original: string;
  replacement: string;
  /** Offset of the changed word in the *new* text. */
  start: number;
  end: number;
}

const MAX_WORD = 24;

export function diffSingleWord(before: string, after: string): SingleWordChange | null {
  if (before === after) return null;
  // A large size change is a paste or a bulk delete, never a typo fix.
  if (Math.abs(before.length - after.length) > MAX_WORD) return null;

  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < maxPrefix - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Expand outwards to whole words so "waht"/"what" is compared, not "ah"/"ha".
  let start = prefix;
  while (start > 0 && isWordChar(after[start - 1])) start--;

  let endBefore = before.length - suffix;
  let endAfter = after.length - suffix;
  while (endAfter < after.length && isWordChar(after[endAfter])) {
    endAfter++;
    endBefore++;
  }
  if (endBefore > before.length) return null;

  const original = before.slice(start, endBefore);
  const replacement = after.slice(start, endAfter);

  if (!original || !replacement || original === replacement) return null;
  if (original.length > MAX_WORD || replacement.length > MAX_WORD) return null;
  if (/\s/.test(original) || /\s/.test(replacement)) return null;

  // Both sides must be ordinary words, and the replacement must survive the
  // same safeguards a typed word would (no URLs, code, digits, ...).
  const guard = analyzeToken(after, start, endAfter);
  if (guard.protected) return null;
  const ordinaryWord = /^[A-Za-zÀ-ɏ'\u02bc\u2018\u2019\uff07]+$/u;
  if (!ordinaryWord.test(original) || !ordinaryWord.test(replacement)) return null;

  return { original, replacement, start, end: endAfter };
}

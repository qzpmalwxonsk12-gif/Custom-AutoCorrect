/**
 * Character-bigram plausibility.
 *
 * Weak ranking evidence, and nothing more. It answers "does this candidate look
 * like an English word, letter by letter?" — which separates `posters` from a
 * hypothetical `pzsters`, and separates almost nothing among real dictionary
 * words, since they are all made of ordinary English letter pairs.
 *
 * Three rules keep it safe:
 *
 *   1. It never prunes. A low score lowers a candidate's rank slightly; it can
 *      never remove one, because rare-but-real words exist and the whole point
 *      of a dictionary is that it already decided what is a word.
 *   2. It is normalised against the *typed* word, so a long candidate is not
 *      penalised merely for having more pairs to be judged on.
 *   3. It is bounded to a small signed range, so it cannot outweigh a cheaper
 *      edit explanation.
 */
import { BIGRAM_METADATA, BIGRAM_TABLE_BASE64 } from '../data/bigram-data.js';

const ALPHABET = 26;
const CODE_A = 97;

let table: Uint8Array | null = null;

/** Decoded lazily: most sessions never raise this weight above zero. */
export function bigramTable(): Uint8Array {
  if (table) return table;
  const binary = atob(BIGRAM_TABLE_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  table = bytes;
  return bytes;
}

/** Log-scaled plausibility of one letter pair, 0..255. 0 means unattested. */
export function bigramScore(first: string, second: string): number {
  const a = first.charCodeAt(0) - CODE_A;
  const b = second.charCodeAt(0) - CODE_A;
  if (a < 0 || a >= ALPHABET || b < 0 || b >= ALPHABET) return 0;
  return bigramTable()[a * ALPHABET + b] ?? 0;
}

/**
 * Mean plausibility of a word's letter pairs, 0..1.
 *
 * Non-letters are skipped rather than scored: an apostrophe in "didn't" is
 * structure, and treating it as an unattested pair would penalise every
 * contraction.
 */
export function wordPlausibility(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length < 2) return 0.5;

  let total = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < letters.length; i++) {
    total += bigramScore(letters[i]!, letters[i + 1]!);
    pairs++;
  }
  return pairs === 0 ? 0.5 : total / pairs / 255;
}

/**
 * Signed evidence in -1..1: how much more (or less) English-looking the
 * candidate is than the word the user actually typed.
 *
 * Relative rather than absolute on purpose. Absolute plausibility mostly
 * measures word length and vowel density; the useful question is whether the
 * *change* makes the letter sequence more ordinary.
 */
export function characterContextScore(typed: string, candidate: string): number {
  const before = wordPlausibility(typed);
  const after = wordPlausibility(candidate);
  // Scaled so a realistic difference (a few hundredths) produces a usable
  // signal, then clamped so an extreme one cannot dominate.
  return Math.max(-1, Math.min(1, (after - before) * 4));
}

export { BIGRAM_METADATA };

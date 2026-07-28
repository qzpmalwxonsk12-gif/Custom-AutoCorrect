/**
 * Word-frequency lookup.
 *
 * The table is a small number of quantised bands rather than an exact rank per
 * word: see `vendor/frequency/README.md` for why the precision is deliberately
 * coarse. Lookup is a single Map hit; the Map is built once, lazily, from a
 * packed string.
 *
 * This sits alongside the legacy `frequencyScore` in `dictionary.ts` rather
 * than replacing it. The legacy prior still contributes to production ranking;
 * this table feeds the independently measured frequency score term.
 */
import { FREQUENCY_BANDS } from './frequency-data.js';
import { FREQUENCY_METADATA } from './frequency-metadata.js';
import { normaliseDictionaryWord } from './dictionary.js';

/** Rank of a word the table does not list. */
export const UNRANKED = 0;

/** Highest band value, for callers normalising into 0..1. */
export const MAX_RANK = 255;

let table: Map<string, number> | null = null;

function build(): Map<string, number> {
  const map = new Map<string, number>();
  for (const [value, words] of FREQUENCY_BANDS) {
    for (const word of words.split(/\s+/u)) {
      if (word) map.set(word, value);
    }
  }
  return map;
}

/** Lazily parsed word -> band value. */
export function frequencyTable(): Map<string, number> {
  if (!table) table = build();
  return table;
}

/** Penalty applied to a rank inherited from a base word. */
export const INFLECTION_PENALTY = 32;

/**
 * Resolves a word's band against an arbitrary lookup.
 *
 * Split out from `frequencyRank` so the fallback can be tested against
 * synthetic data. Testing it against real corpus words is brittle by
 * construction: a 50,000-entry list contains both "work" and "working"
 * directly, so no real pair reliably exercises the fallback, and a corpus
 * update can silently turn a passing assertion into a failing one.
 */
export function resolveRank(
  word: string,
  lookup: (candidate: string) => number | undefined,
): number {
  // A direct entry always wins. The corpus knows this word's own frequency;
  // deriving it from a base word would discard measured evidence.
  const direct = lookup(word);
  if (direct !== undefined) return direct;

  for (const base of inflectionBases(word)) {
    const inherited = lookup(base);
    // One band down: an inflected form is genuinely less common than its base.
    if (inherited !== undefined) return Math.max(1, inherited - INFLECTION_PENALTY);
  }
  return UNRANKED;
}

/**
 * Quantised frequency band for a word, 0 when unranked.
 *
 * Simple inflections inherit their base word's band at a discount when the
 * inflected form is not itself listed, which keeps the table useful across the
 * whole 107,901-word dictionary.
 */
export function frequencyRank(input: string): number {
  const table = frequencyTable();
  return resolveRank(normaliseDictionaryWord(input), (candidate) => table.get(candidate));
}

/** Frequency band expressed as 0..1, for use as a score term. */
export function frequencyWeight(input: string): number {
  return frequencyRank(input) / MAX_RANK;
}

/** Simple English inflections whose base may carry the frequency evidence. */
export function inflectionBases(word: string): string[] {
  const bases: string[] = [];
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    bases.push(word.slice(0, -1));
    if (word.endsWith('es')) bases.push(word.slice(0, -2));
    if (word.endsWith('ies')) bases.push(`${word.slice(0, -3)}y`);
  }
  if (word.length > 4 && word.endsWith('ed')) {
    bases.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith('ied')) bases.push(`${word.slice(0, -3)}y`);
  }
  if (word.length > 5 && word.endsWith('ing')) {
    bases.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  }
  if (word.length > 4 && word.endsWith('ly')) bases.push(word.slice(0, -2));
  if (word.length > 4 && word.endsWith('er')) bases.push(word.slice(0, -2), word.slice(0, -1));
  return bases;
}

export { FREQUENCY_METADATA };

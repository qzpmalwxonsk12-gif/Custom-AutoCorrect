import { DICTIONARY_WORDS } from './dictionary-data.js';
import { DICTIONARY_METADATA } from './dictionary-metadata.js';
import { normaliseRuleText } from '../../shared/util.js';

const NORMALISED_ASCII_WORD = /^[a-z]+(?:'[a-z]+)*$/u;

/**
 * ESDB is an alphabetical word list and does not contain corpus frequencies.
 * This short, explicit legacy prior is used only to break otherwise-equal
 * ranking ties. It never changes dictionary membership.
 */
const COMMON_WORDS = `
the be to of and a in that have i it for not on with he as you do at this but his
by from they we say her she or an will my one all would there their what so up out
if about who get which go me when make can like time no just him know take people
into year your good some could them see other than then now look only come its over
think also back after use two how our work first well way even new want because any
these give day most us is are was were been has had did does said made find here
thing many very still own too little world life tell may ask before great same must
number part place case group problem fact through where much right need feel seem
while last long high different small large next early young important few public
bad able why let put mean keep begin help talk turn start show hear play run move
live believe bring happen write provide sit stand lose pay meet include continue set
learn change lead understand watch follow stop create speak read allow add spend grow
open walk win offer remember love consider appear buy wait serve die send expect
build stay fall cut reach remain suggest raise pass sell require report decide
`.trim().split(/\s+/u);

const COMMON_RANK = new Map(COMMON_WORDS.map((word, index) => [word, index]));

export interface Dictionary {
  readonly words: ReadonlySet<string>;
  readonly byLengthAndFirstLetter: ReadonlyMap<
    number,
    ReadonlyMap<string, readonly string[]>
  >;
}

/**
 * The one canonical representation used by generated data and runtime lookup.
 */
export function normaliseDictionaryWord(input: string): string {
  // Candidate generation already emits this form; keep its hot-path Set
  // lookups free of Unicode normalisation and allocation.
  if (NORMALISED_ASCII_WORD.test(input)) return input;
  return normaliseRuleText(input.trim());
}

/**
 * Exposes Set semantics while keeping direct `dictionary.words.has(...)`
 * lookups case- and apostrophe-insensitive.
 */
class NormalisedWordSet extends Set<string> {
  override has(value: string): boolean {
    return super.has(normaliseDictionaryWord(value));
  }
}

function buildDictionary(): Dictionary {
  const words = new NormalisedWordSet(DICTIONARY_WORDS);
  const mutableBuckets = new Map<number, Map<string, string[]>>();

  for (const word of DICTIONARY_WORDS) {
    const firstLetter = word[0];
    if (!firstLetter) continue;
    let byFirstLetter = mutableBuckets.get(word.length);
    if (!byFirstLetter) {
      byFirstLetter = new Map();
      mutableBuckets.set(word.length, byFirstLetter);
    }
    let bucket = byFirstLetter.get(firstLetter);
    if (!bucket) {
      bucket = [];
      byFirstLetter.set(firstLetter, bucket);
    }
    bucket.push(word);
  }

  const buckets = new Map<number, ReadonlyMap<string, readonly string[]>>();
  for (const [length, byFirstLetter] of mutableBuckets) {
    const frozen = new Map<string, readonly string[]>();
    for (const [firstLetter, bucket] of byFirstLetter) {
      frozen.set(firstLetter, Object.freeze(bucket));
    }
    buckets.set(length, frozen);
  }

  return Object.freeze({
    words,
    byLengthAndFirstLetter: buckets,
  });
}

/** Built once when this module is evaluated, then shared by every correction. */
export const dictionary: Dictionary = buildDictionary();

export const LEXICON_SIZE = DICTIONARY_METADATA.wordCount;

export function isKnownWord(word: string): boolean {
  return dictionary.words.has(word);
}

export function getDictionaryBucket(length: number, firstLetter: string): readonly string[] {
  const first = normaliseDictionaryWord(firstLetter)[0];
  if (!first || !Number.isInteger(length) || length < 1) return [];
  return dictionary.byLengthAndFirstLetter.get(length)?.get(first) ?? [];
}

function explicitFrequency(word: string): number | undefined {
  const rank = COMMON_RANK.get(word);
  if (rank === undefined) return undefined;
  if (COMMON_WORDS.length <= 1) return 1;
  return 1 - (rank / (COMMON_WORDS.length - 1)) * 0.25;
}

/**
 * A deterministic 0..1 ranking prior.
 *
 * ESDB itself supplies no frequency values, so known words outside the
 * explicit common-word list receive a neutral 0.5. A few simple inflections
 * inherit their base word's prior (for example, "works" inherits "work").
 */
export function frequencyScore(input: string): number {
  const word = normaliseDictionaryWord(input);
  if (!dictionary.words.has(word)) return 0;

  const direct = explicitFrequency(word);
  if (direct !== undefined) return direct;

  const possibleBases: string[] = [];
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    possibleBases.push(word.slice(0, -1));
  }
  if (word.length > 4 && word.endsWith('ed')) {
    possibleBases.push(word.slice(0, -2), word.slice(0, -1));
  }
  if (word.length > 5 && word.endsWith('ing')) {
    possibleBases.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  }

  for (const base of possibleBases) {
    const inherited = explicitFrequency(base);
    if (inherited !== undefined) return inherited * 0.98;
  }
  return 0.5;
}

export { DICTIONARY_METADATA };

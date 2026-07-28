/**
 * Lexical support for apostrophe insertion.
 *
 * Process 7 turns "didnt" into "didn't" by trying an apostrophe at each
 * interior position and keeping whatever the dictionary recognises. Dictionary
 * membership alone turned out to be far too weak a test: ESDB contains the
 * possessive and plural of essentially every noun, so "mis" became "mi's" (the
 * possessive of the musical note) and any three-letter fragment could be
 * "corrected" into a possessive nobody wrote.
 *
 * The fix is not a length rule - that would break `hes`, `ims` and `dont`
 * equally. It is to require *lexical support*: the candidate must be a real
 * contraction, or a possessive whose stem the corpus actually ranks.
 */
import { frequencyRank } from './frequency.js';
import { normaliseDictionaryWord } from './dictionary.js';

/**
 * The closed set of English contraction suffixes.
 *
 * English has no others: a word cannot become a contraction by gaining an
 * apostrophe anywhere else.
 */
const CONTRACTION_SUFFIXES = new Set(['t', 's', 're', 've', 'll', 'd', 'm', 'clock']);

/**
 * Stems that form a contraction with `'t`.
 *
 * Note these include the `n`: "didn't" splits as `didn` + `'` + `t`, not
 * `did` + `'t`. The stem is whatever precedes the apostrophe, which is what
 * the generator hands us.
 *
 * Curated because the set is closed and small, and because "didn't" must work
 * whether or not a corpus happens to rank "didnt".
 */
const NEGATIVE_STEMS = new Set([
  'aren', 'can', 'couldn', 'didn', 'doesn', 'don', 'hadn', 'hasn', 'haven',
  'isn', 'mustn', 'needn', 'oughtn', 'shan', 'shouldn', 'wasn', 'weren', 'won',
  'wouldn', 'ain', 'daren', 'mightn', 'mayn',
]);

/**
 * Stems that form a contraction with 's, 're, 've, 'll, 'd or 'm.
 *
 * Pronouns, question words and the handful of nouns that routinely contract.
 * Everything outside this list must earn its apostrophe from the corpus.
 */
const CONTRACTING_STEMS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'that', 'this', 'there', 'here',
  'what', 'who', 'where', 'when', 'why', 'how', 'which', 'let', 'one', 'somebody',
  'someone', 'something', 'nobody', 'everyone', 'everybody', 'anyone', 'anybody',
  'y', 'ma', 'o',
]);

/**
 * Frequency band a possessive's stem must reach for the apostrophe to be
 * offered without a curated entry.
 *
 * 128 is the "ordinary" band - roughly the top 20,000 English words. A stem
 * below it is either rare or not really a word being possessed, which is
 * exactly the "mi's" case.
 */
const MIN_STEM_RANK = 128;

/** Shortest stem that can take a possessive. Pronouns are handled separately. */
const MIN_POSSESSIVE_STEM = 3;

export interface ApostropheSupport {
  supported: boolean;
  /** Which source vouched for it, for diagnostics and tests. */
  reason:
    | 'negative-contraction'
    | 'pronoun-contraction'
    | 'oclock'
    | 'possessive-of-common-stem'
    | 'unsupported-suffix'
    | 'stem-too-short'
    | 'stem-too-rare';
}

/**
 * Decides whether `stem + ' + suffix` is a contraction or possessive English
 * actually forms.
 *
 * Deliberately strict. A false negative costs one missed correction; a false
 * positive rewrites a word the user meant.
 */
export function apostropheSupport(stem: string, suffix: string): ApostropheSupport {
  const s = normaliseDictionaryWord(stem);
  const suf = suffix.toLowerCase();

  if (!CONTRACTION_SUFFIXES.has(suf)) {
    return { supported: false, reason: 'unsupported-suffix' };
  }
  // "o'clock" is the only common word of its shape.
  if (suf === 'clock') {
    return s === 'o'
      ? { supported: true, reason: 'oclock' }
      : { supported: false, reason: 'unsupported-suffix' };
  }
  // "didn't", "can't", "won't": a closed, curated set.
  if (suf === 't') {
    return NEGATIVE_STEMS.has(s)
      ? { supported: true, reason: 'negative-contraction' }
      : { supported: false, reason: 'stem-too-rare' };
  }
  // "I'm", "you're", "they've", "we'll", "he'd", "that's".
  if (CONTRACTING_STEMS.has(s)) {
    return { supported: true, reason: 'pronoun-contraction' };
  }
  /*
   * Everything else can only be a possessive, and only 's forms one. The stem
   * must be a word the corpus ranks: "dog's" yes, "mi's" no.
   *
   * This is the check that closes the false positive. It also means possessive
   * suggestions improve automatically as the frequency corpus improves, rather
   * than needing a curated list of every noun in English.
   */
  if (suf !== 's') return { supported: false, reason: 'stem-too-rare' };
  /*
   * A stem of one or two letters is not a noun being possessed. "mi's", "ab's"
   * and "de's" are all in a broad dictionary; none is what a writer typing
   * "mis" meant. Genuine short possessives are pronouns, and those are already
   * covered by CONTRACTING_STEMS above.
   */
  if (s.length < MIN_POSSESSIVE_STEM) {
    return { supported: false, reason: 'stem-too-short' };
  }
  return frequencyRank(s) >= MIN_STEM_RANK
    ? { supported: true, reason: 'possessive-of-common-stem' }
    : { supported: false, reason: 'stem-too-rare' };
}

/** Convenience for the generator. */
export function apostropheIsSupported(stem: string, suffix: string): boolean {
  return apostropheSupport(stem, suffix).supported;
}

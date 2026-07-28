/**
 * Lightweight part-of-speech classification.
 *
 * Not a statistical tagger: closed-class lookup, morphology and a few ordering
 * heuristics, backed by the extension's existing ESDB dictionary for
 * "is this even a word". That is deliberately enough for the targeted rules -
 * the clause detector mainly needs "is there a finite verb here" and "could
 * this head a subject" - and it keeps the lane deterministic and explainable.
 *
 * Every guess is marked `isGuess`, and rules lower their confidence when they
 * depend on one.
 */
import { isKnownWord as isKnownDictionaryWord, normaliseDictionaryWord } from '../data/dictionary.js';
import {
  ADDRESS_TERMS,
  ADVERBS,
  AUXILIARIES,
  COORDINATORS,
  COPULAS,
  DETERMINERS,
  IMPERATIVE_VERBS,
  INTRODUCTORY_SUBORDINATORS,
  IRREGULAR_PARTICIPLE,
  IRREGULAR_PAST,
  NONFINITE_AUXILIARIES,
  OBJECT_PRONOUNS,
  OTHER_PRONOUNS,
  PREPOSITIONS,
  SUBJECT_PRONOUNS,
  SUBORDINATORS,
} from './lexical-classes.js';
import type { AnalysedToken } from './context-types.js';

/** `isKnownWord` expects the dictionary's normalised form. */
function isKnownWord(word: string): boolean {
  return isKnownDictionaryWord(normaliseDictionaryWord(word));
}

const VERB_SUFFIX = /(ate|ify|ise|ize|ect|duce|sume|ceive|tain|pose|mit|vert|scribe)$/;
const ADJ_SUFFIX = /(ous|ful|ive|able|ible|al|ic|ish|less|ary|ent|ant|y)$/;
const NOUN_SUFFIX = /(tion|sion|ment|ness|ity|ance|ence|ship|hood|dom|ist|ism|er|or|age)$/;
const ADV_SUFFIX = /ly$/;

/** Third-person singular present: "walks", "tests". Not a plural noun. */
function looksThirdPersonSingular(word: string): boolean {
  if (!word.endsWith('s') || word.endsWith('ss') || word.endsWith('us')) return false;
  const stem = word.endsWith('es') ? word.slice(0, -2) : word.slice(0, -1);
  return stem.length >= 3 && isKnownWord(stem);
}

/**
 * Past-tense evidence. `confirmed` means the stem is a real word, which is
 * strong evidence rather than a guess - important because clause confidence
 * (and therefore whether a comma is automatic) depends on it.
 */
function pastTenseEvidence(w: string): 'irregular' | 'confirmed' | 'weak' | 'none' {
  const word = w;
  if (IRREGULAR_PAST.has(word)) return 'irregular';
  if (!word.endsWith('ed')) return 'none';
  const stem = word.slice(0, -2);
  const stemE = word.slice(0, -1);
  if (stem.length >= 3 && isKnownWord(stem)) return 'confirmed';
  if (stemE.length >= 3 && isKnownWord(stemE)) return 'confirmed';
  // doubled consonant: "stopped" -> "stop"
  if (
    stem.length >= 4 &&
    stem[stem.length - 1] === stem[stem.length - 2] &&
    isKnownWord(stem.slice(0, -1))
  ) {
    return 'confirmed';
  }
  // Unconfirmable stem (regional spellings such as "apologised"): still very
  // likely a past tense, but treated as a guess so confidence stays below the
  // automatic threshold.
  return w.length >= 5 ? 'weak' : 'none';
}

/**
 * Classifies one token in place. `previous` is the already-classified token
 * before it, which is what makes "the record" (noun) separable from
 * "I record" (verb) without a full tagger.
 */
export function classifyToken(token: AnalysedToken, previous?: AnalysedToken): AnalysedToken {
  if (token.type === 'punctuation') return token;
  const w = token.normalised;

  // --- closed classes: certain, no guessing ---
  if (AUXILIARIES.has(w)) {
    token.type = 'auxiliary';
    // "be"/"been"/"being" cannot head a clause without another auxiliary.
    token.isFiniteVerb = !NONFINITE_AUXILIARIES.has(w);
    return token;
  }
  if (SUBJECT_PRONOUNS.has(w) || OBJECT_PRONOUNS.has(w) || OTHER_PRONOUNS.has(w)) {
    token.type = 'pronoun';
    token.isSubjectCandidate = SUBJECT_PRONOUNS.has(w) || OTHER_PRONOUNS.has(w);
    return token;
  }
  if (COORDINATORS.has(w)) {
    token.type = 'conjunction';
    token.isCoordinator = true;
    if (SUBORDINATORS.has(w)) token.isSubordinator = true;
    return token;
  }
  if (SUBORDINATORS.has(w)) {
    token.type = 'conjunction';
    token.isSubordinator = true;
    if (INTRODUCTORY_SUBORDINATORS.has(w)) token.isSubjectCandidate = false;
    return token;
  }
  if (DETERMINERS.has(w)) {
    token.type = 'determiner';
    return token;
  }
  if (PREPOSITIONS.has(w)) {
    token.type = 'preposition';
    return token;
  }
  if (ADVERBS.has(w)) {
    token.type = 'adverb';
    return token;
  }

  // --- morphology ---
  if (w.endsWith('ing')) {
    token.isGerundOrParticiple = true;
    token.type = 'verb';
    token.isFiniteVerb = false; // needs an auxiliary to be finite
    token.isGuess = true;
    return token;
  }
  if (IRREGULAR_PARTICIPLE.has(w)) {
    token.type = 'verb';
    token.isPastParticiple = true;
    token.isFiniteVerb = false;
    return token;
  }
  const pastEvidence = pastTenseEvidence(w);
  if (pastEvidence !== 'none') {
    token.type = 'verb';
    token.isPastParticiple = w.endsWith('ed');
    // "-ed" after an auxiliary is a participle ("was tired"), else finite.
    token.isFiniteVerb = !(previous?.type === 'auxiliary');
    // A confirmed stem is evidence; an unconfirmable one stays a guess.
    token.isGuess = pastEvidence === 'weak';
    return token;
  }
  if (looksThirdPersonSingular(w)) {
    // "the tests" is a noun; "it tests" is a verb.
    const nominal = previous?.type === 'determiner' || previous?.type === 'adjective';
    token.type = nominal ? 'noun' : 'verb';
    token.isFiniteVerb = !nominal;
    token.isSubjectCandidate = nominal;
    // Syntactic context decides this, so it is not a bare morphological guess.
    token.isGuess = !(nominal || previous?.isSubjectCandidate === true);
    return token;
  }
  if (ADV_SUFFIX.test(w) && w.length > 4) {
    token.type = 'adverb';
    token.isGuess = true;
    return token;
  }

  // A known word straight after a subject pronoun is that subject's verb
  // ("you finish", "they need"). This outranks the suffix heuristics below,
  // which would otherwise read "finish" as an adjective because of "-ish".
  if (previous?.type === 'pronoun' && previous.isSubjectCandidate && isKnownWord(w)) {
    token.type = 'verb';
    token.isFiniteVerb = true;
    return token;
  }

  // Capitalised mid-sentence: a name.
  const capitalised = /^[A-Z][a-z'’-]*$/.test(token.text);
  if (capitalised && token.index > 0) {
    token.type = 'proper-noun';
    token.isSubjectCandidate = true;
    token.isAddressTerm = true;
    return token;
  }
  if (ADDRESS_TERMS.has(w)) {
    token.type = 'noun';
    token.isSubjectCandidate = true;
    token.isAddressTerm = true;
    return token;
  }

  if (NOUN_SUFFIX.test(w)) {
    token.type = 'noun';
    token.isSubjectCandidate = true;
    token.isGuess = true;
    return token;
  }
  if (ADJ_SUFFIX.test(w)) {
    token.type = 'adjective';
    token.isGuess = true;
    return token;
  }
  if (VERB_SUFFIX.test(w)) {
    token.type = 'verb';
    // A bare stem after a subject is finite present ("they operate").
    token.isFiniteVerb = previous?.isSubjectCandidate === true;
    token.isGuess = true;
    return token;
  }

  // Known imperative verb: "Come here.", "Mom, look at this."
  if (IMPERATIVE_VERBS.has(w)) {
    token.type = 'verb';
    token.isFiniteVerb = previous?.type !== 'auxiliary';
    return token;
  }

  // Bare known word: verb after an auxiliary ("let's call"), noun otherwise.
  if (isKnownWord(w)) {
    // After a modal or "let's" a bare word is a verb; after a copula it is a
    // complement ("was red"), so let it fall through to noun/adjective.
    if (previous?.type === 'auxiliary' && !COPULAS.has(previous.normalised)) {
      token.type = 'verb';
      token.isFiniteVerb = false; // the auxiliary carries finiteness
      token.isGuess = true;
      return token;
    }
    token.type = 'noun';
    token.isSubjectCandidate = true;
    // A determiner or adjective in front is solid evidence of a noun.
    token.isGuess = !(previous?.type === 'determiner' || previous?.type === 'adjective');
    if (capitalised) token.isAddressTerm = true;
    return token;
  }

  token.type = 'unknown';
  token.isGuess = true;
  if (capitalised && token.index > 0) {
    token.type = 'proper-noun';
    token.isSubjectCandidate = true;
    token.isAddressTerm = true;
  }
  return token;
}

/** Classifies a whole sentence left to right. */
export function classifyTokens(tokens: AnalysedToken[]): AnalysedToken[] {
  let previous: AnalysedToken | undefined;
  for (const token of tokens) {
    classifyToken(token, previous);
    if (token.type !== 'punctuation') previous = token;
  }
  return tokens;
}

/** First-token classification cannot use capitalisation as a name signal. */
export function isLikelyProperNoun(token: AnalysedToken): boolean {
  return token.type === 'proper-noun' || (token.isAddressTerm === true && token.index > 0);
}


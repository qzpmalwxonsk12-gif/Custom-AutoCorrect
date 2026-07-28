/**
 * Linguistic analysis types shared by every lane.
 *
 * These used to live in `punctuation-types.ts`, which meant the spelling engine
 * could not describe a token without importing the punctuation engine. They are
 * facts about text, not about commas, so they belong here; `punctuation-types`
 * re-exports them so the punctuation rules are unchanged.
 */

export type TokenType =
  | 'noun'
  | 'proper-noun'
  | 'pronoun'
  | 'verb'
  | 'auxiliary'
  | 'adjective'
  | 'adverb'
  | 'determiner'
  | 'preposition'
  | 'conjunction'
  | 'punctuation'
  | 'number'
  | 'unknown';

export interface AnalysedToken {
  text: string;
  /** Lower-cased, apostrophes normalised. */
  normalised: string;
  start: number;
  end: number;
  type: TokenType;
  /** Index of this token in the sentence's token array. */
  index: number;

  /** A verb that can head a clause (not a bare participle or infinitive). */
  isFiniteVerb?: boolean;
  /** Could head a noun phrase acting as a subject. */
  isSubjectCandidate?: boolean;
  /** Name, kinship term, title or vocative noun. */
  isAddressTerm?: boolean;
  /** Subordinating conjunction that can introduce a dependent clause. */
  isSubordinator?: boolean;
  /** for/and/nor/but/or/yet/so. */
  isCoordinator?: boolean;
  /** -ing form. */
  isGerundOrParticiple?: boolean;
  /** -ed / irregular past participle. */
  isPastParticiple?: boolean;
  /** True when the classification is a guess rather than a lexicon hit. */
  isGuess?: boolean;
  /** True when the token must never be modified (URL, code, number, ...). */
  isProtected?: boolean;
}

export interface ClauseAnalysis {
  startToken: number;
  endToken: number;
  hasSubject: boolean;
  hasFiniteVerb: boolean;
  isIndependent: boolean;
  isDependent: boolean;
  /** 0..1 confidence that this really is a clause. */
  confidence: number;
  /** Token index of the detected subject head, when found. */
  subjectToken?: number;
  /** Token index of the detected finite verb, when found. */
  verbToken?: number;
}

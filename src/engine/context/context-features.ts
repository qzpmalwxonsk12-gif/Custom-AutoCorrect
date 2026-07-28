/**
 * Sentence-level features for the word that is being corrected.
 *
 * The punctuation lane has always had a token classifier and a clause detector;
 * the spelling lane had `previousWord` and `nextWord` strings and nothing else.
 * This module gives both lanes the same view, so "what kind of word precedes
 * this one" has one answer rather than two.
 *
 * Everything here is optional and best effort. The features are *ranking*
 * evidence: a caller that cannot compute them still gets a usable context, and
 * no correction may depend on their presence.
 */
import { analyseSentences } from '../punctuation/punctuation-tokenizer.js';
import { analyseClause } from './clause-detector.js';
import { classifyTokens } from './token-classifier.js';
import type { AnalysedToken, ClauseAnalysis, TokenType } from './context-types.js';

export interface SentenceFeatures {
  /** The sentence containing the target span. */
  sentenceText: string;
  /** Offset of `sentenceText` within the analysed text. */
  sentenceStart: number;
  sentenceTokens: AnalysedToken[];
  /** Clause analysis of the whole sentence, when one could be derived. */
  targetClause?: ClauseAnalysis;
  /** Classified token immediately before the target span. */
  previousToken?: AnalysedToken;
  /** Classified token immediately after the target span. */
  nextToken?: AnalysedToken;
  /** The target span's own token, when it aligns with one. */
  targetToken?: AnalysedToken;
}

/**
 * Longest text this will analyse in one call. Sentence splitting and
 * classification are linear, but the spelling lane runs on every committed
 * word, so the input is bounded rather than trusted.
 */
const MAX_ANALYSIS_LENGTH = 4_000;

/**
 * Builds sentence features around `[start, end)`.
 *
 * Returns null when the text is too long to analyse cheaply or the span cannot
 * be located - callers treat that as "no extra evidence", never as an error.
 */
export function sentenceFeaturesAt(
  text: string,
  start: number,
  end: number,
): SentenceFeatures | null {
  if (text.length === 0 || text.length > MAX_ANALYSIS_LENGTH) return null;
  if (start < 0 || end > text.length || end < start) return null;

  let sentences;
  try {
    sentences = analyseSentences(text);
  } catch {
    return null;
  }

  const sentence =
    sentences.find((s) => s.start <= start && s.end >= end)
    // A span straddling a sentence boundary still belongs to the sentence it
    // starts in; falling back keeps features available for edge cases.
    ?? sentences.find((s) => s.start <= start && s.end > start);
  if (!sentence) return null;

  classifyTokens(sentence.tokens);

  const words = sentence.tokens.filter((token) => token.type !== 'punctuation');
  const previousToken = [...words]
    .reverse()
    .find((token) => token.end <= start);
  const nextToken = words.find((token) => token.start >= end);
  const targetToken = sentence.tokens.find(
    (token) => token.start === start && token.end === end,
  );

  const features: SentenceFeatures = {
    sentenceText: sentence.text,
    sentenceStart: sentence.start,
    sentenceTokens: sentence.tokens,
  };
  const clause = analyseClause(sentence.tokens, 0, sentence.tokens.length);
  if (clause) features.targetClause = clause;
  if (previousToken) features.previousToken = previousToken;
  if (nextToken) features.nextToken = nextToken;
  if (targetToken) features.targetToken = targetToken;
  return features;
}

/** Convenience: the token type before a span, or undefined. */
export function tokenTypeBefore(features: SentenceFeatures | null): TokenType | undefined {
  return features?.previousToken?.type;
}

/** Convenience: the token type after a span, or undefined. */
export function tokenTypeAfter(features: SentenceFeatures | null): TokenType | undefined {
  return features?.nextToken?.type;
}

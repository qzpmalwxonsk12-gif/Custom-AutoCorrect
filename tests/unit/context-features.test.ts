/**
 * Stage 0: the token classifier and clause detector are shared, and the
 * spelling lane can see them.
 */
import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/engine/correction-engine.js';
import { sentenceFeaturesAt } from '../../src/engine/context/context-features.js';
import { classifyTokens } from '../../src/engine/context/token-classifier.js';
import { analyseClause } from '../../src/engine/context/clause-detector.js';
import { analyseSentences } from '../../src/engine/punctuation/punctuation-tokenizer.js';

describe('sentenceFeaturesAt', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';

  it('locates the sentence containing a span', () => {
    const features = sentenceFeaturesAt(text, 16, 19);
    expect(features?.sentenceText).toBe(text);
    expect(features?.sentenceStart).toBe(0);
  });

  it('classifies the tokens either side of the span', () => {
    // "fox" at [16,19): preceded by "brown", followed by "jumps".
    const features = sentenceFeaturesAt(text, 16, 19);
    expect(features?.previousToken?.normalised).toBe('brown');
    expect(features?.nextToken?.normalised).toBe('jumps');
    expect(features?.targetToken?.normalised).toBe('fox');
  });

  it('supplies a clause analysis', () => {
    const features = sentenceFeaturesAt(text, 16, 19);
    expect(features?.targetClause?.hasFiniteVerb).toBe(true);
  });

  it('picks the right sentence out of several', () => {
    const many = 'One here. The cat sat down. Three here.';
    const features = sentenceFeaturesAt(many, 14, 17);
    expect(features?.sentenceText.trim()).toBe('The cat sat down.');
  });

  it('declines rather than throwing on a very long field', () => {
    expect(sentenceFeaturesAt('word '.repeat(2_000), 0, 4)).toBeNull();
  });

  it('declines on an out-of-range span', () => {
    expect(sentenceFeaturesAt(text, 10, 5)).toBeNull();
    expect(sentenceFeaturesAt(text, 0, text.length + 10)).toBeNull();
  });

  it('handles empty text', () => {
    expect(sentenceFeaturesAt('', 0, 0)).toBeNull();
  });
});

describe('EngineContext carries the shared features', () => {
  it('exposes the part of speech either side of the target', () => {
    const text = 'I think the cat sat on the mat.';
    // "cat" at [12,15).
    const context = buildContext(text, 12, 15, 'https://example.com');
    expect(context.previousTokenType).toBe('determiner');
    expect(context.nextTokenType).toBeDefined();
    expect(context.sentenceTokens?.length).toBeGreaterThan(0);
  });

  it('keeps the original string fields working', () => {
    const text = 'I think the cat sat on the mat.';
    const context = buildContext(text, 12, 15, 'https://example.com');
    expect(context.previousWord).toBe('the');
    expect(context.nextWord).toBe('sat');
    expect(context.isSentenceStart).toBe(false);
    expect(context.origin).toBe('https://example.com');
  });

  it('still produces a usable context when features are unavailable', () => {
    // Too long for sentence analysis; the string fields must still be present.
    const long = `${'filler word '.repeat(400)}the cat sat.`;
    const context = buildContext(long, 5, 9, 'https://example.com');
    expect(context.sentenceTokens).toBeUndefined();
    expect(context.previousTokenType).toBeUndefined();
    expect(typeof context.previousWord).toBe('string');
  });
});

describe('one implementation only', () => {
  /**
   * The punctuation provider and the spelling lane must agree about a
   * sentence. Before Stage 0 each could have had its own classifier; this
   * asserts they produce identical classifications for the same input.
   */
  it('the shared classifier gives the punctuation lane the same answer', () => {
    const text = 'The cache stores keys and values.';
    const [sentence] = analyseSentences(text);
    classifyTokens(sentence!.tokens);
    const viaPunctuation = sentence!.tokens.map((t) => `${t.normalised}:${t.type}`);

    const features = sentenceFeaturesAt(text, 10, 16);
    const viaSpelling = features!.sentenceTokens.map((t) => `${t.normalised}:${t.type}`);

    expect(viaSpelling).toEqual(viaPunctuation);
  });

  it('the clause detector is the same function for both lanes', () => {
    const text = 'I was tired but I kept working.';
    const [sentence] = analyseSentences(text);
    classifyTokens(sentence!.tokens);
    const direct = analyseClause(sentence!.tokens, 0, sentence!.tokens.length);
    const viaFeatures = sentenceFeaturesAt(text, 2, 5)?.targetClause;
    expect(viaFeatures?.hasFiniteVerb).toBe(direct?.hasFiniteVerb);
    expect(viaFeatures?.verbToken).toBe(direct?.verbToken);
  });
});

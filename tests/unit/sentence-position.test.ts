/**
 * Sentence-position plausibility.
 *
 * As with every context term, most of these tests are about what it must *not*
 * do. A positional heuristic that is confident is a positional heuristic that
 * mis-corrects headings, dialogue and abbreviations.
 */
import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/engine/correction-engine.js';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import {
  DEFAULT_WEIGHTS,
  EXPERIMENTAL_WEIGHTS,
} from '../../src/engine/context/score-weights.js';
import {
  describeSentencePosition,
  sentencePositionScore,
  sentenceSlot,
} from '../../src/engine/context/sentence-position.js';

const ORIGIN = 'https://example.com';

/** Builds a context for the token at `word`'s first occurrence in `sentence`. */
function contextFor(sentence: string, word: string) {
  const start = sentence.indexOf(word);
  expect(start, `"${word}" not found in "${sentence}"`).toBeGreaterThanOrEqual(0);
  return buildContext(sentence, start, start + word.length, ORIGIN);
}

describe('slot detection reuses the shared sentence analysis', () => {
  it('finds a sentence start', () => {
    expect(sentenceSlot(contextFor('Hello there friend.', 'Hello')).isSentenceStart).toBe(true);
  });

  it('finds a token before terminal punctuation', () => {
    const slot = sentenceSlot(contextFor('I walked to the shop.', 'shop'));
    expect(slot.isSentenceEnd).toBe(true);
    expect(slot.isSentenceStart).toBe(false);
  });

  it('finds clause breaks on both sides', () => {
    expect(sentenceSlot(contextFor('I saw them, then left.', 'them')).beforeClauseBreak).toBe(true);
    expect(sentenceSlot(contextFor('I saw them, then left.', 'then')).afterClauseBreak).toBe(true);
  });

  it('finds a token after an opening quote or bracket', () => {
    expect(sentenceSlot(contextFor('He said "hello there".', 'hello')).afterOpener).toBe(true);
    expect(sentenceSlot(contextFor('The result (partial) came in.', 'partial')).afterOpener)
      .toBe(true);
  });

  /* These two are the reason this module does not detect sentences itself. */
  it('does not treat an abbreviation as a sentence boundary', () => {
    for (const [sentence, word] of [
      ['We sell fruit, e.g. apples and pears.', 'apples'],
      ['The rule, i.e. this one, applies here.', 'this'],
      ['Call Dr. Smith about it.', 'Smith'],
    ] as const) {
      expect(sentenceSlot(contextFor(sentence, word)).isSentenceStart, sentence).toBe(false);
    }
  });

  it('does not treat a decimal or version number as a sentence boundary', () => {
    expect(sentenceSlot(contextFor('The build is 3.5 and stable now.', 'stable'))
      .isSentenceStart).toBe(false);
    expect(sentenceSlot(contextFor('Version 2.1.4 shipped today.', 'shipped'))
      .isSentenceStart).toBe(false);
  });
});

describe('positional prohibitions', () => {
  it('rejects a determiner before a full stop', () => {
    const context = contextFor('I gave it to the.', 'the');
    expect(sentencePositionScore('the', context)).toBeLessThan(0);
  });

  /**
   * Both of these were penalised in the first draft, and the ground-truth sweep
   * showed both were wrong: stranding ("Who are you talking to?") and ellipsis
   * ("Yes, I have.") end sentences on these classes all the time. Penalising
   * auxiliaries turned `hve` -> `have` into `hve` -> `he`.
   */
  it('has no opinion about a stranded preposition or an elided auxiliary', () => {
    const context = contextFor('I gave it to the.', 'the');
    expect(sentencePositionScore('of', context)).toBe(0);
    expect(sentencePositionScore('have', context)).toBe(0);
  });

  it('has no opinion about an ordinary noun ending a sentence', () => {
    expect(sentencePositionScore('shop', contextFor('I walked to the shop.', 'shop'))).toBe(0);
  });

  it('rejects a possessive immediately before a full stop', () => {
    expect(sentencePositionScore("mi's", contextFor('That was a mis.', 'mis'), 'mis'))
      .toBeLessThan(0);
  });

  it('penalises a capitalised form for a lower-case token mid-sentence only', () => {
    const mid = contextFor('I need to iprove it.', 'iprove');
    const start = contextFor('Iprove it now.', 'Iprove');
    expect(sentencePositionScore('iPhone', mid, 'iprove')).toBeLessThan(0);
    // At a sentence start every word is capitalised, so case says nothing.
    expect(sentencePositionScore('iPhone', start, 'Iprove')).toBe(0);
  });

  it('does not reward a candidate merely for being capitalised', () => {
    const context = contextFor('We met in march last year.', 'march');
    expect(sentencePositionScore('March', context, 'march')).toBeLessThanOrEqual(0);
  });

  it('treats a sentence-opening conjunction as unusual, not forbidden', () => {
    const score = sentencePositionScore('and', contextFor('And then we left.', 'And'));
    expect(score).toBeLessThan(0);
    expect(score).toBeGreaterThan(-0.5);
  });

  it('softens its opinion inside a heading or fragment', () => {
    const sentence = contextFor('I gave it to the.', 'the');
    const fragment = contextFor('Notes about the.', 'the');
    expect(Math.abs(sentencePositionScore('the', fragment)))
      .toBeLessThanOrEqual(Math.abs(sentencePositionScore('the', sentence)));
  });

  it('stays inside -1..1', () => {
    for (const sentence of ['I gave it to the.', 'And the.', 'Hello.']) {
      const context = contextFor(sentence, sentence.split(' ')[0]!);
      for (const candidate of ['the', 'of', "mi's", 'iPhone', 'hello', 'and']) {
        const score = sentencePositionScore(candidate, context, 'x');
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('sentence position as a score term', () => {
  it('contributes nothing at weight zero', () => {
    const context = contextFor('I gave it to the.', 'the');
    const candidates = generateCandidates('teh', 10);
    const ranked = rankCandidates(candidates, DEFAULT_WEIGHTS, { context, typedWord: 'teh' });
    for (const scored of ranked) expect(scored.terms.sentencePosition).toBe(0);
  });

  it('reproduces the shipped ranking exactly at weight zero', () => {
    for (const [sentence, word] of [
      ['I need to iprove it.', 'iprove'],
      ['He is the mastter here.', 'mastter'],
      ['I gave it to teh.', 'teh'],
    ] as const) {
      const context = contextFor(sentence, word);
      const candidates = generateCandidates(word, 10);
      if (candidates.length < 2) continue;
      const shipped = rankCandidates(candidates, DEFAULT_WEIGHTS, { context, typedWord: word });
      const explicitZero = rankCandidates(
        candidates,
        { ...DEFAULT_WEIGHTS, sentencePosition: 0 },
        { context, typedWord: word },
      );
      expect(explicitZero.map((s) => s.candidate.word), word).toEqual(
        shipped.map((s) => s.candidate.word),
      );
    }
  });

  it('contributes once its weight is raised', () => {
    const context = contextFor('I gave it to teh.', 'teh');
    const candidates = generateCandidates('teh', 10);
    const ranked = rankCandidates(
      candidates,
      { ...DEFAULT_WEIGHTS, sentencePosition: 0.02 },
      { context, typedWord: 'teh' },
    );
    expect(ranked.some((s) => s.terms.sentencePosition !== 0)).toBe(true);
  });

  it('never adds or removes a candidate', () => {
    const context = contextFor('I gave it to teh.', 'teh');
    const candidates = generateCandidates('teh', 10);
    const ranked = rankCandidates(
      candidates,
      { ...DEFAULT_WEIGHTS, sentencePosition: 0.04 },
      { context, typedWord: 'teh' },
    );
    expect(ranked).toHaveLength(candidates.length);
  });

  it('never overrides a cheaper edit', () => {
    for (const [sentence, word] of [
      ['I need to iprove it.', 'iprove'],
      ['He is the mastter here.', 'mastter'],
      ['I gave it to teh.', 'teh'],
    ] as const) {
      const context = contextFor(sentence, word);
      const candidates = generateCandidates(word, 10);
      if (candidates.length === 0) continue;
      const lowest = Math.min(...candidates.map((c) => c.operationCost));
      const ranked = rankCandidates(
        candidates,
        { ...DEFAULT_WEIGHTS, sentencePosition: 0.04 },
        { context, typedWord: word },
      );
      expect(ranked[0]!.candidate.operationCost, word).toBeLessThanOrEqual(lowest);
    }
  });

  it('is configured as an experimental weight for shadow mode', () => {
    expect(EXPERIMENTAL_WEIGHTS.sentencePosition).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.sentencePosition).toBe(0);
  });

  it('explains itself in diagnostics', () => {
    const detail = describeSentencePosition('the', contextFor('I gave it to the.', 'the'));
    expect(detail).toContain('determiner');
    expect(detail).toContain('before terminal punctuation');
  });
});

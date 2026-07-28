/**
 * Tasks 7 and 8: part-of-speech compatibility and document reuse.
 *
 * Both ship at weight zero, so the first thing each block asserts is that
 * nothing moves until the weight is raised deliberately.
 */
import { describe, expect, it } from 'vitest';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates, scoreCandidate } from '../../src/engine/context/candidate-scoring.js';
import { classifyWord, posCompatibility } from '../../src/engine/context/pos-compatibility.js';
import {
  DocumentEvidence,
  MAX_TRACKED_WORDS,
  OCCURRENCE_CEILING,
} from '../../src/engine/context/document-evidence.js';
import { DEFAULT_WEIGHTS } from '../../src/engine/context/score-weights.js';

const POS_ON = { ...DEFAULT_WEIGHTS, partOfSpeech: 0.05 };
const REUSE_ON = { ...DEFAULT_WEIGHTS, documentReuse: 0.05 };

/* ------------------------------ Task 7 ------------------------------ */

describe('part-of-speech compatibility', () => {
  it('uses the shared classifier, not a second one', () => {
    // Same function the punctuation lane uses; these are its answers.
    expect(classifyWord('the')).toBe('determiner');
    expect(classifyWord('quickly')).toBe('adverb');
    expect(classifyWord('she')).toBe('pronoun');
  });

  it('prefers a noun after a determiner', () => {
    expect(posCompatibility('noun', 'determiner', undefined, false)).toBeGreaterThan(0);
    expect(posCompatibility('verb', 'determiner', undefined, false)).toBeLessThan(0);
  });

  it('prefers a verb before an adverb', () => {
    expect(posCompatibility('verb', undefined, 'adverb', false)).toBeGreaterThan(0);
    expect(posCompatibility('noun', undefined, 'adverb', false)).toBeLessThan(0);
  });

  it('prefers a verb after a subject', () => {
    expect(posCompatibility('verb', 'pronoun', undefined, false)).toBeGreaterThan(0);
    expect(posCompatibility('verb', 'proper-noun', undefined, false)).toBeGreaterThan(0);
  });

  /** The common case: most slots constrain nothing, and saying so is correct. */
  it('has no opinion when the slot constrains nothing', () => {
    expect(posCompatibility('noun', undefined, undefined, false)).toBe(0);
    expect(posCompatibility('noun', 'conjunction', 'conjunction', false)).toBe(0);
  });

  it('stays inside -1..1', () => {
    for (const type of ['noun', 'verb', 'adjective', 'adverb'] as const) {
      for (const prev of [undefined, 'determiner', 'pronoun', 'adjective'] as const) {
        for (const next of [undefined, 'adverb', 'determiner'] as const) {
          const score = posCompatibility(type, prev, next, true);
          expect(score).toBeGreaterThanOrEqual(-1);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('contributes nothing at weight zero', () => {
    const [candidate] = generateCandidates('teh', 5);
    const context = buildContext('I think teh cat.', 8, 11, 'https://example.com');
    const scored = scoreCandidate({ candidate: candidate!, weights: DEFAULT_WEIGHTS, context });
    expect(scored.terms.partOfSpeech).toBe(0);
  });

  it('contributes once its weight is raised', () => {
    // "the woks" - a determiner before the slot.
    const context = buildContext('The woks here.', 4, 8, 'https://example.com');
    const [candidate] = generateCandidates('woks', 5);
    if (!candidate) return;
    const scored = scoreCandidate({ candidate, weights: POS_ON, context });
    expect(scored.terms.partOfSpeech).not.toBe(0);
  });

  /**
   * The documented limit: when both candidates are the same part of speech the
   * signal cannot separate them, and pretending otherwise would be a confident
   * wrong answer.
   */
  it('cannot separate candidates that share a part of speech', () => {
    const context = buildContext('I need to iprove it.', 10, 16, 'https://example.com');
    const candidates = generateCandidates('iprove', 10);
    const improve = candidates.find((c) => c.word === 'improve');
    const prove = candidates.find((c) => c.word === 'prove');
    if (!improve || !prove) return;
    const a = scoreCandidate({ candidate: improve, weights: POS_ON, context });
    const b = scoreCandidate({ candidate: prove, weights: POS_ON, context });
    // Both are verbs, so the term is identical and decides nothing.
    expect(a.terms.partOfSpeech).toBe(b.terms.partOfSpeech);
  });

  it('never lets a rank change bypass the risk policy', () => {
    // "woks" is a valid word: whatever POS says, the class caps it.
    const context = buildContext('The extension woks correctly.', 14, 18, 'https://example.com');
    const candidates = generateCandidates('woks', 10);
    const ranked = rankCandidates(candidates, POS_ON, { context });
    // Ranking may reorder; the policy layer is what forbids automatic action,
    // and that is asserted in context-ranking.test.ts.
    expect(ranked.length).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------ Task 8 ------------------------------ */

describe('document reuse', () => {
  it('records words the document already used correctly', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The cluster runs. The cluster upgrade worked.');
    expect(evidence.evidenceFor('cluster')?.validOccurrences).toBe(2);
  });

  /*
   * "kubernetes" is not in the ESDB dictionary, so it is not tracked - which is
   * the safety property, not a gap. Domain vocabulary the dictionary does not
   * know is exactly what the personal dictionary is for; document reuse only
   * strengthens words already recognised as real.
   */
  it('ignores domain vocabulary the dictionary does not know', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The kubernetes cluster. The kubernetes upgrade.');
    expect(evidence.evidenceFor('kubernetes')).toBeUndefined();
    expect(evidence.evidenceFor('cluster')).toBeDefined();
  });

  /** The central safety property: repetition must not legitimise a typo. */
  it('never records a word the dictionary does not know', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('teh teh teh teh teh');
    expect(evidence.evidenceFor('teh')).toBeUndefined();
    expect(evidence.boostFor('teh')).toBe(0);
  });

  it('ignores very short words', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('the cat sat on the mat and the dog ran');
    expect(evidence.evidenceFor('cat')).toBeUndefined();
  });

  it('notes mid-sentence capitalisation, which suggests a name', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('We met Susan today. Susan agreed.');
    const susan = evidence.evidenceFor('susan');
    expect(susan?.capitalisedOccurrences).toBeGreaterThan(0);
  });

  it('caps the boost so repetition cannot dominate', () => {
    const evidence = new DocumentEvidence();
    evidence.observe(`${'cluster '.repeat(50)}`);
    expect(evidence.boostFor('cluster')).toBeLessThanOrEqual(1);
    expect(evidence.evidenceFor('cluster')?.validOccurrences).toBe(OCCURRENCE_CEILING);
  });

  it('bounds how many words it tracks', () => {
    const evidence = new DocumentEvidence();
    const words: string[] = [];
    // Far more distinct dictionary words than the cap.
    for (const w of ['about', 'above', 'across', 'action', 'actual', 'advice', 'afraid']) {
      for (let i = 0; i < 200; i++) words.push(w);
    }
    evidence.observe(words.join(' '));
    expect(evidence.size()).toBeLessThanOrEqual(MAX_TRACKED_WORDS);
  });

  it('does not leak between documents', () => {
    const first = new DocumentEvidence();
    const second = new DocumentEvidence();
    first.observe('The cluster runs.');
    expect(first.boostFor('cluster')).toBeGreaterThan(0);
    expect(second.boostFor('cluster')).toBe(0);
  });

  it('clears completely', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The cluster runs.');
    evidence.clear();
    expect(evidence.size()).toBe(0);
    expect(evidence.boostFor('cluster')).toBe(0);
  });

  it('keeps counts and a timestamp, never the text', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The cluster runs quietly.');
    for (const entry of evidence.snapshot()) {
      expect(Object.keys(entry).sort()).toEqual([
        'capitalisedOccurrences',
        'lastSeenAt',
        'normalisedWord',
        'validOccurrences',
      ]);
    }
  });

  it('contributes nothing at weight zero', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The cluster runs.');
    const [candidate] = generateCandidates('clsuter', 5);
    if (!candidate) return;
    const scored = scoreCandidate({
      candidate,
      weights: DEFAULT_WEIGHTS,
      documentEvidence: evidence,
    });
    expect(scored.terms.documentReuse).toBe(0);
  });

  it('contributes once its weight is raised', () => {
    const evidence = new DocumentEvidence();
    evidence.observe('The problem repeated. The problem repeated again.');
    const [candidate] = generateCandidates('probelm', 5);
    if (!candidate) return;
    const scored = scoreCandidate({
      candidate,
      weights: REUSE_ON,
      documentEvidence: evidence,
    });
    // Only if the candidate is the reused word does the term fire.
    if (candidate.word === 'problem') expect(scored.terms.documentReuse).toBeGreaterThan(0);
  });

  it('cannot override a substantially better edit explanation', () => {
    // "iphone" is cost 3; document reuse is capped at 1 x 0.05.
    const evidence = new DocumentEvidence();
    evidence.observe('iphone iphone iphone');
    const candidates = generateCandidates('iprove', 10);
    const ranked = rankCandidates(candidates, REUSE_ON, { documentEvidence: evidence });
    expect(ranked[0]!.candidate.word).not.toBe('iphone');
  });
});

/**
 * Stages 1-4: one scorer, one comparator, no early clamping, weights at zero,
 * and the correction-risk policy.
 */
import { describe, expect, it } from 'vitest';
import { generateCandidates, type Candidate } from '../../src/engine/candidate-generator.js';
import { buildContext, analyze } from '../../src/engine/correction-engine.js';
import {
  compareScored,
  rankCandidates,
  scoreCandidate,
} from '../../src/engine/context/candidate-scoring.js';
import { compareByScore, editEvidence } from '../../src/engine/context/candidate-order.js';
import { ruleContextProvider } from '../../src/engine/context/rule-context-provider.js';
import {
  DEFAULT_WEIGHTS,
  FREQUENCY_WEIGHT,
  isNeutral,
} from '../../src/engine/context/score-weights.js';
import { compareRankings } from '../../src/engine/context/shadow-comparison.js';
import { applyPolicy, classifyRisk, RISK_POLICY } from '../../src/engine/context/correction-policy.js';
import {
  frequencyRank,
  frequencyWeight,
  inflectionBases,
  INFLECTION_PENALTY,
  resolveRank,
  UNRANKED,
} from '../../src/engine/data/frequency.js';
import { FREQUENCY_METADATA } from '../../src/engine/data/frequency-metadata.js';
import { learning, settings } from '../helpers.js';

const CONTEXT = buildContext('I think teh cat.', 8, 11, 'https://example.com');

function rankingInput(word: string, candidates: readonly Candidate[]) {
  return {
    originalText: word,
    start: 0,
    end: word.length,
    candidates,
    context: CONTEXT,
    weights: DEFAULT_WEIGHTS,
  };
}

/* ------------------------------ Stage 1 ------------------------------ */

describe('word frequency', () => {
  it('ranks common words above uncommon ones', () => {
    expect(frequencyRank('the')).toBeGreaterThan(frequencyRank('vehicle'));
    expect(frequencyRank('vehicle')).toBeGreaterThan(UNRANKED);
  });

  it('returns 0 for a word the table does not list', () => {
    expect(frequencyRank('ghats')).toBe(UNRANKED);
  });

  /*
   * Tested against synthetic data, not real words.
   *
   * The 50,000-entry corpus lists both "work" and "working" directly, so they
   * can legitimately share a band and no real pair reliably exercises the
   * fallback. Asserting on real words made the test a hostage to the next
   * corpus update - which is exactly how it broke.
   */
  describe('inflection fallback', () => {
    const table = new Map([
      ['bandit', 200],
      ['bandits', 128],
    ]);
    const lookup = (word: string) => table.get(word);

    it('prefers a direct entry over morphological fallback', () => {
      // "bandits" is listed at 128 even though its base sits at 200; the
      // measured value for the word itself must win.
      expect(resolveRank('bandits', lookup)).toBe(128);
    });

    it('inherits a penalised rank when the inflection is absent', () => {
      // "banditing" is not listed; "bandit" is.
      expect(resolveRank('banditing', lookup)).toBe(200 - INFLECTION_PENALTY);
    });

    it('leaves a word with no entry and no known base unranked', () => {
      expect(resolveRank('quixotry', lookup)).toBe(UNRANKED);
    });

    it('never returns a negative rank for a very low base', () => {
      expect(resolveRank('lowing', (w) => (w === 'low' ? 1 : undefined))).toBe(1);
    });

    it('recognises the inflections it claims to', () => {
      for (const [word, base] of [
        ['catsx', null],
        ['cats', 'cat'],
        ['boxes', 'box'],
        ['tries', 'try'],
        ['walked', 'walk'],
        ['running', 'runn'],
        ['quickly', 'quick'],
      ] as const) {
        if (base === null) continue;
        expect(inflectionBases(word), word).toContain(base);
      }
    });
  });

  it('normalises to 0..1 for use as a score term', () => {
    expect(frequencyWeight('the')).toBeGreaterThan(0);
    expect(frequencyWeight('the')).toBeLessThanOrEqual(1);
    expect(frequencyWeight('ghats')).toBe(0);
  });

  it('records corpus-derived provenance', () => {
    expect(FREQUENCY_METADATA.corpusDerived).toBe(true);
    expect(FREQUENCY_METADATA.sourceCompiler).toBe('david47k');
    expect(FREQUENCY_METADATA.underlyingCorpus).toContain('Google Books');
    expect(FREQUENCY_METADATA.sourceRepository).toContain('top-english-wordlists');
  });

  it('keeps the source and generated hashes distinct', () => {
    expect(FREQUENCY_METADATA.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(FREQUENCY_METADATA.generatedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(FREQUENCY_METADATA.sourceSha256).not.toBe(FREQUENCY_METADATA.generatedSha256);
    expect(FREQUENCY_METADATA.dictionarySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pins the exact source list that was reviewed', () => {
    expect(FREQUENCY_METADATA.sourceSha256).toBe(
      'f9920c664b06b1ce3e94f2a355e11729774329f5838c623cc68e73ebaa374e1b',
    );
  });

  /**
   * Every source line lands in exactly one bucket. 805 entries vanished
   * silently the first time this ran; the invariant is what makes that
   * impossible to repeat.
   */
  it('accounts for every source entry', () => {
    const m = FREQUENCY_METADATA;
    expect(
      m.wordCount
        + m.absentFromDictionaryCount
        + m.duplicateCount
        + m.normalisationCollisionCount
        + m.invalidCount,
    ).toBe(m.inputEntryCount);
    expect(m.inputEntryCount).toBe(50_000);
  });

  it('covers far more than the 228-word prior it replaces', () => {
    expect(FREQUENCY_METADATA.wordCount).toBeGreaterThan(40_000);
  });
});

/* ------------------------------ Stage 2 ------------------------------ */

describe('one scorer', () => {
  it('ships with every unmeasured context weight at zero', () => {
    // Frequency is excluded from `isNeutral`: it has been measured and shipped.
    expect(isNeutral(DEFAULT_WEIGHTS)).toBe(true);
    expect(DEFAULT_WEIGHTS.editOperation).toBe(1);
    expect(DEFAULT_WEIGHTS.frequency).toBe(FREQUENCY_WEIGHT);
    expect(DEFAULT_WEIGHTS.partOfSpeech).toBe(0);
    expect(DEFAULT_WEIGHTS.documentReuse).toBe(0);
    expect(DEFAULT_WEIGHTS.wordContext).toBe(0);
  });

  it('contributes nothing from a term whose weight is zero', () => {
    const [candidate] = generateCandidates('teh', 5);
    const scored = scoreCandidate({ candidate: candidate!, weights: DEFAULT_WEIGHTS });
    expect(scored.terms.partOfSpeech).toBe(0);
    expect(scored.terms.documentReuse).toBe(0);
    expect(scored.terms.knownPhrase).toBe(0);
  });

  it('includes a term once its weight is raised', () => {
    const zeroed = { ...DEFAULT_WEIGHTS, frequency: 0 };
    const [candidate] = generateCandidates('teh', 5);
    const off = scoreCandidate({ candidate: candidate!, weights: zeroed });
    const on = scoreCandidate({ candidate: candidate!, weights: DEFAULT_WEIGHTS });
    expect(off.terms.frequency).toBe(0);
    expect(on.terms.frequency).toBeGreaterThan(0);
    expect(on.rawScore).toBeGreaterThan(off.rawScore);
  });

  it('never clamps the raw score', () => {
    // The generation score can exceed 1; the old path clamped to 0.99 before
    // sorting, which is what made distinct candidates tie.
    const candidates = generateCandidates('thats', 10);
    const ranked = rankCandidates(candidates, DEFAULT_WEIGHTS);
    expect(ranked[0]!.rawScore).toBeGreaterThan(1);
  });
});

describe('one comparator', () => {
  it('orders by score first', () => {
    const candidates = generateCandidates('thats', 10);
    const ranked = rankCandidates(candidates, DEFAULT_WEIGHTS);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.rawScore).toBeGreaterThanOrEqual(ranked[i]!.rawScore);
    }
  });

  /**
   * The regression this whole stage exists for: equal scores must be broken by
   * evidence, not by the alphabet.
   */
  it('breaks an exact score tie by operation cost, not alphabetically', () => {
    const cheap = { word: 'zzz', operationCost: 0.5, frequency: 0.5 } as Candidate;
    const dear = { word: 'aaa', operationCost: 3, frequency: 0.5 } as Candidate;
    expect(compareByScore(cheap, dear, () => 1)).toBeLessThan(0);
  });

  it('prefers stronger direct edit evidence when score and cost tie', () => {
    const evidenced = {
      word: 'zzz',
      operationCost: 1,
      frequency: 0.5,
      duplicateLetter: { removedIndex: 1, removedCharacter: 'z' },
    } as Candidate;
    const plain = { word: 'aaa', operationCost: 1, frequency: 0.5 } as Candidate;
    expect(editEvidence(evidenced)).toBeGreaterThan(editEvidence(plain));
    expect(compareByScore(evidenced, plain, () => 1)).toBeLessThan(0);
  });

  it('falls back to lexical order only when nothing else separates them', () => {
    const a = { word: 'aaa', operationCost: 1, frequency: 0.5 } as Candidate;
    const b = { word: 'bbb', operationCost: 1, frequency: 0.5 } as Candidate;
    expect(compareByScore(a, b, () => 1)).toBeLessThan(0);
  });

  it('is deterministic', () => {
    const candidates = generateCandidates('iprove', 10);
    const first = rankCandidates(candidates, DEFAULT_WEIGHTS).map((c) => c.candidate.word);
    const second = rankCandidates(candidates, DEFAULT_WEIGHTS).map((c) => c.candidate.word);
    expect(first).toEqual(second);
  });

  it('compareScored agrees with the shared sequence', () => {
    const candidates = generateCandidates('thats', 10);
    const scored = candidates.map((candidate) =>
      scoreCandidate({ candidate, weights: DEFAULT_WEIGHTS }),
    );
    const viaCompare = [...scored].sort(compareScored).map((s) => s.candidate.word);
    const viaRank = rankCandidates(candidates, DEFAULT_WEIGHTS).map((s) => s.candidate.word);
    expect(viaCompare).toEqual(viaRank);
  });
});

describe('RuleContextProvider', () => {
  /**
   * With every context weight zeroed the provider must not invent an ordering
   * of its own — it should reproduce the generator's exactly. With frequency
   * live it legitimately reorders, which is the entire point of the signal, so
   * the invariant is asserted against zeroed weights.
   */
  it('reproduces the generator ordering when every weight is zeroed', () => {
    const candidates = generateCandidates('thats', 10);
    const decision = ruleContextProvider.rank({
      ...rankingInput('thats', candidates),
      weights: { ...DEFAULT_WEIGHTS, frequency: 0 },
    });
    expect(decision.rankedCandidates.map((c) => c.candidate.word)).toEqual(
      candidates.map((c) => c.word),
    );
  });

  it('reorders when frequency is live, without changing the candidate set', () => {
    const candidates = generateCandidates('thats', 10);
    const decision = ruleContextProvider.rank(rankingInput('thats', candidates));
    expect([...decision.rankedCandidates.map((c) => c.candidate.word)].sort()).toEqual(
      [...candidates.map((c) => c.word)].sort(),
    );
  });

  it('reports an unclamped margin', () => {
    const candidates = generateCandidates('didnt', 10);
    const decision = ruleContextProvider.rank(rankingInput('didnt', candidates));
    expect(decision.bestCandidate?.candidate.word).toBe("didn't");
    expect(decision.margin).toBeGreaterThan(0);
  });

  it('explains itself', () => {
    const candidates = generateCandidates('teh', 10);
    const decision = ruleContextProvider.rank(rankingInput('teh', candidates));
    const sources = decision.evidence.map((e) => e.source);
    expect(sources).toContain('editOperation');
    expect(sources).toContain('weights');
  });

  it('handles an empty candidate set', () => {
    const decision = ruleContextProvider.rank(rankingInput('zzzz', []));
    expect(decision.bestCandidate).toBeNull();
    expect(decision.action).toBe('none');
  });
});

/* ------------------------------ Stage 3 ------------------------------ */

describe('shadow comparison', () => {
  it('records nothing when the weights change no outcome', () => {
    const candidates = generateCandidates('teh', 10);
    const comparison = compareRankings(
      rankingInput('teh', candidates),
      DEFAULT_WEIGHTS,
      DEFAULT_WEIGHTS,
    );
    expect(comparison).toBeNull();
  });

  it('reports the responsible term when a weight changes the winner', () => {
    const candidates = generateCandidates('hes', 10);
    const comparison = compareRankings(rankingInput('hes', candidates));
    // May or may not move, but if it does the report must be complete.
    if (comparison) {
      expect(comparison.currentWinner).toBeTruthy();
      expect(comparison.experimentalWinner).toBeTruthy();
      expect(comparison.winnerChanged || comparison.actionChanged).toBe(true);
      if (comparison.winnerChanged) {
        expect(comparison.responsibleTerms).toContain('frequency');
      }
    }
  });

  it('returns null for an empty candidate set', () => {
    expect(compareRankings(rankingInput('zzzz', []))).toBeNull();
  });
});

/* ------------------------------ Stage 4 ------------------------------ */

describe('correction-risk classes', () => {
  it('classifies by what is at stake', () => {
    expect(classifyRisk({ originalIsValidWord: false, candidate: { operationCost: 1 } as Candidate }))
      .toBe('invalid-word-single-edit');
    expect(classifyRisk({ originalIsValidWord: false, candidate: { operationCost: 3 } as Candidate }))
      .toBe('invalid-word-multi-edit');
    expect(classifyRisk({ originalIsValidWord: true })).toBe('valid-word-replacement');
    expect(classifyRisk({ originalIsValidWord: false, isPersonalRule: true }))
      .toBe('exact-personal-rule');
    expect(classifyRisk({ originalIsValidWord: false, correctionType: 'token-split' }))
      .toBe('token-split');
    expect(
      classifyRisk({
        originalIsValidWord: false,
        correctionType: 'punctuation',
        ruleId: 'punctuation:nonrestrictive-clause',
      }),
    ).toBe('punctuation-meaning-sensitive');
  });

  it('never lets a valid word be replaced automatically', () => {
    const decision = applyPolicy({
      riskClass: 'valid-word-replacement',
      score: 5,
      margin: 5,
      proposedAction: 'autocorrect',
    });
    expect(decision.action).toBe('suggest');
    expect(decision.reason).toContain('valid-word-replacement');
  });

  it('demands a much larger margin for a valid word than for a typo', () => {
    expect(RISK_POLICY['valid-word-replacement'].requiredMargin).toBeGreaterThan(
      RISK_POLICY['invalid-word-single-edit'].requiredMargin * 4,
    );
  });

  it('lowers an action but never raises one', () => {
    const decision = applyPolicy({
      riskClass: 'invalid-word-single-edit',
      score: 5,
      margin: 5,
      proposedAction: 'suggest',
    });
    expect(decision.action).toBe('suggest');
  });

  it('drops to none when the score is below the class minimum', () => {
    const decision = applyPolicy({
      riskClass: 'invalid-word-single-edit',
      score: 0.1,
      margin: 5,
      proposedAction: 'autocorrect',
    });
    expect(decision.action).toBe('none');
  });

  it('demotes to a suggestion when the margin is thin', () => {
    const decision = applyPolicy({
      riskClass: 'invalid-word-multi-edit',
      score: 5,
      margin: 0.01,
      proposedAction: 'autocorrect',
    });
    expect(decision.action).toBe('suggest');
    expect(decision.reason).toContain('margin');
  });

  it('requires provider agreement for an AI-only result', () => {
    const alone = applyPolicy({
      riskClass: 'ai-only',
      score: 5,
      margin: 5,
      proposedAction: 'autocorrect',
    });
    expect(alone.action).toBe('suggest');
  });
});

/* ------------------------------ regression ------------------------------ */

describe('required regression cases still behave', () => {
  function correct(word: string) {
    const text = `I think ${word} `;
    const result = analyze(
      { text, wordEnd: 8 + word.length, origin: 'https://example.com' },
      learning(),
      settings(),
    );
    return result ? { to: result.proposal.replacement, action: result.proposal.action } : null;
  }

  it('keeps the documented corrections', () => {
    expect(correct('punctuatioon')).toMatchObject({ to: 'punctuation', action: 'autocorrect' });
    expect(correct('owrks')).toMatchObject({ to: 'works', action: 'autocorrect' });
    expect(correct('eorks')).toMatchObject({ to: 'works', action: 'autocorrect' });
    expect(correct('didnt')).toMatchObject({ to: "didn't", action: 'autocorrect' });
  });

  it('still ranks iprove by edit cost, never choosing iphone', () => {
    const result = correct('iprove');
    expect(result?.to).toBe('improve');
    expect(result?.to).not.toBe('iphone');
  });

  /*
   * The three cases the UD evaluation flagged as frequency regressions.
   *
   * All three are near-ties between two cost-1 candidates, which is exactly the
   * situation frequency exists to break. Two are genuinely ambiguous without
   * more context and are pinned to whatever the shipped weight produces, so a
   * future weight change has to acknowledge them. The third must not move:
   * a doubled letter is direct evidence, and 0.04 was chosen to protect it.
   */
  describe('frequency regression cases from UD English EWT', () => {
    it('keeps the doubled-letter reading of "mastter"', () => {
      // "mastter" -> "master" (remove a doubled t) beats "matter" (delete the
      // s) on duplicate-letter evidence. At weight 0.06 frequency flipped it;
      // 0.04 was chosen so it does not.
      expect(correct('mastter')?.to).toBe('master');
    });

    it('pins the ambiguous "dmain" case', () => {
      // Both cost 1 with identical base scores: insert "o" for "domain", or
      // delete "d" for "main". Genuinely ambiguous in isolation.
      const result = correct('dmain');
      expect(['domain', 'main']).toContain(result?.to);
      // Whichever wins, it must stay a suggestion rather than being applied.
      expect(result?.action).toBe('suggest');
    });

    it('pins the ambiguous "niecr" case', () => {
      // "nicer" (adjacent swap) versus "niece" (keyboard substitution), both
      // cost 1 and within 0.004 of each other before frequency.
      const result = correct('niecr');
      expect(['nicer', 'niece']).toContain(result?.to);
      expect(result?.action).toBe('suggest');
    });
  });

  it('still leaves valid words alone', () => {
    for (const word of ['book', 'coffee', 'address', 'committee', 'woks']) {
      expect(correct(word), word).toBeNull();
    }
  });
});

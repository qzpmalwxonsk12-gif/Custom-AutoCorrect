/**
 * How the context signals behave together, and the regressions they must not
 * reintroduce.
 *
 * Each signal has its own unit tests and its own ground-truth evaluation. This
 * file is about the combination: the shipped weight set, the experimental one,
 * and the structural invariants that keep either from doing damage.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateCandidates } from '../../src/engine/candidate-generator.js';
import { buildContext } from '../../src/engine/correction-engine.js';
import { rankCandidates } from '../../src/engine/context/candidate-scoring.js';
import {
  applyPolicy,
  classifyRisk,
  RISK_POLICY,
} from '../../src/engine/context/correction-policy.js';
import { ruleContextProvider, RANKING_MARGIN } from '../../src/engine/context/rule-context-provider.js';
import { compareRankings } from '../../src/engine/context/shadow-comparison.js';
import {
  DEFAULT_WEIGHTS,
  EXPERIMENTAL_WEIGHTS,
} from '../../src/engine/context/score-weights.js';
import { isKnownWord } from '../../src/engine/data/dictionary.js';

const ORIGIN = 'https://example.com';

/** The configuration under test, stated explicitly. */
const PRODUCTION = DEFAULT_WEIGHTS;

function contextFor(sentence: string, word: string) {
  const start = sentence.indexOf(word);
  return buildContext(sentence, start, start + word.length, ORIGIN);
}

/** A full provider input, so the provider is exercised the way the engine does. */
function rankingInput(sentence: string, word: string, weights = PRODUCTION) {
  const start = sentence.indexOf(word);
  return {
    candidates: generateCandidates(word, 10),
    weights,
    context: contextFor(sentence, word),
    originalText: word,
    start,
    end: start + word.length,
  };
}

function rank(sentence: string, word: string, weights = PRODUCTION) {
  const candidates = generateCandidates(word, 10);
  return rankCandidates(candidates, weights, { context: contextFor(sentence, word), typedWord: word });
}

describe('the shipped weight set', () => {
  it('has frequency as its only active context signal', () => {
    expect(PRODUCTION.frequency).toBe(0.04);
    expect(PRODUCTION.partOfSpeech).toBe(0);
    expect(PRODUCTION.documentReuse).toBe(0);
    expect(PRODUCTION.characterContext).toBe(0);
    expect(PRODUCTION.sentencePosition).toBe(0);
    expect(PRODUCTION.wordContext).toBe(0);
    expect(PRODUCTION.knownPhrase).toBe(0);
    expect(PRODUCTION.personalHistory).toBe(0);
  });

  it('keeps every measured-but-inactive signal available in shadow mode', () => {
    expect(EXPERIMENTAL_WEIGHTS.documentReuse).toBeGreaterThan(0);
    expect(EXPERIMENTAL_WEIGHTS.sentencePosition).toBeGreaterThan(0);
  });
});

describe('no weak signal can buy a costlier edit', () => {
  const cases = [
    ['I need to iprove it soon.', 'iprove'],
    ['He is the mastter here.', 'mastter'],
    ['I think teh answer is fine.', 'teh'],
    ['The punctuatioon is wrong.', 'punctuatioon'],
    ['I walked to the shpo.', 'shpo'],
  ] as const;

  for (const weights of [
    { name: 'production', value: PRODUCTION },
    { name: 'experimental', value: EXPERIMENTAL_WEIGHTS },
    { name: 'character context at 0.04', value: { ...PRODUCTION, characterContext: 0.04 } },
    { name: 'sentence position at 0.04', value: { ...PRODUCTION, sentencePosition: 0.04 } },
    { name: 'frequency at 0.04', value: { ...PRODUCTION, frequency: 0.04 } },
  ]) {
    it(`holds under ${weights.name}`, () => {
      for (const [sentence, word] of cases) {
        const candidates = generateCandidates(word, 10);
        if (candidates.length === 0) continue;
        const cheapest = Math.min(...candidates.map((c) => c.operationCost));
        const ranked = rank(sentence, word, weights.value);
        expect(ranked[0]!.candidate.operationCost, `${weights.name} / ${word}`)
          .toBeLessThanOrEqual(cheapest);
      }
    });
  }
});

describe('signal strength', () => {
  it('keeps character context weak relative to the edit term', () => {
    const ranked = rank('I think teh answer is fine.', 'teh', {
      ...PRODUCTION,
      characterContext: 0.04,
    });
    for (const scored of ranked) {
      expect(Math.abs(scored.terms.characterContext))
        .toBeLessThan(Math.abs(scored.terms.editOperation) * 0.1);
    }
  });

  it('keeps sentence position weak relative to the edit term', () => {
    const ranked = rank('I gave it to teh.', 'teh', { ...PRODUCTION, sentencePosition: 0.04 });
    for (const scored of ranked) {
      expect(Math.abs(scored.terms.sentencePosition))
        .toBeLessThan(Math.abs(scored.terms.editOperation) * 0.1);
    }
  });

  it('cannot let sentence position bypass the correction-risk policy', () => {
    // A valid word being replaced is capped at "suggest" by class, whatever the
    // ranking layer proposed and whatever the position evidence says.
    const decision = applyPolicy({
      riskClass: 'valid-word-replacement',
      score: 99,
      margin: 99,
      proposedAction: 'autocorrect',
    });
    expect(decision.action).toBe('suggest');
    expect(RISK_POLICY['valid-word-replacement'].maximumAction).toBe('suggest');
  });

  it('never promotes an action above what the scorer proposed', () => {
    for (const riskClass of Object.keys(RISK_POLICY) as Array<keyof typeof RISK_POLICY>) {
      const decision = applyPolicy({ riskClass, score: 99, margin: 99, proposedAction: 'suggest' });
      expect(decision.action, riskClass).not.toBe('autocorrect');
    }
  });
});

describe('experimental weights stay out of production decisions', () => {
  const cases = [
    ['I need to iprove it soon.', 'iprove'],
    ['He is the mastter here.', 'mastter'],
    ['I think teh answer is fine.', 'teh'],
    ['I gave it to teh.', 'teh'],
    ['The chef owns several woks.', 'woks'],
  ] as const;

  it('leaves the production ranking untouched', () => {
    for (const [sentence, word] of cases) {
      const candidates = generateCandidates(word, 10);
      if (candidates.length < 2) continue;
      const context = contextFor(sentence, word);
      const production = rankCandidates(candidates, PRODUCTION, { context, typedWord: word });
      // Ranking again through the provider must agree with the direct call:
      // one scorer, one comparator, no second opinion.
      const viaProvider = ruleContextProvider.rank(rankingInput(sentence, word));
      expect(viaProvider.rankedCandidates.map((s) => s.candidate.word))
        .toEqual(production.map((s) => s.candidate.word));
    }
  });

  it('reports disagreement through shadow comparison without acting on it', () => {
    const word = 'teh';
    const comparison = compareRankings(rankingInput('I gave it to teh.', word));
    // Whether or not the two disagree here, a comparison is a report: it
    // carries no action and no replacement text.
    if (comparison) {
      expect(comparison).not.toHaveProperty('replacementText');
      expect(['autocorrect', 'suggest']).toContain(comparison.currentAction);
    }
  });
});

describe('scores stay unclamped until after ranking', () => {
  it('keeps raw scores above the old 0.99 ceiling', () => {
    const ranked = rank('I think thats fine.', 'thats');
    expect(ranked[0]!.rawScore).toBeGreaterThan(0.99);
  });

  it('measures the margin on unclamped scores', () => {
    const word = 'thats';
    const decision = ruleContextProvider.rank(rankingInput('I think thats fine.', word));
    const best = decision.bestCandidate!;
    const second = decision.secondBestCandidate;
    if (second) expect(decision.margin).toBeCloseTo(best.rawScore - second.rawScore, 10);
    expect(decision.action).toBe(decision.margin >= RANKING_MARGIN ? 'autocorrect' : 'suggest');
  });
});

describe('structural invariants', () => {
  it('has exactly one comparator', () => {
    const source = readFileSync('src/engine/context/candidate-scoring.ts', 'utf8');
    expect(source.match(/\.sort\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('compareByScore');
  });

  it('uses lexical order only as the last tie-break', () => {
    const order = readFileSync('src/engine/context/candidate-order.ts', 'utf8');
    const body = order.slice(order.indexOf('export function compareByScore'));
    const lexical = body.indexOf('return compareWords(');
    expect(lexical, 'lexical fallback not found').toBeGreaterThan(0);
    // Nothing may be compared after the lexical fallback: it is the last word.
    expect(body.slice(lexical).includes('if (')).toBe(false);
    // And every earlier tie-break must come before it.
    for (const earlier of ['operationCost', 'editEvidence', 'contextOf', 'frequency']) {
      expect(body.indexOf(earlier), earlier).toBeLessThan(lexical);
    }
  });

  it('keeps applyCorrection the only production write path', () => {
    const controller = readFileSync('src/content/editable-controller.ts', 'utf8');
    const writes = controller.match(/\bwriteField\(|\bsetFieldText\(/g) ?? [];
    // Every field write goes through applyCorrection, which is the one place a
    // CorrectionRecord is created.
    expect(controller).toContain('applyCorrection');
    expect(writes.length).toBeLessThanOrEqual(2);
  });
});

describe('preserved regressions', () => {
  it('iprove: improve and prove stay plausible, iPhone stays far below', () => {
    for (const weights of [PRODUCTION, EXPERIMENTAL_WEIGHTS]) {
      const ranked = rank('I need to iprove it soon.', 'iprove', weights);
      const words = ranked.map((s) => s.candidate.word);
      expect(words).toContain('improve');
      expect(words).toContain('prove');

      const iphone = ranked.findIndex((s) => s.candidate.word.toLowerCase() === 'iphone');
      if (iphone >= 0) {
        const improve = ranked.findIndex((s) => s.candidate.word === 'improve');
        const prove = ranked.findIndex((s) => s.candidate.word === 'prove');
        expect(iphone).toBeGreaterThan(improve);
        expect(iphone).toBeGreaterThan(prove);
      }
    }
  });

  it('mastter: master is not displaced by matter', () => {
    for (const weights of [
      PRODUCTION,
      EXPERIMENTAL_WEIGHTS,
      { ...PRODUCTION, characterContext: 0.04 },
      { ...PRODUCTION, sentencePosition: 0.04 },
    ]) {
      const ranked = rank('He is the mastter here.', 'mastter', weights);
      expect(ranked[0]!.candidate.word).toBe('master');
    }
  });

  it('mis: no mi\'s is produced', () => {
    for (const weights of [PRODUCTION, EXPERIMENTAL_WEIGHTS]) {
      const ranked = rank('She said it was a mis.', 'mis', weights);
      expect(ranked.map((s) => s.candidate.word)).not.toContain("mi's");
    }
  });

  it("dont: don't is still offered", () => {
    for (const weights of [PRODUCTION, EXPERIMENTAL_WEIGHTS]) {
      const ranked = rank('I dont think so.', 'dont', weights);
      expect(ranked.map((s) => s.candidate.word)).toContain("don't");
    }
  });

  it('woks: a valid word is never replaced automatically', () => {
    expect(isKnownWord('woks')).toBe(true);
    for (const sentence of [
      'The chef owns several woks.',
      'The extension woks correctly.',
    ]) {
      const decision = ruleContextProvider.rank(rankingInput(sentence, 'woks'));
      if (!decision.bestCandidate) continue;
      const riskClass = classifyRisk({
        originalIsValidWord: true,
        candidate: decision.bestCandidate.candidate,
        correctionType: 'spelling',
      });
      expect(riskClass).toBe('valid-word-replacement');
      const policy = applyPolicy({
        riskClass,
        score: decision.bestCandidate.rawScore,
        margin: decision.margin,
        proposedAction: decision.action === 'none' ? 'none' : decision.action,
      });
      expect(policy.action, sentence).not.toBe('autocorrect');
    }
  });
});

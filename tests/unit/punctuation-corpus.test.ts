/**
 * Corpus evaluation: measures the lane's precision on the fixture corpus and
 * asserts the precision targets. This is the test that decides whether a rule
 * is allowed to be automatic.
 */
import { describe, expect, it } from 'vitest';
import { EssentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { DEFAULT_PUNCTUATION_SETTINGS } from '../../src/engine/punctuation/punctuation-config.js';
import type { PunctuationIssue } from '../../src/engine/punctuation/punctuation-types.js';
import { NEGATIVE_CASES, POSITIVE_CASES } from '../fixtures/punctuation-corpus.js';

const provider = new EssentialPunctuationProvider();

/** Applies issues right-to-left so earlier offsets stay valid. */
export function applyIssues(text: string, issues: PunctuationIssue[]): string {
  let out = text;
  for (const issue of [...issues].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, issue.start) + issue.replacementText + out.slice(issue.end);
  }
  return out;
}

function analyse(text: string, overrides: Partial<typeof DEFAULT_PUNCTUATION_SETTINGS> = {}) {
  return provider.analyse(text, {
    settings: { ...DEFAULT_PUNCTUATION_SETTINGS, ...overrides },
  }) as PunctuationIssue[];
}

/** Issues that would be written into the text without asking. */
function automatic(issues: PunctuationIssue[]): PunctuationIssue[] {
  return issues.filter((i) => i.action === 'automatic');
}

describe('positive corpus', () => {
  it('has the required breadth', () => {
    expect(POSITIVE_CASES.length).toBeGreaterThanOrEqual(70);
  });

  for (const testCase of POSITIVE_CASES) {
    it(`corrects: ${testCase.input}`, () => {
      const issues = analyse(testCase.input);
      const applied = applyIssues(testCase.input, issues);
      expect(applied).toBe(testCase.expected);
      expect(issues.some((i) => i.ruleId === testCase.rule)).toBe(true);
    });
  }
});

describe('negative corpus', () => {
  it('has the required breadth', () => {
    expect(NEGATIVE_CASES.length).toBeGreaterThanOrEqual(100);
  });

  for (const testCase of NEGATIVE_CASES) {
    it(`leaves alone (${testCase.why}): ${testCase.input}`, () => {
      const issues = analyse(testCase.input);
      expect(applyIssues(testCase.input, issues)).toBe(testCase.input);
    });
  }
});

describe('measured precision', () => {
  it('reports per-rule precision and meets the automatic target', () => {
    let truePositives = 0;
    let falseNegatives = 0;
    const perRule = new Map<string, { tp: number; fn: number }>();

    for (const testCase of POSITIVE_CASES) {
      const issues = analyse(testCase.input);
      const correct = applyIssues(testCase.input, issues) === testCase.expected;
      const entry = perRule.get(testCase.rule) ?? { tp: 0, fn: 0 };
      if (correct) {
        truePositives++;
        entry.tp++;
      } else {
        falseNegatives++;
        entry.fn++;
      }
      perRule.set(testCase.rule, entry);
    }

    // A false positive is any change at all to a negative case.
    let falsePositives = 0;
    const fpExamples: string[] = [];
    for (const testCase of NEGATIVE_CASES) {
      const issues = analyse(testCase.input);
      if (applyIssues(testCase.input, issues) !== testCase.input) {
        falsePositives++;
        fpExamples.push(`${testCase.input} :: ${issues.map((i) => i.ruleId).join(',')}`);
      }
    }

    const precision = truePositives / (truePositives + falsePositives || 1);
    const recall = truePositives / (truePositives + falseNegatives || 1);
    // Printed so the numbers in the docs are reproducible, not asserted prose.
    console.info(
      `[punctuation] corpus: TP=${truePositives} FP=${falsePositives} FN=${falseNegatives} ` +
        `precision=${(precision * 100).toFixed(1)}% recall=${(recall * 100).toFixed(1)}%`,
    );
    for (const [rule, stats] of perRule) {
      console.info(`[punctuation]   ${rule}: ${stats.tp} correct, ${stats.fn} missed`);
    }
    if (fpExamples.length > 0) console.info('[punctuation] false positives:', fpExamples);

    expect(falsePositives).toBe(0);
    expect(precision).toBeGreaterThanOrEqual(0.99);
  });

  it('never emits an automatic action on any negative case', () => {
    for (const testCase of NEGATIVE_CASES) {
      const issues = analyse(testCase.input, { nonrestrictiveClause: true });
      expect(
        automatic(issues),
        `${testCase.input} (${testCase.why})`,
      ).toHaveLength(0);
    }
  });
});

describe('P101 is never automatic', () => {
  const cases = [
    'My brother who lives in London is a doctor.',
    'My only brother who lives in London is a doctor.',
    'My sister who lives in London called me.',
  ];

  for (const input of cases) {
    it(`stays a suggestion: ${input}`, () => {
      const issues = analyse(input, {
        nonrestrictiveClause: true,
        // Even with the thresholds forced to zero it must not auto-apply.
        automaticThreshold: 0,
        suggestionThreshold: 0,
      });
      const nonrestrictive = issues.filter(
        (i) => i.ruleId === 'punctuation:nonrestrictive-clause',
      );
      for (const issue of nonrestrictive) expect(issue.action).toBe('suggestion');
      expect(automatic(issues)).toHaveLength(0);
    });
  }

  it('is off by default', () => {
    const issues = analyse('My brother who lives in London is a doctor.');
    expect(issues.filter((i) => i.ruleId === 'punctuation:nonrestrictive-clause')).toHaveLength(0);
  });
});

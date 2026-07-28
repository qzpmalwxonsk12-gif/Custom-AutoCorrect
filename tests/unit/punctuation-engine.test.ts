/**
 * Component tests for the punctuation lane: tokenizer, classifier, clause
 * detector, rule framework, overlap resolver and provider behaviour.
 * Rule-level accuracy is measured separately in punctuation-corpus.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { analyseClause, looksLikeSharedContinuation, nounPhraseStart } from '../../src/engine/context/clause-detector.js';
import {
  claimedSpans,
  punctuationIssueKey,
  resolveHarperOverlaps,
  resolveInternalOverlaps,
} from '../../src/engine/punctuation/overlap-resolver.js';
import { DEFAULT_PUNCTUATION_SETTINGS, PUNCTUATION_THRESHOLDS } from '../../src/engine/punctuation/punctuation-config.js';
import {
  EssentialPunctuationProvider,
  ESSENTIAL_PUNCTUATION_RULES,
} from '../../src/engine/punctuation/punctuation-provider.js';
import { analyseSentences, splitSentences } from '../../src/engine/punctuation/punctuation-tokenizer.js';
import { alreadyPunctuated, decideAction, insideQuotes, sentenceIsAnalysable } from '../../src/engine/punctuation/rule-runner.js';
import { classifyTokens } from '../../src/engine/context/token-classifier.js';
import { isPunctuationRuleId, type PunctuationIssue } from '../../src/engine/punctuation/punctuation-types.js';

const provider = new EssentialPunctuationProvider();

function analyse(text: string, overrides: Partial<typeof DEFAULT_PUNCTUATION_SETTINGS> = {}) {
  return provider.analyse(text, {
    settings: { ...DEFAULT_PUNCTUATION_SETTINGS, ...overrides },
  }) as PunctuationIssue[];
}

function tokensOf(text: string) {
  const sentence = analyseSentences(text)[0]!;
  classifyTokens(sentence.tokens);
  return sentence;
}

describe('sentence splitting', () => {
  it('splits on terminal punctuation', () => {
    const text = 'One thing happened. Two things followed! Three?';
    expect(splitSentences(text)).toHaveLength(3);
  });

  it('does not split on abbreviations or initials', () => {
    expect(splitSentences('Dr. Smith arrived on time today.')).toHaveLength(1);
    expect(splitSentences('We met J. Smith at the office.')).toHaveLength(1);
    expect(splitSentences('Use e.g. this option for now.')).toHaveLength(1);
    expect(splitSentences('See No. 12 for details.')).toHaveLength(1);
  });

  it('distinguishes the ordinary lowercase word "no" from the abbreviation "No."', () => {
    expect(splitSentences('The answer was no. Another question followed.')).toHaveLength(2);
  });

  it('does not split inside decimals or versions', () => {
    expect(splitSentences('The value 3.5 was too high.')).toHaveLength(1);
  });

  it('splits on newlines', () => {
    expect(splitSentences('First line here\nSecond line here')).toHaveLength(2);
  });

  it('keeps a closing quote with its sentence', () => {
    const sentences = splitSentences('He said "stop." Then he left.');
    expect(sentences).toHaveLength(2);
  });
});

describe('token classification', () => {
  it('identifies subjects, finite verbs and coordinators', () => {
    const sentence = tokensOf('The build finished and it passed.');
    const byText = new Map(sentence.tokens.map((t) => [t.normalised, t]));
    expect(byText.get('the')?.type).toBe('determiner');
    expect(byText.get('finished')?.isFiniteVerb).toBe(true);
    expect(byText.get('and')?.isCoordinator).toBe(true);
    expect(byText.get('it')?.isSubjectCandidate).toBe(true);
  });

  it('treats a word after a copula as a complement, not a verb', () => {
    const sentence = tokensOf('The flag was red today.');
    const red = sentence.tokens.find((t) => t.normalised === 'red')!;
    expect(red.type).not.toBe('verb');
  });

  it('treats a word after a modal as a verb', () => {
    const sentence = tokensOf('We can wait here now.');
    const wait = sentence.tokens.find((t) => t.normalised === 'wait')!;
    expect(wait.type).toBe('verb');
  });

  it('marks a gerund as non-finite', () => {
    const sentence = tokensOf('Running water is useful here.');
    const running = sentence.tokens.find((t) => t.normalised === 'running')!;
    expect(running.isGerundOrParticiple).toBe(true);
    expect(running.isFiniteVerb).toBe(false);
  });

  it('flags protected tokens', () => {
    const sentence = tokensOf('Go to https://example.com/x now please.');
    expect(sentence.hasProtectedContent).toBe(true);
  });

  it('recognises address terms and proper nouns', () => {
    const sentence = tokensOf('Please tell Sarah about it.');
    const sarah = sentence.tokens.find((t) => t.normalised === 'sarah')!;
    expect(sarah.type).toBe('proper-noun');
    expect(sarah.isAddressTerm).toBe(true);
  });
});

describe('clause analysis', () => {
  it('detects a complete independent clause', () => {
    const sentence = tokensOf('The server crashed today.');
    const clause = analyseClause(sentence.tokens, 0, sentence.tokens.length);
    expect(clause.isIndependent).toBe(true);
    expect(clause.hasSubject).toBe(true);
    expect(clause.hasFiniteVerb).toBe(true);
  });

  it('detects a dependent clause behind a subordinator', () => {
    const sentence = tokensOf('Although it was raining we continued.');
    const clause = analyseClause(sentence.tokens, 0, 4);
    expect(clause.isDependent).toBe(true);
    expect(clause.isIndependent).toBe(false);
  });

  it('picks the nearest subject before the verb, not the first candidate', () => {
    // "the" inside the object phrase must not be read as the subject of "went".
    const sentence = tokensOf('After finishing the report I went home.');
    const clause = analyseClause(sentence.tokens, 2, sentence.tokens.length);
    const subject = sentence.tokens[clause.subjectToken!]!;
    expect(subject.normalised).toBe('i');
  });

  it('reports no clause for a bare complement', () => {
    const sentence = tokensOf('I was tired but determined.');
    const right = analyseClause(sentence.tokens, 4, sentence.tokens.length);
    expect(right.isIndependent).toBe(false);
  });

  it('recognises a bare complement after a coordinator', () => {
    const sentence = tokensOf('I was tired but determined.');
    const coordinator = sentence.tokens.findIndex((t) => t.isCoordinator);
    expect(
      looksLikeSharedContinuation(sentence.tokens, coordinator + 1, sentence.tokens.length),
    ).toBe(true);
  });

  it('finds no subject in a shared-subject continuation', () => {
    // "and tested the extension" has a verb but no subject of its own.
    const sentence = tokensOf('I opened and tested the extension.');
    const coordinator = sentence.tokens.findIndex((t) => t.isCoordinator);
    const right = analyseClause(sentence.tokens, coordinator + 1, sentence.tokens.length);
    expect(right.hasSubject).toBe(false);
    expect(right.isIndependent).toBe(false);
  });

  it('extends a subject head to the start of its noun phrase', () => {
    const sentence = tokensOf('Unless the tests pass the build fails.');
    const buildIndex = sentence.tokens.findIndex((t) => t.normalised === 'build');
    expect(nounPhraseStart(sentence.tokens, buildIndex)).toBe(buildIndex - 1);
  });
});

describe('rule framework', () => {
  it('maps confidence onto actions using the thresholds', () => {
    const s = DEFAULT_PUNCTUATION_SETTINGS;
    expect(decideAction(0.99, 'automatic', s)).toBe('automatic');
    expect(decideAction(0.8, 'automatic', s)).toBe('suggestion');
    expect(decideAction(0.5, 'automatic', s)).toBe('none');
    expect(decideAction(0.99, 'suggestion', s)).toBe('suggestion');
  });

  it('downgrades everything to suggestion when automatic mode is off', () => {
    expect(decideAction(0.99, 'automatic', { ...DEFAULT_PUNCTUATION_SETTINGS, automatic: false }))
      .toBe('suggestion');
  });

  it('refuses fragments and protected content', () => {
    expect(sentenceIsAnalysable(analyseSentences('# Heading')[0]!)).toBe(false);
    expect(sentenceIsAnalysable(analyseSentences('ok')[0]!)).toBe(false);
    expect(sentenceIsAnalysable(analyseSentences('Visit https://x.com/a now.')[0]!)).toBe(false);
  });

  it('detects existing punctuation at a boundary', () => {
    expect(alreadyPunctuated('report, I went', 6)).toBe(true);
    expect(alreadyPunctuated('report I went', 6)).toBe(false);
  });

  it('detects offsets inside quotes', () => {
    const sentence = analyseSentences('He said "after I left he called" quietly.')[0]!;
    const inside = sentence.text.indexOf('left') + sentence.start;
    expect(insideQuotes(sentence, inside)).toBe(true);
  });

  it('every rule has a stable id, priority and explanation path', () => {
    for (const rule of ESSENTIAL_PUNCTUATION_RULES) {
      expect(rule.id.startsWith('punctuation:')).toBe(true);
      expect(isPunctuationRuleId(rule.id)).toBe(true);
      expect(rule.priority).toBeGreaterThan(0);
      expect(['automatic', 'suggestion']).toContain(rule.defaultAction);
      expect(rule.antiPatterns?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('issue shape', () => {
  it('normalises an insertion into a non-empty replacement span', () => {
    const [issue] = analyse('Although it was raining we continued.');
    expect(issue).toBeDefined();
    expect(issue!.originalText.length).toBeGreaterThan(0);
    expect(issue!.replacementText.length).toBeGreaterThan(issue!.originalText.length);
    expect(issue!.replacementText.startsWith(issue!.originalText)).toBe(true);
    expect(issue!.category).toBe('punctuation');
    expect(issue!.evidence.length).toBeGreaterThan(0);
    expect(issue!.explanation.length).toBeGreaterThan(10);
  });

  it('produces offsets that map back to the original text', () => {
    const text = 'Although it was raining we continued.';
    const [issue] = analyse(text);
    expect(text.slice(issue!.start, issue!.end)).toBe(issue!.originalText);
  });

  it('reaches the automatic band only above the configured threshold', () => {
    const issues = analyse('Although it was raining we continued.');
    for (const issue of issues) {
      if (issue.action === 'automatic') {
        expect(issue.confidence).toBeGreaterThanOrEqual(PUNCTUATION_THRESHOLDS.automatic);
      }
    }
  });
});

describe('settings gating', () => {
  it('produces nothing when the engine is disabled', () => {
    expect(analyse('Although it was raining we continued.', { enabled: false })).toHaveLength(0);
  });

  it('honours per-rule switches', () => {
    expect(analyse('I was tired but I kept working.', { independentClause: false })).toHaveLength(0);
    expect(analyse('Thanks Arjun.', { directAddress: false })).toHaveLength(0);
    expect(analyse('I bought apples oranges bananas and grapes.', { simpleList: false })).toHaveLength(0);
    expect(analyse('Although it was raining we continued.', { introductoryClause: false })).toHaveLength(0);
  });

  it('drops the serial comma when the Oxford setting is off', () => {
    const issues = analyse('I bought apples oranges bananas and grapes.', { oxfordComma: false });
    let applied = 'I bought apples oranges bananas and grapes.';
    for (const issue of [...issues].sort((a, b) => b.start - a.start)) {
      applied = applied.slice(0, issue.start) + issue.replacementText + applied.slice(issue.end);
    }
    expect(applied).toBe('I bought apples, oranges, bananas and grapes.');
  });
});

describe('rule statistics feedback', () => {
  const text = 'Although it was raining we continued.';

  it('demotes an automatic rule the user keeps reverting', () => {
    const issues = provider.analyse(text, {
      settings: DEFAULT_PUNCTUATION_SETTINGS,
      stats: {
        'punctuation:introductory-clause': {
          ruleId: 'punctuation:introductory-clause',
          shown: 5,
          accepted: 0,
          rejected: 0,
          reverted: 3,
          ignoredInContext: 0,
        },
      },
    }) as PunctuationIssue[];
    expect(issues[0]?.action).toBe('suggestion');
    expect(issues[0]?.evidence.join(' ')).toContain('demoted');
  });

  it('stops offering a rule that is only ever rejected', () => {
    const issues = provider.analyse(text, {
      settings: DEFAULT_PUNCTUATION_SETTINGS,
      stats: {
        'punctuation:introductory-clause': {
          ruleId: 'punctuation:introductory-clause',
          shown: 9,
          accepted: 0,
          rejected: 7,
          reverted: 0,
          ignoredInContext: 0,
        },
      },
    }) as PunctuationIssue[];
    expect(issues).toHaveLength(0);
  });

  it('keeps applying a rule the user accepts', () => {
    const issues = provider.analyse(text, {
      settings: DEFAULT_PUNCTUATION_SETTINGS,
      stats: {
        'punctuation:introductory-clause': {
          ruleId: 'punctuation:introductory-clause',
          shown: 20,
          accepted: 18,
          rejected: 1,
          reverted: 1,
          ignoredInContext: 0,
        },
      },
    }) as PunctuationIssue[];
    expect(issues[0]?.action).toBe('automatic');
  });
});

describe('overlap resolution', () => {
  const issue = (over: Partial<PunctuationIssue>): PunctuationIssue => ({
    id: 'x',
    ruleId: 'punctuation:introductory-clause',
    category: 'punctuation',
    start: 0,
    end: 5,
    originalText: 'hello',
    replacementText: 'hello,',
    confidence: 0.9,
    action: 'automatic',
    priority: 50,
    message: 'm',
    explanation: 'e',
    evidence: [],
    ...over,
  });

  it('keeps one issue per overlapping cluster, preferring priority', () => {
    const kept = resolveInternalOverlaps([
      issue({ id: 'a', priority: 50 }),
      issue({ id: 'b', priority: 98 }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('b');
  });

  it('breaks priority ties on confidence, then on span size', () => {
    const byConfidence = resolveInternalOverlaps([
      issue({ id: 'a', confidence: 0.8 }),
      issue({ id: 'b', confidence: 0.95 }),
    ]);
    expect(byConfidence[0]!.id).toBe('b');

    const bySpan = resolveInternalOverlaps([
      issue({ id: 'a', start: 0, end: 9 }),
      issue({ id: 'b', start: 0, end: 5 }),
    ]);
    expect(bySpan[0]!.id).toBe('b');
  });

  it('keeps non-overlapping issues from the same rule', () => {
    const kept = resolveInternalOverlaps([
      issue({ id: 'a', start: 0, end: 5 }),
      issue({ id: 'b', start: 10, end: 15 }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('records Harper agreement without dropping our finding', () => {
    const ours = [issue({ id: 'a', start: 4, end: 9 })];
    const { issues, agreedRuleIds } = resolveHarperOverlaps(ours, [
      { start: 4, end: 9, replacement: 'hello,' },
    ]);
    expect(issues).toHaveLength(1);
    expect(agreedRuleIds.has('punctuation:introductory-clause')).toBe(true);
  });

  it('exposes claimed spans so the grammar lane can skip them', () => {
    expect(claimedSpans([issue({ start: 2, end: 7 })])).toEqual([
      { start: 2, end: 7, replacement: 'hello,' },
    ]);
  });

  it('builds a stable key from session, paragraph, rule and span', () => {
    const a = punctuationIssueKey(issue({}), 's1', 'fp1');
    expect(a).toBe(punctuationIssueKey(issue({}), 's1', 'fp1'));
    expect(a).not.toBe(punctuationIssueKey(issue({}), 's1', 'fp2'));
    expect(a).not.toBe(punctuationIssueKey(issue({ start: 3 }), 's1', 'fp1'));
  });
});

describe('provider behaviour', () => {
  it('caches by text and settings', () => {
    const fresh = new EssentialPunctuationProvider();
    const text = 'Although it was raining we continued.';
    const first = fresh.analyse(text, { settings: DEFAULT_PUNCTUATION_SETTINGS });
    const second = fresh.analyse(text, { settings: DEFAULT_PUNCTUATION_SETTINGS });
    expect(second).toEqual(first);
    // A settings change must not be served from the cache.
    const third = fresh.analyse(text, {
      settings: { ...DEFAULT_PUNCTUATION_SETTINGS, introductoryClause: false },
    });
    expect(third).toHaveLength(0);
  });

  it('handles empty and oversized input safely', () => {
    expect(analyse('')).toHaveLength(0);
    expect(analyse('word '.repeat(6000))).toHaveLength(0);
  });

  it('handles multi-sentence paragraphs and reports absolute offsets', () => {
    const text = 'Nothing to fix here. Although it was raining we continued.';
    const issues = analyse(text);
    expect(issues).toHaveLength(1);
    expect(text.slice(issues[0]!.start, issues[0]!.end)).toBe(issues[0]!.originalText);
    expect(issues[0]!.start).toBeGreaterThan(20);
  });

  it('never throws on adversarial input', () => {
    const inputs = ['...', '   ', '"""', 'a,b,c', '\n\n\n', 'A. B. C.', '(((', '?!?!'];
    for (const input of inputs) expect(() => analyse(input)).not.toThrow();
  });
});


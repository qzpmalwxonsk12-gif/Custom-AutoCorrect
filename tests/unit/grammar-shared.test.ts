import { describe, expect, it } from 'vitest';
import {
  autoApplyDecision,
  bareHarperRule,
  deriveEdit,
  isHarperRuleId,
  issueKey,
  recordGrammarFeedback,
  validateIssue,
  validateRulePair,
  widenEdit,
  type GrammarIssue,
} from '../../src/shared/grammar.js';
import { learning } from '../helpers.js';
import { addToDictionary, recordRejection } from '../../src/engine/personal-learning.js';
import { settings } from '../helpers.js';

describe('deriveEdit', () => {
  it('derives the minimal replacement (word snapping happens in widenEdit)', () => {
    // has -> have share "ha", so the minimal diff is "s" -> "ve".
    const edit = deriveEdit('I has a dog', 'I have a dog');
    expect(edit).toEqual({ start: 4, end: 5, replacement: 've' });
  });

  it('derives a pure insertion', () => {
    const edit = deriveEdit('the dog barked', 'the dog, barked');
    expect(edit).toEqual({ start: 7, end: 7, replacement: ',' });
  });

  it('derives a pure deletion whose application restores the target', () => {
    const before = 'the the dog';
    const edit = deriveEdit(before, 'the dog')!;
    expect(edit.replacement).toBe('');
    expect(before.slice(0, edit.start) + edit.replacement + before.slice(edit.end)).toBe('the dog');
  });

  it('returns null for identical strings', () => {
    expect(deriveEdit('same', 'same')).toBeNull();
  });

  it('is UTF-16 correct with astral characters before the edit', () => {
    // The emoji occupies two code units; offsets must be code-unit based.
    const before = '🎉🎉 I has a dog';
    const after = '🎉🎉 I have a dog';
    const edit = deriveEdit(before, after)!;
    expect(before.slice(0, edit.start) + edit.replacement + before.slice(edit.end)).toBe(after);
    // Word snapping turns the minimal "s" -> "ve" diff into has -> have.
    const widened = widenEdit(before, edit)!;
    expect(before.slice(widened.start, widened.end)).toBe('has');
    expect(widened.replacement).toBe('have');
  });

  it('does not let prefix and suffix overlap on repeated text', () => {
    const edit = deriveEdit('aaa', 'aa')!;
    expect(edit.replacement).toBe('');
    expect(edit.end - edit.start).toBe(1);
  });
});

describe('widenEdit', () => {
  it('leaves two-sided edits alone', () => {
    const edit = { start: 2, end: 5, replacement: 'have' };
    expect(widenEdit('I has a dog', edit)).toEqual(edit);
  });

  it('widens an insertion to include the previous word', () => {
    const paragraph = 'the dog barked';
    const edit = widenEdit(paragraph, { start: 7, end: 7, replacement: ',' })!;
    expect(paragraph.slice(edit.start, edit.end)).toBe('dog');
    expect(edit.replacement).toBe('dog,');
  });

  it('widens a deletion so the replacement is non-empty', () => {
    const paragraph = 'the the dog';
    const raw = deriveEdit(paragraph, 'the dog')!;
    const edit = widenEdit(paragraph, raw)!;
    expect(edit.replacement.length).toBeGreaterThan(0);
    expect(paragraph.slice(edit.start, edit.end).length).toBeGreaterThan(0);
    // Applying the widened edit still yields the corrected text.
    expect(
      paragraph.slice(0, edit.start) + edit.replacement + paragraph.slice(edit.end),
    ).toBe('the dog');
  });

  it('snaps mid-word substitutions to whole words', () => {
    const paragraph = 'I has a dog';
    const raw = deriveEdit(paragraph, 'I have a dog')!;
    const edit = widenEdit(paragraph, raw)!;
    expect(paragraph.slice(edit.start, edit.end)).toBe('has');
    expect(edit.replacement).toBe('have');
  });

  it('gives up rather than emit an empty side', () => {
    expect(widenEdit('', { start: 0, end: 0, replacement: '' })).toBeNull();
  });
});

function issue(overrides: Partial<GrammarIssue> = {}): GrammarIssue {
  return {
    ruleId: 'SubjectVerbAgreement',
    kind: 'Agreement',
    message: 'Use "have" here.',
    start: 2,
    end: 5,
    original: 'has',
    replacement: 'have',
    ...overrides,
  };
}

describe('validateIssue', () => {
  const text = 'I has a dog';
  const base = {
    text,
    paragraphStart: 0,
    paragraphEnd: text.length,
    learning: learning(),
    dismissed: new Set<string>(),
    occupiedRanges: [] as Array<{ start: number; end: number }>,
  };

  it('accepts a well-formed issue and returns field coordinates', () => {
    const verdict = validateIssue({ ...base, issue: issue() });
    expect(verdict).toEqual({ ok: true, start: 2, end: 5 });
  });

  it('offsets by the paragraph position in the field', () => {
    const fieldText = `Intro line.\n${text}`;
    const verdict = validateIssue({
      ...base,
      text: fieldText,
      paragraphStart: 12,
      paragraphEnd: fieldText.length,
      issue: issue(),
    });
    expect(verdict).toEqual({ ok: true, start: 14, end: 17 });
  });

  it('rejects when the text has drifted', () => {
    const verdict = validateIssue({ ...base, issue: issue({ original: 'had' }) });
    expect(verdict).toMatchObject({ ok: false, reason: 'text-drifted' });
  });

  it('rejects spans outside the linted paragraph', () => {
    const verdict = validateIssue({ ...base, issue: issue({ start: 2, end: 500 }) });
    expect(verdict).toMatchObject({ ok: false, reason: 'out-of-range' });
  });

  it('rejects empty or no-op issues', () => {
    expect(validateIssue({ ...base, issue: issue({ replacement: '' }) })).toMatchObject({
      ok: false,
      reason: 'empty-side',
    });
    expect(validateIssue({ ...base, issue: issue({ replacement: 'has' }) })).toMatchObject({
      ok: false,
      reason: 'no-op',
    });
  });

  it('honours the personal dictionary for single-word issues', () => {
    const data = learning();
    addToDictionary(data, 'has');
    const verdict = validateIssue({ ...base, learning: data, issue: issue() });
    expect(verdict).toMatchObject({ ok: false, reason: 'in-dictionary' });
  });

  it('honours blocked word pairs', () => {
    const data = learning();
    recordRejection(data, 'has', 'have', 'never-this-pair', undefined, settings());
    const verdict = validateIssue({ ...base, learning: data, issue: issue() });
    expect(verdict).toMatchObject({ ok: false, reason: 'pair-blocked' });
  });

  it('never fights an existing correction record for the same span', () => {
    const verdict = validateIssue({
      ...base,
      occupiedRanges: [{ start: 4, end: 8 }],
      issue: issue(),
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'overlaps-record' });
  });

  describe('paragraph-start capitalization artefacts', () => {
    const capIssue = (paragraph: string): GrammarIssue => ({
      ruleId: 'SentenceCapitalization',
      kind: 'Capitalization',
      message: 'Capitalize this sentence.',
      start: 0,
      end: paragraph.indexOf(' '),
      original: paragraph.slice(0, paragraph.indexOf(' ')),
      replacement:
        paragraph[0]!.toUpperCase() + paragraph.slice(1, paragraph.indexOf(' ')),
    });

    it('suppresses them when the previous line ends mid-sentence', () => {
      const fieldText = 'Whom is going to the\nmeeting? That is the question.';
      const paragraphStart = fieldText.indexOf('meeting?');
      const verdict = validateIssue({
        ...base,
        text: fieldText,
        paragraphStart,
        paragraphEnd: fieldText.length,
        issue: capIssue('meeting? That is the question.'),
      });
      expect(verdict).toMatchObject({ ok: false, reason: 'mid-sentence-capitalization' });
    });

    it('allows them after a completed sentence', () => {
      const fieldText = 'That was fine.\nmeeting notes follow here.';
      const paragraphStart = fieldText.indexOf('meeting');
      const verdict = validateIssue({
        ...base,
        text: fieldText,
        paragraphStart,
        paragraphEnd: fieldText.length,
        issue: capIssue('meeting notes follow here.'),
      });
      expect(verdict).toMatchObject({ ok: true });
    });

    it('allows them at the very start of the document', () => {
      const fieldText = 'meeting notes follow here.';
      const verdict = validateIssue({
        ...base,
        text: fieldText,
        paragraphStart: 0,
        paragraphEnd: fieldText.length,
        issue: capIssue(fieldText),
      });
      expect(verdict).toMatchObject({ ok: true });
    });

    it('does not affect capitalization findings later in a paragraph', () => {
      const fieldText = 'Whom is going\nwell i suppose so.';
      const paragraphStart = fieldText.indexOf('well');
      const paragraph = 'well i suppose so.';
      const verdict = validateIssue({
        ...base,
        text: fieldText,
        paragraphStart,
        paragraphEnd: fieldText.length,
        issue: {
          ruleId: 'CapitalizePersonalPronouns',
          kind: 'Capitalization',
          message: 'Capitalize I.',
          start: paragraph.indexOf(' i ') + 1,
          end: paragraph.indexOf(' i ') + 2,
          original: 'i',
          replacement: 'I',
        },
      });
      expect(verdict).toMatchObject({ ok: true });
    });
  });
});

describe('rule id helpers', () => {
  it('round-trips the harper prefix', () => {
    expect(isHarperRuleId('harper:Foo')).toBe(true);
    expect(isHarperRuleId('waht->what')).toBe(false);
    expect(isHarperRuleId(undefined)).toBe(false);
    expect(bareHarperRule('harper:Foo')).toBe('Foo');
    expect(bareHarperRule('Foo')).toBe('Foo');
  });

  it('builds distinct issue keys per rule, text and paragraph', () => {
    const a = issueKey(issue(), 'fp1');
    expect(a).toBe(issueKey(issue(), 'fp1'));
    expect(a).not.toBe(issueKey(issue(), 'fp2'));
    expect(a).not.toBe(issueKey(issue({ ruleId: 'Other' }), 'fp1'));
  });
});

describe('autoApplyDecision', () => {
  const on = settings({ harperAutoApply: true });

  it('refuses when the setting is off', () => {
    expect(autoApplyDecision(issue(), settings(), learning())).toEqual({
      auto: false,
      reason: 'setting-off',
    });
  });

  it('allows an ordinary correctness rule when enabled', () => {
    expect(autoApplyDecision(issue(), on, learning())).toEqual({ auto: true });
  });

  it('never auto-applies a rule measured as wrong', () => {
    expect(autoApplyDecision(issue({ ruleId: 'NominalWants' }), on, learning())).toEqual({
      auto: false,
      reason: 'denied-rule',
    });
  });

  it('never auto-applies subjective kinds', () => {
    for (const kind of ['Style', 'Readability']) {
      expect(autoApplyDecision(issue({ kind }), on, learning())).toEqual({
        auto: false,
        reason: 'denied-kind',
      });
    }
    // Enhancement is objective enough (cant -> can't) and stays eligible.
    expect(autoApplyDecision(issue({ kind: 'Enhancement' }), on, learning())).toEqual({
      auto: true,
    });
  });

  it('backs off a rule the user keeps reverting', () => {
    const data = learning();
    data.grammarStats.SubjectVerbAgreement = { offered: 4, accepted: 0, rejected: 2 };
    expect(autoApplyDecision(issue(), on, data)).toEqual({
      auto: false,
      reason: 'user-reverts',
    });
  });

  it('keeps auto-applying when acceptances outweigh reverts', () => {
    const data = learning();
    data.grammarStats.SubjectVerbAgreement = { offered: 20, accepted: 6, rejected: 3 };
    expect(autoApplyDecision(issue(), on, data)).toEqual({ auto: true });
  });

  it('tolerates a single revert', () => {
    const data = learning();
    data.grammarStats.SubjectVerbAgreement = { offered: 3, accepted: 0, rejected: 1 };
    expect(autoApplyDecision(issue(), on, data)).toEqual({ auto: true });
  });
});

describe('validateRulePair', () => {
  it('accepts a plain word pair', () => {
    expect(validateRulePair('corect', 'correct')).toEqual({ ok: true });
    expect(validateRulePair('  Corect  ', ' correct ')).toEqual({ ok: true });
  });

  it('accepts a multi-word replacement', () => {
    expect(validateRulePair('alot', 'a lot')).toEqual({ ok: true });
  });

  it('rejects an empty side', () => {
    expect(validateRulePair('corect', '  ').ok).toBe(false);
    expect(validateRulePair('', 'correct').ok).toBe(false);
  });

  it('rejects identical sides regardless of case', () => {
    expect(validateRulePair('Correct', 'correct').ok).toBe(false);
  });

  it('rejects a multi-word original', () => {
    const result = validateRulePair('a lot', 'alot');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/single word/);
  });

  it('rejects digits, symbols and over-long input', () => {
    expect(validateRulePair('x1', 'x2').ok).toBe(false);
    expect(validateRulePair('foo()', 'foo').ok).toBe(false);
    expect(validateRulePair('a'.repeat(70), 'b').ok).toBe(false);
    expect(validateRulePair('word', 'b'.repeat(70)).ok).toBe(false);
  });

  it('allows apostrophes and hyphens', () => {
    expect(validateRulePair('dont', "don't")).toEqual({ ok: true });
    expect(validateRulePair('wellknown', 'well-known')).toEqual({ ok: true });
  });
});

describe('recordGrammarFeedback', () => {
  it('accumulates per-rule counters', () => {
    const data = learning();
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'offered' });
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'accepted' });
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'rejected' });
    recordGrammarFeedback(data, { ruleId: 'B', verdict: 'offered' });
    expect(data.grammarStats.A).toEqual({ offered: 1, accepted: 1, rejected: 1 });
    expect(data.grammarStats.B).toEqual({ offered: 1, accepted: 0, rejected: 0 });
  });

  it('stores well-formed ignore hashes once, on rejection only', () => {
    const data = learning();
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'rejected', ignoreHash: '12345' });
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'rejected', ignoreHash: '12345' });
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'accepted', ignoreHash: '999' });
    recordGrammarFeedback(data, { ruleId: 'A', verdict: 'rejected', ignoreHash: 'not-a-hash' });
    expect(data.grammarIgnoredLints).toEqual(['12345']);
  });

  it('ignores empty rule ids', () => {
    const data = learning();
    recordGrammarFeedback(data, { ruleId: '', verdict: 'offered' });
    expect(Object.keys(data.grammarStats)).toHaveLength(0);
  });
});

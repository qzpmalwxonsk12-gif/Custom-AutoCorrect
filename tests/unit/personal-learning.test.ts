import { describe, expect, it } from 'vitest';
import {
  addToDictionary,
  deleteRule,
  ensureRule,
  findRule,
  isBlockedPair,
  isDictionaryWord,
  observeManualEdit,
  prunePending,
  recordAccepted,
  recordApplied,
  recordRejection,
  recordSkipped,
  removeFromDictionary,
  unblockPair,
  upsertUserRule,
} from '../../src/engine/personal-learning.js';
import { personalFactor } from '../../src/engine/confidence-scorer.js';
import { learning, settings } from '../helpers.js';

describe('rule bookkeeping', () => {
  it('creates a rule on first use and counts applications', () => {
    const data = learning();
    recordApplied(data, 'waht', 'what', 'builtin-typo');
    recordApplied(data, 'waht', 'what', 'builtin-typo');
    const rule = findRule(data, 'waht', 'what');
    expect(rule?.applied).toBe(2);
    expect(rule?.source).toBe('builtin-typo');
    expect(rule?.mode).toBe('autocorrect');
  });

  it('raises confidence as corrections are accepted', () => {
    const data = learning();
    const before = personalFactor(findRule(data, 'waht', 'what'));
    for (let i = 0; i < 5; i++) {
      recordAccepted(data, 'waht', 'what', { previousWord: 'think' }, settings());
    }
    const rule = findRule(data, 'waht', 'what')!;
    expect(rule.confidence).toBeGreaterThan(before);
    expect(rule.mode).toBe('autocorrect');
    expect(rule.context.previousWords).toContain('think');
  });

  it('does not learn when learning is switched off', () => {
    const data = learning();
    recordAccepted(data, 'waht', 'what', undefined, settings({ learnFromDecisions: false }));
    expect(findRule(data, 'waht', 'what')).toBeUndefined();
  });

  it('counts skips without changing confidence', () => {
    const data = learning();
    ensureRule(data, 'waht', 'what', 'builtin-typo');
    const before = findRule(data, 'waht', 'what')!.confidence;
    recordSkipped(data, 'waht', 'what');
    const rule = findRule(data, 'waht', 'what')!;
    expect(rule.skipped).toBe(1);
    expect(rule.confidence).toBe(before);
  });
});

describe('rejection semantics', () => {
  it('revert-once only lowers confidence', () => {
    const data = learning();
    for (let i = 0; i < 6; i++) recordAccepted(data, 'a', 'b', undefined, settings());
    const before = findRule(data, 'a', 'b')!.confidence;
    const outcome = recordRejection(data, 'a', 'b', 'revert-once', undefined, settings());
    const rule = findRule(data, 'a', 'b')!;
    expect(rule.confidence).toBeLessThan(before);
    expect(rule.mode).toBe('autocorrect'); // one no does not undo six yeses
    expect(outcome.effect).toBe('confidence-lowered');
    expect(isBlockedPair(data, 'a', 'b')).toBe(false);
  });

  it('lower-confidence demotes the rule to suggestion-only', () => {
    const data = learning();
    for (let i = 0; i < 6; i++) recordAccepted(data, 'a', 'b', undefined, settings());
    const outcome = recordRejection(data, 'a', 'b', 'lower-confidence', undefined, settings());
    expect(findRule(data, 'a', 'b')!.mode).toBe('suggestion');
    expect(outcome.effect).toBe('demoted-to-suggestion');
  });

  it('never-this-pair blocks the pair permanently', () => {
    const data = learning();
    const outcome = recordRejection(data, 'form', 'from', 'never-this-pair', undefined, settings());
    expect(outcome.effect).toBe('blocked');
    expect(isBlockedPair(data, 'form', 'from')).toBe(true);
    expect(findRule(data, 'form', 'from')!.enabled).toBe(false);

    unblockPair(data, 'form->from');
    expect(isBlockedPair(data, 'form', 'from')).toBe(false);
    expect(findRule(data, 'form', 'from')!.mode).toBe('suggestion');
  });

  it('never-correct-word adds to the dictionary without destroying rule state', () => {
    const data = learning();
    ensureRule(data, 'fable', 'able', 'lexicon');
    ensureRule(data, 'fable', 'table', 'lexicon');
    const outcome = recordRejection(data, 'fable', 'able', 'never-correct-word', undefined, settings());
    expect(outcome.effect).toBe('dictionary-added');
    expect(isDictionaryWord(data, 'Fable')).toBe(true);
    expect(findRule(data, 'fable', 'table')!.enabled).toBe(true);
  });

  it('not-in-this-context records only the surrounding words', () => {
    const data = learning();
    const outcome = recordRejection(
      data,
      'form',
      'from',
      'not-in-this-context',
      { previousWord: 'application', nextWord: 'below' },
      settings(),
    );
    expect(outcome.effect).toBe('context-blocked');
    const rule = findRule(data, 'form', 'from')!;
    expect(rule.context.blockedPrevious).toContain('application');
    expect(rule.context.blockedNext).toContain('below');
    expect(rule.mode).not.toBe('blocked');
  });

  it('keep-no-learn changes nothing at all', () => {
    const data = learning();
    const outcome = recordRejection(data, 'a', 'b', 'keep-no-learn', undefined, settings());
    expect(outcome.effect).toBe('no-learning');
    expect(findRule(data, 'a', 'b')).toBeUndefined();
  });
});

describe('learning from manual edits', () => {
  const s = settings({ manualEditEvidence: 3 });

  it('requires repeated evidence before creating a rule', () => {
    const data = learning();
    expect(observeManualEdit(data, { original: 'waht', replacement: 'what' }, s).createdRule).toBeUndefined();
    expect(observeManualEdit(data, { original: 'waht', replacement: 'what' }, s).createdRule).toBeUndefined();
    const third = observeManualEdit(data, { original: 'waht', replacement: 'what' }, s);
    expect(third.createdRule).toBeDefined();
    // New rules are suggestion-only: they have to earn autocorrect.
    expect(third.createdRule!.mode).toBe('suggestion');
    expect(third.createdRule!.accepted).toBe(0);
    expect(data.pending['waht->what']).toBeUndefined();
  });

  it('refuses multi-word, numeric and non-word changes', () => {
    const data = learning();
    expect(observeManualEdit(data, { original: 'a b', replacement: 'c' }, s).rejectedBecause).toBe('multi-word');
    expect(observeManualEdit(data, { original: 'x1', replacement: 'x2' }, s).rejectedBecause).toBe('non-word-characters');
    expect(observeManualEdit(data, { original: 'same', replacement: 'same' }, s).rejectedBecause).toBe('empty-or-identical');
    expect(observeManualEdit(data, { original: 'a', replacement: 'b' }, s).rejectedBecause).toBe('length');
  });

  it('refuses semantic rewrites, distant substitutions, and unknown targets', () => {
    const data = learning();
    expect(observeManualEdit(data, { original: 'like', replacement: 'hate' }, s).rejectedBecause).toBe(
      'not-typo-shaped',
    );
    expect(observeManualEdit(data, { original: 'cat', replacement: 'hat' }, s).rejectedBecause).toBe(
      'not-typo-shaped',
    );
    expect(
      observeManualEdit(data, { original: 'qzxv', replacement: 'wzxv' }, s).rejectedBecause,
    ).toBe('unknown-target');
  });

  it('refuses words in the dictionary or blocked pairs', () => {
    const data = learning();
    addToDictionary(data, 'waht');
    expect(observeManualEdit(data, { original: 'waht', replacement: 'what' }, s).rejectedBecause).toBe('in-dictionary');

    const other = learning();
    recordRejection(other, 'form', 'from', 'never-this-pair', undefined, s);
    expect(observeManualEdit(other, { original: 'form', replacement: 'from' }, s).rejectedBecause).toBe('blocked');
  });

  it('respects the learning switch', () => {
    const data = learning();
    const off = settings({ learnFromManualEdits: false });
    expect(observeManualEdit(data, { original: 'waht', replacement: 'what' }, off).accepted).toBe(false);
  });

  it('prunes stale evidence', () => {
    const data = learning();
    observeManualEdit(data, { original: 'waht', replacement: 'what' }, s);
    data.pending['waht->what']!.lastSeen = Date.now() - 40 * 24 * 60 * 60 * 1000;
    expect(prunePending(data)).toBe(1);
    expect(Object.keys(data.pending)).toHaveLength(0);
  });
});

describe('dictionary and rule management', () => {
  it('normalises dictionary entries', () => {
    const data = learning();
    addToDictionary(data, '  Fable ');
    addToDictionary(data, 'fable');
    expect(data.dictionary).toEqual(['fable']);
  });

  it('treats apostrophe variants as the same dictionary word and blocked pair', () => {
    const data = learning();
    addToDictionary(data, 'can\u2019r');
    expect(isDictionaryWord(data, "can'r")).toBe(true);

    recordRejection(data, 'can\u2019r', 'can\u02bct', 'never-this-pair', undefined, settings());
    expect(isBlockedPair(data, "can'r", "can't")).toBe(true);
    expect(findRule(data, "can'r", "can't")?.id).toBe("can'r->can't");
  });

  it('deletes rules and their block entries', () => {
    const data = learning();
    recordRejection(data, 'a', 'b', 'never-this-pair', undefined, settings());
    deleteRule(data, 'a->b');
    expect(findRule(data, 'a', 'b')).toBeUndefined();
    expect(isBlockedPair(data, 'a', 'b')).toBe(false);
  });

  it('restores legacy dictionary-disabled rules when the word is removed', () => {
    const data = learning();
    const rule = ensureRule(data, 'fable', 'table', 'personal-learning');
    rule.enabled = false;
    addToDictionary(data, 'fable');
    removeFromDictionary(data, 'fable');
    expect(rule.enabled).toBe(true);
  });

  it('upgrades and unblocks an explicit user rule', () => {
    const data = learning();
    recordRejection(data, 'waht', 'what', 'never-this-pair', undefined, settings());
    addToDictionary(data, 'waht');
    data.pending['waht->what'] = {
      original: 'waht',
      replacement: 'what',
      count: 2,
      firstSeen: 1,
      lastSeen: 2,
    };

    const rule = upsertUserRule(data, 'Waht', 'What');
    expect(rule).toMatchObject({
      id: 'waht->what',
      source: 'user-created',
      mode: 'autocorrect',
      enabled: true,
      manual: true,
      confidence: 0.99,
    });
    expect(isBlockedPair(data, 'waht', 'what')).toBe(false);
    expect(isDictionaryWord(data, 'waht')).toBe(false);
    expect(data.pending['waht->what']).toBeUndefined();
  });
});

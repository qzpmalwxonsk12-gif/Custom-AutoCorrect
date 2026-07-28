import { describe, expect, it } from 'vitest';
import { analyze, buildContext } from '../../src/engine/correction-engine.js';
import {
  addToDictionary,
  ensureRule,
  recordApplied,
  recordRejection,
} from '../../src/engine/personal-learning.js';
import { learning, settings } from '../helpers.js';
import type { LearningData, Settings } from '../../src/shared/types.js';

/** Analyses the word that ends at the first occurrence of `word` in `text`. */
function run(
  text: string,
  word: string,
  data: LearningData = learning(),
  s: Settings = settings(),
) {
  const index = text.indexOf(word);
  if (index === -1) throw new Error(`"${word}" not in "${text}"`);
  return analyze({ text, wordEnd: index + word.length, origin: 'https://example.com' }, data, s);
}

describe('common misspellings', () => {
  it('auto-corrects the shipped typo table', () => {
    for (const [typo, expected] of [
      ['waht', 'what'],
      ['teh', 'the'],
      ['becuase', 'because'],
      ['recieve', 'receive'],
      ['adn', 'and'],
      ['oir', 'or'],
    ] as const) {
      const result = run(`I think ${typo} `, typo);
      expect(result?.proposal.replacement, typo).toBe(expected);
      expect(result?.proposal.action, typo).toBe('autocorrect');
      expect(result?.proposal.confidence, typo).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('preserves capitalisation', () => {
    expect(run('Waht is that', 'Waht')?.proposal.replacement).toBe('What');
    expect(run('I said WAHT ', 'WAHT')?.proposal).toBeUndefined(); // ALL CAPS is protected
  });

  it('capitalises at a sentence start even when typed lower-case', () => {
    const result = run('Hello. waht now', 'waht');
    expect(result?.proposal.replacement).toBe('What');
  });

  it('reports the correction range so the caller can replace precisely', () => {
    const text = 'I think waht happened';
    const result = run(text, 'waht');
    expect(result?.proposal.start).toBe(8);
    expect(result?.proposal.end).toBe(12);
  });

  it('applies complete multiword typo-table replacements', () => {
    expect(run('alot ', 'alot')?.proposal.replacement).toBe('A lot');
    expect(run('I see noone ', 'noone')?.proposal.replacement).toBe('no one');
  });

  it('does not demote a built-in merely because application statistics exist', () => {
    const data = learning();
    recordApplied(data, 'waht', 'what', 'builtin-typo');
    const result = run('I think waht happened', 'waht', data);
    expect(result?.proposal.correctionType).toBe('spelling');
    expect(result?.proposal.action).toBe('autocorrect');
  });

  it.each([
    ['abut', 'The properties abut each other'],
    ['wont', 'He was wont to walk there'],
  ])('does not let the legacy typo table rewrite the valid ESDB word %s', (word, text) => {
    expect(run(text, word)).toBeNull();
  });
});

describe('Idea Version 1 dictionary pipeline', () => {
  it.each([
    ['owrks', 'works'],
    ['nromal', 'normal'],
  ])('auto-corrects a unique adjacent swap %s -> %s', (typed, expected) => {
    const result = run(`The ${typed} continued`, typed);
    expect(result?.proposal.replacement).toBe(expected);
    expect(result?.proposal.action).toBe('autocorrect');
    expect(result?.proposal.reason).toContain('adjacent');
  });

  it.each([
    ['eorks', 'works'],
    ['gello', 'hello'],
    ['tge', 'the'],
  ])('finds a one-key neighbour substitution %s -> %s', (typed, expected) => {
    const result = run(`I typed ${typed} here`, typed);
    expect(result?.proposal.replacement).toBe(expected);
    expect(result?.proposal.correctionType).toBe('keyboard-proximity');
  });

  it('auto-corrects surriunding after ranking every Process 3 candidate', () => {
    const result = run('The surriunding text', 'surriunding');
    expect(result?.proposal).toMatchObject({
      replacement: 'surrounding',
      correctionType: 'keyboard-proximity',
      source: 'lexicon',
      action: 'autocorrect',
      keyboardSubstitution: {
        index: 4,
        typedCharacter: 'i',
        replacementCharacter: 'o',
        neighbourMapMatched: true,
      },
    });
    expect(result?.proposal.confidence).toBeGreaterThanOrEqual(
      settings().autocorrectThreshold,
    );
    expect(result?.proposal.reason).toContain('position 5: i → o');
  });

  it.each([
    ['Surriunding text', 'Surriunding', 'Surrounding'],
    ['SURRIUNDING text', 'SURRIUNDING', 'SURROUNDING'],
  ])('preserves capitalization for %s', (text, typed, expected) => {
    const result = run(text, typed);
    expect(result?.proposal.replacement).toBe(expected);
    expect(result?.proposal.action).toBe('autocorrect');
    expect(result?.proposal.correctionType).toBe('keyboard-proximity');
  });

  it('uses the common-word prior to rank works above dorks for eorks', () => {
    const result = run('It eorks well', 'eorks');
    expect(result?.proposal.replacement).toBe('works');
    expect(result?.proposal.action).toBe('autocorrect');
  });

  it('keeps a close multi-candidate result as a suggestion', () => {
    // "iprove" is the canonical ambiguous case: "improve" (insert a letter)
    // and "prove" (delete one) are equally simple, so neither is imposed.
    const result = run('I will iprove this', 'iprove');
    expect(result?.proposal.replacement).toBe('improve');
    expect(result?.proposal.action).not.toBe('autocorrect');
  });

  it('uses only the unified raw-score margin for an ambiguous action', () => {
    /*
     * `ares` leads `ores` by only 0.0517 on the shared unclamped score. The
     * legacy confidence function gives them a wider 0.0668 gap; taking the
     * larger of those two margins used to auto-apply `aores -> ares` despite
     * the actual ranking being below the 0.06 ambiguity threshold.
     */
    const result = run('The aores remain here', 'aores');
    expect(result?.proposal.replacement).toBe('ares');
    expect(result?.proposal.action).toBe('suggest');
  });

  it('canonicalises smart apostrophes for rules while preserving their display style', () => {
    const smartTypo = 'can\u2019r';
    const result = run(`I ${smartTypo} continue`, smartTypo);
    expect(result?.proposal.replacement).toBe('can\u2019t');

    const personal = learning();
    addToDictionary(personal, "can'r");
    expect(run(`I ${smartTypo} continue`, smartTypo, personal)).toBeNull();

    const blocked = learning();
    recordRejection(blocked, "can'r", "can't", 'never-this-pair', undefined, settings());
    expect(run(`I ${smartTypo} continue`, smartTypo, blocked)?.proposal.replacement).not.toBe(
      'can\u2019t',
    );
  });
});

describe('bounded context', () => {
  it('keeps context windows bounded inside a very large single-line field', () => {
    const prefix = `${'ordinary prose '.repeat(100_000)}Previous sentence. `;
    const word = 'nromal';
    const start = prefix.length;
    const text = `${prefix}${word} after this. Ignored sentence.`;
    const context = buildContext(
      text,
      start,
      start + word.length,
      'https://example.com',
    );

    expect(context.before).toBe('');
    expect(context.after).toBe(' after this. ');
    expect(context.previousWord).toBe('');
    expect(context.nextWord).toBe('after');
    expect(context.before.length).toBeLessThanOrEqual(60);
    expect(context.after.length).toBeLessThanOrEqual(60);
  });
});

describe('safeguards', () => {
  it('does not auto-rewrite the valid word "ut"', () => {
    expect(run('I sang ut softly', 'ut')).toBeNull();
  });

  it('leaves URLs, e-mails and code alone', () => {
    expect(run('go to https://x.com/waht now', 'waht')).toBeNull();
    expect(run('write to teh@x.com now', 'teh')).toBeNull();
    expect(run('use `waht` here', 'waht')).toBeNull();
    expect(run('call getWaht()', 'getWaht')).toBeNull();
  });

  it('leaves capitalised names mid-sentence alone', () => {
    // Lower-case "gello" produces the valid keyboard candidate "hello", so
    // this specifically exercises the title-case name guard.
    expect(run('I met Gello today', 'Gello')).toBeNull();
  });

  it('protects mixed alphanumeric runs through the real word range', () => {
    expect(run('id waht2 here', 'waht')).toBeNull();
    expect(run('id 2waht here', 'waht')).toBeNull();
  });

  it('does not rewrite a short hyphenated prefix as a standalone word', () => {
    // UD EWT contains the legitimate spelling "mis-matches". Treating its
    // three-letter prefix as an independent token changed it to "is-matches".
    expect(run('The process mis-matches remain visible', 'mis')).toBeNull();
  });

  it('does not treat numbers as words', () => {
    expect(
      analyze(
        { text: 'value 12345 ', wordEnd: 11, origin: 'https://example.com' },
        learning(),
        settings(),
      ),
    ).toBeNull();
  });

  it('never touches a word in the personal dictionary', () => {
    const data = learning();
    addToDictionary(data, 'waht');
    expect(run('I think waht happened', 'waht', data)).toBeNull();
  });

  it('never applies a blocked pair again', () => {
    const data = learning();
    recordRejection(data, 'waht', 'what', 'never-this-pair', undefined, settings());
    const result = run('I think waht happened', 'waht', data);
    // Blocking a pair blocks that replacement, not the word: a different
    // candidate may still be *suggested*, but never applied automatically.
    expect(result?.proposal.replacement).not.toBe('what');
    expect(result?.proposal.action).not.toBe('autocorrect');
  });

  it('silences every layer once the word is in the dictionary', () => {
    const data = learning();
    recordRejection(data, 'waht', 'what', 'never-correct-word', undefined, settings());
    expect(run('I think waht happened', 'waht', data)).toBeNull();
  });

  it('respects a per-site off switch', () => {
    const s = settings({ siteOverrides: { 'https://example.com': 'off' } });
    expect(run('I think waht happened', 'waht', learning(), s)).toBeNull();
  });

  it('does nothing when disabled', () => {
    expect(run('I think waht happened', 'waht', learning(), settings({ enabled: false }))).toBeNull();
  });
});

describe('real-word (contextual) corrections', () => {
  it('suggests from -> form only when the context supports it', () => {
    const result = run('I received it form him', 'form');
    expect(result?.proposal.replacement).toBe('from');
    expect(result?.proposal.correctionType).toBe('contextual');
    // Ambiguous by nature: never auto-applied without personal evidence.
    expect(result?.proposal.action).toBe('suggest');
  });

  it('leaves "complete the form" untouched', () => {
    expect(run('Please complete the form', 'form')).toBeNull();
  });

  it('can be disabled entirely', () => {
    const s = settings({ contextualEnabled: false });
    expect(run('I received it form him', 'form', learning(), s)).toBeNull();
  });

  it('honours a context-specific rejection', () => {
    const data = learning();
    recordRejection(
      data,
      'form',
      'from',
      'not-in-this-context',
      { previousWord: 'it', nextWord: 'him' },
      settings(),
    );
    expect(run('I received it form him', 'form', data)).toBeNull();
  });

  it('does not treat a stored contextual rule as an unconditional exact rule', () => {
    const data = learning();
    const rule = ensureRule(data, 'form', 'from', 'builtin-context');
    rule.accepted = 12;
    rule.mode = 'autocorrect';
    rule.confidence = 0.95;
    expect(run('Please complete the form', 'form', data)).toBeNull();
  });
});

describe('personal and user rules', () => {
  it('applies a user-created rule with top priority', () => {
    const data = learning();
    const rule = ensureRule(data, 'omw', 'on my way', 'user-created', true);
    rule.mode = 'autocorrect';
    const result = run('ok omw now', 'omw', data);
    expect(result?.proposal.replacement).toBe('on my way');
    expect(result?.proposal.correctionType).toBe('exact-rule');
    expect(result?.proposal.action).toBe('autocorrect');
  });

  it('keeps a learned rule as a suggestion until it earns trust', () => {
    const data = learning();
    const rule = ensureRule(data, 'hte', 'the', 'personal-learning');
    rule.accepted = 1;
    rule.confidence = 0.6;
    const result = run('in hte end', 'hte', data);
    expect(result?.proposal.action).toBe('suggest');
  });

  it('promotes a well-accepted learned rule to autocorrect', () => {
    const data = learning();
    const rule = ensureRule(data, 'hte', 'the', 'personal-learning');
    rule.accepted = 12;
    rule.mode = 'autocorrect';
    rule.confidence = 0.9;
    const result = run('in hte end', 'hte', data);
    expect(result?.proposal.action).toBe('autocorrect');
  });

  it('demotes a typo-table pair after a revert', () => {
    const data = learning();
    const before = run('I think waht happened', 'waht', data);
    expect(before?.proposal.action).toBe('autocorrect');

    recordRejection(data, 'waht', 'what', 'revert-once', undefined, settings());
    const after = run('I think waht happened', 'waht', data);
    expect(after?.proposal.action).toBe('suggest');
  });
});

describe('grammar rules', () => {
  it('fixes the indefinite article', () => {
    const result = run('this is a apple', 'apple');
    expect(result?.proposal.original).toBe('a');
    expect(result?.proposal.replacement).toBe('an');
    expect(result?.proposal.correctionType).toBe('grammar');
    expect(result?.proposal.action).toBe('autocorrect');
  });

  it('fixes the reverse direction', () => {
    const result = run('this is an car', 'car');
    expect(result?.proposal.replacement).toBe('a');
  });

  it('stays out of ambiguous h- and u- words', () => {
    expect(run('a historic day', 'historic')).toBeNull();
    expect(run('a unique idea', 'unique')).toBeNull();
  });

  it('can be disabled', () => {
    expect(run('this is a apple', 'apple', learning(), settings({ grammarEnabled: false }))).toBeNull();
  });

  it('honours an existing grammar rule mode', () => {
    const data = learning();
    const rule = ensureRule(data, 'a', 'an', 'builtin-context');
    rule.mode = 'suggestion';
    const result = run('this is a apple', 'apple', data);
    expect(result?.proposal.correctionType).toBe('grammar');
    expect(result?.proposal.action).toBe('suggest');
    expect(result?.proposal.ruleId).toBe('a->an');
  });

  it('honours grammar site and context blocks', () => {
    const siteData = learning();
    const siteRule = ensureRule(siteData, 'a', 'an', 'builtin-context');
    siteRule.sites['https://example.com'] = 'off';
    expect(run('this is a apple', 'apple', siteData)).toBeNull();

    const contextData = learning();
    recordRejection(
      contextData,
      'a',
      'an',
      'not-in-this-context',
      { previousWord: 'is', nextWord: 'apple' },
      settings(),
    );
    expect(run('this is a apple', 'apple', contextData)).toBeNull();
  });
});

describe('thresholds', () => {
  it('suppresses everything below the suggestion threshold', () => {
    const s = settings({ suggestionThreshold: 0.999, autocorrectThreshold: 0.999 });
    expect(run('I think waht happened', 'waht', learning(), s)).toBeNull();
  });

  it('turns autocorrect into suggestions when the bar is raised', () => {
    const s = settings({ autocorrectThreshold: 0.99 });
    expect(run('I think waht happened', 'waht', learning(), s)?.proposal.action).toBe('suggest');
  });
});

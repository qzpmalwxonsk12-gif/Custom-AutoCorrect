import { describe, expect, it } from 'vitest';
import {
  analyzeToken,
  isSentenceStart,
  nextWord,
  previousWord,
  tokenizeWords,
  wordEndingAt,
} from '../../src/engine/tokenizer.js';

describe('wordEndingAt', () => {
  it('extracts the word finishing at the given offset', () => {
    const text = 'I think waht happened';
    expect(wordEndingAt(text, 12)).toEqual({ text: 'waht', start: 8, end: 12 });
  });

  it('keeps in-word apostrophes but trims edge ones', () => {
    expect(wordEndingAt("don't", 5)?.text).toBe("don't");
    expect(wordEndingAt("'quoted'", 8)?.text).toBe('quoted');
  });

  it.each(["'", '\u2019', '\u2018', '\u02bc', '\uff07'])(
    'recognises apostrophe variant %s inside a word',
    (apostrophe) => {
      const word = `can${apostrophe}t`;
      expect(wordEndingAt(word, word.length)?.text).toBe(word);
    },
  );

  it('returns null when there is no word', () => {
    expect(wordEndingAt('hello  ', 7)).toBeNull();
    expect(wordEndingAt('hello', 0)).toBeNull();
  });
});

describe('tokenizeWords', () => {
  it('splits on non-word characters and keeps offsets', () => {
    const tokens = tokenizeWords('Hi there, world!');
    expect(tokens.map((t) => t.text)).toEqual(['Hi', 'there', 'world']);
    expect(tokens[2]).toMatchObject({ start: 10, end: 15 });
  });
});

describe('analyzeToken safeguards', () => {
  const check = (text: string, word: string) => {
    const start = text.indexOf(word);
    return analyzeToken(text, start, start + word.length);
  };

  it('allows ordinary prose words', () => {
    expect(check('I think waht happened', 'waht').protected).toBe(false);
    expect(check('a well-knwon fact', 'knwon').protected).toBe(false);
  });

  it('protects URLs, e-mails, paths, handles and hashtags', () => {
    expect(check('see https://example.com/waht now', 'waht').reason).toBe('url-like');
    expect(check('mail me at teh@example.com', 'teh').reason).toBe('email-like');
    expect(check('open C:/tmp/waht here', 'waht').reason).toBe('path-like');
    expect(check('ping @waht about it', 'waht').reason).toBe('email-like');
    expect(check('tagged #waht today', 'waht').reason).toBe('sticky-prefix');
  });

  it('protects identifiers, abbreviations and numbers', () => {
    expect(check('call getWaht now', 'getWaht').protected).toBe(true);
    expect(check('the NASA report', 'NASA').reason).toBe('all-caps');
    expect(check('set some_waht value', 'waht').reason).toBe('sticky-prefix');
    expect(check('id waht2 here', 'waht2').reason).toBe('has-digit');
  });

  it('protects code fences and inline code', () => {
    expect(check('```\nwaht\n```', 'waht').reason).toBe('code-fence');
    expect(check('```\ncode\n```\nwaht', 'waht').protected).toBe(false);
    expect(check('use `waht` here', 'waht').reason).toBe('inline-code');
  });

  it('protects markdown emphasis', () => {
    expect(check('this is **waht** bold', 'waht').reason).toBe('markdown-syntax');
  });

  it('protects single characters and very long strings', () => {
    expect(analyzeToken('a b', 0, 1).reason).toBe('too-short');
    const long = 'x'.repeat(30);
    expect(analyzeToken(`a ${long} b`, 2, 32).reason).toBe('too-long');
  });
});

describe('sentence helpers', () => {
  it('detects sentence starts', () => {
    expect(isSentenceStart('Hello there', 0)).toBe(true);
    expect(isSentenceStart('One. Two', 5)).toBe(true);
    expect(isSentenceStart('one two', 4)).toBe(false);
    expect(isSentenceStart('line\nnext', 5)).toBe(true);
  });

  it('reads the neighbouring words', () => {
    const text = 'I received it form him';
    const start = text.indexOf('form');
    expect(previousWord(text, start)).toBe('it');
    expect(nextWord(text, start + 4)).toBe('him');
    expect(previousWord('I can\u2019t proceed', 7)).toBe("can't");
  });

  it('returns empty strings at the edges', () => {
    expect(previousWord('form him', 0)).toBe('');
    expect(nextWord('it form', 7)).toBe('');
    expect(nextWord('it form\nnext line', 7)).toBe('');
  });

  it('refuses unbounded neighbouring tokens and separator runs', () => {
    expect(nextWord(`word ${'x'.repeat(1_000)}`, 4)).toBe('');
    expect(previousWord(`${' '.repeat(1_000)}word`, 1_000)).toBe('');
  });
});

/**
 * Word-boundary corrections. These are the riskiest edits in the engine -
 * changing spaces can change meaning - so the negative cases matter more than
 * the positive ones.
 */
import { describe, expect, it } from 'vitest';
import {
  generateMergeCandidate,
  generateSplitCandidate,
  generateSplitOptions,
} from '../../src/engine/token-spacing.js';

/** Runs the merge check on the last two words of `text`. */
function merge(text: string) {
  const match = /(\S+)\s(\S+)\s*$/.exec(text);
  if (!match) return null;
  const currentStart = text.lastIndexOf(match[2]!);
  const previousStart = text.lastIndexOf(match[1]!, currentStart - 1);
  return generateMergeCandidate({
    text,
    previousStart,
    previousEnd: previousStart + match[1]!.length,
    currentStart,
    currentEnd: currentStart + match[2]!.length,
  });
}

function split(word: string, text = word) {
  const start = text.indexOf(word);
  return generateSplitCandidate({ text, start, end: start + word.length });
}

describe('accidental space merge', () => {
  it('merges a broken word', () => {
    const candidate = merge('impro vement');
    expect(candidate).not.toBeNull();
    expect(candidate!.originalText).toBe('impro vement');
    expect(candidate!.replacementText).toBe('improvement');
    expect(candidate!.source).toBe('accidental-space-merge');
    expect(candidate!.confidence).toBeGreaterThanOrEqual(0.97);
  });

  it('covers the whole span as one correction, not two words', () => {
    const text = 'the impro vement here';
    const candidate = merge('the impro vement');
    expect(candidate).not.toBeNull();
    expect(text.slice(candidate!.start, candidate!.end)).toBe('impro vement');
  });

  it('preserves the leading capital', () => {
    const candidate = merge('Impro vement');
    expect(candidate!.replacementText).toBe('Improvement');
  });

  for (const phrase of [
    'ice cream',
    'peanut butter',
    'web browser',
    'credit card',
    'high school',
    'data base',
  ]) {
    it(`never automatically merges "${phrase}"`, () => {
      const candidate = merge(phrase);
      // Either no candidate at all, or a suggestion - never automatic.
      if (candidate) expect(candidate.confidence).toBeLessThan(0.95);
    });
  }

  it('does not merge across punctuation', () => {
    expect(merge('impro, vement')).toBeNull();
  });

  it('does not merge across two spaces', () => {
    expect(merge('impro  vement')).toBeNull();
  });

  it('refuses protected tokens', () => {
    expect(merge('visit https://x.com/impro vement')).toBeNull();
    expect(merge('call get_impro vement')).toBeNull();
  });

  it('refuses fragments containing digits', () => {
    expect(merge('impro4 vement')).toBeNull();
  });

  it('returns nothing when the joined form is not a word', () => {
    expect(merge('qwer tyui')).toBeNull();
  });
});

describe('missing space split', () => {
  it('splits a joined compound', () => {
    const candidate = split('improvementability');
    expect(candidate).not.toBeNull();
    expect(candidate!.originalText).toBe('improvementability');
    expect(candidate!.replacementText).toBe('improvement ability');
    expect(candidate!.source).toBe('missing-space-split');
    expect(candidate!.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('preserves the leading capital', () => {
    expect(split('Improvementability')!.replacementText).toBe('Improvement ability');
  });

  for (const word of [
    'another',
    'software',
    'football',
    'without',
    'something',
    'database',
    'inside',
    'outside',
  ]) {
    it(`never splits the valid word "${word}"`, () => {
      expect(split(word)).toBeNull();
    });
  }

  it('keeps short joined words as suggestions rather than automatic', () => {
    for (const word of ['helloworld', 'webbrowser']) {
      const candidate = split(word);
      if (candidate) expect(candidate.confidence).toBeLessThan(0.95);
    }
  });

  it('refuses identifiers, addresses, paths and mixed strings', () => {
    expect(split('CamelCase')).toBeNull();
    expect(split('snake_case')).toBeNull();
    expect(split('kebab-case')).toBeNull();
    expect(split('username123')).toBeNull();
    expect(split('name@example.com', 'mail name@example.com now')).toBeNull();
    expect(split('file/path', 'open file/path now')).toBeNull();
  });

  it('refuses a URL', () => {
    expect(split('example', 'see https://example.com/x now')).toBeNull();
  });

  it('lists every dictionary split, best first', () => {
    const options = generateSplitOptions('improvementability');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toMatchObject({ left: 'improvement', right: 'ability' });
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1]!.score).toBeGreaterThanOrEqual(options[i]!.score);
    }
  });

  it('does not split a word with no valid decomposition', () => {
    expect(split('qwertyuiopx')).toBeNull();
  });
});

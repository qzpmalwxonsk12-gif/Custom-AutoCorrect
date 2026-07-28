import { describe, expect, it, vi } from 'vitest';
import {
  buildPreview,
  commonPrefixLength,
  commonSuffixLength,
  debounce,
  fnv1a,
  normaliseRuleText,
  paragraphAt,
  ruleId,
  sentenceAt,
} from '../../src/shared/util.js';

describe('fnv1a', () => {
  it('is stable and eight hex characters', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});

describe('common prefix/suffix', () => {
  it('measures the shared ends case-insensitively', () => {
    expect(commonSuffixLength('I think ', 'you think ')).toBe(7);
    expect(commonPrefixLength(' happened', ' Happened now')).toBe(9);
    expect(commonSuffixLength('abc', 'xyz')).toBe(0);
  });
});

describe('paragraphAt / sentenceAt', () => {
  const text = 'First line here.\nSecond paragraph. With two sentences.\nThird.';

  it('finds paragraph bounds', () => {
    const p = paragraphAt(text, 20);
    expect(text.slice(p.start, p.end)).toBe('Second paragraph. With two sentences.');
  });

  it('finds sentence bounds inside a paragraph', () => {
    const s = sentenceAt(text, 20);
    expect(text.slice(s.start, s.end)).toBe('Second paragraph. ');
  });

  it('clamps at the ends of the text', () => {
    expect(paragraphAt(text, 0).start).toBe(0);
    expect(paragraphAt(text, text.length).end).toBe(text.length);
  });
});

describe('buildPreview', () => {
  const text = 'A long line of text where the correction lives somewhere in the middle of it all.';

  it('adds ellipses when truncated', () => {
    const preview = buildPreview(text, 40, 45, 10);
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).toContain('lives');
  });

  it('returns nothing when context storage is disabled', () => {
    expect(buildPreview(text, 40, 45, 0)).toBe('');
  });

  it('does not add an ellipsis at the true edges', () => {
    expect(buildPreview('short text', 0, 5, 50)).toBe('short text');
  });
});

describe('ruleId', () => {
  it('lower-cases both sides', () => {
    expect(ruleId('Waht', 'What')).toBe('waht->what');
  });

  it('canonicalises Unicode apostrophe variants', () => {
    expect(normaliseRuleText('CAN\u2019T')).toBe("can't");
    expect(ruleId('can\u02bcr', 'can\u2019t')).toBe("can'r->can't");
  });
});

describe('debounce', () => {
  it('coalesces calls and supports flush/cancel', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const fn = debounce(spy, 100);
    fn(1);
    fn(2);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(2);

    fn(3);
    fn.flush();
    expect(spy).toHaveBeenCalledTimes(2);

    fn(4);
    fn.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

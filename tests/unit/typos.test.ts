import { describe, expect, it } from 'vitest';
import { lookupTypo, typoTable } from '../../src/engine/data/typos.js';

describe('shipped typo data', () => {
  it('preserves quoted multiword replacements', () => {
    expect(lookupTypo('alot')).toBe('a lot');
    expect(lookupTypo('noone')).toBe('no one');
    expect(lookupTypo('ofcourse')).toBe('of course');
    expect(lookupTypo('outof')).toBe('out of');
  });

  it('does not auto-rewrite valid words or regional spellings', () => {
    for (const word of ['ut', 'fro', 'dependant', 'judgement', 'lightening', 'themself']) {
      expect(lookupTypo(word)).toBeUndefined();
    }
  });

  it('contains only complete non-empty mappings', () => {
    const table = typoTable();
    expect(table.size).toBeGreaterThan(300);
    for (const [original, replacement] of table) {
      expect(original.trim(), original).toBe(original);
      expect(replacement.trim(), original).toBe(replacement);
      expect(original.length, original).toBeGreaterThan(0);
      expect(replacement.length, original).toBeGreaterThan(0);
      expect(replacement, original).not.toBe(original);
      expect(replacement, original).not.toContain('"');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  KEY_NEIGHBOURS,
  KEY_NEIGHBOUR_SYMMETRY_EXCEPTIONS,
  areAdjacent,
  keyDistance,
  neighbours,
  proximityScore,
} from '../../src/engine/keyboard-distance.js';

const MAP: Readonly<Record<string, readonly string[]>> = KEY_NEIGHBOURS;
const ALPHABET = [...'abcdefghijklmnopqrstuvwxyz'];

function unorderedPair(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

describe('keyDistance', () => {
  it('is zero for the same key', () => {
    expect(keyDistance('a', 'a')).toBe(0);
  });

  it('is small for neighbouring keys', () => {
    expect(keyDistance('a', 's')).toBeCloseTo(1, 5);
    expect(keyDistance('q', 'w')).toBeCloseTo(1, 5);
  });

  it('is large for opposite ends of the keyboard', () => {
    expect(keyDistance('q', 'p')).toBeGreaterThan(8);
  });

  it('returns Infinity for unknown characters', () => {
    expect(keyDistance('a', '£')).toBe(Infinity);
  });

  it('is case-insensitive', () => {
    expect(keyDistance('A', 's')).toBe(keyDistance('a', 's'));
  });
});

describe('areAdjacent', () => {
  it('accepts horizontal and diagonal neighbours', () => {
    expect(areAdjacent('a', 's')).toBe(true);
    expect(areAdjacent('s', 'w')).toBe(true);
    expect(areAdjacent('i', 'o')).toBe(true);
  });

  it('rejects distant keys and identical keys', () => {
    expect(areAdjacent('a', 'l')).toBe(false);
    expect(areAdjacent('a', 'a')).toBe(false);
  });

  it('uses the explicit map even when coordinate distance exceeds the old threshold', () => {
    expect(keyDistance('g', 'r')).toBeGreaterThan(1.2);
    expect(areAdjacent('g', 'r')).toBe(true);
  });
});

describe('proximityScore', () => {
  it('scores a neighbouring-key slip highly', () => {
    expect(proximityScore('wprd', 'word')).toBeGreaterThan(0.9);
  });

  it('scores a distant-key difference at zero-ish', () => {
    expect(proximityScore('wqrd', 'word')).toBeLessThan(0.2);
  });

  it('returns 0 when lengths differ', () => {
    expect(proximityScore('wrd', 'word')).toBe(0);
  });

  it('penalises two differences relative to one', () => {
    expect(proximityScore('wprf', 'word')).toBeLessThan(proximityScore('wprd', 'word'));
  });

  it('normalises case before comparing keys', () => {
    expect(proximityScore('I', 'i')).toBe(1);
    expect(proximityScore('WPRD', 'word')).toBe(proximityScore('wprd', 'word'));
  });

  it('always returns a value in the inclusive 0..1 range', () => {
    for (const [typed, intended] of [
      ['word', 'word'],
      ['wprd', 'word'],
      ['wqrd', 'word'],
      ['wprf', 'word'],
      ['abc', 'xyz'],
      ['a£c', 'abc'],
    ]) {
      const score = proximityScore(typed!, intended!);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('neighbours', () => {
  it('lists physically adjacent keys', () => {
    const result = neighbours('s');
    expect(result).toContain('a');
    expect(result).toContain('d');
    expect(result).toContain('w');
    expect(result).not.toContain('s');
    expect(result).not.toContain('p');
  });

  it('handles uppercase lookup without returning the source key', () => {
    expect(neighbours('I')).toEqual(neighbours('i'));
    expect(neighbours('I')).toContain('o');
    expect(neighbours('I')).not.toContain('i');
  });

  it('returns nothing for unknown characters', () => {
    expect(neighbours('7')).toEqual([]);
  });

  it('returns a copy rather than exposing the source map', () => {
    const result = neighbours('i');
    result.push('x');
    expect(KEY_NEIGHBOURS.i).not.toContain('x');
  });
});

describe('KEY_NEIGHBOURS validation', () => {
  it('defines every lowercase English letter exactly once', () => {
    expect(Object.keys(KEY_NEIGHBOURS).sort()).toEqual(ALPHABET);
  });

  it('contains only unique lowercase letter keys and never the source key', () => {
    for (const [key, values] of Object.entries(KEY_NEIGHBOURS)) {
      expect(new Set(values).size, `${key} contains a duplicate`).toBe(values.length);
      expect(values, `${key} contains itself`).not.toContain(key);
      for (const value of values) {
        expect(value, `${key} has invalid neighbour ${value}`).toMatch(/^[a-z]$/);
      }
    }
  });

  it('keeps the four deliberate corners at exactly two neighbours', () => {
    expect(KEY_NEIGHBOURS.q).toEqual(['w', 'a']);
    expect(KEY_NEIGHBOURS.p).toEqual(['o', 'l']);
    expect(KEY_NEIGHBOURS.z).toEqual(['a', 'x']);
    expect(KEY_NEIGHBOURS.m).toEqual(['l', 'n']);
  });

  it('uses five neighbours for every non-corner top and bottom key', () => {
    for (const key of [...'wertyuio', ...'xcvbn']) {
      expect(MAP[key], key).toHaveLength(5);
    }
  });

  it('defines the required W, I and O regions', () => {
    expect(KEY_NEIGHBOURS.w).toEqual(['q', 'e', 'a', 's', 'd']);
    expect(KEY_NEIGHBOURS.i).toEqual(['u', 'o', 'j', 'k', 'l']);
    expect(KEY_NEIGHBOURS.o).toEqual(['i', 'p', 'j', 'k', 'l']);
  });

  it('defines the full eight-key region for central middle-row keys', () => {
    expect(KEY_NEIGHBOURS.s).toEqual(['q', 'w', 'e', 'a', 'd', 'z', 'x', 'c']);
    expect(KEY_NEIGHBOURS.d).toEqual(['w', 'e', 'r', 's', 'f', 'x', 'c', 'v']);
    expect(KEY_NEIGHBOURS.f).toEqual(['e', 'r', 't', 'd', 'g', 'c', 'v', 'b']);
    expect(KEY_NEIGHBOURS.g).toEqual(['r', 't', 'y', 'f', 'h', 'v', 'b', 'n']);
    expect(KEY_NEIGHBOURS.h).toEqual(['t', 'y', 'u', 'g', 'j', 'b', 'n', 'm']);
  });

  it('is symmetrical except for the centrally documented corner pairs', () => {
    const declared = new Set(
      KEY_NEIGHBOUR_SYMMETRY_EXCEPTIONS.map(([a, b]) => unorderedPair(a, b)),
    );
    const observed = new Set<string>();

    for (const [key, values] of Object.entries(KEY_NEIGHBOURS)) {
      for (const neighbour of values) {
        if (!MAP[neighbour]?.includes(key)) {
          observed.add(unorderedPair(key, neighbour));
        }
      }
    }

    expect([...observed].sort()).toEqual([...declared].sort());
  });
});

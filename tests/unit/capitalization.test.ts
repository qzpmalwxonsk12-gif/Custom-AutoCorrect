import { describe, expect, it } from 'vitest';
import { applyCaseStyle, capitalise, detectCaseStyle, matchCase } from '../../src/engine/capitalization.js';

describe('detectCaseStyle', () => {
  it('classifies the common styles', () => {
    expect(detectCaseStyle('waht')).toBe('lower');
    expect(detectCaseStyle('Waht')).toBe('title');
    expect(detectCaseStyle('WAHT')).toBe('upper');
    expect(detectCaseStyle('wAhT')).toBe('mixed');
  });

  it('treats non-alphabetic input as lower', () => {
    expect(detectCaseStyle("'")).toBe('lower');
  });
});

describe('matchCase', () => {
  it('preserves the capitalisation of the word being replaced', () => {
    expect(matchCase('Waht', 'what')).toBe('What');
    expect(matchCase('WAHT', 'what')).toBe('WHAT');
    expect(matchCase('waht', 'what')).toBe('what');
  });

  it('leaves mixed case alone', () => {
    expect(matchCase('wAhT', 'what')).toBe('what');
  });

  it('works for multi-word replacements', () => {
    expect(matchCase('Alot', 'a lot')).toBe('A lot');
  });

  it('round-trips for reverts', () => {
    // "What" was written by us; reverting must restore "Waht", not "waht".
    expect(matchCase('What', 'waht')).toBe('Waht');
  });
});

describe('applyCaseStyle / capitalise', () => {
  it('applies an explicit style', () => {
    expect(applyCaseStyle('what', 'upper')).toBe('WHAT');
    expect(applyCaseStyle('WHAT', 'title')).toBe('What');
  });

  it('capitalises the first letter only', () => {
    expect(capitalise('what')).toBe('What');
    expect(capitalise('')).toBe('');
  });
});

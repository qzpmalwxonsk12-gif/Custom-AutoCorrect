import { describe, expect, it } from 'vitest';
import { filterRecords, groupRecords, matchesFilter } from '../../src/history/correction-history.js';
import type { CorrectionRecord, CorrectionType } from '../../src/shared/types.js';

const NOW = 1_700_000_000_000;

function record(overrides: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    id: overrides.id ?? `r${Math.random()}`,
    sessionId: 's',
    originalText: 'teh',
    replacementText: 'the',
    correctionType: 'spelling',
    confidence: 0.95,
    status: 'pending',
    createdAt: NOW,
    anchor: {
      approximateOffset: 0,
      textBefore: '',
      originalText: 'teh',
      replacementText: 'the',
      textAfter: '',
      occurrenceIndex: 0,
    },
    contextPreview: 'I think the cat',
    autoApplied: true,
    learningApplied: false,
    ...overrides,
  };
}

describe('filters', () => {
  it('groups all the letter-level types under Spelling', () => {
    const types: CorrectionType[] = [
      'spelling',
      'keyboard-proximity',
      'adjacent-swap',
      'duplicate-letter',
      'missing-letter',
      'extra-letter',
    ];
    for (const correctionType of types) {
      expect(matchesFilter(record({ correctionType }), 'spelling'), correctionType).toBe(true);
    }
  });

  it('separates spacing and punctuation from spelling', () => {
    expect(matchesFilter(record({ correctionType: 'token-merge' }), 'spacing')).toBe(true);
    expect(matchesFilter(record({ correctionType: 'token-split' }), 'spacing')).toBe(true);
    expect(matchesFilter(record({ correctionType: 'token-split' }), 'spelling')).toBe(false);
    expect(matchesFilter(record({ correctionType: 'punctuation' }), 'punctuation')).toBe(true);
  });

  it('separates automatic changes from accepted suggestions', () => {
    expect(matchesFilter(record({ autoApplied: true }), 'automatic')).toBe(true);
    expect(matchesFilter(record({ autoApplied: true }), 'suggestion')).toBe(false);
    expect(matchesFilter(record({ autoApplied: false }), 'suggestion')).toBe(true);
  });

  it('still filters by status and search text', () => {
    const records = [
      record({ id: 'a', status: 'reverted', originalText: 'teh' }),
      record({ id: 'b', status: 'pending', originalText: 'commmon', replacementText: 'common' }),
    ];
    expect(filterRecords(records, 'reverted').map((r) => r.id)).toEqual(['a']);
    expect(filterRecords(records, 'all', 'commmon').map((r) => r.id)).toEqual(['b']);
  });
});

describe('groupRecords', () => {
  it('returns one anonymous group when grouping is off', () => {
    const records = [record(), record()];
    const groups = groupRecords(records, 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.records).toHaveLength(2);
    expect(groups[0]!.label).toBe('');
  });

  it('groups by paragraph fingerprint', () => {
    const records = [
      record({ id: 'a', anchor: { ...record().anchor, paragraphFingerprint: 'p1' } }),
      record({ id: 'b', anchor: { ...record().anchor, paragraphFingerprint: 'p2' } }),
      record({ id: 'c', anchor: { ...record().anchor, paragraphFingerprint: 'p1' } }),
    ];
    const groups = groupRecords(records, 'paragraph');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.records.map((r) => r.id)).toEqual(['a', 'c']);
    // A fingerprint means nothing to a reader, so the group is named by text.
    expect(groups[0]!.label).toContain('I think the cat');
  });

  it('buckets by age, newest bucket first', () => {
    const records = [
      record({ id: 'now', createdAt: NOW - 1_000 }),
      record({ id: 'hour', createdAt: NOW - 30 * 60_000 }),
      record({ id: 'day', createdAt: NOW - 6 * 60 * 60_000 }),
      record({ id: 'week', createdAt: NOW - 3 * 24 * 60 * 60_000 }),
      record({ id: 'old', createdAt: NOW - 30 * 24 * 60 * 60_000 }),
    ];
    const groups = groupRecords(records, 'time', { now: NOW });
    expect(groups.map((g) => g.label)).toEqual([
      'Last few minutes',
      'Last hour',
      'Today',
      'This week',
      'Older',
    ]);
  });

  it('groups by site and by field using the supplied labels', () => {
    const records = [record(), record()];
    expect(groupRecords(records, 'site', { siteLabel: 'example.com' })[0]!.label).toBe(
      'example.com',
    );
    expect(groupRecords(records, 'field', { fieldLabel: 'Message body' })[0]!.label).toBe(
      'Message body',
    );
  });

  it('never loses a record while grouping', () => {
    const records = Array.from({ length: 9 }, (_, i) =>
      record({ id: `r${i}`, createdAt: NOW - i * 60 * 60_000 }),
    );
    for (const grouping of ['none', 'site', 'field', 'paragraph', 'time'] as const) {
      const total = groupRecords(records, grouping, { now: NOW }).reduce(
        (sum, group) => sum + group.records.length,
        0,
      );
      expect(total, grouping).toBe(records.length);
    }
  });

  it('handles an empty list', () => {
    expect(groupRecords([], 'time')).toHaveLength(1);
    expect(groupRecords([], 'time')[0]!.records).toHaveLength(0);
  });
});

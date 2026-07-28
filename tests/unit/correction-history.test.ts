import { describe, expect, it } from 'vitest';
import {
  autoAcceptStale,
  countRecords,
  expireSessions,
  filterRecords,
  isExpired,
  matchesQuery,
  pendingRecords,
} from '../../src/history/correction-history.js';
import { canTransition, holdsReplacement, isOpen, transition } from '../../src/history/correction-record.js';
import { recordAt, session } from '../helpers.js';

const TEXT = 'I think what happened was fine and what a day.';

function makeRecords() {
  const a = recordAt(TEXT, 8, 'waht', 'what');
  const b = recordAt(TEXT, 35, 'waht', 'what');
  const c = recordAt(TEXT, 8, 'form', 'from');
  c.correctionType = 'contextual';
  c.confidence = 0.7;
  const d = recordAt(TEXT, 8, 'a', 'an');
  d.correctionType = 'grammar';
  return { a, b, c, d };
}

describe('status transitions', () => {
  it('allows the expected moves and blocks the rest', () => {
    expect(canTransition('pending', 'accepted')).toBe(true);
    expect(canTransition('pending', 'reverted')).toBe(true);
    expect(canTransition('accepted', 'reverted')).toBe(true);
    expect(canTransition('superseded', 'accepted')).toBe(false);
    expect(canTransition('reverted', 'skipped')).toBe(false);
  });

  it('records the reason and review time', () => {
    const { a } = makeRecords();
    expect(transition(a, 'reverted', { rejectionReason: 'never-this-pair' })).toBe(true);
    expect(a.status).toBe('reverted');
    expect(a.rejectionReason).toBe('never-this-pair');
    expect(a.reviewedAt).toBeGreaterThan(0);
  });

  it('refuses illegal transitions without mutating the record', () => {
    const { a } = makeRecords();
    transition(a, 'superseded');
    expect(transition(a, 'accepted')).toBe(false);
    expect(a.status).toBe('superseded');
  });

  it('knows which statuses still hold the replacement', () => {
    const { a } = makeRecords();
    expect(holdsReplacement(a)).toBe(true);
    expect(isOpen(a)).toBe(true);
    transition(a, 'reverted');
    expect(holdsReplacement(a)).toBe(false);
    expect(isOpen(a)).toBe(false);
  });
});

describe('counts and filters', () => {
  it('counts by bucket', () => {
    const { a, b, c, d } = makeRecords();
    transition(b, 'accepted');
    transition(c, 'reverted');
    transition(d, 'unresolved');
    const counts = countRecords([a, b, c, d]);
    expect(counts).toEqual({ total: 4, pending: 1, accepted: 1, reverted: 1, unresolved: 1 });
  });

  it('isolates grammar-engine findings applied without asking', () => {
    const { a, b, c, d } = makeRecords();
    // Auto-applied by the grammar engine.
    d.correctionType = 'grammar';
    d.sourceRuleId = 'harper:RepeatedWords';
    d.autoApplied = true;
    // Same engine, but the user accepted a chip: not auto-applied.
    c.correctionType = 'grammar';
    c.sourceRuleId = 'harper:ItsContraction';
    c.autoApplied = false;
    // A word-lane autocorrection: auto-applied, but not a grammar finding.
    a.autoApplied = true;
    b.autoApplied = true;

    const all = [a, b, c, d];
    expect(filterRecords(all, 'auto-grammar')).toEqual([d]);
    // The broader grammar filter still shows both engine records.
    expect(filterRecords(all, 'grammar')).toHaveLength(2);
  });

  it('filters by status and type', () => {
    const { a, b, c, d } = makeRecords();
    transition(b, 'accepted');
    const all = [a, b, c, d];
    expect(filterRecords(all, 'pending')).toHaveLength(3);
    expect(filterRecords(all, 'accepted')).toHaveLength(1);
    expect(filterRecords(all, 'spelling')).toHaveLength(2);
    expect(filterRecords(all, 'contextual')).toHaveLength(1);
    expect(filterRecords(all, 'grammar')).toHaveLength(1);
    expect(filterRecords(all, 'low-confidence')).toHaveLength(1);
    expect(filterRecords(all, 'all')).toHaveLength(4);
  });

  it('searches original, replacement and context', () => {
    const { a, c } = makeRecords();
    expect(matchesQuery(a, 'waht')).toBe(true);
    expect(matchesQuery(a, 'WHAT')).toBe(true);
    expect(matchesQuery(a, 'happened')).toBe(true);
    expect(matchesQuery(a, 'zebra')).toBe(false);
    expect(matchesQuery(c, 'contextual')).toBe(true);
    expect(filterRecords([a, c], 'all', 'from')).toHaveLength(1);
  });

  it('lists pending and skipped as reviewable', () => {
    const { a, b } = makeRecords();
    transition(b, 'skipped');
    expect(pendingRecords([a, b])).toHaveLength(2);
  });
});

describe('session lifecycle', () => {
  it('expires by retention window', () => {
    const s = session();
    s.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(isExpired(s, 7)).toBe(true);
    expect(isExpired(s, 30)).toBe(false);
    expect(isExpired(s, 0)).toBe(false); // 0 = keep forever
  });

  it('removes expired sessions from a map', () => {
    const fresh = session();
    const old = { ...session(), id: 's_old', updatedAt: Date.now() - 40 * 24 * 3600 * 1000 };
    const map = { [fresh.id]: fresh, [old.id]: old };
    expect(expireSessions(map, 7)).toEqual(['s_old']);
    expect(Object.keys(map)).toEqual([fresh.id]);
  });

  it('auto-accepts stale pending corrections when configured', () => {
    const { a, b } = makeRecords();
    a.createdAt = Date.now() - 60 * 60 * 1000;
    const s = session([a, b]);
    expect(autoAcceptStale(s, 0)).toHaveLength(0); // disabled
    const changed = autoAcceptStale(s, 30);
    expect(changed).toHaveLength(1);
    expect(a.status).toBe('auto-accepted');
    expect(b.status).toBe('pending');
  });
});

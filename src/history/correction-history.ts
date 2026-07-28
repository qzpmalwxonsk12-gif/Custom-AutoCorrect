/** Session-level history operations: counts, filtering, search, expiry. */
import { isHarperRuleId } from '../shared/grammar.js';
import { fnv1a, normaliseForFingerprint } from '../shared/util.js';
import type {
  CorrectionRecord,
  CorrectionSession,
  CorrectionStatus,
  CorrectionType,
  SessionCounts,
} from '../shared/types.js';

export type FilterKey =
  | 'all'
  | 'pending'
  | 'accepted'
  | 'reverted'
  | 'rejected'
  | 'unresolved'
  | 'spelling'
  | 'spacing'
  | 'punctuation'
  | 'grammar'
  | 'auto-grammar'
  | 'automatic'
  | 'suggestion'
  | 'contextual'
  | 'personal'
  | 'low-confidence';

const TYPE_FILTERS: Partial<Record<FilterKey, CorrectionType[]>> = {
  spelling: [
    'spelling',
    'keyboard-proximity',
    'adjacent-swap',
    'duplicate-letter',
    'missing-letter',
    'extra-letter',
  ],
  spacing: ['token-merge', 'token-split'],
  punctuation: ['punctuation'],
  grammar: ['grammar'],
  contextual: ['contextual'],
  personal: ['personal-rule', 'exact-rule'],
};

const STATUS_FILTERS: Partial<Record<FilterKey, CorrectionStatus[]>> = {
  pending: ['pending', 'skipped'],
  accepted: ['accepted', 'auto-accepted'],
  reverted: ['reverted'],
  rejected: ['rejected'],
  unresolved: ['unresolved', 'superseded'],
};

export function textFingerprint(text: string): string {
  return fnv1a(normaliseForFingerprint(text.slice(0, 4000)));
}

export function countRecords(records: readonly CorrectionRecord[]): SessionCounts {
  const counts: SessionCounts = { total: 0, pending: 0, accepted: 0, reverted: 0, unresolved: 0 };
  for (const r of records) {
    counts.total++;
    switch (r.status) {
      case 'pending':
      case 'skipped':
        counts.pending++;
        break;
      case 'accepted':
      case 'auto-accepted':
        counts.accepted++;
        break;
      case 'reverted':
      case 'rejected':
        counts.reverted++;
        break;
      case 'unresolved':
      case 'superseded':
        counts.unresolved++;
        break;
    }
  }
  return counts;
}

/**
 * True for a grammar-engine finding that was written into the text without the
 * user confirming it. Excludes the word lane's own autocorrections, which are
 * also `autoApplied` but are not grammar-engine findings.
 */
export function isAutoAppliedGrammar(record: CorrectionRecord): boolean {
  return (
    record.autoApplied &&
    record.correctionType === 'grammar' &&
    isHarperRuleId(record.sourceRuleId)
  );
}

export function matchesFilter(record: CorrectionRecord, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'low-confidence') return record.confidence < 0.8;
  if (filter === 'auto-grammar') return isAutoAppliedGrammar(record);
  if (filter === 'automatic') return record.autoApplied;
  if (filter === 'suggestion') return !record.autoApplied;
  const statuses = STATUS_FILTERS[filter];
  if (statuses) return statuses.includes(record.status);
  const types = TYPE_FILTERS[filter];
  if (types) return types.includes(record.correctionType);
  return true;
}

/* ------------------------------ grouping ------------------------------ */

export type GroupKey = 'none' | 'site' | 'field' | 'paragraph' | 'time';

export interface RecordGroup {
  key: string;
  label: string;
  records: CorrectionRecord[];
}

/** Buckets used by time grouping, coarse enough to stay readable. */
function timeBucket(timestamp: number, now: number): { key: string; label: string } {
  const age = now - timestamp;
  if (age < 5 * 60_000) return { key: 't0', label: 'Last few minutes' };
  if (age < 60 * 60_000) return { key: 't1', label: 'Last hour' };
  if (age < 24 * 60 * 60_000) return { key: 't2', label: 'Today' };
  if (age < 7 * 24 * 60 * 60_000) return { key: 't3', label: 'This week' };
  return { key: 't4', label: 'Older' };
}

/**
 * Splits records into display groups, preserving the order they were given in.
 *
 * Paragraph grouping uses the anchor's paragraph fingerprint, which is already
 * stored for relocation - so grouping costs nothing extra and stays correct
 * when the surrounding text moves.
 */
export function groupRecords(
  records: readonly CorrectionRecord[],
  grouping: GroupKey,
  context: { siteLabel?: string; fieldLabel?: string; now?: number } = {},
): RecordGroup[] {
  if (grouping === 'none' || records.length === 0) {
    return [{ key: 'all', label: '', records: [...records] }];
  }
  const now = context.now ?? Date.now();
  const groups = new Map<string, RecordGroup>();

  for (const record of records) {
    let key: string;
    let label: string;
    switch (grouping) {
      case 'site':
        key = context.siteLabel ?? 'this site';
        label = key;
        break;
      case 'field':
        key = context.fieldLabel || 'This field';
        label = key;
        break;
      case 'paragraph': {
        key = record.anchor.paragraphFingerprint ?? 'unknown';
        // A fingerprint means nothing to a reader, so the paragraph is named by
        // the text around its first correction.
        label = record.contextPreview
          ? record.contextPreview.slice(0, 60)
          : 'Paragraph';
        break;
      }
      case 'time': {
        const bucket = timeBucket(record.createdAt, now);
        key = bucket.key;
        label = bucket.label;
        break;
      }
    }
    const existing = groups.get(key);
    if (existing) existing.records.push(record);
    else groups.set(key, { key, label, records: [record] });
  }
  return [...groups.values()];
}

export function matchesQuery(record: CorrectionRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    record.originalText.toLowerCase().includes(q) ||
    record.replacementText.toLowerCase().includes(q) ||
    record.contextPreview.toLowerCase().includes(q) ||
    record.correctionType.includes(q)
  );
}

export function filterRecords(
  records: readonly CorrectionRecord[],
  filter: FilterKey,
  query = '',
): CorrectionRecord[] {
  return records.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query));
}

export function pendingRecords(records: readonly CorrectionRecord[]): CorrectionRecord[] {
  return records.filter((r) => r.status === 'pending' || r.status === 'skipped');
}

export function findRecord(
  session: CorrectionSession,
  id: string,
): CorrectionRecord | undefined {
  return session.records.find((r) => r.id === id);
}

/** True when the session has aged past the retention window. */
export function isExpired(
  session: CorrectionSession,
  retentionDays: number,
  now = Date.now(),
): boolean {
  if (retentionDays <= 0) return false;
  return now - session.updatedAt > retentionDays * 24 * 60 * 60 * 1000;
}

export function expireSessions(
  sessions: Record<string, CorrectionSession>,
  retentionDays: number,
  now = Date.now(),
): string[] {
  const removed: string[] = [];
  for (const [id, session] of Object.entries(sessions)) {
    if (isExpired(session, retentionDays, now)) {
      delete sessions[id];
      removed.push(id);
    }
  }
  return removed;
}

/**
 * Marks pending corrections older than `minutes` as auto-accepted, mirroring
 * the "I never reviewed it, so I meant to keep it" setting.
 */
export function autoAcceptStale(
  session: CorrectionSession,
  minutes: number,
  now = Date.now(),
): CorrectionRecord[] {
  if (minutes <= 0) return [];
  const cutoff = now - minutes * 60 * 1000;
  const changed: CorrectionRecord[] = [];
  for (const r of session.records) {
    if (r.status === 'pending' && r.createdAt < cutoff) {
      r.status = 'auto-accepted';
      r.reviewedAt = now;
      changed.push(r);
    }
  }
  return changed;
}

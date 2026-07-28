/** Presentation helpers shared by the list and the review bar. */
import type { CorrectionRecord, CorrectionStatus, CorrectionType } from '../shared/types.js';

export const STATUS_LABEL: Record<CorrectionStatus, string> = {
  pending: 'Pending review',
  accepted: 'Accepted',
  'auto-accepted': 'Auto-accepted',
  reverted: 'Reverted',
  rejected: 'Rejected',
  skipped: 'Skipped',
  unresolved: 'Location unresolved',
  superseded: 'Superseded by later edit',
};

export const TYPE_LABEL: Record<CorrectionType, string> = {
  'exact-rule': 'Your rule',
  'personal-rule': 'Learned rule',
  spelling: 'Spelling',
  'adjacent-swap': 'Swapped letters',
  'keyboard-proximity': 'Keyboard slip',
  'duplicate-letter': 'Duplicate letter',
  'missing-letter': 'Missing letter',
  'extra-letter': 'Extra letter',
  'token-merge': 'Joined words',
  'token-split': 'Split words',
  'repeated-word': 'Repeated word',
  'missing-apostrophe': 'Apostrophe',
  contextual: 'Context',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  capitalisation: 'Capitalisation',
};

/** Records written by older builds may carry a type this build removed. */
export function typeLabel(type: CorrectionType | string): string {
  return TYPE_LABEL[type as CorrectionType] ?? 'Correction';
}

export const REASON_LABEL: Record<string, string> = {
  'revert-once': 'reverted once',
  'lower-confidence': 'confidence lowered',
  'never-this-pair': 'blocked this replacement',
  'never-correct-word': 'added to dictionary',
  'not-in-this-context': 'blocked in this context',
  'keep-no-learn': 'kept without learning',
};

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function confidenceText(c: number): string {
  return `${Math.round(c * 100)}% confidence`;
}

/** The key/value block shown when an item is expanded. */
export function detailRows(record: CorrectionRecord): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Type', TYPE_LABEL[record.correctionType]],
    ['Confidence', confidenceText(record.confidence)],
    ['Status', STATUS_LABEL[record.status]],
    ['Applied', record.autoApplied ? 'automatically' : 'from a suggestion'],
    ['Learned', record.learningApplied ? 'yes' : 'no'],
    ['Corrected', new Date(record.createdAt).toLocaleString()],
  ];
  if (record.keyboardSubstitution) {
    const evidence = record.keyboardSubstitution;
    rows.splice(
      1,
      0,
      ['Reason', 'Keyboard-neighbour substitution'],
      [
        'Key change',
        `Position ${evidence.index + 1}: ${evidence.typedCharacter} → ${evidence.replacementCharacter}`,
      ],
      ['Dictionary', 'ESDB'],
    );
  }
  if (record.reviewedAt) rows.push(['Reviewed', new Date(record.reviewedAt).toLocaleString()]);
  if (record.rejectionReason) {
    rows.push(['Decision', REASON_LABEL[record.rejectionReason] ?? record.rejectionReason]);
  }
  if (record.sourceRuleId) rows.push(['Rule', record.sourceRuleId]);
  if (record.contextWords && (record.contextWords.previous || record.contextWords.next)) {
    rows.push(['Context', `${record.contextWords.previous || '—'} … ${record.contextWords.next || '—'}`]);
  }
  if (record.lastKnownRange) {
    rows.push(['Position', `${record.lastKnownRange.start}–${record.lastKnownRange.end}`]);
  } else {
    rows.push(['Position', 'not currently located']);
  }
  if (record.failureReason) rows.push(['Note', record.failureReason]);
  return rows;
}

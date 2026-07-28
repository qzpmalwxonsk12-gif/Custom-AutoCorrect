/** Correction record construction and the legal status transitions. */
import { newId } from '../shared/util.js';
import type {
  CorrectionProposal,
  CorrectionRecord,
  CorrectionStatus,
  TextAnchor,
} from '../shared/types.js';

export interface CreateRecordInput {
  sessionId: string;
  proposal: CorrectionProposal;
  anchor: TextAnchor;
  contextPreview: string;
  autoApplied: boolean;
}

export function createRecord(input: CreateRecordInput): CorrectionRecord {
  const { proposal } = input;
  const record: CorrectionRecord = {
    id: newId('c'),
    sessionId: input.sessionId,
    originalText: proposal.original,
    replacementText: proposal.replacement,
    correctionType: proposal.correctionType,
    confidence: proposal.confidence,
    status: 'pending',
    createdAt: Date.now(),
    anchor: input.anchor,
    contextPreview: input.contextPreview,
    autoApplied: input.autoApplied,
    learningApplied: false,
    lastKnownRange: { start: proposal.start, end: proposal.start + proposal.replacement.length },
  };
  if (proposal.ruleId) record.sourceRuleId = proposal.ruleId;
  // Which catalogue rule the panel may offer to change. Absent for curated and
  // personal replacements, which are governed by their own settings rather
  // than by a rule mode.
  if (proposal.controlRuleId) record.controlRuleId = proposal.controlRuleId;
  if (proposal.keyboardSubstitution) {
    record.keyboardSubstitution = { ...proposal.keyboardSubstitution };
  }
  if (proposal.letterEvidence) {
    record.letterEvidence = { ...proposal.letterEvidence };
  }
  return record;
}

/**
 * Allowed status transitions. `unresolved` and `superseded` are reachable from
 * any live state because the document can always change underneath us.
 */
const TRANSITIONS: Record<CorrectionStatus, CorrectionStatus[]> = {
  pending: ['accepted', 'auto-accepted', 'reverted', 'rejected', 'skipped', 'unresolved', 'superseded'],
  skipped: ['accepted', 'auto-accepted', 'reverted', 'rejected', 'pending', 'unresolved', 'superseded'],
  accepted: ['reverted', 'unresolved', 'superseded'],
  'auto-accepted': ['accepted', 'reverted', 'unresolved', 'superseded'],
  reverted: ['accepted', 'unresolved', 'superseded'],
  rejected: ['reverted', 'unresolved', 'superseded'],
  unresolved: ['pending', 'accepted', 'reverted', 'superseded'],
  superseded: [],
};

export function canTransition(from: CorrectionStatus, to: CorrectionStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Applies a status change, returning false when the transition is illegal. */
export function transition(
  record: CorrectionRecord,
  to: CorrectionStatus,
  extra: Partial<Pick<CorrectionRecord, 'rejectionReason' | 'failureReason'>> = {},
): boolean {
  if (!canTransition(record.status, to)) return false;
  record.status = to;
  record.reviewedAt = Date.now();
  if (extra.rejectionReason !== undefined) record.rejectionReason = extra.rejectionReason;
  if (extra.failureReason !== undefined) record.failureReason = extra.failureReason;
  else if (to !== 'unresolved') delete record.failureReason;
  return true;
}

export function isOpen(record: CorrectionRecord): boolean {
  return record.status === 'pending' || record.status === 'skipped';
}

/** Statuses whose text still contains the replacement. */
export function holdsReplacement(record: CorrectionRecord): boolean {
  return (
    record.status === 'pending' ||
    record.status === 'skipped' ||
    record.status === 'accepted' ||
    record.status === 'auto-accepted'
  );
}

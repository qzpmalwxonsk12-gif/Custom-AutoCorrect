/**
 * Correction-session persistence.
 *
 * Sessions are stored one key each so a single field's activity never rewrites
 * unrelated history. Writes and deletes are serialised and acknowledged before
 * their message handler returns, which is required for short-lived MV3 workers.
 */
import { countRecords, isExpired } from '../history/correction-history.js';
import { areAdjacent } from '../engine/keyboard-distance.js';
import type {
  CorrectionRecord,
  CorrectionSession,
  CorrectionStatus,
  CorrectionType,
  KeyboardSubstitutionEvidence,
  RejectionReason,
  Settings,
  TextAnchor,
} from '../shared/types.js';
import { getAllRaw, getRaw, removeRaw, setRaw } from './storage.js';
import { KEYS, sessionKey, type SessionIndexEntry } from './types.js';

/** True when this session may be written to disk at all. */
export function shouldPersist(
  session: CorrectionSession,
  settings: Settings,
): boolean {
  if (!settings.persistSessions) return false;
  if (session.persistence === 'memory') return false;
  if (settings.memoryOnlyOrigins.includes(session.origin)) return false;
  return true;
}

export async function readIndex(): Promise<SessionIndexEntry[]> {
  const raw = await getRaw<unknown>(KEYS.sessionIndex);
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is SessionIndexEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const value = entry as Partial<SessionIndexEntry>;
    return (
      typeof value.id === 'string' &&
      typeof value.origin === 'string' &&
      typeof value.fieldLabel === 'string' &&
      typeof value.updatedAt === 'number' &&
      Number.isFinite(value.updatedAt) &&
      typeof value.total === 'number' &&
      typeof value.pending === 'number'
    );
  });
}

async function writeIndex(entries: SessionIndexEntry[]): Promise<void> {
  if (!(await setRaw({ [KEYS.sessionIndex]: entries }))) {
    throw new Error('Could not update the correction-session index.');
  }
}

function indexEntry(session: CorrectionSession, fieldLabel: string): SessionIndexEntry {
  const counts = countRecords(session.records);
  return {
    id: session.id,
    origin: session.origin,
    fieldLabel,
    updatedAt: session.updatedAt,
    total: counts.total,
    pending: counts.pending,
  };
}

let operationTail: Promise<void> = Promise.resolve();
let clearedAt = 0;
const deletedAt = new Map<string, number>();

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = operationTail.then(operation);
  operationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Removes stored context beyond the current privacy setting. This is enforced
 * in the background as a second line of defence even if a stale content script
 * sends an older/full record shape.
 */
export function limitSessionContext(
  session: CorrectionSession,
  radius: number,
): CorrectionSession {
  const next = structuredClone(session);
  const r = Math.max(0, Math.floor(radius));
  for (const record of next.records) {
    // Older builds stored raw element ids in this unused hint. Do not persist
    // it: the string did not participate in relocation and could expose page
    // metadata without providing a user benefit.
    delete record.anchor.domPath;
    record.anchor.textBefore = r > 0 ? record.anchor.textBefore.slice(-r) : '';
    record.anchor.textAfter = r > 0 ? record.anchor.textAfter.slice(0, r) : '';
    if (r === 0) {
      record.contextPreview = '';
      delete record.contextWords;
      delete record.anchor.paragraphFingerprint;
      delete record.anchor.sentenceFingerprint;
    } else {
      // A preview cannot be safely re-centred without the live document. Drop
      // oversized legacy previews rather than retain more text than requested.
      const maximum = r * 2 + record.replacementText.length + 2;
      if (record.contextPreview.length > maximum) record.contextPreview = '';
    }
  }
  return next;
}

const IMPORT_SESSION_LIMIT = 500;
const IMPORT_RECORD_LIMIT = 5_000;
const CORRECTION_STATUSES = new Set<CorrectionStatus>([
  'pending',
  'accepted',
  'auto-accepted',
  'reverted',
  'rejected',
  'skipped',
  'unresolved',
  'superseded',
]);
const CORRECTION_TYPES = new Set<CorrectionType>([
  'exact-rule',
  'personal-rule',
  'spelling',
  'keyboard-proximity',
  'contextual',
  'grammar',
]);
const REJECTION_REASONS = new Set<RejectionReason>([
  'revert-once',
  'lower-confidence',
  'never-this-pair',
  'never-correct-word',
  'not-in-this-context',
  'keep-no-learn',
]);

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function importedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new Error(`Invalid ${label} in imported history.`);
  }
  return value;
}

function importedNumber(value: unknown, label: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Invalid ${label} in imported history.`);
  }
  return value;
}

function importedOptionalString(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): void {
  if (source[key] === undefined) return;
  target[key] = importedString(source[key], key, maxLength, true);
}

function importAnchor(value: unknown): TextAnchor {
  const raw = object(value);
  const anchor: TextAnchor = {
    approximateOffset: importedNumber(raw.approximateOffset, 'anchor offset', true),
    textBefore: importedString(raw.textBefore, 'anchor prefix', 512, true),
    originalText: importedString(raw.originalText, 'anchor original text', 1_024, true),
    replacementText: importedString(raw.replacementText, 'anchor replacement text', 1_024, true),
    textAfter: importedString(raw.textAfter, 'anchor suffix', 512, true),
    occurrenceIndex: importedNumber(raw.occurrenceIndex, 'anchor occurrence', true),
  };
  const optional = anchor as unknown as Record<string, unknown>;
  importedOptionalString(optional, raw, 'paragraphFingerprint', 128);
  importedOptionalString(optional, raw, 'sentenceFingerprint', 128);
  importedOptionalString(optional, raw, 'domPath', 2_048);
  return anchor;
}

function importKeyboardSubstitution(value: unknown): KeyboardSubstitutionEvidence {
  const raw = object(value);
  const typedCharacter = importedString(
    raw.typedCharacter,
    'typed keyboard character',
    1,
  );
  const replacementCharacter = importedString(
    raw.replacementCharacter,
    'replacement keyboard character',
    1,
  );
  if (
    !/^[a-z]$/.test(typedCharacter) ||
    !/^[a-z]$/.test(replacementCharacter) ||
    typedCharacter === replacementCharacter ||
    typeof raw.neighbourMapMatched !== 'boolean'
  ) {
    throw new Error('Invalid keyboard-substitution evidence in imported history.');
  }
  const evidence: KeyboardSubstitutionEvidence = {
    index: importedNumber(raw.index, 'keyboard substitution index', true),
    typedCharacter,
    replacementCharacter,
    neighbourMapMatched: raw.neighbourMapMatched,
  };
  if (raw.keyDistance !== undefined) {
    const distance = importedNumber(raw.keyDistance, 'keyboard key distance');
    if (distance > 20) {
      throw new Error('Invalid keyboard key distance in imported history.');
    }
    evidence.keyDistance = distance;
  }
  return evidence;
}

function importRecord(value: unknown, sessionId: string): CorrectionRecord {
  const raw = object(value);
  const status = raw.status as CorrectionStatus;
  const correctionType = raw.correctionType as CorrectionType;
  if (!CORRECTION_STATUSES.has(status) || !CORRECTION_TYPES.has(correctionType)) {
    throw new Error('Invalid correction status or type in imported history.');
  }
  const confidence = importedNumber(raw.confidence, 'correction confidence');
  if (confidence > 1) throw new Error('Invalid correction confidence in imported history.');
  if (typeof raw.autoApplied !== 'boolean' || typeof raw.learningApplied !== 'boolean') {
    throw new Error('Invalid correction flags in imported history.');
  }

  const record: CorrectionRecord = {
    id: importedString(raw.id, 'correction id', 256),
    sessionId,
    originalText: importedString(raw.originalText, 'correction original text', 1_024, true),
    replacementText: importedString(raw.replacementText, 'correction replacement text', 1_024, true),
    correctionType,
    confidence,
    status,
    createdAt: importedNumber(raw.createdAt, 'correction timestamp'),
    anchor: importAnchor(raw.anchor),
    contextPreview: importedString(raw.contextPreview, 'context preview', 2_048, true),
    autoApplied: raw.autoApplied,
    learningApplied: raw.learningApplied,
  };
  if (raw.reviewedAt !== undefined) {
    record.reviewedAt = importedNumber(raw.reviewedAt, 'review timestamp');
  }
  if (raw.contextWords !== undefined) {
    const words = object(raw.contextWords);
    record.contextWords = {
      previous: importedString(words.previous, 'previous context word', 128, true),
      next: importedString(words.next, 'next context word', 128, true),
    };
  }
  if (raw.sourceRuleId !== undefined) {
    record.sourceRuleId = importedString(raw.sourceRuleId, 'source rule id', 512, true);
  }
  if (raw.keyboardSubstitution !== undefined) {
    if (correctionType !== 'keyboard-proximity') {
      throw new Error('Keyboard evidence requires a keyboard-proximity correction.');
    }
    const evidence = importKeyboardSubstitution(raw.keyboardSubstitution);
    if (
      evidence.index >= record.originalText.length ||
      record.originalText[evidence.index]?.toLowerCase() !== evidence.typedCharacter ||
      record.replacementText[evidence.index]?.toLowerCase() !==
        evidence.replacementCharacter ||
      !evidence.neighbourMapMatched ||
      !areAdjacent(evidence.typedCharacter, evidence.replacementCharacter)
    ) {
      throw new Error('Keyboard evidence does not match the imported correction.');
    }
    record.keyboardSubstitution = evidence;
  }
  if (raw.rejectionReason !== undefined) {
    const reason = raw.rejectionReason as RejectionReason;
    if (!REJECTION_REASONS.has(reason)) {
      throw new Error('Invalid rejection reason in imported history.');
    }
    record.rejectionReason = reason;
  }
  if (raw.failureReason !== undefined) {
    record.failureReason = importedString(raw.failureReason, 'failure reason', 1_024, true);
  }
  if (raw.lastKnownRange !== undefined) {
    const range = object(raw.lastKnownRange);
    const start = importedNumber(range.start, 'range start', true);
    const end = importedNumber(range.end, 'range end', true);
    if (end < start) throw new Error('Invalid correction range in imported history.');
    record.lastKnownRange = { start, end };
  }
  return record;
}

/**
 * Validates and strips unknown properties from an untrusted JSON history
 * bundle before it can reach extension storage or the side-panel DOM.
 */
export function parseImportedSessions(value: unknown): CorrectionSession[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > IMPORT_SESSION_LIMIT) {
    throw new Error(`Imported history must contain at most ${IMPORT_SESSION_LIMIT} sessions.`);
  }

  const sessions: CorrectionSession[] = [];
  const ids = new Set<string>();
  let recordCount = 0;
  for (const valueSession of value) {
    const raw = object(valueSession);
    const id = importedString(raw.id, 'session id', 256);
    if (ids.has(id)) throw new Error('Imported history contains duplicate session ids.');
    ids.add(id);

    const originText = importedString(raw.origin, 'session origin', 512);
    let origin: string;
    try {
      const url = new URL(originText);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      origin = url.origin;
    } catch {
      throw new Error('Invalid session origin in imported history.');
    }
    if (!Array.isArray(raw.records)) {
      throw new Error('Invalid correction list in imported history.');
    }
    recordCount += raw.records.length;
    if (recordCount > IMPORT_RECORD_LIMIT) {
      throw new Error(`Imported history must contain at most ${IMPORT_RECORD_LIMIT} corrections.`);
    }
    const fieldKind = raw.fieldKind;
    if (fieldKind !== 'input' && fieldKind !== 'textarea' && fieldKind !== 'contenteditable') {
      throw new Error('Invalid field kind in imported history.');
    }
    const persistence = raw.persistence;
    if (persistence !== 'memory' && persistence !== 'persisted') {
      throw new Error('Invalid persistence mode in imported history.');
    }

    const session: CorrectionSession = {
      id,
      origin,
      fieldId: importedString(raw.fieldId, 'field id', 512),
      fieldKind,
      textFingerprint: importedString(raw.textFingerprint, 'text fingerprint', 256, true),
      createdAt: importedNumber(raw.createdAt, 'session creation timestamp'),
      updatedAt: importedNumber(raw.updatedAt, 'session update timestamp'),
      // Imported history is either written intentionally or dropped by the
      // current privacy settings; a stale "memory" label must not be ambiguous.
      persistence: 'persisted',
      records: raw.records.map((record) => importRecord(record, id)),
    };
    if (raw.title !== undefined) {
      session.title = importedString(raw.title, 'session title', 512, true);
    }
    if (raw.url !== undefined) {
      const rawUrl = importedString(raw.url, 'session URL', 2_048);
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
        url.search = '';
        url.hash = '';
        session.url = url.toString();
      } catch {
        throw new Error('Invalid page URL in imported history.');
      }
    }
    sessions.push(session);
  }
  return sessions;
}

/** Persists one content-side batch and resolves only after it is durable. */
export function saveSession(session: CorrectionSession): Promise<boolean> {
  const snapshot = structuredClone(session);
  return serial(async () => {
    const tombstone = Math.max(clearedAt, deletedAt.get(snapshot.id) ?? 0);
    if (snapshot.updatedAt <= tombstone) return false;

    const index = await readIndex();
    const byId = new Map(index.map((entry) => [entry.id, entry]));
    byId.set(snapshot.id, indexEntry(snapshot, snapshot.title ?? snapshot.fieldId));
    const patch = {
      [sessionKey(snapshot.id)]: snapshot,
      [KEYS.sessionIndex]: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    };
    if (!(await setRaw(patch))) throw new Error('Could not save the correction session.');
    return true;
  });
}

export async function loadSession(id: string): Promise<CorrectionSession | undefined> {
  return getRaw<CorrectionSession>(sessionKey(id));
}

export async function deleteSession(id: string): Promise<void> {
  const tombstone = Date.now();
  const previousTombstone = deletedAt.get(id);
  deletedAt.set(id, tombstone);
  try {
    await serial(async () => {
      if (!(await removeRaw(sessionKey(id)))) {
        throw new Error('Could not delete the stored correction session.');
      }
      const index = await readIndex();
      await writeIndex(index.filter((entry) => entry.id !== id));
    });
  } catch (e) {
    if (deletedAt.get(id) === tombstone) {
      if (previousTombstone === undefined) deletedAt.delete(id);
      else deletedAt.set(id, previousTombstone);
    }
    throw e;
  }
}

export async function deleteAllSessions(): Promise<number> {
  const previousClearedAt = clearedAt;
  const requestedAt = Date.now();
  clearedAt = requestedAt;
  try {
    return await serial(async () => {
      const all = await getAllRaw();
      const keys = Object.keys(all).filter((key) => key.startsWith(KEYS.sessionPrefix));
      if (keys.length > 0 && !(await removeRaw(keys))) {
        throw new Error('Could not delete all stored correction sessions.');
      }
      await writeIndex([]);
      return keys.length;
    });
  } catch (e) {
    if (clearedAt === requestedAt) clearedAt = previousClearedAt;
    throw e;
  }
}

/**
 * Replaces the persisted history after a fully validated import. New records
 * and their index are written together; stale keys are removed afterwards so
 * a failed write cannot destroy the previous backup.
 */
export function replaceAllSessions(sessions: readonly CorrectionSession[]): Promise<number> {
  const snapshots = sessions.map((session) => structuredClone(session));
  const previousClearedAt = clearedAt;
  const replacedAt = Date.now();
  clearedAt = replacedAt;
  const replacement = serial(async () => {
    const all = await getAllRaw();
    const previousKeys = Object.keys(all).filter((key) => key.startsWith(KEYS.sessionPrefix));
    const importedKeys = new Set<string>();
    const patch: Record<string, unknown> = {};
    for (const session of snapshots) {
      const key = sessionKey(session.id);
      importedKeys.add(key);
      patch[key] = session;
      deletedAt.delete(session.id);
    }
    patch[KEYS.sessionIndex] = snapshots
      .map((session) => indexEntry(session, session.title ?? session.fieldId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!(await setRaw(patch))) throw new Error('Could not restore correction history.');

    const staleKeys = previousKeys.filter((key) => !importedKeys.has(key));
    if (staleKeys.length > 0 && !(await removeRaw(staleKeys))) {
      throw new Error('The new history was restored, but old session data could not be removed.');
    }
    return snapshots.length;
  });
  return replacement.catch((e) => {
    if (clearedAt === replacedAt) clearedAt = previousClearedAt;
    throw e;
  });
}

/** Deletes existing disk history as soon as an origin becomes memory-only. */
export function deleteSessionsForOrigins(origins: readonly string[]): Promise<number> {
  const blocked = new Set(origins);
  if (blocked.size === 0) return Promise.resolve(0);
  const tombstone = Date.now();
  return serial(async () => {
    const all = await getAllRaw();
    const index = await readIndex();
    const indexedDrop = index.filter((entry) => blocked.has(entry.origin));
    const dropIds = new Set(indexedDrop.map((entry) => entry.id));
    const dropKeys = new Set(indexedDrop.map((entry) => sessionKey(entry.id)));
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(KEYS.sessionPrefix)) continue;
      const raw = object(value);
      if (typeof raw.origin !== 'string' || !blocked.has(raw.origin)) continue;
      const id = key.slice(KEYS.sessionPrefix.length);
      dropIds.add(id);
      dropKeys.add(key);
    }
    for (const id of dropIds) deletedAt.set(id, tombstone);
    if (
      dropKeys.size > 0 &&
      !(await removeRaw([...dropKeys]))
    ) {
      throw new Error('Could not remove history for a memory-only origin.');
    }
    if (dropIds.size > 0) {
      await writeIndex(index.filter((entry) => !dropIds.has(entry.id)));
    }
    return dropIds.size;
  });
}

/** Applies a reduced context radius to every stored session. */
export function scrubStoredSessionContexts(radius: number): Promise<number> {
  return serial(async () => {
    const index = await readIndex();
    const patch: Record<string, unknown> = {};
    let changed = 0;
    for (const entry of index) {
      const session = await getRaw<CorrectionSession>(sessionKey(entry.id));
      if (!session) continue;
      const limited = limitSessionContext(session, radius);
      patch[sessionKey(entry.id)] = limited;
      changed++;
    }
    if (changed > 0 && !(await setRaw(patch))) {
      throw new Error('Could not reduce stored correction context.');
    }
    return changed;
  });
}

/** Removes sessions past the retention window. Returns how many were dropped. */
export async function pruneExpired(settings: Settings, now = Date.now()): Promise<number> {
  return serial(async () => {
    const index = await readIndex();
    if (index.length === 0) return 0;

    const keep: SessionIndexEntry[] = [];
    const drop: string[] = [];
    const ttl = settings.sessionRetentionDays;
    for (const entry of index) {
      const stale =
        ttl > 0 && now - entry.updatedAt > ttl * 24 * 60 * 60 * 1000;
      if (stale) drop.push(entry.id);
      else keep.push(entry);
    }
    if (drop.length > 0) {
      if (!(await removeRaw(drop.map(sessionKey)))) {
        throw new Error('Could not prune expired correction sessions.');
      }
      await writeIndex(keep);
    }
    return drop.length;
  });
}

/** Used by the options page listing. */
export async function loadAllSessions(): Promise<CorrectionSession[]> {
  const index = await readIndex();
  const out: CorrectionSession[] = [];
  for (const entry of index) {
    const s = await loadSession(entry.id);
    if (s) out.push(s);
  }
  return out;
}

export { isExpired };

/** Test seam for the serial queue and deletion tombstones. */
export function __resetSessionStorageForTests(): void {
  operationTail = Promise.resolve();
  clearedAt = 0;
  deletedAt.clear();
}

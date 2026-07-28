/** Shared fixtures for the test suite. */
import { DEFAULT_SETTINGS, EMPTY_LEARNING, type LearningData, type Settings } from '../src/shared/types.js';
import { createAnchor } from '../src/history/anchor.js';
import { createRecord } from '../src/history/correction-record.js';
import type { CorrectionProposal, CorrectionRecord, CorrectionSession } from '../src/shared/types.js';

export function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

export function learning(overrides: Partial<LearningData> = {}): LearningData {
  return { ...structuredClone(EMPTY_LEARNING), ...overrides };
}

export function proposal(overrides: Partial<CorrectionProposal> = {}): CorrectionProposal {
  return {
    start: 0,
    end: 4,
    original: 'waht',
    replacement: 'what',
    correctionType: 'spelling',
    confidence: 0.96,
    action: 'autocorrect',
    reason: 'common misspelling',
    ...overrides,
  };
}

/**
 * Builds a record as if `original` had just been replaced by `replacement` at
 * `index` in the (already corrected) `text`.
 */
export function recordAt(
  text: string,
  index: number,
  original: string,
  replacement: string,
  contextRadius = 32,
): CorrectionRecord {
  const end = index + replacement.length;
  const anchor = createAnchor({
    text,
    start: index,
    end,
    originalText: original,
    replacementText: replacement,
    contextRadius,
  });
  return createRecord({
    sessionId: 's_test',
    proposal: proposal({ start: index, end, original, replacement }),
    anchor,
    contextPreview: text.slice(Math.max(0, index - 20), end + 20),
    autoApplied: true,
  });
}

export function session(records: CorrectionRecord[] = []): CorrectionSession {
  return {
    id: 's_test',
    origin: 'https://example.com',
    fieldId: 'f_test',
    fieldKind: 'textarea',
    textFingerprint: 'abcd1234',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    persistence: 'persisted',
    records,
  };
}

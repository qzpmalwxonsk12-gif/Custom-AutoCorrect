/** Shapes and keys of everything written to chrome.storage.local. */
import type { CorrectionSession, LearningData, Settings } from '../shared/types.js';

/**
 * 1 - original shape.
 * 2 - per-rule modes, writing profiles, personal vocabulary, pause state.
 */
export const SCHEMA_VERSION = 2;

export const KEYS = {
  schema: 'schemaVersion',
  settings: 'settings',
  learning: 'learning',
  /** Sessions live under `session:<id>` so one write never rewrites them all. */
  sessionPrefix: 'session:',
  sessionIndex: 'sessionIndex',
} as const;

export function sessionKey(id: string): string {
  return KEYS.sessionPrefix + id;
}

/** Lightweight index so the options page can list sessions without loading them. */
export interface SessionIndexEntry {
  id: string;
  origin: string;
  fieldLabel: string;
  updatedAt: number;
  total: number;
  pending: number;
}

export interface ExportBundle {
  format: 'personal-autocorrect';
  version: number;
  exportedAt: number;
  settings: Settings;
  learning: LearningData;
  sessions?: CorrectionSession[];
}

export interface StoredShape {
  [KEYS.schema]?: number;
  [KEYS.settings]?: Settings;
  [KEYS.learning]?: LearningData;
  [KEYS.sessionIndex]?: SessionIndexEntry[];
  [key: string]: unknown;
}

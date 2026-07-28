/**
 * Personal vocabulary: the words, names and phrases this user has decided the
 * engine should respect, plus the corrections they always or never want.
 *
 * Entries carry a scope so "leave this alone here" does not become "leave this
 * alone everywhere". Platform independent.
 */

export type VocabularyScope =
  /** Everywhere. */
  | { kind: 'global' }
  /** One origin, e.g. "https://example.com". */
  | { kind: 'site'; origin: string }
  /** One field in one tab, for the life of that document. */
  | { kind: 'document'; documentScope: string };

export type VocabularyKind =
  /** Never flag this word. */
  | 'allowed-word'
  /** A name or proper noun: never flagged, and capitalisation is preserved. */
  | 'name'
  /** This word must always be written with this exact capitalisation. */
  | 'capitalisation'
  /** Always replace `original` with `replacement`. */
  | 'preferred'
  /** Never replace `original` with `replacement`. */
  | 'blocked'
  /** A multi-word phrase that must never be split, merged or "fixed". */
  | 'phrase';

export interface VocabularyEntry {
  id: string;
  kind: VocabularyKind;
  /** The word or phrase, as the user typed it. */
  original: string;
  /** Required for 'capitalisation', 'preferred' and 'blocked'. */
  replacement?: string;
  scope: VocabularyScope;
  createdAt: number;
  note?: string;
}

export interface PersonalVocabulary {
  version: number;
  entries: VocabularyEntry[];
}

export const VOCABULARY_VERSION = 1;

export const EMPTY_VOCABULARY: PersonalVocabulary = {
  version: VOCABULARY_VERSION,
  entries: [],
};

/** Upper bound so a runaway import cannot exhaust extension storage. */
export const MAX_VOCABULARY_ENTRIES = 5_000;

export function vocabularyEntryId(
  kind: VocabularyKind,
  original: string,
  replacement: string | undefined,
  scope: VocabularyScope,
): string {
  const where =
    scope.kind === 'global'
      ? 'g'
      : scope.kind === 'site'
        ? `s:${scope.origin}`
        : `d:${scope.documentScope}`;
  return `${kind}|${original.toLowerCase()}|${(replacement ?? '').toLowerCase()}|${where}`;
}

/** True when `entry` applies in the given place. */
export function scopeApplies(
  scope: VocabularyScope,
  where: { origin: string; documentScope?: string },
): boolean {
  switch (scope.kind) {
    case 'global':
      return true;
    case 'site':
      return scope.origin === where.origin;
    case 'document':
      return where.documentScope !== undefined && scope.documentScope === where.documentScope;
  }
}

export function scopeLabel(scope: VocabularyScope): string {
  switch (scope.kind) {
    case 'global':
      return 'Everywhere';
    case 'site':
      return scope.origin.replace(/^https?:\/\//, '');
    case 'document':
      return 'This document only';
  }
}

export interface VocabularyView {
  allowedWords: Set<string>;
  names: Set<string>;
  /** lower-cased word -> required rendering. */
  capitalisation: Map<string, string>;
  /** lower-cased original -> replacement. */
  preferred: Map<string, string>;
  /** `${original}->${replacement}` pairs that must never be applied. */
  blocked: Set<string>;
  /** Lower-cased multi-word phrases to leave untouched. */
  phrases: Set<string>;
}

export function emptyView(): VocabularyView {
  return {
    allowedWords: new Set(),
    names: new Set(),
    capitalisation: new Map(),
    preferred: new Map(),
    blocked: new Set(),
    phrases: new Set(),
  };
}

/**
 * Collapses the entry list into the lookup shape the engine uses, keeping only
 * entries that apply in this place. Called once per config change, not per key.
 */
export function buildVocabularyView(
  vocabulary: PersonalVocabulary,
  where: { origin: string; documentScope?: string },
): VocabularyView {
  const view = emptyView();
  for (const entry of vocabulary.entries) {
    if (!scopeApplies(entry.scope, where)) continue;
    const key = entry.original.toLowerCase();
    switch (entry.kind) {
      case 'allowed-word':
        view.allowedWords.add(key);
        break;
      case 'name':
        view.names.add(key);
        view.allowedWords.add(key);
        if (entry.original !== key) view.capitalisation.set(key, entry.original);
        break;
      case 'capitalisation':
        if (entry.replacement) view.capitalisation.set(key, entry.replacement);
        break;
      case 'preferred':
        if (entry.replacement) view.preferred.set(key, entry.replacement);
        break;
      case 'blocked':
        if (entry.replacement) {
          view.blocked.add(`${key}->${entry.replacement.toLowerCase()}`);
        }
        break;
      case 'phrase':
        view.phrases.add(key);
        break;
    }
  }
  return view;
}

/* ------------------------------ import / export ------------------------------ */

export interface VocabularyBundle {
  format: 'personal-autocorrect-vocabulary';
  version: number;
  exportedAt: number;
  entries: VocabularyEntry[];
}

export function exportVocabulary(vocabulary: PersonalVocabulary): VocabularyBundle {
  return {
    format: 'personal-autocorrect-vocabulary',
    version: VOCABULARY_VERSION,
    exportedAt: Date.now(),
    entries: vocabulary.entries,
  };
}

const KINDS = new Set<VocabularyKind>([
  'allowed-word',
  'name',
  'capitalisation',
  'preferred',
  'blocked',
  'phrase',
]);

function parseScope(value: unknown): VocabularyScope | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { kind?: unknown; origin?: unknown; documentScope?: unknown };
  if (raw.kind === 'global') return { kind: 'global' };
  if (raw.kind === 'site' && typeof raw.origin === 'string' && raw.origin) {
    return { kind: 'site', origin: raw.origin.slice(0, 253) };
  }
  if (raw.kind === 'document' && typeof raw.documentScope === 'string' && raw.documentScope) {
    return { kind: 'document', documentScope: raw.documentScope.slice(0, 64) };
  }
  return null;
}

/**
 * Validates an imported bundle. Unknown or malformed entries are dropped
 * rather than rejected wholesale, so one bad row cannot cost the user the
 * whole file - but a wrong *format* is still an error, because silently
 * importing nothing looks identical to success.
 */
export function parseVocabularyBundle(payload: unknown): PersonalVocabulary {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('That file is not a vocabulary export.');
  }
  const bundle = payload as Partial<VocabularyBundle>;
  if (bundle.format !== 'personal-autocorrect-vocabulary') {
    throw new Error('That file was not exported from Personal Autocorrect vocabulary.');
  }
  if (
    typeof bundle.version !== 'number'
    || !Number.isInteger(bundle.version)
    || bundle.version < 1
    || bundle.version > VOCABULARY_VERSION
  ) {
    throw new Error(`Unsupported vocabulary version: ${String(bundle.version)}.`);
  }

  const entries: VocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(bundle.entries) ? bundle.entries : []) {
    if (entries.length >= MAX_VOCABULARY_ENTRIES) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Partial<VocabularyEntry>;
    if (!KINDS.has(item.kind as VocabularyKind)) continue;
    const original = typeof item.original === 'string' ? item.original.trim().slice(0, 128) : '';
    if (!original) continue;
    const replacement =
      typeof item.replacement === 'string' ? item.replacement.trim().slice(0, 128) : undefined;
    const kind = item.kind as VocabularyKind;
    // These three are meaningless without a right-hand side.
    if ((kind === 'capitalisation' || kind === 'preferred' || kind === 'blocked') && !replacement) {
      continue;
    }
    const scope = parseScope(item.scope) ?? { kind: 'global' as const };
    const id = vocabularyEntryId(kind, original, replacement, scope);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      kind,
      original,
      ...(replacement ? { replacement } : {}),
      scope,
      createdAt:
        typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now(),
      ...(typeof item.note === 'string' && item.note ? { note: item.note.slice(0, 200) } : {}),
    });
  }
  return { version: VOCABULARY_VERSION, entries };
}

/** Adds or replaces an entry, keeping the list bounded. */
export function upsertEntry(
  vocabulary: PersonalVocabulary,
  entry: Omit<VocabularyEntry, 'id' | 'createdAt'> & { createdAt?: number },
): VocabularyEntry {
  const id = vocabularyEntryId(entry.kind, entry.original, entry.replacement, entry.scope);
  const created: VocabularyEntry = {
    ...entry,
    id,
    createdAt: entry.createdAt ?? Date.now(),
  };
  const index = vocabulary.entries.findIndex((e) => e.id === id);
  if (index >= 0) vocabulary.entries[index] = created;
  else vocabulary.entries.push(created);
  if (vocabulary.entries.length > MAX_VOCABULARY_ENTRIES) {
    vocabulary.entries.splice(0, vocabulary.entries.length - MAX_VOCABULARY_ENTRIES);
  }
  return created;
}

export function removeEntry(vocabulary: PersonalVocabulary, id: string): boolean {
  const index = vocabulary.entries.findIndex((e) => e.id === id);
  if (index < 0) return false;
  vocabulary.entries.splice(index, 1);
  return true;
}

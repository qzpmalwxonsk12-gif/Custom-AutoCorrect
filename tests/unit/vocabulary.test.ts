import { describe, expect, it } from 'vitest';
import {
  EMPTY_VOCABULARY,
  MAX_VOCABULARY_ENTRIES,
  buildVocabularyView,
  exportVocabulary,
  parseVocabularyBundle,
  removeEntry,
  scopeApplies,
  scopeLabel,
  upsertEntry,
  vocabularyEntryId,
  type PersonalVocabulary,
} from '../../src/shared/vocabulary.js';

function fresh(): PersonalVocabulary {
  return structuredClone(EMPTY_VOCABULARY);
}

describe('vocabulary scopes', () => {
  it('applies a global entry everywhere', () => {
    expect(scopeApplies({ kind: 'global' }, { origin: 'https://a.example' })).toBe(true);
  });

  it('applies a site entry only to that origin', () => {
    const scope = { kind: 'site', origin: 'https://a.example' } as const;
    expect(scopeApplies(scope, { origin: 'https://a.example' })).toBe(true);
    expect(scopeApplies(scope, { origin: 'https://b.example' })).toBe(false);
  });

  it('applies a document entry only to that document', () => {
    const scope = { kind: 'document', documentScope: '7:0' } as const;
    expect(scopeApplies(scope, { origin: 'https://a.example', documentScope: '7:0' })).toBe(true);
    expect(scopeApplies(scope, { origin: 'https://a.example', documentScope: '8:0' })).toBe(false);
    // No document identity at all must not silently match.
    expect(scopeApplies(scope, { origin: 'https://a.example' })).toBe(false);
  });

  it('names each scope in a way a person can read', () => {
    expect(scopeLabel({ kind: 'global' })).toBe('Everywhere');
    expect(scopeLabel({ kind: 'site', origin: 'https://a.example' })).toBe('a.example');
    expect(scopeLabel({ kind: 'document', documentScope: '7:0' })).toBe('This document only');
  });

  it('gives entries differing only by scope different ids', () => {
    const a = vocabularyEntryId('blocked', 'teh', 'the', { kind: 'global' });
    const b = vocabularyEntryId('blocked', 'teh', 'the', {
      kind: 'site',
      origin: 'https://a.example',
    });
    expect(a).not.toBe(b);
  });
});

describe('buildVocabularyView', () => {
  it('collects each kind into the shape the engine consults', () => {
    const vocabulary = fresh();
    upsertEntry(vocabulary, { kind: 'allowed-word', original: 'kubernetes', scope: { kind: 'global' } });
    upsertEntry(vocabulary, { kind: 'name', original: 'Aoife', scope: { kind: 'global' } });
    upsertEntry(vocabulary, {
      kind: 'capitalisation',
      original: 'iphone',
      replacement: 'iPhone',
      scope: { kind: 'global' },
    });
    upsertEntry(vocabulary, {
      kind: 'preferred',
      original: 'colour',
      replacement: 'color',
      scope: { kind: 'global' },
    });
    upsertEntry(vocabulary, {
      kind: 'blocked',
      original: 'teh',
      replacement: 'the',
      scope: { kind: 'global' },
    });
    upsertEntry(vocabulary, { kind: 'phrase', original: 'ice cream', scope: { kind: 'global' } });

    const view = buildVocabularyView(vocabulary, { origin: 'https://a.example' });
    expect(view.allowedWords.has('kubernetes')).toBe(true);
    // A name is also an allowed word: it must never be "corrected".
    expect(view.allowedWords.has('aoife')).toBe(true);
    expect(view.names.has('aoife')).toBe(true);
    expect(view.capitalisation.get('aoife')).toBe('Aoife');
    expect(view.capitalisation.get('iphone')).toBe('iPhone');
    expect(view.preferred.get('colour')).toBe('color');
    expect(view.blocked.has('teh->the')).toBe(true);
    expect(view.phrases.has('ice cream')).toBe(true);
  });

  it('excludes entries scoped to a different site', () => {
    const vocabulary = fresh();
    upsertEntry(vocabulary, {
      kind: 'allowed-word',
      original: 'wontfix',
      scope: { kind: 'site', origin: 'https://tracker.example' },
    });
    expect(
      buildVocabularyView(vocabulary, { origin: 'https://other.example' }).allowedWords.size,
    ).toBe(0);
    expect(
      buildVocabularyView(vocabulary, { origin: 'https://tracker.example' }).allowedWords.size,
    ).toBe(1);
  });
});

describe('upsert and remove', () => {
  it('replaces an entry with the same identity instead of duplicating it', () => {
    const vocabulary = fresh();
    upsertEntry(vocabulary, {
      kind: 'preferred',
      original: 'colour',
      replacement: 'color',
      scope: { kind: 'global' },
    });
    upsertEntry(vocabulary, {
      kind: 'preferred',
      original: 'colour',
      replacement: 'color',
      scope: { kind: 'global' },
      note: 'second time',
    });
    expect(vocabulary.entries).toHaveLength(1);
    expect(vocabulary.entries[0]!.note).toBe('second time');
  });

  it('removes by id and reports whether anything was removed', () => {
    const vocabulary = fresh();
    const entry = upsertEntry(vocabulary, {
      kind: 'allowed-word',
      original: 'kubernetes',
      scope: { kind: 'global' },
    });
    expect(removeEntry(vocabulary, entry.id)).toBe(true);
    expect(removeEntry(vocabulary, entry.id)).toBe(false);
    expect(vocabulary.entries).toHaveLength(0);
  });

  it('keeps the list bounded', () => {
    const vocabulary = fresh();
    for (let i = 0; i < MAX_VOCABULARY_ENTRIES + 25; i++) {
      upsertEntry(vocabulary, {
        kind: 'allowed-word',
        original: `word${i}`,
        scope: { kind: 'global' },
      });
    }
    expect(vocabulary.entries.length).toBe(MAX_VOCABULARY_ENTRIES);
  });
});

describe('versioned import and export', () => {
  it('round-trips through export and import', () => {
    const vocabulary = fresh();
    upsertEntry(vocabulary, { kind: 'name', original: 'Aoife', scope: { kind: 'global' } });
    upsertEntry(vocabulary, {
      kind: 'blocked',
      original: 'teh',
      replacement: 'the',
      scope: { kind: 'site', origin: 'https://a.example' },
    });

    const bundle = exportVocabulary(vocabulary);
    expect(bundle.format).toBe('personal-autocorrect-vocabulary');
    expect(bundle.version).toBe(1);

    const restored = parseVocabularyBundle(JSON.parse(JSON.stringify(bundle)));
    expect(restored.entries).toHaveLength(2);
    expect(restored.entries.map((e) => e.original).sort()).toEqual(['Aoife', 'teh']);
    expect(restored.entries.find((e) => e.original === 'teh')?.scope).toEqual({
      kind: 'site',
      origin: 'https://a.example',
    });
  });

  it('rejects a file that is not a vocabulary export', () => {
    expect(() => parseVocabularyBundle({ format: 'something-else', version: 1 })).toThrow(
      /not exported/i,
    );
    expect(() => parseVocabularyBundle('nope')).toThrow(/not a vocabulary export/i);
  });

  it('rejects a version it cannot understand', () => {
    expect(() =>
      parseVocabularyBundle({
        format: 'personal-autocorrect-vocabulary',
        version: 99,
        entries: [],
      }),
    ).toThrow(/unsupported/i);
  });

  /**
   * One malformed row must not cost the user the rest of the file - but the
   * malformed row must not be imported either.
   */
  it('drops malformed entries and keeps the good ones', () => {
    const restored = parseVocabularyBundle({
      format: 'personal-autocorrect-vocabulary',
      version: 1,
      entries: [
        { kind: 'allowed-word', original: 'good', scope: { kind: 'global' } },
        { kind: 'not-a-kind', original: 'bad', scope: { kind: 'global' } },
        { kind: 'allowed-word', original: '   ', scope: { kind: 'global' } },
        // 'blocked' without a replacement means nothing, so it is dropped.
        { kind: 'blocked', original: 'teh', scope: { kind: 'global' } },
        'not an object',
      ],
    });
    expect(restored.entries.map((e) => e.original)).toEqual(['good']);
  });

  it('falls back to a global scope when the stored scope is unusable', () => {
    const restored = parseVocabularyBundle({
      format: 'personal-autocorrect-vocabulary',
      version: 1,
      entries: [{ kind: 'allowed-word', original: 'word', scope: { kind: 'site' } }],
    });
    expect(restored.entries[0]!.scope).toEqual({ kind: 'global' });
  });
});

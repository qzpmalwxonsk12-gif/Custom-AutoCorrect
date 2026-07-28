import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_LEARNING } from '../../src/shared/types.js';
import {
  __resetCacheForTests,
  getLearning,
  getSettings,
  hydrate,
  mutateLearning,
  replaceAll,
  updateSettings,
} from '../../src/storage/storage.js';
import {
  __resetSessionStorageForTests,
  deleteAllSessions,
  deleteSessionsForOrigins,
  limitSessionContext,
  parseImportedSessions,
  replaceAllSessions,
  saveSession,
} from '../../src/storage/session-storage.js';
import { KEYS, sessionKey } from '../../src/storage/types.js';
import { recordAt, session } from '../helpers.js';

interface StorageHarness {
  data: Record<string, unknown>;
  failGet: boolean;
  failSet: boolean;
  failRemove: boolean;
}

function installStorage(initial: Record<string, unknown> = {}): StorageHarness {
  const harness: StorageHarness = {
    data: structuredClone(initial),
    failGet: false,
    failSet: false,
    failRemove: false,
  };
  const local = {
    async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
      if (harness.failGet) throw new Error('read denied');
      if (keys === null) return structuredClone(harness.data);
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => key in harness.data)
          .map((key) => [key, structuredClone(harness.data[key])]),
      );
    },
    async set(patch: Record<string, unknown>): Promise<void> {
      if (harness.failSet) throw new Error('disk full');
      Object.assign(harness.data, structuredClone(patch));
    },
    async remove(keys: string | string[]): Promise<void> {
      if (harness.failRemove) throw new Error('remove denied');
      for (const key of Array.isArray(keys) ? keys : [keys]) delete harness.data[key];
    },
  };
  vi.stubGlobal('chrome', { storage: { local } } as unknown as typeof chrome);
  return harness;
}

beforeEach(() => {
  __resetCacheForTests();
  __resetSessionStorageForTests();
  vi.unstubAllGlobals();
});

describe('settings storage durability', () => {
  it('does not mistake a failed read for a fresh profile and can retry', async () => {
    const storage = installStorage();
    storage.failGet = true;

    await expect(hydrate()).rejects.toThrow('Could not read local extension storage');
    expect(storage.data).toEqual({});

    storage.failGet = false;
    await expect(hydrate()).resolves.toMatchObject({ settings: DEFAULT_SETTINGS });
    expect(storage.data[KEYS.settings]).toBeDefined();
  });

  it('does not publish a settings change that failed to reach disk', async () => {
    const storage = installStorage({
      [KEYS.schema]: 1,
      [KEYS.settings]: DEFAULT_SETTINGS,
      [KEYS.learning]: EMPTY_LEARNING,
    });
    await hydrate();
    storage.failSet = true;

    await expect(updateSettings({ enabled: false })).rejects.toThrow('disk full');
    expect((await getSettings()).enabled).toBe(true);
    expect((storage.data[KEYS.settings] as typeof DEFAULT_SETTINGS).enabled).toBe(true);
  });

  it('orders settings, full replacements, and later learning events without mixing snapshots', async () => {
    const storage = installStorage({
      [KEYS.schema]: 1,
      [KEYS.settings]: DEFAULT_SETTINGS,
      [KEYS.learning]: EMPTY_LEARNING,
    });
    const restoredLearning = structuredClone(EMPTY_LEARNING);
    restoredLearning.dictionary = ['restored'];

    const beforeImport = updateSettings({ enabled: false });
    const imported = replaceAll({ ...DEFAULT_SETTINGS, enabled: true }, restoredLearning);
    const afterImport = mutateLearning((data) => data.dictionary.push('later'));
    await Promise.all([beforeImport, imported, afterImport]);

    expect((await getSettings()).enabled).toBe(true);
    expect((await getLearning()).dictionary).toEqual(['restored', 'later']);
    expect((storage.data[KEYS.learning] as typeof EMPTY_LEARNING).dictionary).toEqual([
      'restored',
      'later',
    ]);
  });
});

describe('session storage privacy and deletion', () => {
  it('removes every persisted context field when the radius is zero', () => {
    const original = session();
    const record = recordAt('private words what around the correction', 14, 'waht', 'what');
    record.contextPreview = 'private words around waht';
    record.contextWords = { previous: 'private', next: 'words' };
    record.anchor.domPath = 'body>div#user-123>p';
    original.records = [record];

    expect(limitSessionContext(original, 32).records[0]?.anchor.domPath).toBeUndefined();
    const limited = limitSessionContext(original, 0);
    expect(limited.records[0]?.contextPreview).toBe('');
    expect(limited.records[0]?.contextWords).toBeUndefined();
    expect(limited.records[0]?.anchor.textBefore).toBe('');
    expect(limited.records[0]?.anchor.textAfter).toBe('');
    expect(limited.records[0]?.anchor.paragraphFingerprint).toBeUndefined();
    expect(limited.records[0]?.anchor.sentenceFingerprint).toBeUndefined();
    expect(limited.records[0]?.anchor.domPath).toBeUndefined();
    expect(original.records[0]?.contextPreview).toContain('private');
  });

  it('deletes orphaned session keys as well as indexed sessions', async () => {
    const active = session();
    active.updatedAt = Date.now() + 10;
    const storage = installStorage({
      [KEYS.sessionIndex]: [],
      [sessionKey('orphan')]: { id: 'orphan' },
    });
    await saveSession(active);

    await expect(deleteAllSessions()).resolves.toBe(2);
    expect(Object.keys(storage.data).filter((key) => key.startsWith(KEYS.sessionPrefix))).toEqual([]);
    expect(storage.data[KEYS.sessionIndex]).toEqual([]);
  });

  it('validates imported history and strips unknown properties', () => {
    const keyboardRecord = recordAt(
      'surrounding happened',
      0,
      'surriunding',
      'surrounding',
    );
    keyboardRecord.correctionType = 'keyboard-proximity';
    keyboardRecord.keyboardSubstitution = {
      index: 4,
      typedCharacter: 'i',
      replacementCharacter: 'o',
      neighbourMapMatched: true,
      keyDistance: 1,
    };
    const exported = session([keyboardRecord]);
    const raw = {
      ...structuredClone(exported),
      injected: 'discard me',
      records: exported.records.map((record) => ({ ...structuredClone(record), injected: true })),
    };

    const [parsed] = parseImportedSessions([raw]);
    expect(parsed).toMatchObject({ id: exported.id, origin: exported.origin });
    expect(parsed?.records[0]?.keyboardSubstitution).toEqual(
      keyboardRecord.keyboardSubstitution,
    );
    expect('injected' in (parsed as unknown as Record<string, unknown>)).toBe(false);
    expect('injected' in (parsed!.records[0] as unknown as Record<string, unknown>)).toBe(false);
    expect(() => parseImportedSessions([{ ...raw, origin: 'javascript:alert(1)' }])).toThrow(
      'Invalid session origin',
    );

    const invalidEvidence = structuredClone(raw) as {
      records: Array<Record<string, unknown>>;
    };
    invalidEvidence.records[0]!.replacementText = 'surraunding';
    invalidEvidence.records[0]!.keyboardSubstitution = {
      ...keyboardRecord.keyboardSubstitution,
      replacementCharacter: 'a',
    };
    expect(() => parseImportedSessions([invalidEvidence])).toThrow(
      'Keyboard evidence does not match',
    );
  });

  it('replaces indexed and orphaned history with the validated import', async () => {
    const restored = session([recordAt('what happened', 0, 'waht', 'what')]);
    restored.id = 'restored';
    restored.records[0]!.sessionId = restored.id;
    const storage = installStorage({
      [KEYS.sessionIndex]: [],
      [sessionKey('old')]: { id: 'old' },
    });

    await expect(replaceAllSessions([restored])).resolves.toBe(1);
    expect(storage.data[sessionKey('old')]).toBeUndefined();
    expect(storage.data[sessionKey('restored')]).toMatchObject({ id: 'restored' });
    expect(storage.data[KEYS.sessionIndex]).toMatchObject([{ id: 'restored' }]);
  });

  it('removes orphaned data when an origin becomes memory-only', async () => {
    const storage = installStorage({
      [KEYS.sessionIndex]: [],
      [sessionKey('orphan')]: {
        ...session(),
        id: 'orphan',
        origin: 'https://private.example',
      },
    });

    await expect(deleteSessionsForOrigins(['https://private.example'])).resolves.toBe(1);
    expect(storage.data[sessionKey('orphan')]).toBeUndefined();
  });
});

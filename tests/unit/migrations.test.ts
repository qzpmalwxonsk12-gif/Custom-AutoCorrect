import { describe, expect, it } from 'vitest';
import { migrate, normaliseStored } from '../../src/storage/migrations.js';
import { KEYS, SCHEMA_VERSION, type StoredShape } from '../../src/storage/types.js';
import { DEFAULT_SETTINGS, EMPTY_LEARNING } from '../../src/shared/types.js';

/** Storage written by an older or partially corrupted build. */
const stored = (raw: Record<string, unknown>): StoredShape => raw as StoredShape;

describe('migrate', () => {
  it('seeds defaults on a fresh profile', () => {
    const { patch, from, to } = migrate({});
    expect(from).toBe(0);
    expect(to).toBe(SCHEMA_VERSION);
    expect(patch[KEYS.settings]).toBeDefined();
    expect(patch[KEYS.learning]).toBeDefined();
    expect(patch[KEYS.schema]).toBe(SCHEMA_VERSION);
  });

  it('leaves existing data untouched', () => {
    const store = stored({
      [KEYS.schema]: SCHEMA_VERSION,
      [KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
      [KEYS.learning]: { ...EMPTY_LEARNING, dictionary: ['fable'] },
      [KEYS.sessionIndex]: [],
    });
    const { patch } = migrate(store);
    expect(patch[KEYS.settings]).toBeUndefined();
    expect(patch[KEYS.learning]).toBeUndefined();
  });

  it('is idempotent', () => {
    const first = migrate({});
    const second = migrate({ ...first.patch });
    expect(second.patch[KEYS.schema]).toBe(SCHEMA_VERSION);
    expect(second.from).toBe(SCHEMA_VERSION);
  });

  it('does not downgrade data from a future schema', () => {
    const future = SCHEMA_VERSION + 3;
    const result = migrate(stored({ [KEYS.schema]: future }));
    expect(result).toEqual({ patch: {}, from: future, to: future });
  });
});

describe('normaliseStored', () => {
  it('fills in settings added by a newer build', () => {
    const { settings } = normaliseStored(stored({ [KEYS.settings]: { enabled: false } }));
    expect(settings.enabled).toBe(false);
    expect(settings.autocorrectThreshold).toBe(DEFAULT_SETTINGS.autocorrectThreshold);
    expect(settings.reviewShortcuts.keep).toBe(DEFAULT_SETTINGS.reviewShortcuts.keep);
  });

  it('repairs list fields that were corrupted', () => {
    const { settings } = normaliseStored(
      stored({ [KEYS.settings]: { denylist: 'not-an-array', memoryOnlyOrigins: null } }),
    );
    expect(settings.denylist).toEqual([]);
    expect(settings.memoryOnlyOrigins).toEqual([]);
  });

  it('canonicalises memory-only entries to exact web origins', () => {
    const { settings } = normaliseStored(
      stored({
        [KEYS.settings]: {
          memoryOnlyOrigins: [
            'HTTPS://Private.Example/path?secret=1',
            'https://private.example',
            'javascript:alert(1)',
            'not a site',
          ],
        },
      }),
    );
    expect(settings.memoryOnlyOrigins).toEqual(['https://private.example']);
  });

  it('repairs partial learning data', () => {
    const { learning } = normaliseStored(stored({ [KEYS.learning]: { rules: { 'a->b': {} } } }));
    expect(learning.dictionary).toEqual([]);
    expect(learning.blockedPairs).toEqual([]);
    expect(learning.pending).toEqual({});
    expect(Object.keys(learning.rules)).toEqual(['a->b']);
    expect(learning.rules['a->b']).toMatchObject({
      id: 'a->b',
      original: 'a',
      replacement: 'b',
      mode: 'suggestion',
      source: 'personal-learning',
      enabled: true,
      context: { previousWords: [], nextWords: [], blockedPrevious: [], blockedNext: [] },
      sites: {},
    });
  });

  it('canonicalises apostrophes in stored dictionaries, rules and blocks', () => {
    const { learning } = normaliseStored(
      stored({
        [KEYS.learning]: {
          rules: {
            'can\u2019r->can\u02bct': {
              original: 'CAN\u2019R',
              replacement: 'CAN\u02bCT',
            },
          },
          dictionary: ['can\u2019r', "can'r"],
          blockedPairs: ['can\uff07r->can\u2018t'],
        },
      }),
    );
    expect(learning.dictionary).toEqual(["can'r"]);
    expect(learning.blockedPairs).toEqual(["can'r->can't"]);
    expect(learning.rules["can'r->can't"]).toMatchObject({
      original: "can'r",
      replacement: "can't",
    });
  });

  it('produces defaults from an empty store', () => {
    const { settings, learning } = normaliseStored({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(learning.rules).toEqual({});
  });

  it('bounds malformed settings and drops unknown properties', () => {
    const { settings } = normaliseStored(
      stored({
        [KEYS.settings]: {
          enabled: 'yes',
          suggestionThreshold: 8,
          autocorrectThreshold: -2,
          manualEditEvidence: 99,
          contextRadius: -4,
          denylist: [' Example.COM ', 3, '', 'example.com'],
          siteOverrides: { 'https://example.com': 'off', bad: 'maybe' },
          reviewShortcuts: { keep: 42, revert: 'KeyR' },
          injected: 'discard me',
        },
      }),
    );

    expect(settings.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(settings.autocorrectThreshold).toBe(0);
    expect(settings.suggestionThreshold).toBe(0);
    expect(settings.manualEditEvidence).toBe(20);
    expect(settings.contextRadius).toBe(0);
    expect(settings.denylist).toEqual(['example.com']);
    expect(settings.siteOverrides).toEqual({ 'https://example.com': 'off' });
    expect(settings.reviewShortcuts.keep).toBe(DEFAULT_SETTINGS.reviewShortcuts.keep);
    expect(settings.reviewShortcuts.revert).toBe('KeyR');
    expect('injected' in settings).toBe(false);
  });

  it('normalises every rule field and honours persisted blocks', () => {
    const { learning } = normaliseStored(
      stored({
        [KEYS.learning]: {
          version: 999,
          rules: {
            'Waht->What': {
              original: 'WAHT',
              replacement: 'WHAT',
              source: 'builtin-typo',
              mode: 'suggestion',
              applied: 4.7,
              accepted: -2,
              reverted: 0,
              blocked: 0,
              confidence: 4,
              context: {
                previousWords: [' Think ', 'think', 3],
                blockedNext: 'bad',
              },
              sites: { 'https://off.example': 'off', bad: 'on' },
              enabled: true,
              unexpected: 'discard',
            },
          },
          dictionary: [' Fable ', 'fable', 7],
          blockedPairs: ['WAHT->WHAT', 'invalid'],
          pending: {
            'x->y': { count: -5, firstSeen: -1, lastSeen: Number.POSITIVE_INFINITY },
            'waht->what': { count: 2 },
          },
        },
      }),
    );

    expect(learning.version).toBe(SCHEMA_VERSION);
    expect(learning.dictionary).toEqual(['fable']);
    expect(learning.blockedPairs).toEqual(['waht->what']);
    expect(learning.pending).toHaveProperty('x->y');
    expect(learning.pending).not.toHaveProperty('waht->what');
    expect(learning.rules['waht->what']).toMatchObject({
      id: 'waht->what',
      original: 'waht',
      replacement: 'what',
      applied: 5,
      accepted: 0,
      confidence: 1,
      source: 'builtin-typo',
      mode: 'blocked',
      enabled: false,
      context: {
        previousWords: ['think'],
        nextWords: [],
        blockedPrevious: [],
        blockedNext: [],
      },
      sites: { 'https://off.example': 'off' },
    });
    expect('unexpected' in learning.rules['waht->what']!).toBe(false);
  });
});

describe('migration to schema 2 (rule controls)', () => {
  const legacy = (settings: Record<string, unknown>): StoredShape =>
    stored({
      [KEYS.schema]: 1,
      [KEYS.settings]: { ...DEFAULT_SETTINGS, ...settings },
      [KEYS.learning]: { ...EMPTY_LEARNING },
      [KEYS.sessionIndex]: [],
    });

  function ruleModes(store: StoredShape): Record<string, string> {
    const patched = migrate(store).patch[KEYS.settings] as { ruleModes?: Record<string, string> };
    return patched?.ruleModes ?? {};
  }

  /**
   * A user who switched a punctuation rule off made a decision. Resetting it to
   * the catalogue default on upgrade would silently turn it back on.
   */
  it('carries a disabled punctuation rule into the new model', () => {
    expect(ruleModes(legacy({ punctuationSimpleList: false }))['punctuation:simple-list']).toBe(
      'disabled',
    );
  });

  it('demotes enabled punctuation rules to suggestions when automatic was off', () => {
    const modes = ruleModes(legacy({ punctuationAutomatic: false }));
    expect(modes['punctuation:simple-list']).toBe('suggestion');
    expect(modes['punctuation:direct-address']).toBe('suggestion');
  });

  it('carries the Harper auto-apply choice across', () => {
    expect(ruleModes(legacy({ harperEnabled: true, harperAutoApply: true }))['grammar:harper'])
      .toBe('automatic');
    expect(ruleModes(legacy({ harperEnabled: false }))['grammar:harper']).toBe('disabled');
  });

  it('turns both spacing rules off when spacing was disabled', () => {
    const modes = ruleModes(legacy({ spacingCorrectionEnabled: false }));
    expect(modes['spacing:merge']).toBe('disabled');
    expect(modes['spacing:split']).toBe('disabled');
  });

  it('leaves an existing rule mode alone, so re-running changes nothing', () => {
    const store = legacy({
      punctuationSimpleList: false,
      ruleModes: { 'punctuation:simple-list': 'automatic' },
    });
    expect(ruleModes(store)['punctuation:simple-list']).toBe('automatic');
  });

  it('adds no opinion when the user never expressed one', () => {
    expect(ruleModes(legacy({}))['punctuation:simple-list']).toBeUndefined();
  });

  it('normalises the new settings on the way out', () => {
    const { settings } = normaliseStored(
      stored({
        [KEYS.settings]: {
          profile: 'not-a-profile',
          shadowMode: 'nonsense',
          theme: 'chartreuse',
          ruleModes: { 'spacing:merge': 'wrong', 'not:a:rule': 'automatic' },
          pause: { until: -5, tabs: ['x', 3] },
        },
      }),
    );
    expect(settings.profile).toBe(DEFAULT_SETTINGS.profile);
    expect(settings.shadowMode).toBe('off');
    expect(settings.theme).toBe('system');
    expect(settings.ruleModes).toEqual({});
    expect(settings.pause).toEqual({ until: 0, tabs: [3] });
  });

  it('keeps a valid rule mode and profile', () => {
    const { settings } = normaliseStored(
      stored({
        [KEYS.settings]: {
          profile: 'fiction',
          ruleModes: { 'spacing:merge': 'suggestion' },
          siteRuleModes: { 'https://a.example': { 'spacing:split': 'disabled' } },
          siteProfiles: { 'https://a.example': 'coding' },
        },
      }),
    );
    expect(settings.profile).toBe('fiction');
    expect(settings.ruleModes['spacing:merge']).toBe('suggestion');
    expect(settings.siteRuleModes['https://a.example']!['spacing:split']).toBe('disabled');
    expect(settings.siteProfiles['https://a.example']).toBe('coding');
  });

  it('preserves stored vocabulary entries and drops malformed ones', () => {
    const { learning } = normaliseStored(
      stored({
        [KEYS.learning]: {
          ...EMPTY_LEARNING,
          vocabulary: {
            version: 1,
            entries: [
              { kind: 'allowed-word', original: 'kubernetes', scope: { kind: 'global' } },
              { kind: 'bogus', original: 'x', scope: { kind: 'global' } },
            ],
          },
        },
      }),
    );
    expect(learning.vocabulary.entries.map((e) => e.original)).toEqual(['kubernetes']);
  });
});

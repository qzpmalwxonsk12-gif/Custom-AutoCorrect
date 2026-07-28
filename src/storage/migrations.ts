/**
 * Schema migrations. Each step takes the whole stored object and returns the
 * patch to write. Steps must be idempotent - a service worker can die halfway.
 */
import {
  DEFAULT_SETTINGS,
  EMPTY_LEARNING,
  HARPER_DIALECTS,
  type CorrectionRule,
  type GrammarRuleStats,
  type HarperDialect,
  type LearningData,
  type PendingPattern,
  type PunctuationRuleStatsRecord,
  type ReviewAction,
  type RuleContext,
  type RuleMode,
  type RuleSource,
  type Settings,
} from '../shared/types.js';
import {
  isCorrectionRuleId,
  RULE_CONTROL_MODES,
  type RuleControlMode,
  type RuleModeMap,
} from '../shared/rules.js';
import { isWritingProfileId, type WritingProfileId } from '../shared/profiles.js';
import {
  EMPTY_VOCABULARY,
  parseVocabularyBundle,
  VOCABULARY_VERSION,
  type PersonalVocabulary,
} from '../shared/vocabulary.js';
import type { PauseState } from '../shared/status.js';
import { clamp, normaliseRuleText, ruleId } from '../shared/util.js';
import { KEYS, SCHEMA_VERSION, type StoredShape } from './types.js';

type Migration = (store: StoredShape) => StoredShape;
type UnknownRecord = Record<string, unknown>;

const MAX_RULES = 5_000;
const MAX_LIST_ITEMS = 5_000;
const MAX_CONTEXT_WORDS = 12;
const MAX_COUNTER = 1_000_000_000;
const RULE_MODES = new Set<RuleMode>(['autocorrect', 'suggestion', 'blocked']);
const RULE_SOURCES = new Set<RuleSource>([
  'builtin-typo',
  'builtin-context',
  'builtin-grammar',
  'lexicon',
  'personal-learning',
  'user-created',
]);
const REVIEW_ACTIONS: ReviewAction[] = [
  'keep',
  'revert',
  'next',
  'previous',
  'dictionary',
  'never',
  'exit',
];

/** Index by *target* version: MIGRATIONS[1] upgrades 0 -> 1. */
const MIGRATIONS: Record<number, Migration> = {
  1: (store) => {
    const patch: StoredShape = {};
    if (!store[KEYS.settings]) patch[KEYS.settings] = { ...DEFAULT_SETTINGS };
    if (!store[KEYS.learning]) patch[KEYS.learning] = structuredClone(EMPTY_LEARNING);
    if (!store[KEYS.sessionIndex]) patch[KEYS.sessionIndex] = [];
    return patch;
  },

  /**
   * v2 introduces per-rule modes. Before this, punctuation rules were
   * individual booleans and Harper had a single "apply automatically" flag.
   * Those are real user decisions, so they are carried across rather than
   * reset to catalogue defaults - a user who turned the Oxford comma off must
   * not find it back on after an update.
   */
  2: (store) => {
    const settings = asRecord(store[KEYS.settings]);
    if (Object.keys(settings).length === 0) return {};

    const modes: RuleModeMap = { ...normaliseRuleModes(settings.ruleModes) };
    // An explicit `false` is a decision; `undefined` is "never had an opinion".
    const legacy: Array<[string, CorrectionRuleIdLike]> = [
      ['punctuationDirectAddress', 'punctuation:direct-address'],
      ['punctuationIntroductoryClause', 'punctuation:introductory-clause'],
      ['punctuationIndependentClause', 'punctuation:independent-clause'],
      ['punctuationSimpleList', 'punctuation:simple-list'],
      ['punctuationNonrestrictiveClause', 'punctuation:nonrestrictive-clause'],
    ];
    const punctuationAutomatic = settings.punctuationAutomatic !== false;
    for (const [flag, id] of legacy) {
      if (modes[id] !== undefined) continue; // already migrated; stay idempotent
      if (settings[flag] === false) modes[id] = 'disabled';
      else if (settings[flag] === true && !punctuationAutomatic) modes[id] = 'suggestion';
    }
    // The introductory-participle rule shared the introductory-clause flag.
    if (
      modes['punctuation:introductory-participle'] === undefined
      && settings.punctuationIntroductoryClause === false
    ) {
      modes['punctuation:introductory-participle'] = 'disabled';
    }
    if (modes['grammar:harper'] === undefined) {
      if (settings.harperEnabled === false) modes['grammar:harper'] = 'disabled';
      else if (settings.harperAutoApply === true) modes['grammar:harper'] = 'automatic';
    }
    if (modes['spacing:merge'] === undefined && settings.spacingCorrectionEnabled === false) {
      modes['spacing:merge'] = 'disabled';
      modes['spacing:split'] = 'disabled';
    }

    // normaliseSettings validates the result on the way out; this step only
    // has to preserve intent, not produce a fully-formed Settings object.
    const patch: StoredShape = {};
    patch[KEYS.settings] = { ...settings, ruleModes: modes } as unknown as Settings;
    return patch;
  },
};

/** Local alias: migrations run before the catalogue type is in scope for keys. */
type CorrectionRuleIdLike = keyof RuleModeMap;

export function migrate(store: StoredShape): { patch: StoredShape; from: number; to: number } {
  const rawVersion = store[KEYS.schema];
  const from =
    typeof rawVersion === 'number' && Number.isSafeInteger(rawVersion) && rawVersion >= 0
      ? rawVersion
      : 0;
  // Never stamp an older schema version over data written by a newer build.
  if (from > SCHEMA_VERSION) return { patch: {}, from, to: from };

  let patch: StoredShape = {};
  let working: StoredShape = { ...store };

  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) continue;
    const stepPatch = step(working);
    patch = { ...patch, ...stepPatch };
    working = { ...working, ...stepPatch };
  }
  patch[KEYS.schema] = SCHEMA_VERSION;
  return { patch, from, to: SCHEMA_VERSION };
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberIn(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const bounded = clamp(value, min, max);
  return integer ? Math.round(bounded) : bounded;
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
  lowerCase = true,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    let text = cleanString(item, maxLength);
    if (lowerCase) text = normaliseRuleText(text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function originList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanString(item, 512);
    if (!text) continue;
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const origin = url.origin;
      if (seen.has(origin)) continue;
      seen.add(origin);
      out.push(origin);
      if (out.length >= maxItems) break;
    } catch {
      // Memory-only entries are origins, not hostname patterns. Invalid input
      // must not create a false sense that a site is protected.
    }
  }
  return out;
}

function normaliseShortcuts(value: unknown): Settings['reviewShortcuts'] {
  const raw = asRecord(value);
  const out = { ...DEFAULT_SETTINGS.reviewShortcuts };
  for (const action of REVIEW_ACTIONS) {
    const shortcut = cleanString(raw[action], 32);
    if (shortcut) out[action] = shortcut;
  }
  return out;
}

function normaliseOverrides(value: unknown): Settings['siteOverrides'] {
  const raw = asRecord(value);
  const out: Settings['siteOverrides'] = {};
  let count = 0;
  for (const [origin, mode] of Object.entries(raw)) {
    const key = cleanString(origin, 512);
    if (!key || isUnsafeKey(key) || (mode !== 'on' && mode !== 'off')) continue;
    out[key] = mode;
    if (++count >= 500) break;
  }
  return out;
}

function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

/* ---------------- rule modes, profiles, pause, vocabulary ---------------- */

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normaliseRuleModes(value: unknown): RuleModeMap {
  const raw = asRecord(value);
  const out: RuleModeMap = {};
  for (const [id, mode] of Object.entries(raw)) {
    if (!isCorrectionRuleId(id) || isUnsafeKey(id)) continue;
    if (!RULE_CONTROL_MODES.includes(mode as RuleControlMode)) continue;
    out[id] = mode as RuleControlMode;
  }
  return out;
}

function normaliseSiteRuleModes(value: unknown): Record<string, RuleModeMap> {
  const raw = asRecord(value);
  const out: Record<string, RuleModeMap> = {};
  let count = 0;
  for (const [origin, modes] of Object.entries(raw)) {
    const key = cleanString(origin, 512);
    if (!key || isUnsafeKey(key)) continue;
    const parsed = normaliseRuleModes(modes);
    if (Object.keys(parsed).length === 0) continue;
    out[key] = parsed;
    if (++count >= 500) break;
  }
  return out;
}

function normaliseSiteProfiles(value: unknown): Record<string, WritingProfileId> {
  const raw = asRecord(value);
  const out: Record<string, WritingProfileId> = {};
  let count = 0;
  for (const [origin, profile] of Object.entries(raw)) {
    const key = cleanString(origin, 512);
    if (!key || isUnsafeKey(key) || !isWritingProfileId(profile)) continue;
    out[key] = profile;
    if (++count >= 500) break;
  }
  return out;
}

function normalisePause(value: unknown): PauseState {
  const raw = asRecord(value);
  const until = numberIn(raw.until, 0, 0, Number.MAX_SAFE_INTEGER, true);
  const tabs: number[] = [];
  if (Array.isArray(raw.tabs)) {
    for (const id of raw.tabs) {
      if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) tabs.push(id);
      if (tabs.length >= 200) break;
    }
  }
  return { until, tabs };
}

function normaliseVocabulary(value: unknown): PersonalVocabulary {
  // parseVocabularyBundle owns the per-entry validation; wrapping the stored
  // shape as a bundle keeps exactly one implementation of those rules.
  try {
    return parseVocabularyBundle({
      format: 'personal-autocorrect-vocabulary',
      version: VOCABULARY_VERSION,
      exportedAt: 0,
      entries: asRecord(value).entries ?? [],
    });
  } catch {
    return structuredClone(EMPTY_VOCABULARY);
  }
}

function normaliseSettings(value: unknown): Settings {
  const raw = asRecord(value);
  const autocorrectThreshold = numberIn(
    raw.autocorrectThreshold,
    DEFAULT_SETTINGS.autocorrectThreshold,
    0,
    1,
  );
  const suggestionThreshold = Math.min(
    autocorrectThreshold,
    numberIn(raw.suggestionThreshold, DEFAULT_SETTINGS.suggestionThreshold, 0, 1),
  );

  return {
    enabled: boolean(raw.enabled, DEFAULT_SETTINGS.enabled),
    contextualEnabled: boolean(raw.contextualEnabled, DEFAULT_SETTINGS.contextualEnabled),
    contextualAutocorrect: boolean(
      raw.contextualAutocorrect,
      DEFAULT_SETTINGS.contextualAutocorrect,
    ),
    grammarEnabled: boolean(raw.grammarEnabled, DEFAULT_SETTINGS.grammarEnabled),
    autocorrectThreshold,
    suggestionThreshold,
    learnFromDecisions: boolean(raw.learnFromDecisions, DEFAULT_SETTINGS.learnFromDecisions),
    learnFromManualEdits: boolean(
      raw.learnFromManualEdits,
      DEFAULT_SETTINGS.learnFromManualEdits,
    ),
    manualEditEvidence: numberIn(
      raw.manualEditEvidence,
      DEFAULT_SETTINGS.manualEditEvidence,
      2,
      20,
      true,
    ),
    showInlineFlash: boolean(raw.showInlineFlash, DEFAULT_SETTINGS.showInlineFlash),
    showSuggestionChips: boolean(
      raw.showSuggestionChips,
      DEFAULT_SETTINGS.showSuggestionChips,
    ),
    contextRadius: numberIn(raw.contextRadius, DEFAULT_SETTINGS.contextRadius, 0, 256, true),
    storePageUrl: boolean(raw.storePageUrl, DEFAULT_SETTINGS.storePageUrl),
    persistSessions: boolean(raw.persistSessions, DEFAULT_SETTINGS.persistSessions),
    sessionRetentionDays: numberIn(
      raw.sessionRetentionDays,
      DEFAULT_SETTINGS.sessionRetentionDays,
      0,
      3_650,
      true,
    ),
    autoAcceptAfterMinutes: numberIn(
      raw.autoAcceptAfterMinutes,
      DEFAULT_SETTINGS.autoAcceptAfterMinutes,
      0,
      525_600,
      true,
    ),
    hideAcceptedFromList: boolean(
      raw.hideAcceptedFromList,
      DEFAULT_SETTINGS.hideAcceptedFromList,
    ),
    denylist: stringList(raw.denylist, 500, 253),
    memoryOnlyOrigins: originList(raw.memoryOnlyOrigins, 500),
    siteOverrides: normaliseOverrides(raw.siteOverrides),
    reviewShortcuts: normaliseShortcuts(raw.reviewShortcuts),
    shortcutsEnabled: boolean(raw.shortcutsEnabled, DEFAULT_SETTINGS.shortcutsEnabled),
    spacingCorrectionEnabled: boolean(
      raw.spacingCorrectionEnabled,
      DEFAULT_SETTINGS.spacingCorrectionEnabled,
    ),
    punctuationEnabled: boolean(raw.punctuationEnabled, DEFAULT_SETTINGS.punctuationEnabled),
    punctuationAutomatic: boolean(raw.punctuationAutomatic, DEFAULT_SETTINGS.punctuationAutomatic),
    punctuationOxfordComma: boolean(
      raw.punctuationOxfordComma,
      DEFAULT_SETTINGS.punctuationOxfordComma,
    ),
    punctuationDirectAddress: boolean(
      raw.punctuationDirectAddress,
      DEFAULT_SETTINGS.punctuationDirectAddress,
    ),
    punctuationIntroductoryClause: boolean(
      raw.punctuationIntroductoryClause,
      DEFAULT_SETTINGS.punctuationIntroductoryClause,
    ),
    punctuationIndependentClause: boolean(
      raw.punctuationIndependentClause,
      DEFAULT_SETTINGS.punctuationIndependentClause,
    ),
    punctuationSimpleList: boolean(
      raw.punctuationSimpleList,
      DEFAULT_SETTINGS.punctuationSimpleList,
    ),
    punctuationNonrestrictiveClause: boolean(
      raw.punctuationNonrestrictiveClause,
      DEFAULT_SETTINGS.punctuationNonrestrictiveClause,
    ),
    punctuationSuggestionThreshold: numberIn(
      raw.punctuationSuggestionThreshold,
      DEFAULT_SETTINGS.punctuationSuggestionThreshold,
      0.5,
      1,
    ),
    // Never allow the automatic bar to be lowered below the suggestion bar or
    // below the level the corpus was validated at.
    punctuationAutomaticThreshold: numberIn(
      raw.punctuationAutomaticThreshold,
      DEFAULT_SETTINGS.punctuationAutomaticThreshold,
      0.9,
      1,
    ),
    punctuationShowExplanations: boolean(
      raw.punctuationShowExplanations,
      DEFAULT_SETTINGS.punctuationShowExplanations,
    ),
    punctuationAllowRulePromotion: boolean(
      raw.punctuationAllowRulePromotion,
      DEFAULT_SETTINGS.punctuationAllowRulePromotion,
    ),
    harperEnabled: boolean(raw.harperEnabled, DEFAULT_SETTINGS.harperEnabled),
    harperAutoApply: boolean(raw.harperAutoApply, DEFAULT_SETTINGS.harperAutoApply),
    harperDialect: HARPER_DIALECTS.includes(raw.harperDialect as HarperDialect)
      ? (raw.harperDialect as HarperDialect)
      : DEFAULT_SETTINGS.harperDialect,
    harperDisabledRules: stringList(raw.harperDisabledRules, 500, 128),
    pause: normalisePause(raw.pause),
    ruleModes: normaliseRuleModes(raw.ruleModes),
    siteRuleModes: normaliseSiteRuleModes(raw.siteRuleModes),
    profile: isWritingProfileId(raw.profile) ? raw.profile : DEFAULT_SETTINGS.profile,
    siteProfiles: normaliseSiteProfiles(raw.siteProfiles),
    disabledFields: stringList(raw.disabledFields, 1_000, 320, false),
    deepScanEnabled: boolean(raw.deepScanEnabled, DEFAULT_SETTINGS.deepScanEnabled),
    deepScanPasses: numberIn(raw.deepScanPasses, DEFAULT_SETTINGS.deepScanPasses, 1, 10, true),
    shadowMode: oneOf(raw.shadowMode, ['off', 'experimental', 'all'] as const, DEFAULT_SETTINGS.shadowMode),
    shadowPersist: boolean(raw.shadowPersist, DEFAULT_SETTINGS.shadowPersist),
    historyDisplayMode: oneOf(
      raw.historyDisplayMode,
      ['compact', 'detailed'] as const,
      DEFAULT_SETTINGS.historyDisplayMode,
    ),
    historyGrouping: oneOf(
      raw.historyGrouping,
      ['none', 'site', 'field', 'paragraph', 'time'] as const,
      DEFAULT_SETTINGS.historyGrouping,
    ),
    markupOverlayEnabled: boolean(
      raw.markupOverlayEnabled,
      DEFAULT_SETTINGS.markupOverlayEnabled,
    ),
    showCorrectionExplanations: boolean(
      raw.showCorrectionExplanations,
      DEFAULT_SETTINGS.showCorrectionExplanations,
    ),
    theme: oneOf(
      raw.theme,
      ['system', 'light', 'dark', 'high-contrast'] as const,
      DEFAULT_SETTINGS.theme,
    ),
    motion: oneOf(raw.motion, ['system', 'reduce'] as const, DEFAULT_SETTINGS.motion),
  };
}

function pairFromKey(key: string): { original: string; replacement: string } {
  const separator = key.indexOf('->');
  if (separator <= 0) return { original: '', replacement: '' };
  return {
    original: normaliseRuleText(key.slice(0, separator).trim()),
    replacement: normaliseRuleText(key.slice(separator + 2).trim()),
  };
}

function counter(value: unknown): number {
  return numberIn(value, 0, 0, MAX_COUNTER, true);
}

function normaliseContext(value: unknown): RuleContext {
  const raw = asRecord(value);
  return {
    previousWords: stringList(raw.previousWords, MAX_CONTEXT_WORDS, 64),
    nextWords: stringList(raw.nextWords, MAX_CONTEXT_WORDS, 64),
    blockedPrevious: stringList(raw.blockedPrevious, MAX_CONTEXT_WORDS, 64),
    blockedNext: stringList(raw.blockedNext, MAX_CONTEXT_WORDS, 64),
  };
}

function normaliseRuleSites(value: unknown): CorrectionRule['sites'] {
  const raw = asRecord(value);
  const out: CorrectionRule['sites'] = {};
  let count = 0;
  for (const [origin, mode] of Object.entries(raw)) {
    const key = cleanString(origin, 512);
    if (!key || isUnsafeKey(key) || mode !== 'off') continue;
    out[key] = 'off';
    if (++count >= 100) break;
  }
  return out;
}

function smoothedConfidence(accepted: number, reverted: number, blocked: number): number {
  return (accepted + 2) / (accepted + reverted * 2 + blocked * 4 + 4);
}

function normaliseRule(key: string, value: unknown, now: number): CorrectionRule | null {
  const raw = asRecord(value);
  const fallback = pairFromKey(key);
  const original = normaliseRuleText(cleanString(raw.original, 64) || fallback.original);
  const replacement = normaliseRuleText(
    cleanString(raw.replacement, 256) || fallback.replacement,
  );
  if (!original || !replacement || original === replacement) return null;

  const source = RULE_SOURCES.has(raw.source as RuleSource)
    ? (raw.source as RuleSource)
    : 'personal-learning';
  const applied = counter(raw.applied);
  const accepted = counter(raw.accepted);
  const reverted = counter(raw.reverted);
  const skipped = counter(raw.skipped);
  const blocked = counter(raw.blocked);
  let mode = RULE_MODES.has(raw.mode as RuleMode)
    ? (raw.mode as RuleMode)
    : source === 'personal-learning'
      ? 'suggestion'
      : 'autocorrect';

  // Version 0.2 created suggestion-mode statistic records for built-ins after
  // their first automatic application. Repair only untouched built-in records.
  if (
    source !== 'personal-learning' &&
    source !== 'user-created' &&
    mode === 'suggestion' &&
    applied > 0 &&
    accepted === 0 &&
    reverted === 0 &&
    blocked === 0
  ) {
    mode = 'autocorrect';
  }

  const fallbackConfidence =
    source === 'user-created' ? 0.99 : smoothedConfidence(accepted, reverted, blocked);
  const rule: CorrectionRule = {
    id: ruleId(original, replacement),
    original,
    replacement,
    applied,
    accepted,
    reverted,
    skipped,
    blocked,
    confidence: numberIn(raw.confidence, fallbackConfidence, 0, 1),
    mode,
    source,
    context: normaliseContext(raw.context),
    sites: normaliseRuleSites(raw.sites),
    firstSeen: numberIn(raw.firstSeen, now, 0, Number.MAX_SAFE_INTEGER, true),
    manual: boolean(raw.manual, source === 'user-created'),
    enabled: mode !== 'blocked' && boolean(raw.enabled, true),
  };
  if (typeof raw.lastApplied === 'number' && Number.isFinite(raw.lastApplied)) {
    rule.lastApplied = numberIn(raw.lastApplied, now, 0, Number.MAX_SAFE_INTEGER, true);
  }
  return rule;
}

function normaliseBlockedPairs(value: unknown): string[] {
  const raw = stringList(value, MAX_LIST_ITEMS, 322);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of raw) {
    const pair = pairFromKey(key);
    if (!pair.original || !pair.replacement) continue;
    const id = ruleId(pair.original, pair.replacement);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalisePendingEntry(
  key: string,
  value: unknown,
  now: number,
): PendingPattern | null {
  const raw = asRecord(value);
  const fallback = pairFromKey(key);
  const original = normaliseRuleText(cleanString(raw.original, 64) || fallback.original);
  const replacement = normaliseRuleText(
    cleanString(raw.replacement, 256) || fallback.replacement,
  );
  if (!original || !replacement || original === replacement) return null;
  const firstSeen = numberIn(raw.firstSeen, now, 0, Number.MAX_SAFE_INTEGER, true);
  const lastSeen = numberIn(raw.lastSeen, firstSeen, firstSeen, Number.MAX_SAFE_INTEGER, true);
  return {
    original,
    replacement,
    count: numberIn(raw.count, 1, 1, MAX_COUNTER, true),
    firstSeen,
    lastSeen,
  };
}

function normaliseLearning(value: unknown): LearningData {
  const raw = asRecord(value);
  const now = Date.now();
  const rules: LearningData['rules'] = {};
  let ruleCount = 0;
  for (const [key, value] of Object.entries(asRecord(raw.rules))) {
    const rule = normaliseRule(key, value, now);
    if (!rule) continue;
    rules[rule.id] = rule;
    if (++ruleCount >= MAX_RULES) break;
  }

  const blockedPairs = normaliseBlockedPairs(raw.blockedPairs);
  for (const id of blockedPairs) {
    const rule = rules[id];
    if (rule) {
      rule.mode = 'blocked';
      rule.enabled = false;
    }
  }

  const pending: LearningData['pending'] = {};
  let pendingCount = 0;
  for (const [key, value] of Object.entries(asRecord(raw.pending))) {
    const entry = normalisePendingEntry(key, value, now);
    if (!entry) continue;
    const id = ruleId(entry.original, entry.replacement);
    if (rules[id]) continue;
    pending[id] = entry;
    if (++pendingCount >= MAX_RULES) break;
  }

  return {
    version: numberIn(raw.version, 1, 1, SCHEMA_VERSION, true),
    rules,
    dictionary: stringList(raw.dictionary, MAX_LIST_ITEMS, 64),
    blockedPairs,
    pending,
    grammarStats: normaliseGrammarStats(raw.grammarStats),
    punctuationStats: normalisePunctuationStats(raw.punctuationStats),
    grammarIgnoredLints: stringList(raw.grammarIgnoredLints, 2_000, 30).filter((h) =>
      /^\d{1,30}$/.test(h),
    ),
    vocabulary: normaliseVocabulary(raw.vocabulary),
  };
}

function normalisePunctuationStats(
  value: unknown,
): Record<string, PunctuationRuleStatsRecord> {
  const raw = asRecord(value);
  const out: Record<string, PunctuationRuleStatsRecord> = {};
  let count = 0;
  for (const [key, entry] of Object.entries(raw)) {
    const name = cleanString(key, 128);
    if (!name || isUnsafeKey(name) || !name.startsWith('punctuation:')) continue;
    const stats = asRecord(entry);
    out[name] = {
      shown: counter(stats.shown),
      accepted: counter(stats.accepted),
      rejected: counter(stats.rejected),
      reverted: counter(stats.reverted),
      ignoredInContext: counter(stats.ignoredInContext),
    };
    if (++count >= 50) break;
  }
  return out;
}

function normaliseGrammarStats(value: unknown): Record<string, GrammarRuleStats> {
  const raw = asRecord(value);
  const out: Record<string, GrammarRuleStats> = {};
  let count = 0;
  for (const [key, entry] of Object.entries(raw)) {
    const name = cleanString(key, 128);
    if (!name || isUnsafeKey(name)) continue;
    const stats = asRecord(entry);
    out[name] = {
      offered: counter(stats.offered),
      accepted: counter(stats.accepted),
      rejected: counter(stats.rejected),
    };
    if (++count >= 200) break;
  }
  return out;
}

/**
 * Repairs missing and malformed fields from older builds or imported bundles.
 * No untrusted extra properties escape this boundary.
 */
export function normaliseStored(store: StoredShape): {
  settings: Settings;
  learning: LearningData;
} {
  return {
    settings: normaliseSettings(store[KEYS.settings]),
    learning: normaliseLearning(store[KEYS.learning]),
  };
}

/**
 * The learning model. Pure functions over a `LearningData` value - no storage,
 * no chrome APIs - so the same code can back an Android implementation.
 *
 * The background service worker is the single writer; content scripts hold a
 * read-only snapshot that is refreshed whenever this data changes.
 */
import { normaliseRuleText, ruleId as makeRuleId } from '../shared/util.js';
import { personalFactor } from './confidence-scorer.js';
import { isKnownWord } from './data/lexicon.js';
import { lookupTypo } from './data/typos.js';
import { classifyEdit } from './edit-distance.js';
import { areAdjacent } from './keyboard-distance.js';
import type {
  CorrectionRule,
  EngineContext,
  LearningData,
  RejectionReason,
  RuleSource,
  Settings,
} from '../shared/types.js';

const MAX_CONTEXT_WORDS = 12;

export function getRule(data: LearningData, id: string): CorrectionRule | undefined {
  return data.rules[id];
}

export function findRule(
  data: LearningData,
  original: string,
  replacement: string,
): CorrectionRule | undefined {
  return data.rules[makeRuleId(original, replacement)];
}

export function isDictionaryWord(data: LearningData, word: string): boolean {
  return data.dictionary.includes(normaliseRuleText(word.trim()));
}

export function isBlockedPair(data: LearningData, original: string, replacement: string): boolean {
  return data.blockedPairs.includes(makeRuleId(original, replacement));
}

/** Any rule that would rewrite `word`, regardless of target. */
export function rulesForWord(data: LearningData, word: string): CorrectionRule[] {
  const w = normaliseRuleText(word.trim());
  return Object.values(data.rules).filter((r) => r.original === w);
}

export function ensureRule(
  data: LearningData,
  original: string,
  replacement: string,
  source: RuleSource,
  manual = false,
): CorrectionRule {
  const originalNormalised = normaliseRuleText(original.trim());
  const replacementNormalised = normaliseRuleText(replacement.trim());
  const id = makeRuleId(originalNormalised, replacementNormalised);
  const existing = data.rules[id];
  if (existing) return existing;
  const rule: CorrectionRule = {
    id,
    original: originalNormalised,
    replacement: replacementNormalised,
    applied: 0,
    accepted: 0,
    reverted: 0,
    skipped: 0,
    blocked: 0,
    confidence: 0.5,
    // A rule created while recording an already-applied built-in correction
    // must preserve that built-in's normal threshold behavior. Only genuinely
    // learned rules begin suggestion-only.
    mode: source === 'personal-learning' ? 'suggestion' : 'autocorrect',
    source,
    context: { previousWords: [], nextWords: [], blockedPrevious: [], blockedNext: [] },
    sites: {},
    firstSeen: Date.now(),
    manual,
    enabled: true,
  };
  data.rules[id] = rule;
  return rule;
}

function pushCapped(list: string[], value: string): void {
  const normalised = normaliseRuleText(value.trim());
  if (!normalised || list.includes(normalised)) return;
  list.push(normalised);
  if (list.length > MAX_CONTEXT_WORDS) list.shift();
}

function refresh(rule: CorrectionRule): CorrectionRule {
  rule.confidence = personalFactor(rule);
  if (rule.mode !== 'blocked') {
    if (rule.confidence < 0.5 && rule.reverted > 0) rule.mode = 'suggestion';
    else if (rule.confidence >= 0.75 && rule.accepted >= 3) rule.mode = 'autocorrect';
  }
  return rule;
}

/** Called when a correction is written into the text. */
export function recordApplied(
  data: LearningData,
  original: string,
  replacement: string,
  source: RuleSource,
): CorrectionRule {
  const rule = ensureRule(data, original, replacement, source);
  rule.applied++;
  rule.lastApplied = Date.now();
  return refresh(rule);
}

/** Called when the user keeps a correction (explicitly or by review). */
export function recordAccepted(
  data: LearningData,
  original: string,
  replacement: string,
  ctx: Partial<EngineContext> | undefined,
  settings: Settings,
): CorrectionRule | undefined {
  if (!settings.learnFromDecisions) return undefined;
  const rule = ensureRule(data, original, replacement, 'personal-learning');
  rule.accepted++;
  if (ctx?.previousWord) pushCapped(rule.context.previousWords, ctx.previousWord);
  if (ctx?.nextWord) pushCapped(rule.context.nextWords, ctx.nextWord);
  return refresh(rule);
}

export interface RejectionOutcome {
  rule?: CorrectionRule;
  /** What actually changed, for the UI to report back honestly. */
  effect:
    | 'confidence-lowered'
    | 'demoted-to-suggestion'
    | 'blocked'
    | 'dictionary-added'
    | 'context-blocked'
    | 'no-learning';
}

/** Applies the meaning of a rejection. This is where the five modes differ. */
export function recordRejection(
  data: LearningData,
  original: string,
  replacement: string,
  reason: RejectionReason,
  ctx: Partial<EngineContext> | undefined,
  settings: Settings,
): RejectionOutcome {
  if (reason === 'keep-no-learn') return { effect: 'no-learning' };
  if (!settings.learnFromDecisions && reason === 'revert-once') return { effect: 'no-learning' };

  const rule = ensureRule(data, original, replacement, 'personal-learning');
  const id = rule.id;

  switch (reason) {
    case 'revert-once':
      rule.reverted++;
      refresh(rule);
      return { rule, effect: rule.mode === 'suggestion' ? 'demoted-to-suggestion' : 'confidence-lowered' };

    case 'lower-confidence':
      rule.reverted += 2;
      refresh(rule);
      rule.mode = 'suggestion';
      return { rule, effect: 'demoted-to-suggestion' };

    case 'never-this-pair':
      rule.reverted++;
      rule.blocked++;
      rule.mode = 'blocked';
      rule.enabled = false;
      refresh(rule);
      rule.mode = 'blocked';
      if (!data.blockedPairs.includes(id)) data.blockedPairs.push(id);
      return { rule, effect: 'blocked' };

    case 'never-correct-word': {
      rule.reverted++;
      refresh(rule);
      const w = normaliseRuleText(original.trim());
      if (!data.dictionary.includes(w)) data.dictionary.push(w);
      // The dictionary itself is the veto. Do not destroy the rules' previous
      // enabled state, so removing the word can restore prior behavior.
      return { rule, effect: 'dictionary-added' };
    }

    case 'not-in-this-context':
      rule.reverted++;
      if (ctx?.previousWord) pushCapped(rule.context.blockedPrevious, ctx.previousWord);
      if (ctx?.nextWord) pushCapped(rule.context.blockedNext, ctx.nextWord);
      refresh(rule);
      return { rule, effect: 'context-blocked' };
  }
}

export function recordSkipped(data: LearningData, original: string, replacement: string): void {
  const rule = findRule(data, original, replacement);
  if (rule) rule.skipped++;
}

export function addToDictionary(data: LearningData, word: string): void {
  const w = normaliseRuleText(word.trim());
  if (!w || data.dictionary.includes(w)) return;
  data.dictionary.push(w);
}

export function removeFromDictionary(data: LearningData, word: string): void {
  const w = normaliseRuleText(word.trim());
  const i = data.dictionary.indexOf(w);
  if (i < 0) return;
  data.dictionary.splice(i, 1);
  // Older versions disabled rules when adding a dictionary word. Repair those
  // legacy rules, while preserving explicit/global blocks.
  for (const rule of rulesForWord(data, w)) {
    if (rule.mode !== 'blocked' && !data.blockedPairs.includes(rule.id)) {
      rule.enabled = true;
    }
  }
}

/**
 * Creates or upgrades an explicit user-authored rule. This intentionally wins
 * over stale learned statistics and earlier "never this pair/word" choices.
 */
export function upsertUserRule(
  data: LearningData,
  original: string,
  replacement: string,
): CorrectionRule {
  const originalLower = normaliseRuleText(original.trim());
  const replacementLower = normaliseRuleText(replacement.trim());
  const id = makeRuleId(originalLower, replacementLower);
  const rule = ensureRule(data, originalLower, replacementLower, 'user-created', true);

  rule.id = id;
  rule.original = originalLower;
  rule.replacement = replacementLower;
  rule.source = 'user-created';
  rule.manual = true;
  rule.mode = 'autocorrect';
  rule.enabled = true;
  rule.confidence = 0.99;

  data.blockedPairs = data.blockedPairs.filter((blockedId) => blockedId !== id);
  data.dictionary = data.dictionary.filter(
    (word) => normaliseRuleText(word) !== originalLower,
  );
  delete data.pending[id];
  return rule;
}

export function unblockPair(
  data: LearningData,
  id: string,
  mode: 'autocorrect' | 'suggestion' = 'suggestion',
): void {
  const i = data.blockedPairs.indexOf(id);
  if (i >= 0) data.blockedPairs.splice(i, 1);
  const rule = data.rules[id];
  if (rule) {
    rule.enabled = true;
    rule.mode = mode;
    refresh(rule);
  }
}

export function deleteRule(data: LearningData, id: string): void {
  delete data.rules[id];
  unblockPair(data, id);
}

export function setRuleMode(data: LearningData, id: string, mode: CorrectionRule['mode']): void {
  const rule = data.rules[id];
  if (!rule) return;
  rule.mode = mode;
  rule.enabled = mode !== 'blocked';
}

/* ------------------------------------------------------------------ *
 * Learning from manual edits
 * ------------------------------------------------------------------ */

export interface ManualEditObservation {
  original: string;
  replacement: string;
}

export interface ManualEditResult {
  accepted: boolean;
  /** Evidence count so far. */
  count: number;
  /** Set when the observation crossed the threshold and created a rule. */
  createdRule?: CorrectionRule;
  rejectedBecause?: string;
}

const MULTI_WORD = /\s/;

/**
 * Records one observed manual edit. A rule is only created after
 * `settings.manualEditEvidence` independent sightings, and it starts as
 * suggestion-only so a wrong inference cannot silently rewrite text.
 */
export function observeManualEdit(
  data: LearningData,
  obs: ManualEditObservation,
  settings: Settings,
): ManualEditResult {
  if (!settings.learnFromManualEdits) {
    return { accepted: false, count: 0, rejectedBecause: 'learning-disabled' };
  }
  const original = normaliseRuleText(obs.original.trim());
  const replacement = normaliseRuleText(obs.replacement.trim());

  if (!original || !replacement || original === replacement) {
    return { accepted: false, count: 0, rejectedBecause: 'empty-or-identical' };
  }
  if (MULTI_WORD.test(original) || MULTI_WORD.test(replacement)) {
    return { accepted: false, count: 0, rejectedBecause: 'multi-word' };
  }
  if (original.length < 2 || original.length > 24 || replacement.length > 24) {
    return { accepted: false, count: 0, rejectedBecause: 'length' };
  }
  if (/[^a-zà-ÿ'’]/i.test(original) || /[^a-zà-ÿ'’]/i.test(replacement)) {
    return { accepted: false, count: 0, rejectedBecause: 'non-word-characters' };
  }
  const shape = classifyEdit(original, replacement);
  if (shape === 'identical' || shape === 'other') {
    return { accepted: false, count: 0, rejectedBecause: 'not-typo-shaped' };
  }
  const shippedTypo = lookupTypo(original) === replacement;
  if (shape === 'substitution' && !shippedTypo) {
    const changedAt = [...original].findIndex((ch, i) => ch !== replacement[i]);
    if (changedAt < 0 || !areAdjacent(original[changedAt]!, replacement[changedAt]!)) {
      return { accepted: false, count: 0, rejectedBecause: 'not-typo-shaped' };
    }
  }
  if (!isKnownWord(replacement) && !shippedTypo) {
    return { accepted: false, count: 0, rejectedBecause: 'unknown-target' };
  }
  if (isDictionaryWord(data, original)) {
    return { accepted: false, count: 0, rejectedBecause: 'in-dictionary' };
  }
  const id = makeRuleId(original, replacement);
  if (data.blockedPairs.includes(id)) {
    return { accepted: false, count: 0, rejectedBecause: 'blocked' };
  }
  if (data.rules[id]?.enabled && data.rules[id]!.mode !== 'blocked') {
    return { accepted: false, count: 0, rejectedBecause: 'rule-exists' };
  }

  const now = Date.now();
  const entry = data.pending[id] ?? {
    original,
    replacement,
    count: 0,
    firstSeen: now,
    lastSeen: now,
  };
  entry.count++;
  entry.lastSeen = now;
  data.pending[id] = entry;

  if (entry.count < settings.manualEditEvidence) {
    return { accepted: true, count: entry.count };
  }

  delete data.pending[id];
  const rule = ensureRule(data, original, replacement, 'personal-learning');
  refresh(rule);
  // Learned rules never start in autocorrect mode; they earn it.
  rule.mode = 'suggestion';
  return { accepted: true, count: entry.count, createdRule: rule };
}

/** Drops manual-edit evidence older than 30 days so stale noise cannot accrue. */
export function prunePending(data: LearningData, now = Date.now()): number {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [id, p] of Object.entries(data.pending)) {
    if (p.lastSeen < cutoff) {
      delete data.pending[id];
      removed++;
    }
  }
  return removed;
}

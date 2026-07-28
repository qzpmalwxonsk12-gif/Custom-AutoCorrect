/**
 * Shadow mode: providers analyse text and record what they *would* have done,
 * without touching a single character.
 *
 * This exists so an experimental rule (or, later, an AI provider) can be
 * measured against the shipping engine on real writing before it is allowed to
 * change anything. The privacy rule is strict and deliberate: observations are
 * capped, live in memory unless persistence is explicitly on, and never record
 * anything from a protected field.
 */
import type { ProposalAction } from './types.js';

export type ShadowProvider =
  | 'spelling'
  | 'spacing'
  | 'punctuation'
  | 'grammar'
  /** The context-ranking layer comparing experimental weights. */
  | 'context'
  | 'ai';

export interface ShadowObservation {
  id: string;
  /** Which lane produced it. */
  provider: ShadowProvider;
  /** Catalogue id where one exists, otherwise the provider's own rule id. */
  ruleId: string;
  originalText: string;
  replacementText: string;
  confidence: number;
  /** What would have happened had shadow mode been off. */
  wouldHave: Extract<ProposalAction, 'autocorrect' | 'suggest'>;
  /** Another provider proposed the same replacement for the same span. */
  agreedWith?: ShadowProvider[];
  /** Another provider proposed a *different* replacement for the same span. */
  disagreedWith?: Array<{ provider: ShadowProvider; replacementText: string }>;
  origin: string;
  createdAt: number;
}

/** Bounded so a long writing session cannot grow without limit. */
export const MAX_SHADOW_OBSERVATIONS = 500;

export interface ShadowLog {
  version: number;
  observations: ShadowObservation[];
}

export const EMPTY_SHADOW_LOG: ShadowLog = { version: 1, observations: [] };

let counter = 0;

export function createObservation(input: {
  provider: ShadowProvider;
  ruleId: string;
  originalText: string;
  replacementText: string;
  confidence: number;
  wouldHave: ShadowObservation['wouldHave'];
  origin: string;
  now?: number;
}): ShadowObservation {
  counter = (counter + 1) % 1_000_000;
  const now = input.now ?? Date.now();
  return {
    id: `sh_${now.toString(36)}_${counter.toString(36)}`,
    provider: input.provider,
    ruleId: input.ruleId.slice(0, 128),
    // Bounded: an observation is evidence about a rule, not a text archive.
    originalText: input.originalText.slice(0, 120),
    replacementText: input.replacementText.slice(0, 120),
    confidence: input.confidence,
    wouldHave: input.wouldHave,
    origin: input.origin,
    createdAt: now,
  };
}

/**
 * Appends an observation, cross-referencing it against recent ones for the same
 * original text so agreement and disagreement between providers is visible.
 */
export function recordObservation(log: ShadowLog, observation: ShadowObservation): ShadowLog {
  const recent = log.observations.slice(-25);
  const sameSpan = recent.filter(
    (o) =>
      o.originalText === observation.originalText
      && o.origin === observation.origin
      && o.provider !== observation.provider
      && observation.createdAt - o.createdAt < 60_000,
  );

  const agreed = sameSpan
    .filter((o) => o.replacementText === observation.replacementText)
    .map((o) => o.provider);
  const disagreed = sameSpan
    .filter((o) => o.replacementText !== observation.replacementText)
    .map((o) => ({ provider: o.provider, replacementText: o.replacementText }));

  const entry: ShadowObservation = {
    ...observation,
    ...(agreed.length > 0 ? { agreedWith: [...new Set(agreed)] } : {}),
    ...(disagreed.length > 0 ? { disagreedWith: disagreed } : {}),
  };

  // Symmetry: the earlier observation should also show that it was contradicted.
  for (const other of sameSpan) {
    if (other.replacementText === observation.replacementText) {
      other.agreedWith = [...new Set([...(other.agreedWith ?? []), observation.provider])];
    } else {
      other.disagreedWith = [
        ...(other.disagreedWith ?? []),
        { provider: observation.provider, replacementText: observation.replacementText },
      ];
    }
  }

  const observations = [...log.observations, entry];
  if (observations.length > MAX_SHADOW_OBSERVATIONS) {
    observations.splice(0, observations.length - MAX_SHADOW_OBSERVATIONS);
  }
  return { version: log.version, observations };
}

export interface ShadowSummary {
  total: number;
  wouldHaveAutocorrected: number;
  wouldHaveSuggested: number;
  byProvider: Record<string, number>;
  byRule: Record<string, number>;
  agreements: number;
  disagreements: number;
}

export function summariseShadowLog(log: ShadowLog): ShadowSummary {
  const summary: ShadowSummary = {
    total: log.observations.length,
    wouldHaveAutocorrected: 0,
    wouldHaveSuggested: 0,
    byProvider: {},
    byRule: {},
    agreements: 0,
    disagreements: 0,
  };
  for (const o of log.observations) {
    if (o.wouldHave === 'autocorrect') summary.wouldHaveAutocorrected++;
    else summary.wouldHaveSuggested++;
    summary.byProvider[o.provider] = (summary.byProvider[o.provider] ?? 0) + 1;
    summary.byRule[o.ruleId] = (summary.byRule[o.ruleId] ?? 0) + 1;
    if (o.agreedWith?.length) summary.agreements++;
    if (o.disagreedWith?.length) summary.disagreements++;
  }
  return summary;
}

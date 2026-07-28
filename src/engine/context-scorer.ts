/**
 * Lightweight local context scoring for real-word errors.
 *
 * No model, no network: a signed evidence score built from hand-written bigram
 * cues plus whatever the user's own accept/reject history says.
 */
import { confusionEntry, confusionFor } from './data/confusions.js';
import type { CorrectionRule, EngineContext } from '../shared/types.js';

export interface ContextVerdict {
  /** Positive: swap to `replacement`. Negative: keep the typed word. */
  score: number;
  replacement?: string;
  reason: string;
}

function evidence(word: string, ctx: EngineContext): number {
  const entry = confusionEntry(word);
  if (!entry) return 0;
  let s = 0;
  if (ctx.previousWord && entry.prev.includes(ctx.previousWord)) s += 1;
  if (ctx.nextWord && entry.next.includes(ctx.nextWord)) s += 1;
  if (entry.patterns) {
    const window = `${ctx.before} ${ctx.after}`.toLowerCase();
    for (const p of entry.patterns) if (p.test(window)) s += 0.5;
  }
  return s;
}

/**
 * Decides whether a *valid* word is the wrong word here.
 *
 * Returns a verdict whose score is roughly "how much more the context supports
 * the alternative than the typed word". Callers turn that into confidence.
 */
export function scoreContext(word: string, ctx: EngineContext): ContextVerdict | null {
  const set = confusionFor(word);
  if (!set) return null;

  const own = evidence(word, ctx);
  let best: { word: string; score: number } | null = null;
  for (const alt of set.alternatives) {
    const s = evidence(alt, ctx);
    if (!best || s > best.score) best = { word: alt, score: s };
  }
  if (!best) return null;

  const delta = best.score - own;
  if (delta <= 0) {
    return { score: delta, reason: `context supports "${word}"` };
  }
  // The typed word having *any* support is a strong veto: "complete the form"
  // must never flip, even though "from" also has cues nearby.
  if (own > 0) {
    return { score: delta - own, reason: `both readings have support` };
  }
  return {
    score: delta,
    replacement: best.word,
    reason: `context suggests "${best.word}" (${describeCues(ctx)})`,
  };
}

function describeCues(ctx: EngineContext): string {
  const parts: string[] = [];
  if (ctx.previousWord) parts.push(`after "${ctx.previousWord}"`);
  if (ctx.nextWord) parts.push(`before "${ctx.nextWord}"`);
  return parts.join(', ') || 'sentence context';
}

/**
 * Applies the user's context-specific rejections ("keep `form` after
 * `application`"). Returns true when this rule must not fire here.
 */
export function contextBlocked(rule: CorrectionRule | undefined, ctx: EngineContext): boolean {
  if (!rule) return false;
  if (ctx.previousWord && rule.context.blockedPrevious.includes(ctx.previousWord)) return true;
  if (ctx.nextWord && rule.context.blockedNext.includes(ctx.nextWord)) return true;
  return false;
}

/** Positive nudge when the user has previously accepted this rule right here. */
export function contextSupport(rule: CorrectionRule | undefined, ctx: EngineContext): number {
  if (!rule) return 0;
  let s = 0;
  if (ctx.previousWord && rule.context.previousWords.includes(ctx.previousWord)) s += 0.5;
  if (ctx.nextWord && rule.context.nextWords.includes(ctx.nextWord)) s += 0.5;
  return s;
}

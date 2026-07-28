/**
 * The correction engine: layered, deterministic, allocation-light.
 *
 * Entry point is `analyze()`, which is called once per committed word. Layers
 * run in a fixed priority order and the first actionable one wins:
 *
 *   1. never-correct / blocked rules      6. indexed dictionary candidates
 *   2. user dictionary                    7. keyboard + edit-distance scoring
 *   3. user-created exact rules           8. lightweight contextual scoring
 *   4. personal learned rules             9. local grammar rules
 *   5. common typo table
 *
 * Nothing in this file touches the DOM, chrome APIs or the network.
 */
import { clamp, normaliseRuleText } from '../shared/util.js';
import type {
  CorrectionProposal,
  CorrectionRule,
  EngineContext,
  LearningData,
  Settings,
} from '../shared/types.js';
import { generateCandidates, type Candidate } from './candidate-generator.js';
import { ruleContextProvider } from './context/rule-context-provider.js';
import { applyPolicy, classifyRisk } from './context/correction-policy.js';
import { DEFAULT_WEIGHTS } from './context/score-weights.js';
import type { DocumentEvidenceSource } from './context/document-evidence.js';
import { compareRankings, type RankingComparison } from './context/shadow-comparison.js';
import { matchCase, capitalise, detectCaseStyle } from './capitalization.js';
import {
  decideAction,
  personalFactor,
  scoreContextual,
  scoreExact,
  scoreSpelling,
} from './confidence-scorer.js';
import { contextBlocked, contextSupport, scoreContext } from './context-scorer.js';
import { sentenceFeaturesAt } from './context/context-features.js';
import { isKnownWord } from './data/dictionary.js';
import { lookupTypo } from './data/typos.js';
import { checkArticle } from './grammar-rules.js';
import { findRule, isBlockedPair, isDictionaryWord } from './personal-learning.js';
import {
  analyzeToken,
  isSentenceStart,
  nextWord,
  previousWord,
  wordEndingAt,
} from './tokenizer.js';

const CONTEXT_WINDOW = 60;
/** Minimum lead over the runner-up required for a spelling auto-correction. */
export const SPELLING_AUTOCORRECT_MARGIN = 0.06;
/**
 * Preserve short acronym/ticker protection while allowing a long, unknown
 * all-caps word to receive the same high-confidence spelling analysis as
 * ordinary prose. The final confidence and ambiguity gates still apply.
 */
const MIN_ALL_CAPS_SPELLCHECK_LENGTH = 6;

/**
 * The most recent experimental-vs-production ranking difference.
 *
 * A module-level slot rather than a return value because `analyze` is called
 * from a synchronous hot path whose signature is shared by several callers, and
 * only the shadow lane cares. Read it immediately after `analyze` returns, or
 * not at all.
 */
let lastRankingComparison: RankingComparison | null = null;

/** Takes the last shadow comparison, clearing it. */
export function takeRankingComparison(): RankingComparison | null {
  const value = lastRankingComparison;
  lastRankingComparison = null;
  return value;
}

export interface AnalyzeInput {
  text: string;
  /** Exclusive end offset of the word that was just committed. */
  wordEnd: number;
  origin: string;
  /**
   * Document-local vocabulary evidence, when the caller has any. Optional so
   * every existing call site is unchanged and the engine stays usable without
   * a document around it.
   */
  documentEvidence?: DocumentEvidenceSource;
}

export interface AnalyzeResult {
  proposal: CorrectionProposal;
  context: EngineContext;
}

/** Builds the bounded context window handed to the scorers. */
export function buildContext(
  text: string,
  start: number,
  end: number,
  origin: string,
): EngineContext {
  const rawBefore = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  let beforeStart = Math.max(
    rawBefore.lastIndexOf('\n') + 1,
    rawBefore.lastIndexOf('\r') + 1,
  );
  const sentenceBoundary = /[.!?][)"'\]]?\s/gu;
  let boundary: RegExpExecArray | null;
  while ((boundary = sentenceBoundary.exec(rawBefore)) !== null) {
    beforeStart = Math.max(beforeStart, boundary.index + boundary[0].length);
  }
  const before = rawBefore.slice(beforeStart);

  let after = text.slice(end, Math.min(text.length, end + CONTEXT_WINDOW));
  const afterBoundary = /(?:\r?\n|[.!?][)"'\]]?(?:\s|$))/u.exec(after);
  if (afterBoundary) {
    after = after.slice(0, afterBoundary.index + afterBoundary[0].length);
  }
  const context: EngineContext = {
    before,
    after,
    previousWord: previousWord(text, start),
    nextWord: nextWord(text, end),
    isSentenceStart: isSentenceStart(text, start),
    origin,
  };

  // Shared linguistic features. Best effort by design: `sentenceFeaturesAt`
  // declines on very long fields, and every consumer treats absence as "no
  // extra evidence" rather than as a failure.
  const features = sentenceFeaturesAt(text, start, end);
  if (features) {
    context.sentenceText = features.sentenceText;
    context.sentenceTokens = features.sentenceTokens;
    if (features.targetClause) context.targetClause = features.targetClause;
    if (features.previousToken) context.previousTokenType = features.previousToken.type;
    if (features.nextToken) context.nextTokenType = features.nextToken.type;
  }
  return context;
}

function ruleUsable(
  rule: CorrectionRule | undefined,
  data: LearningData,
  ctx: EngineContext,
  blockedIds?: ReadonlySet<string>,
): rule is CorrectionRule {
  if (!rule) return false;
  if (!rule.enabled || rule.mode === 'blocked') return false;
  if (blockedIds ? blockedIds.has(rule.id) : data.blockedPairs.includes(rule.id)) return false;
  if (rule.sites[ctx.origin] === 'off') return false;
  if (contextBlocked(rule, ctx)) return false;
  return true;
}

/** Case-adjusts a replacement for the word it is standing in for. */
function fit(observed: string, replacement: string, ctx: EngineContext): string {
  let out = matchCase(observed, replacement);
  const apostrophe = observed.match(/['\u02bc\u2018\u2019\uff07]/u)?.[0];
  if (apostrophe && apostrophe !== "'") out = out.replaceAll("'", apostrophe);
  if (ctx.isSentenceStart && detectCaseStyle(observed) !== 'upper') out = capitalise(out);
  return out;
}

/**
 * Analyses the word ending at `wordEnd` and returns a proposal, or null when
 * nothing should happen. Cost is bounded and independent of document length.
 */
export function analyze(
  input: AnalyzeInput,
  data: LearningData,
  settings: Settings,
): AnalyzeResult | null {
  if (!settings.enabled) return null;
  const { text, wordEnd, origin } = input;
  if (settings.siteOverrides[origin] === 'off') return null;

  const token = wordEndingAt(text, wordEnd);
  if (!token) return null;

  const guard = analyzeToken(text, token.start, token.end);
  const ctx = buildContext(text, token.start, token.end, origin);
  const word = token.text;
  const lower = normaliseRuleText(word);

  // Layer 1 + 2: protected tokens and the personal dictionary short-circuit
  // every replacement layer. Grammar still gets a look because it only ever
  // rewrites the *article* in front of the word.
  const longUnknownAllCaps =
    guard.reason === 'all-caps' &&
    word.length >= MIN_ALL_CAPS_SPELLCHECK_LENGTH &&
    !isKnownWord(lower);
  const spellingAllowed =
    (!guard.protected || longUnknownAllCaps) &&
    !isDictionaryWord(data, lower);

  if (spellingAllowed) {
    const proposal =
      exactRuleLayer(text, token, lower, ctx, data, settings) ??
      typoLayer(text, token, lower, ctx, data, settings) ??
      dictionaryPipelineLayer(
        text,
        token,
        lower,
        ctx,
        data,
        settings,
        input.documentEvidence ?? null,
      ) ??
      contextualLayer(text, token, lower, ctx, data, settings);
    if (proposal) return { proposal, context: ctx };
  }

  if (settings.grammarEnabled) {
    const fix = checkArticle(text, token.start, token.end);
    if (fix && !isBlockedPair(data, fix.original, fix.replacement)) {
      // Grammar targets the preceding article, so its learning context must be
      // built around that span rather than around the committed noun.
      const grammarCtx = buildContext(text, fix.start, fix.end, origin);
      const rule = findRule(data, fix.original, fix.replacement);
      if (rule && !ruleUsable(rule, data, grammarCtx)) return null;
      const confidence = rule
        ? clamp(fix.confidence * (0.7 + 0.6 * personalFactor(rule)), 0, 0.99)
        : fix.confidence;
      const action = decideAction(confidence, rule?.mode ?? 'default', settings);
      if (action !== 'none') {
        return {
          proposal: {
            start: fix.start,
            end: fix.end,
            original: fix.original,
            replacement: fix.replacement,
            correctionType: 'grammar',
            source: 'builtin-grammar',
            confidence,
            action,
            reason: fix.reason,
            ruleId: rule?.id,
          },
          context: grammarCtx,
        };
      }
    }
  }
  return null;
}

/* ------------------------------ layers ------------------------------ */

/** Layers 3 + 4: user-created rules, then personal learned rules. */
function exactRuleLayer(
  _text: string,
  token: { text: string; start: number; end: number },
  lower: string,
  ctx: EngineContext,
  data: LearningData,
  settings: Settings,
): CorrectionProposal | null {
  const candidates = Object.values(data.rules).filter(
    (r) =>
      (r.source === 'user-created' || r.source === 'personal-learning') &&
      r.original === lower &&
      ruleUsable(r, data, ctx),
  );
  if (candidates.length === 0) return null;

  const order = (r: CorrectionRule) =>
    (r.source === 'user-created' ? 2 : r.source === 'personal-learning' ? 1 : 0) * 10 +
    r.confidence;
  candidates.sort((a, b) => order(b) - order(a));
  const rule = candidates[0]!;

  const source = rule.source === 'user-created' ? 'user-created' : 'personal-rule';
  const confidence = clamp(scoreExact(source, rule) + contextSupport(rule, ctx) * 0.05, 0, 0.99);
  const action = decideAction(confidence, rule.mode, settings);
  if (action === 'none') return null;

  return {
    start: token.start,
    end: token.end,
    original: token.text,
    replacement: fit(token.text, rule.replacement, ctx),
    correctionType: rule.source === 'user-created' ? 'exact-rule' : 'personal-rule',
    source: rule.source === 'user-created' ? 'user-created' : 'personal-learning',
    confidence,
    action,
    reason:
      rule.source === 'user-created'
        ? 'your replacement rule'
        : `learned from your edits (${rule.accepted} kept, ${rule.reverted} reverted)`,
    ruleId: rule.id,
  };
}

/** Layer 5: the shipped common-typo table. */
function typoLayer(
  _text: string,
  token: { text: string; start: number; end: number },
  lower: string,
  ctx: EngineContext,
  data: LearningData,
  settings: Settings,
): CorrectionProposal | null {
  // The preserved typo table predates the full ESDB list. If its left-hand
  // side is a legitimate dictionary word (for example "abut" or "wont"),
  // treating it as an unconditional typo would create a real-word error.
  if (isKnownWord(lower)) return null;
  const replacement = lookupTypo(lower);
  if (!replacement) return null;
  if (isBlockedPair(data, lower, replacement)) return null;

  const rule = data.rules[`${lower}->${replacement}`];
  if (rule && !ruleUsable(rule, data, ctx)) return null;

  const confidence = scoreExact('builtin-typo', rule);
  const action = decideAction(confidence, rule?.mode ?? 'default', settings);
  if (action === 'none') return null;

  return {
    start: token.start,
    end: token.end,
    original: token.text,
    replacement: fit(token.text, replacement, ctx),
    correctionType: 'spelling',
    source: 'builtin-typo',
    confidence,
    action,
    reason: 'common misspelling',
    ruleId: rule?.id,
  };
}

/** Layers 6 + 7: the deterministic three-process dictionary pipeline. */
function dictionaryPipelineLayer(
  _text: string,
  token: { text: string; start: number; end: number },
  lower: string,
  ctx: EngineContext,
  data: LearningData,
  settings: Settings,
  documentEvidence: DocumentEvidenceSource = null,
): CorrectionProposal | null {
  // A word the dictionary knows is not a spelling error. Real-word errors are
  // deliberately delegated to the context layer.
  if (isKnownWord(lower)) return null;
  if (lower.length < 3) return null;
  // Capitalised mid-sentence: almost always a name, so do not infer that an
  // uncommon proper noun is a misspelling merely because ESDB lacks it.
  if (detectCaseStyle(token.text) === 'title' && !ctx.isSentenceStart) return null;

  const blockedIds = new Set(data.blockedPairs);
  const blockedPrefix = `${lower}->`;
  let hasBlockedAlternative = false;
  for (const id of blockedIds) {
    if (id.startsWith(blockedPrefix)) {
      hasBlockedAlternative = true;
      break;
    }
  }
  const evidenceByWord = new Map<
    string,
    {
      eligible: boolean;
      rule: CorrectionRule | undefined;
      rankAdjustment: number;
    }
  >();
  const evidenceFor = (candidate: Candidate) => {
    const cached = evidenceByWord.get(candidate.word);
    if (cached) return cached;
    const id = `${lower}->${candidate.word}`;
    const rule = data.rules[id];
    const eligible =
      !blockedIds.has(id) &&
      (!rule || ruleUsable(rule, data, ctx, blockedIds));
    const evidence = {
      eligible,
      rule,
      rankAdjustment:
        eligible && rule
          ? (personalFactor(rule) - 0.5) * 0.14 +
            contextSupport(rule, ctx) * 0.06
          : eligible
            ? 0
            : -1,
    };
    evidenceByWord.set(candidate.word, evidence);
    return evidence;
  };

  const candidates = generateCandidates(
    lower,
    10,
    undefined,
    undefined,
    (candidate) => evidenceFor(candidate).rankAdjustment,
  );
  if (candidates.length === 0) return null;

  /*
   * Ranking happens once, in the shared provider, on an **unclamped** score.
   *
   * This used to be a local sort over `scoreSpelling`, which clamps to 0.99 —
   * so two genuinely different candidates could both reach the ceiling, tie,
   * and be separated by alphabetical order. Confidence is still computed from
   * `scoreSpelling` below, but only *after* the winner and the margin have been
   * established on a scale that can still tell them apart.
   */
  const eligible = candidates.filter((candidate) => evidenceFor(candidate).eligible);
  if (eligible.length === 0) return null;

  const rankingInput = {
    originalText: token.text,
    start: token.start,
    end: token.end,
    candidates: eligible,
    context: ctx,
    weights: DEFAULT_WEIGHTS,
    rankAdjustment: (candidate: Candidate) => evidenceFor(candidate).rankAdjustment,
    documentEvidence,
  };
  const decision = ruleContextProvider.rank(rankingInput);
  if (!decision.bestCandidate) return null;

  // Shadow comparison: what would the experimental weights have chosen? Costs
  // one extra ranking pass over at most ten candidates, and only runs when the
  // caller asked for it.
  if (settings.shadowMode !== 'off') {
    lastRankingComparison = compareRankings(rankingInput);
  }

  const bestRule = evidenceFor(decision.bestCandidate.candidate).rule;
  const best = {
    candidate: decision.bestCandidate.candidate,
    rule: bestRule,
    confidence: scoreSpelling({
      candidate: decision.bestCandidate.candidate,
      originalIsWord: false,
      rule: bestRule,
      contextSupport: contextSupport(bestRule, ctx),
    }),
  };
  const hasRunnerUp = decision.secondBestCandidate !== null;

  /*
   * There is exactly one ambiguity margin: the winner's lead on the unified,
   * unclamped ranking scale. Display confidence is deliberately computed only
   * after ranking and must not widen that lead.
   */
  const rawMargin = hasRunnerUp ? decision.margin : 1;
  // A close runner-up is evidence against certainty, even when the winner
  // remains the best deterministic suggestion.
  const ambiguityPenalty = hasRunnerUp
    ? Math.max(0, SPELLING_AUTOCORRECT_MARGIN - rawMargin)
    : 0;
  // Clamping happens here and only here: after ranking, after the margin.
  const confidence = clamp(best.confidence - ambiguityPenalty, 0, 0.99);
  let action = decideAction(confidence, best.rule?.mode ?? 'default', settings);
  if (action === 'autocorrect' && rawMargin < SPELLING_AUTOCORRECT_MARGIN) {
    action = 'suggest';
  }
  // If the user explicitly blocked a different replacement for this spelling,
  // an automatically chosen fallback would evade that decision.
  if (
    action === 'autocorrect' &&
    hasBlockedAlternative
  ) {
    action = 'suggest';
  }
  // Appending a letter to a short token is the signature of a word the user
  // has not finished ("impro" + " " + "vement"). Completing it automatically
  // destroys the evidence the accidental-space merge needs, so this shape is
  // only ever offered.
  const insertion = best.candidate.missingLetter;
  if (
    action === 'autocorrect' &&
    insertion &&
    insertion.insertedIndex >= lower.length &&
    lower.length < 7
  ) {
    action = 'suggest';
  }

  /*
   * Correction-risk policy, applied last.
   *
   * The scorer has already decided *which* candidate is best; this decides
   * whether that evidence is strong and safe enough to act on. It can only ever
   * lower the action - a class never promotes a correction the scorer was
   * unwilling to make - so with the margins tuned to today's behaviour this is
   * a no-op for existing cases and a gate for the new ones.
   */
  const policy = applyPolicy({
    riskClass: classifyRisk({
      originalIsValidWord: false,
      candidate: best.candidate,
      isPersonalRule: best.rule?.source === 'user-created'
        || best.rule?.source === 'personal-learning',
    }),
    score: decision.bestCandidate.rawScore,
    margin: rawMargin,
    proposedAction: action,
  });
  action = policy.action;

  if (action === 'none') return null;

  const proposal: CorrectionProposal = {
    start: token.start,
    end: token.end,
    original: token.text,
    replacement: fit(token.text, best.candidate.word, ctx),
    correctionType: correctionTypeFor(best.candidate),
    source: 'lexicon',
    confidence,
    action,
    reason: describeCandidate(best.candidate, ambiguityPenalty > 0),
    ruleId: best.rule?.id,
    keyboardSubstitution: best.candidate.keyboardSubstitution,
  };
  if (best.candidate.duplicateLetter) proposal.letterEvidence = best.candidate.duplicateLetter;
  if (best.candidate.missingLetter) proposal.letterEvidence = best.candidate.missingLetter;
  if (best.candidate.extraLetter) proposal.letterEvidence = best.candidate.extraLetter;
  if (best.candidate.missingApostrophe) {
    proposal.letterEvidence = best.candidate.missingApostrophe;
  }
  return proposal;
}

/** Presentation type, so the panel can name the operation that was performed. */
function correctionTypeFor(candidate: Candidate): CorrectionProposal['correctionType'] {
  switch (candidate.process) {
    case 2:
      return 'adjacent-swap';
    case 3:
      return 'keyboard-proximity';
    case 4:
      return 'duplicate-letter';
    case 5:
      return 'missing-letter';
    case 6:
      return 'extra-letter';
    case 7:
      return 'missing-apostrophe';
    default:
      return 'spelling';
  }
}

/** Layer 8: real-word errors decided by local context. */
function contextualLayer(
  _text: string,
  token: { text: string; start: number; end: number },
  lower: string,
  ctx: EngineContext,
  data: LearningData,
  settings: Settings,
): CorrectionProposal | null {
  if (!settings.contextualEnabled) return null;
  const verdict = scoreContext(lower, ctx);
  if (!verdict?.replacement || verdict.score <= 0) return null;
  if (isBlockedPair(data, lower, verdict.replacement)) return null;

  const rule = data.rules[`${lower}->${verdict.replacement}`];
  if (rule && !ruleUsable(rule, data, ctx)) return null;

  const confidence = scoreContextual(verdict.score, rule, contextSupport(rule, ctx));
  let action = decideAction(confidence, rule?.mode ?? 'default', settings);
  // Contextual rewrites only auto-apply when the user has opted in *and* the
  // rule has personal evidence behind it.
  if (action === 'autocorrect' && !(settings.contextualAutocorrect && rule && rule.accepted >= 3)) {
    action = 'suggest';
  }
  if (action === 'none') return null;

  return {
    start: token.start,
    end: token.end,
    original: token.text,
    replacement: fit(token.text, verdict.replacement, ctx),
    correctionType: 'contextual',
    source: 'builtin-context',
    confidence,
    action,
    reason: verdict.reason,
    ruleId: rule?.id,
  };
}

function describeCandidate(candidate: Candidate, ambiguous: boolean): string {
  const suffix = ambiguous ? '; close alternative also found' : '';
  switch (candidate.process) {
    case 2:
      return `two adjacent letters swapped${suffix}`;
    case 3:
      if (candidate.keyboardSubstitution) {
        const evidence = candidate.keyboardSubstitution;
        return (
          `keyboard-neighbour substitution at position ${evidence.index + 1}: ` +
          `${evidence.typedCharacter} → ${evidence.replacementCharacter}${suffix}`
        );
      }
      return `keyboard-neighbour substitution${suffix}`;
    case 4:
      if (candidate.duplicateLetter) {
        const { removedCharacter, removedIndex } = candidate.duplicateLetter;
        return (
          `removed accidental duplicate letter: ` +
          `${removedCharacter} at position ${removedIndex + 1}${suffix}`
        );
      }
      return `removed an accidental duplicate letter${suffix}`;
    case 5:
      if (candidate.missingLetter) {
        const { insertedCharacter, insertedIndex } = candidate.missingLetter;
        return (
          `inserted missing letter: ` +
          `${insertedCharacter} at position ${insertedIndex + 1}${suffix}`
        );
      }
      return `inserted a missing letter${suffix}`;
    case 6:
      if (candidate.extraLetter) {
        const { removedCharacter, removedIndex } = candidate.extraLetter;
        return (
          `removed extra letter: ${removedCharacter} at position ${removedIndex + 1}${suffix}`
        );
      }
      return `removed an extra letter${suffix}`;
    case 7:
      if (candidate.missingApostrophe) {
        const { insertedIndex } = candidate.missingApostrophe;
        return `restored the missing apostrophe at position ${insertedIndex + 1}${suffix}`;
      }
      return `restored a missing apostrophe${suffix}`;
    default:
      return `same-length dictionary match${suffix}`;
  }
}

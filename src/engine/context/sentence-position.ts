/**
 * Sentence-position plausibility for a candidate.
 *
 * Answers one narrow question: given *where in the sentence* the typed token
 * sits, is this candidate's word class possible there? English forbids a few
 * positions outright — a sentence cannot end on `the`, a possessive cannot sit
 * before a full stop — and those prohibitions are reliable in a way that most
 * positional guesses are not.
 *
 * Three things this deliberately does not do:
 *
 *   - It does not detect sentences. Position comes from the shared analysis in
 *     `EngineContext`, which the punctuation lane has always used, so `e.g.`
 *     and `3.5` are already not sentence boundaries here.
 *   - It does not propose or duplicate capitalisation corrections. Those are a
 *     separate lane; this only reorders candidates that already exist.
 *   - It does not reward a candidate for being capitalised. The only
 *     capitalisation rule below is a *penalty*, and it is switched off at
 *     sentence start precisely because capitalisation carries no information
 *     there.
 *
 * Like every context term the output is small and advisory: operation cost
 * still outranks it in the comparator.
 */
import { classifyWord } from './pos-compatibility.js';
import type { EngineContext } from '../../shared/types.js';
import type { TokenType } from './context-types.js';

/** Where the target token sits, derived entirely from existing analysis. */
export interface SentenceSlot {
  /** First lexical word of its sentence. */
  isSentenceStart: boolean;
  /** Immediately before `.`, `!` or `?`. */
  isSentenceEnd: boolean;
  /** Immediately before `,`, `;`, `:`, a dash or a closing bracket. */
  beforeClauseBreak: boolean;
  /** Immediately after `,`, `;`, `:`, a dash or an opening bracket. */
  afterClauseBreak: boolean;
  /** Immediately after an opening quote or bracket. */
  afterOpener: boolean;
  /** The sentence has no finite verb: a heading, label or fragment. */
  isFragment: boolean;
}

const TERMINAL = /^[.!?]/;
const CLAUSE_BREAK_AFTER = /^\s*[,;:)\]}–—-]/;
const CLAUSE_BREAK_BEFORE = /[,;:([{–—-]\s*$/;
const OPENER = /["'“‘([{]\s*$/;

/**
 * Classes that genuinely cannot end a sentence.
 *
 * Deliberately short. The ground-truth sweep rejected the two obvious
 * additions, and both rejections were correct English:
 *
 *   - `auxiliary` ends sentences constantly through ellipsis - "Yes, I have."
 *     Penalising it turned `hve` -> `have` into `hve` -> `he`.
 *   - `preposition` strands just as often in questions and relative clauses -
 *     "Who are you talking to?", "Where are you from?"
 *
 * A determiner really does require a complement, and a sentence really cannot
 * end on a bare coordinator, so those two remain.
 */
const NEEDS_A_COMPLEMENT: ReadonlySet<TokenType> = new Set<TokenType>([
  'determiner',
  'conjunction',
]);

/** Reads the slot out of the shared context. No tokenising happens here. */
export function sentenceSlot(context: EngineContext): SentenceSlot {
  const after = context.after ?? '';
  const before = context.before ?? '';
  const trimmedAfter = after.replace(/^\s+/, '');

  return {
    isSentenceStart: context.isSentenceStart === true,
    isSentenceEnd: TERMINAL.test(trimmedAfter),
    beforeClauseBreak: CLAUSE_BREAK_AFTER.test(after),
    afterClauseBreak: CLAUSE_BREAK_BEFORE.test(before),
    afterOpener: OPENER.test(before),
    // Only claim "fragment" when the analysis ran and found no finite verb.
    isFragment: context.targetClause !== undefined && !context.targetClause.hasFiniteVerb,
  };
}

/** True for a candidate whose dictionary form carries a capital. */
function isProperForm(candidate: string): boolean {
  return /[A-Z]/.test(candidate);
}

/** True for a possessive or contraction ending, e.g. `mi's`, `that's`. */
function isPossessiveForm(candidate: string): boolean {
  return /['’]s$/i.test(candidate);
}

/**
 * How well a candidate fits its sentence slot, in -1..1.
 *
 * Zero means "no opinion", which is the answer for most words in most
 * positions. Every rule below is a prohibition rather than a preference: the
 * signal only speaks when a position genuinely rules a class out.
 */
export function sentencePositionScore(
  candidate: string,
  context: EngineContext,
  typedWord?: string,
): number {
  const slot = sentenceSlot(context);
  const type = classifyWord(candidate);
  let score = 0;

  // A sentence cannot end on a word that requires a complement: "I went to
  // the." is not a sentence, whatever the edit distance says.
  if (slot.isSentenceEnd && NEEDS_A_COMPLEMENT.has(type)) score -= 1;

  // A possessive needs a noun after it, so it cannot sit before a full stop.
  // This is the positional half of the `mis` -> `mi's` guard; the lexical half
  // lives in the contraction table and does the real work.
  if (slot.isSentenceEnd && isPossessiveForm(candidate)) score -= 0.75;

  // The same prohibition, weaker, at an internal clause break: "I saw the, and
  // left" is wrong. Prepositions are excluded here for the same reason as
  // above - "the man I spoke to, and then left" is ordinary English.
  if (slot.beforeClauseBreak && !slot.isSentenceEnd && type === 'determiner') score -= 0.5;

  // A capitalised dictionary form proposed for a lower-case token is weak
  // negative evidence mid-sentence, and *no* evidence at a sentence start,
  // where every word is capitalised and the case tells us nothing. This is why
  // `iPhone` must not climb over `improve` and `prove` for `iprove`.
  if (
    typedWord !== undefined
    && isProperForm(candidate)
    && typedWord === typedWord.toLowerCase()
    && !slot.isSentenceStart
    && !slot.afterOpener
    && !slot.afterClauseBreak
  ) {
    score -= 0.5;
  }

  // Opening a sentence with a coordinating conjunction is possible and common
  // in informal writing, so this is the smallest penalty here rather than a
  // prohibition.
  if ((slot.isSentenceStart || slot.afterOpener) && type === 'conjunction') score -= 0.25;

  // Headings, labels and fragments break the assumptions above - they routinely
  // end on a preposition or a determiner - so halve any opinion formed in one.
  if (slot.isFragment) score /= 2;

  return Math.max(-1, Math.min(1, score));
}

/** Human-readable reason, for ranking diagnostics. */
export function describeSentencePosition(
  candidate: string,
  context: EngineContext,
  typedWord?: string,
): string {
  const slot = sentenceSlot(context);
  const parts: string[] = [];
  if (slot.isSentenceStart) parts.push('sentence start');
  if (slot.isSentenceEnd) parts.push('before terminal punctuation');
  if (slot.beforeClauseBreak) parts.push('before clause break');
  if (slot.afterClauseBreak) parts.push('after clause break');
  if (slot.afterOpener) parts.push('after opening quote or bracket');
  if (slot.isFragment) parts.push('fragment');
  const where = parts.length > 0 ? parts.join(', ') : 'mid-sentence';
  const score = sentencePositionScore(candidate, context, typedWord);
  return `${classifyWord(candidate)} at ${where} (${score >= 0 ? '+' : ''}${score.toFixed(2)})`;
}

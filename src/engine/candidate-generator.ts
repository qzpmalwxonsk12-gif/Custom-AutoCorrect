/**
 * Deterministic spelling candidates for Idea Version 1.
 *
 * The generator has exactly three bounded processes:
 *   1. scan only the same-length, same-first-letter dictionary bucket;
 *   2. check the n - 1 adjacent swaps;
 *   3. check one QWERTY-neighbour substitution at a time.
 *
 * It never iterates the full dictionary and never generates insertions,
 * deletions, arbitrary permutations, or multi-character substitutions.
 */
import { compareByScore } from './context/candidate-order.js';
import { apostropheIsSupported } from './data/contractions.js';
import { classifyEdit, type EditShape } from './edit-distance.js';
import { keyDistance, neighbours, proximityScore } from './keyboard-distance.js';
import type { KeyboardSubstitutionEvidence } from '../shared/types.js';
import {
  dictionary,
  frequencyScore,
  normaliseDictionaryWord,
} from './data/dictionary.js';

export type CandidateProcess = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Deterministic cost of the edit that explains a candidate. Lower is a simpler
 * and therefore more plausible typo.
 *
 * This is the dominant ranking term: it is what stops a broad same-length
 * bucket match ("iprove" -> "iphone", several substitutions) from beating a
 * single-operation explanation ("iprove" -> "improve", one inserted letter).
 */
export const OPERATION_COST = {
  exactRule: 0,
  duplicateLetter: 1,
  adjacentSwap: 1,
  keyboardSubstitution: 1,
  missingLetter: 1,
  extraLetter: 1,
  /**
   * Cheaper than any other single edit. Dropping the apostrophe from a
   * contraction is the single most common thing a fast typist does, and the
   * result is almost never a real word - so when "didnt" has both a
   * one-apostrophe reading ("didn't") and a one-letter reading ("dint"), the
   * apostrophe is overwhelmingly the intended one.
   */
  missingApostrophe: 0.5,
  arbitrarySubstitution: 2,
  bucketSimilarity: 3,
  multiOperation: 4,
} as const;

/** Which character was removed to reach a candidate. */
export interface RemovedLetterEvidence {
  removedIndex: number;
  removedCharacter: string;
}

/** Which character was inserted, and where, to reach a candidate. */
export interface InsertedLetterEvidence {
  insertedIndex: number;
  insertedCharacter: string;
}

export interface Candidate {
  word: string;
  process: CandidateProcess;
  shape: EditShape;
  /** See OPERATION_COST. Dominates ranking. */
  operationCost: number;
  /** 0..1 combined structural similarity used by the final scorer. */
  similarity: number;
  /** 0..1 fraction of characters in the same position. */
  positionMatches: number;
  /** 0..1 multiset letter overlap. */
  letterOverlap: number;
  /** 0..1 common-prefix fraction. */
  prefixSimilarity: number;
  /** 0..1 keyboard plausibility (1 for an exact adjacent swap). */
  proximity: number;
  /** 0..1 frequency prior; neutral for unranked ESDB entries. */
  frequency: number;
  /** Present only when Process 3 generated this candidate from the map. */
  keyboardSubstitution?: KeyboardSubstitutionEvidence;
  /** Present only for Process 4 (accidental duplicate letter). */
  duplicateLetter?: RemovedLetterEvidence;
  /** Present only for Process 5 (missing letter). */
  missingLetter?: InsertedLetterEvidence;
  /** Present only for Process 6 (one extra letter that is not a duplicate). */
  extraLetter?: RemovedLetterEvidence;
  /** Present only for Process 7 (a dropped apostrophe). */
  missingApostrophe?: InsertedLetterEvidence;
}

/**
 * Narrow lookup contract makes the no-full-scan property testable. Production
 * passes the singleton ESDB dictionary; tests may pass a counted lookup.
 */
export interface CandidateDictionary {
  words: Pick<ReadonlySet<string>, 'has'>;
  byLengthAndFirstLetter: Pick<
    ReadonlyMap<number, ReadonlyMap<string, readonly string[]>>,
    'get'
  >;
}

export interface CandidateDiagnostics {
  process1Examined: number;
  adjacentSwapsGenerated: number;
  keyboardSubstitutionsGenerated: number;
  duplicateLetterGenerated: number;
  missingLetterGenerated: number;
  extraLetterGenerated: number;
  apostropheGenerated: number;
  membershipChecks: number;
}

/** Optional personal/context history nudge used before the top-ten cutoff. */
export type CandidateRankAdjustment = (candidate: Candidate) => number;

export function createCandidateDiagnostics(): CandidateDiagnostics {
  return {
    process1Examined: 0,
    adjacentSwapsGenerated: 0,
    keyboardSubstitutionsGenerated: 0,
    duplicateLetterGenerated: 0,
    missingLetterGenerated: 0,
    extraLetterGenerated: 0,
    apostropheGenerated: 0,
    membershipChecks: 0,
  };
}

const MIN_LENGTH = 3;
const MAX_LENGTH = 24;
const PROCESS_ONE_MIN_SIMILARITY = 0.48;

/**
 * Runs all three processes, merges duplicate hits, ranks deterministically,
 * and returns at most `limit` candidates (the public limit is clamped to 10).
 */
export function generateCandidates(
  word: string,
  limit = 10,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
  rankAdjustment?: CandidateRankAdjustment,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  if (w.length < MIN_LENGTH || w.length > MAX_LENGTH || !/^[a-z]+(?:'[a-z]+)*$/.test(w)) {
    return [];
  }

  const boundedLimit = Math.max(0, Math.min(10, Math.trunc(limit)));
  if (boundedLimit === 0) return [];

  const compare = createCandidateComparator(rankAdjustment);
  const merged = new Map<string, Candidate>();
  const processOne = collectSameLengthCandidates(w, source, diagnostics)
    .sort(compare)
    .slice(0, 10);
  for (const candidate of processOne) {
    mergeCandidate(merged, candidate, compare);
  }
  for (const candidate of generateAdjacentSwapCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }
  for (const candidate of generateKeyboardCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }
  // Single-operation length changes. These run unconditionally: a weak result
  // from an earlier process must never prevent a simpler explanation.
  for (const candidate of generateDuplicateLetterCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }
  for (const candidate of generateInsertionCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }
  for (const candidate of generateDeletionCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }
  for (const candidate of generateApostropheCandidates(w, source, diagnostics)) {
    mergeCandidate(merged, candidate, compare);
  }

  return [...merged.values()].sort(compare).slice(0, boundedLimit);
}

/**
 * Process 4: remove one half of a repeated-letter run ("punctuatioon").
 * Only runs of two or more identical characters are considered, so this is at
 * most n - 1 membership checks.
 */
export function generateDuplicateLetterCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let index = 1; index < w.length; index++) {
    if (w[index] !== w[index - 1]) continue;
    if (diagnostics) diagnostics.duplicateLetterGenerated++;
    const candidate = w.slice(0, index) + w.slice(index + 1);
    if (candidate === w || seen.has(candidate)) continue;
    seen.add(candidate);
    if (diagnostics) diagnostics.membershipChecks++;
    if (!source.words.has(candidate)) continue;
    const metrics = similarityMetrics(w, candidate);
    const entry = makeCandidate(w, candidate, 4, metrics);
    entry.duplicateLetter = { removedIndex: index, removedCharacter: w[index]! };
    out.push(entry);
  }
  return out.sort(compareCandidates);
}

/**
 * Process 5: insert one letter at each of the n + 1 positions ("iprove").
 * Exact dictionary membership only - the dictionary is never scanned.
 */
export function generateInsertionCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  if (w.length + 1 > MAX_LENGTH) return [];
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let index = 0; index <= w.length; index++) {
    for (let code = 97; code <= 122; code++) {
      const letter = String.fromCharCode(code);
      if (diagnostics) diagnostics.missingLetterGenerated++;
      const candidate = w.slice(0, index) + letter + w.slice(index);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (diagnostics) diagnostics.membershipChecks++;
      if (!source.words.has(candidate)) continue;
      const metrics = similarityMetrics(w, candidate);
      const entry = makeCandidate(w, candidate, 5, metrics);
      entry.missingLetter = { insertedIndex: index, insertedCharacter: letter };
      out.push(entry);
    }
  }
  return out.sort(compareCandidates);
}

/**
 * Process 7: insert an apostrophe at each interior position ("didnt").
 *
 * At most n - 1 exact membership checks. This exists because the letter-level
 * processes handle a dropped apostrophe *badly*: "didnt" is one deletion away
 * from "dint" and one substitution away from several other words, so without
 * this process the engine confidently produced "dint". The dictionary already
 * carries 18,761 apostrophe forms, so the correct answer was always one lookup
 * away.
 */
export function generateApostropheCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  // A word that already has an apostrophe is not missing one.
  if (w.includes("'")) return [];
  const out: Candidate[] = [];

  // Interior positions only: a leading or trailing apostrophe is a quote mark,
  // not a contraction.
  for (let index = 1; index < w.length; index++) {
    if (diagnostics) diagnostics.apostropheGenerated++;
    const candidate = `${w.slice(0, index)}'${w.slice(index)}`;
    if (diagnostics) diagnostics.membershipChecks++;
    if (!source.words.has(candidate)) continue;
    /*
     * Dictionary membership is necessary but nowhere near sufficient.
     *
     * ESDB carries the possessive of essentially every noun, so "mis" matched
     * "mi's" - the possessive of the musical note - and any short fragment
     * could be rewritten into a possessive nobody wrote. The candidate must
     * additionally be a contraction English actually forms, or a possessive
     * whose stem the corpus ranks. See `data/contractions.ts`.
     */
    if (!apostropheIsSupported(w.slice(0, index), w.slice(index))) continue;
    const metrics = similarityMetrics(w, candidate);
    const entry = makeCandidate(w, candidate, 7, metrics);
    entry.missingApostrophe = { insertedIndex: index, insertedCharacter: "'" };
    out.push(entry);
  }
  return out.sort(compareCandidates);
}

/**
 * Process 6: delete one letter that is not part of a repeated run (those are
 * Process 4's job, and carry clearer evidence).
 */
export function generateDeletionCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let index = 0; index < w.length; index++) {
    /*
     * An apostrophe inside a word is structure, not a stray keystroke.
     *
     * Without this the process offered "o'neal" -> "oneal" and "can't" ->
     * "cant", turning every possessive and contraction into a correction
     * candidate. Found by reviewing false positives on UD English EWT.
     * Process 7 handles the error that actually happens - a *missing*
     * apostrophe; deleting a present one is never the fix.
     */
    if (w[index] === "'") continue;
    const isRepeat =
      (index > 0 && w[index] === w[index - 1]) ||
      (index + 1 < w.length && w[index] === w[index + 1]);
    if (isRepeat) continue;
    if (diagnostics) diagnostics.extraLetterGenerated++;
    const candidate = w.slice(0, index) + w.slice(index + 1);
    if (candidate === w || seen.has(candidate)) continue;
    seen.add(candidate);
    if (diagnostics) diagnostics.membershipChecks++;
    if (!source.words.has(candidate)) continue;
    const metrics = similarityMetrics(w, candidate);
    const entry = makeCandidate(w, candidate, 6, metrics);
    entry.extraLetter = { removedIndex: index, removedCharacter: w[index]! };
    out.push(entry);
  }
  return out.sort(compareCandidates);
}

/** Process 1: inspect only the indexed length + first-letter bucket. */
export function generateSameLengthCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
  rankAdjustment?: CandidateRankAdjustment,
): Candidate[] {
  return collectSameLengthCandidates(word, source, diagnostics)
    .sort(createCandidateComparator(rankAdjustment))
    .slice(0, 10);
}

function collectSameLengthCandidates(
  word: string,
  source: CandidateDictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  const first = w[0];
  if (!first) return [];

  const bucket = source.byLengthAndFirstLetter.get(w.length)?.get(first) ?? [];
  const out: Candidate[] = [];
  for (const candidate of bucket) {
    if (diagnostics) diagnostics.process1Examined++;
    if (candidate === w) continue;
    const metrics = similarityMetrics(w, candidate);
    if (metrics.similarity < PROCESS_ONE_MIN_SIMILARITY) continue;
    out.push(makeCandidate(w, candidate, 1, metrics));
  }

  return out;
}

/** Process 2: generate exactly one swap for each adjacent pair (n - 1). */
export function generateAdjacentSwapCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let index = 0; index + 1 < w.length; index++) {
    if (diagnostics) diagnostics.adjacentSwapsGenerated++;
    const candidate =
      w.slice(0, index) + w[index + 1] + w[index] + w.slice(index + 2);
    if (diagnostics) diagnostics.membershipChecks++;
    const known = source.words.has(candidate);
    if (candidate === w || seen.has(candidate)) continue;
    seen.add(candidate);
    if (!known) continue;
    const metrics = similarityMetrics(w, candidate);
    out.push(makeCandidate(w, candidate, 2, metrics));
  }

  return out.sort(compareCandidates);
}

/**
 * Process 3: replace one character with one physical QWERTY neighbour. Each
 * generated string differs from the input at exactly one position.
 */
export function generateKeyboardCandidates(
  word: string,
  source: CandidateDictionary = dictionary,
  diagnostics?: CandidateDiagnostics,
): Candidate[] {
  const w = normaliseDictionaryWord(word);
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (let index = 0; index < w.length; index++) {
    const typedCharacter = w[index]!;
    for (const neighbour of neighbours(typedCharacter)) {
      if (diagnostics) diagnostics.keyboardSubstitutionsGenerated++;
      const candidate = w.slice(0, index) + neighbour + w.slice(index + 1);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (diagnostics) diagnostics.membershipChecks++;
      if (!source.words.has(candidate)) continue;
      const metrics = similarityMetrics(w, candidate);
      out.push(makeCandidate(w, candidate, 3, metrics, {
        index,
        typedCharacter,
        replacementCharacter: neighbour,
        neighbourMapMatched: true,
        keyDistance: keyDistance(typedCharacter, neighbour),
      }));
    }
  }

  return out.sort(compareCandidates);
}

interface SimilarityMetrics {
  similarity: number;
  positionMatches: number;
  letterOverlap: number;
  prefixSimilarity: number;
}

function similarityMetrics(typed: string, candidate: string): SimilarityMetrics {
  const length = Math.max(typed.length, candidate.length, 1);
  let positions = 0;
  for (let index = 0; index < Math.min(typed.length, candidate.length); index++) {
    if (typed[index] === candidate[index]) positions++;
  }

  const typedCounts = characterCounts(typed);
  const candidateCounts = characterCounts(candidate);
  let overlap = 0;
  for (const [character, count] of typedCounts) {
    overlap += Math.min(count, candidateCounts.get(character) ?? 0);
  }

  let prefix = 0;
  while (
    prefix < typed.length &&
    prefix < candidate.length &&
    typed[prefix] === candidate[prefix]
  ) {
    prefix++;
  }

  const positionMatches = positions / length;
  const letterOverlap = overlap / length;
  const prefixSimilarity = prefix / length;
  return {
    positionMatches,
    letterOverlap,
    prefixSimilarity,
    similarity:
      positionMatches * 0.5 +
      letterOverlap * 0.35 +
      prefixSimilarity * 0.15,
  };
}

function characterCounts(word: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const character of word) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  return counts;
}

function makeCandidate(
  typed: string,
  word: string,
  process: CandidateProcess,
  metrics: SimilarityMetrics,
  keyboardSubstitution?: KeyboardSubstitutionEvidence,
): Candidate {
  // Exact mutation processes carry a stronger similarity prior than a broad
  // bucket match, while retaining the individual metrics for inspection.
  // A single-letter length change scores badly on positional similarity
  // ("iprove"/"improve" shares one aligned character) even though it is the
  // simplest possible explanation, so those processes get a floor too.
  const similarity =
    process === 2
      ? Math.max(metrics.similarity, 0.98)
      : process === 3
        ? Math.max(metrics.similarity, 0.94)
        : process === 4
          ? Math.max(metrics.similarity, 0.96)
          : process === 5 || process === 6
            ? Math.max(metrics.similarity, 0.95)
            // A dropped apostrophe leaves every letter in place, so the typed
            // word and the contraction are as close as two strings get.
            : process === 7
              ? Math.max(metrics.similarity, 0.99)
              : metrics.similarity;

  const candidate: Candidate = {
    word,
    process,
    shape: classifyEdit(typed, word),
    operationCost: operationCostFor(process, typed, word),
    similarity,
    positionMatches: metrics.positionMatches,
    letterOverlap: metrics.letterOverlap,
    prefixSimilarity: metrics.prefixSimilarity,
    proximity: process === 3 ? proximityScore(typed, word) : 1,
    frequency: frequencyScore(word),
  };
  if (keyboardSubstitution) candidate.keyboardSubstitution = keyboardSubstitution;
  return candidate;
}

/**
 * Cost of the edit that produced this candidate. Processes 2-6 each perform
 * exactly one operation. Process 1 inspects a whole bucket, so its cost is
 * derived from how far the candidate actually is from the typed word.
 */
function operationCostFor(
  process: CandidateProcess,
  typed: string,
  candidate: string,
): number {
  switch (process) {
    case 2:
      return OPERATION_COST.adjacentSwap;
    case 3:
      return OPERATION_COST.keyboardSubstitution;
    case 4:
      return OPERATION_COST.duplicateLetter;
    case 5:
      return OPERATION_COST.missingLetter;
    case 7:
      return OPERATION_COST.missingApostrophe;
    case 6:
      return OPERATION_COST.extraLetter;
    default:
      break;
  }
  // Process 1: same length by construction, so count differing positions.
  let differences = 0;
  for (let index = 0; index < typed.length; index++) {
    if (typed[index] !== candidate[index]) differences++;
  }
  if (differences === 1) return OPERATION_COST.arbitrarySubstitution;
  if (differences === 2 && classifyEdit(typed, candidate) === 'transposition') {
    return OPERATION_COST.adjacentSwap;
  }
  if (differences <= 2) return OPERATION_COST.bucketSimilarity;
  return OPERATION_COST.multiOperation;
}

function mergeCandidate(
  target: Map<string, Candidate>,
  candidate: Candidate,
  compare: (a: Candidate, b: Candidate) => number,
): void {
  const previous = target.get(candidate.word);
  if (!previous || compare(candidate, previous) < 0) {
    target.set(candidate.word, candidate);
  }
}

/*
 * Both comparators below delegate to the one tie-break sequence in
 * `context/candidate-order.ts`. They differ only in the score they supply:
 * the pre-cutoff ordering includes the personal rank nudge, the plain one does
 * not. Keeping the *sequence* in one place is what stops the generator's
 * ordering and the final ranking from disagreeing.
 */
function createCandidateComparator(
  rankAdjustment?: CandidateRankAdjustment,
): (a: Candidate, b: Candidate) => number {
  const scores = new WeakMap<Candidate, number>();
  const score = (candidate: Candidate): number => {
    const cached = scores.get(candidate);
    if (cached !== undefined) return cached;
    const value =
      candidateGenerationScore(candidate) + (rankAdjustment?.(candidate) ?? 0);
    scores.set(candidate, value);
    return value;
  };
  return (a, b) => compareByScore(a, b, score);
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return compareByScore(a, b, candidateGenerationScore);
}

/**
 * Non-personal score shared by pre-cutoff ranking and the final confidence
 * layer so a viable candidate cannot be pruned under different weights.
 */
/**
 * Penalty applied for the complexity of the explaining edit.
 *
 * Sized so that a single-operation candidate (cost 1) always outranks a
 * multi-substitution bucket match (cost 4) regardless of how similar the
 * latter looks - that is what makes "iprove" resolve to "improve" and never to
 * "iphone" - while keeping the result inside the 0..1 range that the
 * confidence layer needs.
 */
const COST_PENALTY: Record<number, number> = {
  0: 0,
  1: 0,
  2: 0.1,
  3: 0.18,
  4: 0.28,
};

/**
 * Banded rather than keyed by exact value: costs are not all integers (a
 * dropped apostrophe is deliberately cheaper than any letter edit), and an
 * exact-key lookup silently gave every fractional cost the *worst* penalty.
 */
function costPenalty(cost: number): number {
  if (cost <= 1) return COST_PENALTY[1]!;
  if (cost <= 2) return COST_PENALTY[2]!;
  if (cost <= 3) return COST_PENALTY[3]!;
  return COST_PENALTY[4]!;
}

export function candidateGenerationScore(candidate: Candidate): number {
  const processPrior =
    candidate.process === 2
      ? 0.11
      : candidate.process === 3
        ? 0.08
        /*
         * Deliberately the strongest prior of any process, for a reason
         * specific to it: this process only ever runs on a word the dictionary
         * does *not* know, and a non-word that becomes a word by adding one
         * apostrophe is essentially always that contraction.
         *
         * The competitor is always a short, high-frequency word - "thats" ->
         * "that", "theyre" -> "there", "shes" -> "she" - whose frequency prior
         * beat the apostrophe on cost alone. Cost banding could not separate
         * them either, because a half-cost and a unit-cost edit share a band.
         */
        : candidate.process === 7
          ? 0.3
          : candidate.process === 4 || candidate.process === 5 || candidate.process === 6
            ? 0.14
            : 0.04;
  const keyboardEvidence =
    candidate.process === 3 ? Math.max(0, candidate.proximity - 0.5) * 0.11 : 0;
  // Keep the pre-cutoff order identical to scoreSpelling's non-personal
  // terms, so the top-ten bound cannot discard a frequency-backed winner
  // before the final ranking layer sees it - and so ranking and confidence
  // can never disagree about which candidate wins.
  return (
    candidate.similarity * 0.72 +
    candidate.frequency * 0.18 +
    processPrior +
    keyboardEvidence -
    costPenalty(candidate.operationCost)
  );
}

/** Code-unit ordering is stable across hosts and does not depend on locale. */

/**
 * Finds a correction again in text that has since been edited.
 *
 * Character offsets are treated as a *hint* with a small weight. The decision
 * is dominated by surrounding text, paragraph identity and occurrence order, so
 * inserting paragraphs above the correction does not break it, and two
 * identical words in one document do not get confused with each other.
 *
 * When the evidence is weak or two positions score similarly, the result is
 * `ambiguous` - the caller must ask the user or mark the record unresolved.
 * It never returns a "best guess" that could rewrite the wrong text.
 */
import {
  commonPrefixLength,
  commonSuffixLength,
  fnv1a,
  normaliseForFingerprint,
  paragraphAt,
} from '../shared/util.js';
import type { TextAnchor } from '../shared/types.js';
import { isWholeWord } from './anchor.js';

export interface LocateCandidate {
  start: number;
  end: number;
  score: number;
  exactCase: boolean;
}

export type LocateResult =
  | ({ status: 'found' } & LocateCandidate)
  | { status: 'ambiguous'; candidates: LocateCandidate[] }
  | { status: 'missing' };

export interface LocateOptions {
  /** Which side of the correction to search for. */
  target?: 'replacement' | 'original';
  /** Minimum score for a confident match. */
  minScore?: number;
  /** How far the winner must lead the runner-up. */
  margin?: number;
  /**
   * Floor for the case where the text contains exactly one occurrence. There is
   * nothing to confuse it with, so the bar is lower - but not absent, or a
   * rewritten document could still be edited in the wrong place.
   */
  singleMinScore?: number;
  /** Cap on retained candidates. Every occurrence is scored, memory stays bounded. */
  maxOccurrences?: number;
}

const WEIGHTS = {
  before: 0.3,
  after: 0.2,
  offset: 0.15,
  occurrence: 0.1,
  paragraph: 0.15,
  exactCase: 0.1,
};

export function locate(
  text: string,
  anchor: TextAnchor,
  options: LocateOptions = {},
): LocateResult {
  const target = options.target ?? 'replacement';
  const minScore = options.minScore ?? 0.55;
  const margin = options.margin ?? 0.12;
  const maxOccurrences = Math.max(2, Math.floor(options.maxOccurrences ?? 400));

  const needle = target === 'replacement' ? anchor.replacementText : anchor.originalText;
  if (!needle) return { status: 'missing' };

  const hay = text.toLowerCase();
  const nee = needle.toLowerCase();
  const candidates: LocateCandidate[] = [];
  let occurrenceIndex = 0;
  let exactCaseOccurrences = 0;
  let cursor = hay.indexOf(nee);
  while (cursor !== -1) {
    const start = cursor;
    const end = start + needle.length;
    if (isWholeWord(text, start, end)) {
      const candidate: LocateCandidate = {
        start,
        end,
        exactCase: text.slice(start, end) === needle,
        score: scoreCandidate(text, anchor, needle, start, end, occurrenceIndex),
      };
      if (candidate.exactCase) exactCaseOccurrences++;
      retainBest(candidates, candidate, maxOccurrences);
      occurrenceIndex++;
    }
    cursor = hay.indexOf(nee, cursor + 1);
  }
  if (occurrenceIndex === 0) return { status: 'missing' };

  candidates.sort((a, b) => b.score - a.score || a.start - b.start);

  const best = candidates[0]!;
  const second = candidates[1];

  if (occurrenceIndex === 1) {
    // Unique occurrence: accept unless the context has changed beyond
    // recognition, which would suggest this is a different piece of text.
    const floor = options.singleMinScore ?? 0.4;
    return best.score >= floor
      ? { status: 'found', ...best }
      : { status: 'ambiguous', candidates };
  }

  // With privacy-minimal anchors, occurrence order alone is too fragile to
  // choose among repeated words after edits. A uniquely matching case is still
  // direct evidence; otherwise require the user to pick the occurrence.
  if (
    !anchor.textBefore
    && !anchor.textAfter
    && !anchor.paragraphFingerprint
    && !anchor.sentenceFingerprint
    && exactCaseOccurrences !== 1
  ) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 5) };
  }

  if (best.score < minScore) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 5) };
  }
  if (!second || best.score - second.score < margin) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 5) };
  }
  return { status: 'found', ...best };
}

/** Maintains a min-heap containing only the strongest candidates. */
function retainBest(heap: LocateCandidate[], candidate: LocateCandidate, limit: number): void {
  if (heap.length < limit) {
    heap.push(candidate);
    siftUp(heap, heap.length - 1);
    return;
  }
  const weakest = heap[0]!;
  if (candidate.score < weakest.score
    || (candidate.score === weakest.score && candidate.start >= weakest.start)) {
    return;
  }
  heap[0] = candidate;
  siftDown(heap, 0);
}

function weaker(a: LocateCandidate, b: LocateCandidate): boolean {
  return a.score < b.score || (a.score === b.score && a.start > b.start);
}

function siftUp(heap: LocateCandidate[], index: number): void {
  let child = index;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (!weaker(heap[child]!, heap[parent]!)) return;
    [heap[parent], heap[child]] = [heap[child]!, heap[parent]!];
    child = parent;
  }
}

function siftDown(heap: LocateCandidate[], index: number): void {
  let parent = index;
  while (true) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let weakest = parent;
    if (left < heap.length && weaker(heap[left]!, heap[weakest]!)) weakest = left;
    if (right < heap.length && weaker(heap[right]!, heap[weakest]!)) weakest = right;
    if (weakest === parent) return;
    [heap[parent], heap[weakest]] = [heap[weakest]!, heap[parent]!];
    parent = weakest;
  }
}

function scoreCandidate(
  text: string,
  anchor: TextAnchor,
  needle: string,
  start: number,
  end: number,
  occurrenceIndex: number,
): number {
  let score = 0;
  let available = 0;

  // Surrounding text - the strongest signal we have.
  if (anchor.textBefore) {
    const live = text.slice(Math.max(0, start - anchor.textBefore.length), start);
    score += WEIGHTS.before * similarity(commonSuffixLength(anchor.textBefore, live), anchor.textBefore, live);
    available += WEIGHTS.before;
  }
  if (anchor.textAfter) {
    const live = text.slice(end, Math.min(text.length, end + anchor.textAfter.length));
    score += WEIGHTS.after * similarity(commonPrefixLength(anchor.textAfter, live), anchor.textAfter, live);
    available += WEIGHTS.after;
  }

  // Offset proximity: decays over ~400 characters, so it breaks ties without
  // ever outvoting the textual evidence.
  const drift = Math.abs(start - anchor.approximateOffset);
  score += WEIGHTS.offset * Math.exp(-drift / 400);
  available += WEIGHTS.offset;

  // Which occurrence of this word it is.
  score += WEIGHTS.occurrence * (occurrenceIndex === anchor.occurrenceIndex ? 1 : 0);
  available += WEIGHTS.occurrence;

  if (anchor.paragraphFingerprint) {
    const para = paragraphAt(text, start);
    const fp = fnv1a(normaliseForFingerprint(text.slice(para.start, para.end)));
    score += WEIGHTS.paragraph * (fp === anchor.paragraphFingerprint ? 1 : 0);
    available += WEIGHTS.paragraph;
  }

  score += WEIGHTS.exactCase * (text.slice(start, end) === needle ? 1 : 0.5);
  available += WEIGHTS.exactCase;

  // Normalise so a privacy-minimal anchor (no stored context) is scored on the
  // signals it does have rather than being permanently penalised.
  return available > 0 ? score / available : 0;
}

function similarity(matched: number, stored: string, live: string): number {
  const n = Math.min(stored.length, live.length);
  if (n === 0) return 0;
  return matched / n;
}

/** All whole-word, case-insensitive occurrences of `needle`. */
export function findWholeWordOccurrences(text: string, needle: string, limit: number): number[] {
  const hay = text.toLowerCase();
  const nee = needle.toLowerCase();
  const out: number[] = [];
  if (!nee) return out;
  let i = hay.indexOf(nee);
  while (i !== -1 && out.length < limit) {
    if (isWholeWord(text, i, i + nee.length)) out.push(i);
    i = hay.indexOf(nee, i + 1);
  }
  return out;
}

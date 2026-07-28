/**
 * Bookkeeping for the background re-scan: which parts of a field have been
 * checked, how many times, and what is left to do.
 *
 * The unit of work is a sentence, and each one is identified by a fingerprint
 * of its own text. That is what makes the scan incremental: adding 200 words to
 * a checked 500-word document leaves the existing sentences byte-identical, so
 * their fingerprints - and their completed pass counts - survive, and only the
 * new sentences are queued. Editing a sentence changes its fingerprint, which
 * correctly puts it back at zero passes.
 *
 * Pure: no DOM, no chrome APIs, no timers.
 */
import { splitSentences } from '../engine/punctuation/punctuation-tokenizer.js';
import { fnv1a, normaliseForFingerprint } from '../shared/util.js';

export interface SweepChunk {
  start: number;
  end: number;
  fingerprint: string;
}

/** Sentences below this length carry nothing worth a pass of their own. */
const MIN_CHUNK_LENGTH = 2;

/** Guards a pathological field (thousands of one-word lines). */
const MAX_CHUNKS = 2_000;

/** Entries retained after they leave the text, so an undo restores their count. */
const MAX_REMEMBERED = 4_000;

export function chunksOf(text: string): SweepChunk[] {
  const chunks: SweepChunk[] = [];
  for (const span of splitSentences(text)) {
    const slice = text.slice(span.start, span.end);
    if (slice.trim().length < MIN_CHUNK_LENGTH) continue;
    chunks.push({
      start: span.start,
      end: span.end,
      fingerprint: fnv1a(normaliseForFingerprint(slice)),
    });
    if (chunks.length >= MAX_CHUNKS) break;
  }
  return chunks;
}

export interface SweepProgress {
  /** Chunks that have reached the target pass count. */
  done: number;
  total: number;
  /** True when nothing is left to scan. */
  complete: boolean;
}

export class SweepPlan {
  /** fingerprint -> passes completed. Insertion-ordered for cheap eviction. */
  private readonly passes = new Map<string, number>();

  /**
   * A range to finish before anything else, e.g. the text the user selected and
   * right-clicked. Cleared once every chunk inside it is done.
   */
  private priority: { start: number; end: number } | null = null;

  /** Puts a range at the front of the queue. */
  prioritise(range: { start: number; end: number } | null): void {
    this.priority = range && range.end > range.start ? { ...range } : null;
  }

  hasPriority(): boolean {
    return this.priority !== null;
  }

  /**
   * The next chunk needing work, or null when every chunk has reached
   * `targetPasses`. Chunks are returned in document order so the scan reads the
   * way the user wrote - except that a prioritised range is exhausted first.
   */
  next(text: string, targetPasses: number): SweepChunk | null {
    const target = Math.max(1, targetPasses);
    const chunks = chunksOf(text);

    if (this.priority) {
      const { start, end } = this.priority;
      // Any chunk overlapping the range counts: a selection rarely lands
      // exactly on sentence boundaries.
      const inRange = chunks.filter((c) => c.start < end && c.end > start);
      for (const chunk of inRange) {
        if ((this.passes.get(chunk.fingerprint) ?? 0) < target) return chunk;
      }
      // The priority range is finished; fall through to the rest of the field.
      this.priority = null;
    }

    for (const chunk of chunks) {
      if ((this.passes.get(chunk.fingerprint) ?? 0) < target) return chunk;
    }
    return null;
  }

  /**
   * Records that a chunk was examined and found clean.
   *
   * A clean pass over unchanged text is deterministic: repeating it cannot
   * produce a different answer, so the chunk is credited with every remaining
   * pass at once. This is why a 5-pass scan does not cost five times the work -
   * only chunks that actually *changed* are looked at again, and a change gives
   * them a new fingerprint and a fresh count anyway.
   *
   * Pass `converged: false` when a provider that has not answered yet (the
   * asynchronous grammar lane) might still report something; the chunk then
   * earns a single pass and will be revisited.
   */
  recordClean(fingerprint: string, targetPasses: number, converged = true): void {
    const target = Math.max(1, targetPasses);
    const current = this.passes.get(fingerprint) ?? 0;
    this.remember(fingerprint, converged ? target : Math.min(target, current + 1));
  }

  /** A chunk was changed by a correction: its old identity no longer applies. */
  forget(fingerprint: string): void {
    this.passes.delete(fingerprint);
  }

  /** Forces a full re-scan, e.g. the user pressed "Check whole text". */
  reset(): void {
    this.passes.clear();
  }

  progress(text: string, targetPasses: number): SweepProgress {
    const target = Math.max(1, targetPasses);
    const chunks = chunksOf(text);
    let done = 0;
    for (const chunk of chunks) {
      if ((this.passes.get(chunk.fingerprint) ?? 0) >= target) done++;
    }
    return { done, total: chunks.length, complete: done === chunks.length };
  }

  /** Test seam: how many passes a chunk has been credited with. */
  passesFor(fingerprint: string): number {
    return this.passes.get(fingerprint) ?? 0;
  }

  private remember(fingerprint: string, value: number): void {
    this.passes.set(fingerprint, value);
    while (this.passes.size > MAX_REMEMBERED) {
      const oldest = this.passes.keys().next().value;
      if (oldest === undefined) break;
      this.passes.delete(oldest);
    }
  }
}

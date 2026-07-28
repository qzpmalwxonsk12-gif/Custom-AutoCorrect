/**
 * Document-local vocabulary evidence.
 *
 * A word the writer has already used correctly in this document is more likely
 * to be what they meant the next time something resembles it. That helps
 * character names, product names, project jargon and domain terms — exactly the
 * vocabulary a general dictionary cannot contain.
 *
 * The dangers are specific, so the limits are too:
 *
 *   - it must not legitimise a misspelling merely because it was repeated, so
 *     only words the *dictionary already knows* accumulate evidence, and the
 *     boost is capped well below what a better edit explanation is worth;
 *   - it must not leak between documents, so evidence is per field and cleared
 *     when the field's identity changes;
 *   - it must not grow without limit, so the map is bounded and evicts the
 *     least recently seen entry;
 *   - it must not become a copy of the document, so only normalised words,
 *     counts and a timestamp are kept — never the text itself.
 */
import { isKnownWord, normaliseDictionaryWord } from '../data/dictionary.js';

export interface DocumentWordEvidence {
  normalisedWord: string;
  /** Times the word appeared as a valid dictionary word. */
  validOccurrences: number;
  /** Times it appeared capitalised mid-sentence, suggesting a name. */
  capitalisedOccurrences: number;
  lastSeenAt: number;
}

/** Words tracked per field. Beyond this the least recently seen is evicted. */
export const MAX_TRACKED_WORDS = 400;

/** Occurrences beyond which more repetition adds nothing. */
export const OCCURRENCE_CEILING = 5;

/** Shortest word worth tracking; short words carry no identifying signal. */
const MIN_TRACKED_LENGTH = 4;

export class DocumentEvidence {
  private readonly words = new Map<string, DocumentWordEvidence>();

  /**
   * Records the words of a document.
   *
   * Only dictionary words are recorded. A repeated misspelling must never
   * become self-justifying: that would turn one typo into a permanent one.
   */
  observe(text: string, now = Date.now()): void {
    const pattern = /[A-Za-z][A-Za-z']*/g;
    let match: RegExpExecArray | null;
    let seen = 0;
    while ((match = pattern.exec(text)) !== null && seen < 5_000) {
      seen++;
      const surface = match[0];
      if (surface.length < MIN_TRACKED_LENGTH) continue;
      const word = normaliseDictionaryWord(surface);
      if (!isKnownWord(word)) continue;

      const capitalised =
        match.index > 0 && surface[0] === surface[0]!.toUpperCase();
      const existing = this.words.get(word);
      if (existing) {
        existing.validOccurrences = Math.min(
          OCCURRENCE_CEILING,
          existing.validOccurrences + 1,
        );
        if (capitalised) {
          existing.capitalisedOccurrences = Math.min(
            OCCURRENCE_CEILING,
            existing.capitalisedOccurrences + 1,
          );
        }
        existing.lastSeenAt = now;
        // Re-insert so Map iteration order tracks recency.
        this.words.delete(word);
        this.words.set(word, existing);
        continue;
      }
      this.words.set(word, {
        normalisedWord: word,
        validOccurrences: 1,
        capitalisedOccurrences: capitalised ? 1 : 0,
        lastSeenAt: now,
      });
      this.evict();
    }
  }

  evidenceFor(word: string): DocumentWordEvidence | undefined {
    return this.words.get(normaliseDictionaryWord(word));
  }

  /**
   * Bounded boost in 0..1 for a candidate already used in this document.
   *
   * Reaches its ceiling quickly: the difference between "used once" and "used
   * twice" is meaningful, between "used four times" and "five" is not.
   */
  boostFor(word: string): number {
    const evidence = this.evidenceFor(word);
    if (!evidence) return 0;
    // The first occurrence is the informative one; later ones taper.
    return Math.min(1, evidence.validOccurrences / 3);
  }

  size(): number {
    return this.words.size;
  }

  clear(): void {
    this.words.clear();
  }

  /** Test seam. */
  snapshot(): DocumentWordEvidence[] {
    return [...this.words.values()];
  }

  private evict(): void {
    while (this.words.size > MAX_TRACKED_WORDS) {
      // Map preserves insertion order and `observe` re-inserts on touch, so the
      // first key is the least recently seen.
      const oldest = this.words.keys().next().value;
      if (oldest === undefined) break;
      this.words.delete(oldest);
    }
  }
}

/** Evidence source handed to the scorer; null means "no document context". */
export type DocumentEvidenceSource = Pick<DocumentEvidence, 'boostFor'> | null;

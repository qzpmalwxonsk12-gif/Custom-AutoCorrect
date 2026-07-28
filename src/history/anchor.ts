/**
 * Anchor creation. Anchors are built *after* the replacement has been written,
 * so `[start, end)` describes where the replacement now lives.
 */
import { fnv1a, normaliseForFingerprint, paragraphAt, sentenceAt } from '../shared/util.js';
import type { TextAnchor } from '../shared/types.js';

export interface AnchorInput {
  text: string;
  start: number;
  end: number;
  originalText: string;
  replacementText: string;
  /** Characters of context to keep. 0 stores no surrounding text at all. */
  contextRadius: number;
  domPath?: string;
}

/** Counts whole-word occurrences of `needle` in `text` before `limit`. */
export function occurrenceIndexOf(text: string, needle: string, limit: number): number {
  if (!needle) return 0;
  const hay = text.toLowerCase();
  const nee = needle.toLowerCase();
  let count = 0;
  let i = hay.indexOf(nee);
  while (i !== -1 && i < limit) {
    if (isWholeWord(text, i, i + nee.length)) count++;
    i = hay.indexOf(nee, i + 1);
  }
  return count;
}

export function isWholeWord(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1]! : '';
  const after = end < text.length ? text[end]! : '';
  const wordish = /[A-Za-zÀ-ɏ0-9]/;
  return !wordish.test(before) && !wordish.test(after);
}

export function createAnchor(input: AnchorInput): TextAnchor {
  const { text, start, end, contextRadius } = input;
  const radius = Math.max(0, contextRadius);

  const anchor: TextAnchor = {
    approximateOffset: start,
    textBefore: radius ? text.slice(Math.max(0, start - radius), start) : '',
    originalText: input.originalText,
    replacementText: input.replacementText,
    textAfter: radius ? text.slice(end, Math.min(text.length, end + radius)) : '',
    occurrenceIndex: occurrenceIndexOf(text, input.replacementText, start),
  };
  if (radius > 0) {
    const para = paragraphAt(text, start);
    const sent = sentenceAt(text, start);
    anchor.paragraphFingerprint = fnv1a(
      normaliseForFingerprint(text.slice(para.start, para.end)),
    );
    anchor.sentenceFingerprint = fnv1a(
      normaliseForFingerprint(text.slice(sent.start, sent.end)),
    );
    if (input.domPath) anchor.domPath = input.domPath;
  }
  return anchor;
}

/**
 * Refreshes the volatile parts of an anchor after the correction has been
 * relocated, so the next lookup starts from better information.
 */
export function refreshAnchor(
  anchor: TextAnchor,
  text: string,
  start: number,
  end: number,
  contextRadius: number,
): TextAnchor {
  const radius = Math.max(0, contextRadius);
  const refreshed: TextAnchor = {
    ...anchor,
    approximateOffset: start,
    textBefore: radius ? text.slice(Math.max(0, start - radius), start) : '',
    textAfter: radius ? text.slice(end, Math.min(text.length, end + radius)) : '',
    occurrenceIndex: occurrenceIndexOf(text, text.slice(start, end), start),
  };
  if (radius > 0) {
    const para = paragraphAt(text, start);
    const sent = sentenceAt(text, start);
    refreshed.paragraphFingerprint = fnv1a(
      normaliseForFingerprint(text.slice(para.start, para.end)),
    );
    refreshed.sentenceFingerprint = fnv1a(
      normaliseForFingerprint(text.slice(sent.start, sent.end)),
    );
  } else {
    delete refreshed.paragraphFingerprint;
    delete refreshed.sentenceFingerprint;
    delete refreshed.domPath;
  }
  return refreshed;
}

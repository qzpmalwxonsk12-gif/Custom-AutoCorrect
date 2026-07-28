/**
 * Safe, verified reversion.
 *
 * Rules enforced here:
 *   - never act on a stale offset alone (the locator decides, not the offset);
 *   - the text at the target must still be the replacement we wrote;
 *   - only the intended occurrence is touched;
 *   - the restored word wears the capitalisation currently in the document,
 *     not the capitalisation recorded at correction time.
 */
import { matchCase } from '../engine/capitalization.js';
import type { CorrectionRecord } from '../shared/types.js';
import { locate, type LocateCandidate } from './correction-locator.js';

export interface TextEdit {
  start: number;
  end: number;
  insert: string;
}

export type RevertFailure =
  | { ok: false; reason: 'missing'; message: string }
  | { ok: false; reason: 'ambiguous'; message: string; candidates: LocateCandidate[] }
  | { ok: false; reason: 'text-changed'; message: string };

export type RevertOutcome = ({ ok: true; edit: TextEdit; score: number }) | RevertFailure;

export interface RevertOptions {
  /** Raise for destructive operations; the default is already strict. */
  minScore?: number;
  margin?: number;
}

/**
 * Computes the edit that restores `record.originalText`, or explains why it
 * cannot be done safely. Applying the edit is the caller's job.
 */
export function planRevert(
  text: string,
  record: CorrectionRecord,
  options: RevertOptions = {},
): RevertOutcome {
  const { anchor } = record;

  const result = locate(text, anchor, {
    target: 'replacement',
    minScore: options.minScore ?? 0.6,
    margin: options.margin ?? 0.15,
  });

  if (result.status === 'missing') {
    return {
      ok: false,
      reason: 'missing',
      message: `"${anchor.replacementText}" is no longer in this text - it was probably edited or deleted.`,
    };
  }
  if (result.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'ambiguous',
      message:
        result.candidates.length > 1
          ? `"${anchor.replacementText}" appears in several places and the surrounding text has changed too much to tell them apart.`
          : `The text around "${anchor.replacementText}" has changed too much to be sure this is the same one.`,
      candidates: result.candidates,
    };
  }

  const observed = text.slice(result.start, result.end);
  if (observed.toLowerCase() !== anchor.replacementText.toLowerCase()) {
    return {
      ok: false,
      reason: 'text-changed',
      message: `The text at this position is "${observed}", not "${anchor.replacementText}".`,
    };
  }

  return {
    ok: true,
    score: result.score,
    edit: {
      start: result.start,
      end: result.end,
      insert: restoredOriginal(observed, record),
    },
  };
}

/**
 * The mirror image of `planRevert`: puts the replacement back after a revert
 * (used by "undo my revert" in the panel).
 */
export function planReapply(
  text: string,
  record: CorrectionRecord,
  options: RevertOptions = {},
): RevertOutcome {
  const { anchor } = record;
  const result = locate(text, anchor, {
    target: 'original',
    minScore: options.minScore ?? 0.6,
    margin: options.margin ?? 0.15,
  });

  if (result.status === 'missing') {
    return {
      ok: false,
      reason: 'missing',
      message: `"${anchor.originalText}" is no longer in this text.`,
    };
  }
  if (result.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `"${anchor.originalText}" appears in several places; pick the right one.`,
      candidates: result.candidates,
    };
  }
  const observed = text.slice(result.start, result.end);
  return {
    ok: true,
    score: result.score,
    edit: {
      start: result.start,
      end: result.end,
      insert: matchCase(observed, record.replacementText),
    },
  };
}

/**
 * The exact text to restore.
 *
 * When the document still shows precisely what we wrote, the user's original
 * is restored verbatim - including its capitalisation. That matters because a
 * correction may itself have changed the case ("teh" at a sentence start
 * becomes "The"); re-deriving the case from the replacement would then give
 * back "Teh" rather than what the user actually typed.
 *
 * Only when something else has since re-cased the word do we transfer the
 * observed capitalisation onto the original, so a word that moved to a
 * sentence start stays capitalised.
 */
function restoredOriginal(observed: string, record: CorrectionRecord): string {
  if (observed === record.replacementText) return record.originalText;
  return matchCase(observed, record.originalText);
}

/** Applies an edit to a plain string (used by tests and the plain-text path). */
export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
}

/**
 * Maps a caret position across an edit so the user's cursor does not jump.
 * Positions inside the edited range collapse to the end of the inserted text.
 */
export function shiftCaret(caret: number, edit: TextEdit): number {
  const delta = edit.insert.length - (edit.end - edit.start);
  if (caret <= edit.start) return caret;
  if (caret >= edit.end) return caret + delta;
  return edit.start + edit.insert.length;
}

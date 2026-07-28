/**
 * Word extraction plus the "never touch this token" safeguards.
 *
 * Precision beats recall everywhere in this file: when in doubt, protect.
 */
import { normaliseRuleText } from '../shared/util.js';

export interface Token {
  text: string;
  start: number;
  end: number;
}

/** Letters, accented letters and in-word apostrophes. */
const WORD_CHAR = /[A-Za-zÀ-ɏ'\u02bc\u2018\u2019\uff07]/;
const APOSTROPHE = /['\u02bc\u2018\u2019\uff07]/u;
const HYPHEN_BOUNDARY = /[-\u2010-\u2015\u2212\uff0d]/u;
const MAX_WORD_LENGTH = 24;
const MAX_CONTEXT_SKIP = 128;
const MAX_NONSPACE_RUN = 512;
const MAX_CODE_MARKERS = 1_024;

/** Characters that commit a word (typing one of these triggers a correction). */
export const COMMIT_CHARS = new Set([
  ' ',
  '\n',
  '\t',
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '"',
  '”',
  '\r',
]);

/**
 * Characters that, when they immediately precede a word, mean the word is part
 * of a URL, e-mail, path, handle or identifier. `-` is deliberately absent:
 * "well-knwon" should still be correctable.
 */
const STICKY_PREFIX = new Set(['@', '#', '/', '\\', '.', ':', '_', '$', '~', '%', '&', '=', '+', '|', '^']);

/** Same idea for the character that follows the word. */
const STICKY_SUFFIX = new Set([
  '@', '/', '\\', ':', '_', '$', '~', '%', '&', '=', '+', '|', '^', '(',
]);

export type ProtectionReason =
  | 'too-short'
  | 'too-long'
  | 'has-digit'
  | 'all-caps'
  | 'internal-caps'
  | 'sticky-prefix'
  | 'sticky-suffix'
  | 'url-like'
  | 'email-like'
  | 'path-like'
  | 'hyphen-fragment'
  | 'code-fence'
  | 'inline-code'
  | 'markdown-syntax'
  | 'structured-code'
  | 'repeated-symbol';

export interface TokenAnalysis {
  protected: boolean;
  reason?: ProtectionReason;
}

export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Returns the word ending exactly at `end` (exclusive), or null.
 * Leading/trailing apostrophes are trimmed off the token.
 */
export function wordEndingAt(text: string, end: number): Token | null {
  if (end <= 0 || end > text.length) return null;
  let start = end;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
    // Nothing longer than this can pass analyzeToken. Refuse it before a
    // pathological unbroken run can make committed-word lookup unbounded.
    if (end - start > MAX_WORD_LENGTH + 2) return null;
  }
  if (start === end) return null;
  let s = start;
  let e = end;
  while (s < e && isApostrophe(text[s]!)) s++;
  while (e > s && isApostrophe(text[e - 1]!)) e--;
  if (s >= e) return null;
  return { text: text.slice(s, e), start: s, end: e };
}

/** Word containing or immediately preceding `caret`. */
export function wordAround(text: string, caret: number): Token | null {
  let end = caret;
  while (end < text.length && isWordChar(text[end])) {
    end++;
    if (end - caret > MAX_WORD_LENGTH + 2) return null;
  }
  return wordEndingAt(text, end);
}

function isApostrophe(ch: string): boolean {
  return APOSTROPHE.test(ch);
}

export function tokenizeWords(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && isWordChar(text[i])) i++;
    const tok = wordEndingAt(text, i);
    if (tok && tok.start >= start) out.push(tok);
  }
  return out;
}

/** True when the line containing `index` sits inside a fenced code block. */
function inCodeFence(text: string, index: number): boolean {
  let fences = index > 0 && text.startsWith('```') ? 1 : 0;
  let searchFrom = 0;
  while (searchFrom < index) {
    const newline = text.indexOf('\n```', searchFrom);
    if (newline < 0 || newline + 1 >= index) break;
    fences++;
    // An adversarial field made entirely of fence markers is code-like; after
    // a bounded amount of evidence, conservatively protect it.
    if (fences >= MAX_CODE_MARKERS) return true;
    searchFrom = newline + 4;
  }
  return fences % 2 === 1;
}

/** True when `index` sits inside an odd number of backticks on its own line. */
function inInlineCode(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let ticks = 0;
  let searchFrom = lineStart;
  while (searchFrom < index) {
    const tick = text.indexOf('`', searchFrom);
    if (tick < 0 || tick >= index) break;
    ticks++;
    if (ticks >= MAX_CODE_MARKERS) return true;
    searchFrom = tick + 1;
  }
  return ticks % 2 === 1;
}

/**
 * Decides whether the token at [start,end) may be modified at all.
 * `text` is the full field text so neighbouring characters can be inspected.
 */
export function analyzeToken(
  text: string,
  start: number,
  end: number,
  options: {
    /**
     * Shortest token worth analysing. Two for spelling, where a one-letter
     * "word" is never a misspelling worth guessing at - but the capitalisation
     * rule needs one, because the pronoun "I" is exactly that case.
     */
    minLength?: number;
  } = {},
): TokenAnalysis {
  const minLength = options.minLength ?? 2;
  const word = text.slice(start, end);
  const prev = start > 0 ? text[start - 1]! : '';
  const next = end < text.length ? text[end]! : '';
  // Inspect the whole non-space run, not only `word`. Word extraction excludes
  // digits, so checking only the slice would let `waht2` become `what2`.
  const runStart = findRunStart(text, start);
  const runEnd = findRunEnd(text, end);
  if (runStart === null || runEnd === null) {
    return { protected: true, reason: 'too-long' };
  }
  const run = text.slice(runStart, runEnd);

  if (word.length < minLength) return { protected: true, reason: 'too-short' };
  if (word.length > 24) return { protected: true, reason: 'too-long' };
  if (/\d/.test(run)) return { protected: true, reason: 'has-digit' };

  /*
   * A short piece joined to a hyphen is usually a prefix/suffix, not an
   * independent word ("mis-matches", "co-operate"). Guessing from three
   * letters or fewer is especially dangerous because deletion can turn the
   * fragment into a very frequent unrelated word. Longer prose typos such as
   * "well-knwon" remain eligible.
   */
  if (word.length <= 3 && (HYPHEN_BOUNDARY.test(prev) || HYPHEN_BOUNDARY.test(next))) {
    return { protected: true, reason: 'hyphen-fragment' };
  }
  // A segment surrounded by dashes is an identifier/flag component, while a
  // single dash on one side may still be ordinary prose with a correctable
  // typo ("well-knwon"). This keeps that useful case without rewriting
  // kebab-case names.
  if (
    (HYPHEN_BOUNDARY.test(prev) && HYPHEN_BOUNDARY.test(next))
    || (HYPHEN_BOUNDARY.test(prev) && HYPHEN_BOUNDARY.test(text[start - 2] ?? ''))
  ) {
    return { protected: true, reason: 'structured-code' };
  }

  // ALL CAPS -> abbreviation/ticker. Single leading capital is normal prose.
  if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
    return { protected: true, reason: 'all-caps' };
  }
  // camelCase / PascalCase mid-word capitals -> identifier.
  if (/[a-z][A-Z]/.test(word)) return { protected: true, reason: 'internal-caps' };

  // Look at the whole run of non-space characters the word belongs to: that is
  // what distinguishes a URL from a path from an address.
  const startsDottedRun =
    next === '.' && /[\p{L}\p{N}]/u.test(text[end + 1] ?? '');
  if (run.includes('://') || /^www\./i.test(run) || startsDottedRun) {
    return { protected: true, reason: 'url-like' };
  }
  if (run.includes('@') && run.length > word.length) {
    return { protected: true, reason: 'email-like' };
  }
  if (/[\\/]/.test(run) && run.length > word.length) {
    return { protected: true, reason: 'path-like' };
  }

  if (inCodeFence(text, start)) return { protected: true, reason: 'code-fence' };
  if (inInlineCode(text, start)) return { protected: true, reason: 'inline-code' };
  if (inStructuredCode(text, start, end)) {
    return { protected: true, reason: 'structured-code' };
  }

  // Markdown/HTML syntax immediately hugging the word, e.g. **word** or <word>.
  if (/[*~`<>[\]]/.test(prev) || /[*~`>]/.test(next)) {
    return { protected: true, reason: 'markdown-syntax' };
  }

  if (STICKY_PREFIX.has(prev)) {
    if (prev === '.') return { protected: true, reason: 'url-like' };
    return { protected: true, reason: 'sticky-prefix' };
  }
  if (STICKY_SUFFIX.has(next)) {
    return { protected: true, reason: 'sticky-suffix' };
  }
  if (/(.)\1{2,}/.test(word) && !/^[a-z]+$/i.test(word)) {
    return { protected: true, reason: 'repeated-symbol' };
  }
  return { protected: false };
}

/**
 * Conservative recognition for structured snippets whose interesting token is
 * separated from the punctuation that identifies the language. Immediate
 * sticky-character checks cannot see `{"key": "word"}`, CSS declarations or
 * `SELECT word FROM ...`.
 */
function inStructuredCode(text: string, start: number, end: number): boolean {
  const scanStart = Math.max(0, start - MAX_NONSPACE_RUN);
  const scanEnd = Math.min(text.length, end + MAX_NONSPACE_RUN);
  const before = text.slice(scanStart, start);
  const after = text.slice(end, scanEnd);

  // JSON/CSS/object-literal content inside a nearby balanced brace pair.
  if (
    before.lastIndexOf('{') > before.lastIndexOf('}')
    && after.indexOf('}') >= 0
  ) {
    return true;
  }

  const lineStart = Math.max(text.lastIndexOf('\n', start - 1) + 1, scanStart);
  const newline = text.indexOf('\n', end);
  const lineEnd = Math.min(newline < 0 ? text.length : newline, scanEnd);
  const line = text.slice(lineStart, lineEnd);
  return (
    /\bSELECT\b.*\bFROM\b/.test(line)
    || /\bINSERT\s+INTO\b/.test(line)
    || /\bUPDATE\b.*\bSET\b/.test(line)
    || /\bDELETE\s+FROM\b/.test(line)
  );
}

function findRunStart(text: string, index: number): number | null {
  let i = index;
  while (i > 0 && !/\s/.test(text[i - 1]!)) {
    i--;
    if (index - i > MAX_NONSPACE_RUN) return null;
  }
  return i;
}

function findRunEnd(text: string, index: number): number | null {
  let i = index;
  while (i < text.length && !/\s/.test(text[i]!)) {
    i++;
    if (i - index > MAX_NONSPACE_RUN) return null;
  }
  return i;
}

/**
 * Words whose full stop does not end a sentence, whatever their case.
 *
 * Dotted forms are listed as written, because "e.g." reaches here as `e.g`.
 */
const ALWAYS_ABBREVIATIONS = new Set([
  'etc', 'eg', 'ie', 'vs', 'approx', 'cf', 'al', 'pp', 'ca', 'viz',
  'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k', 'a.d', 'b.c', 'ph.d', 'r.i.p',
]);

/**
 * Abbreviations that collide with ordinary words - "Sat." is Saturday, but
 * "he sat." ends a sentence; likewise "Mar."/"march", "No."/"no", "St."/"st".
 *
 * Matching these case-blind would refuse to capitalise after any sentence
 * ending in one of them, which is far more common than the abbreviation. Real
 * abbreviations are capitalised, so the capital is the discriminator.
 */
const TITLE_ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'rev', 'hon',
  'est', 'dept', 'inc', 'ltd', 'co', 'corp', 'fig', 'vol', 'no', 'ed',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
]);

/**
 * True when the token before `start` is an abbreviation that ends in a stop.
 *
 * The single implementation for the whole engine: the capitalisation lane and
 * the context builder both call this, so "Dr. Smith" cannot be a sentence
 * boundary for one of them and not the other.
 */
export function followsAbbreviation(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 40), start);
  // Allow internal stops so "e.g." arrives here as `e.g` rather than `g`.
  const match = /([\p{L}][\p{L}.]*)\.[ \t]*$/u.exec(before);
  if (!match) return false;
  const word = match[1]!;
  const lower = word.toLowerCase();
  if (ALWAYS_ABBREVIATIONS.has(lower)) return true;
  // A single capital letter is an initial: "J. R. R. Tolkien".
  const capitalised = word[0] === word[0]!.toUpperCase() && /\p{L}/u.test(word[0]!);
  if (word.length === 1) return capitalised;
  return capitalised && TITLE_ABBREVIATIONS.has(lower);
}

/** True when the word starting at `start` begins a sentence. */
export function isSentenceStart(text: string, start: number): boolean {
  const from = Math.max(0, start - MAX_CONTEXT_SKIP);
  for (let i = start - 1; i >= from; i--) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\t') continue;
    if (ch === '\n' || ch === '\r') return true;
    // A stop only ends a sentence when the word before it is not an
    // abbreviation: "Call Dr. Smith" is one sentence, not two.
    if (ch === '.') return !followsAbbreviation(text, i + 1);
    if (ch === '!' || ch === '?') return true;
    if (ch === '"' || ch === "'" || ch === '(' || ch === '“') continue;
    return false;
  }
  return from === 0;
}

/** Word immediately before `start`, lower-cased ('' when none). */
export function previousWord(text: string, start: number): string {
  let i = start;
  let skipped = 0;
  while (i > 0 && /[\s"'(“]/.test(text[i - 1]!)) {
    i--;
    if (++skipped >= MAX_CONTEXT_SKIP) return '';
  }
  const tok = wordEndingAt(text, i);
  return tok ? normaliseRuleText(tok.text) : '';
}

/** Word immediately after `end`, lower-cased ('' when none). */
export function nextWord(text: string, end: number): string {
  let i = end;
  let skipped = 0;
  while (i < text.length && !isWordChar(text[i])) {
    if (text[i] === '\n') return '';
    i++;
    if (++skipped >= MAX_CONTEXT_SKIP) return '';
  }
  let j = i;
  while (j < text.length && isWordChar(text[j])) {
    j++;
    if (j - i > MAX_WORD_LENGTH + 2) return '';
  }
  const tok = wordEndingAt(text, j);
  return tok && tok.start >= i ? normaliseRuleText(tok.text) : '';
}

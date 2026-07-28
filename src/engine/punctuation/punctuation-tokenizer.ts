/**
 * Sentence segmentation and tokenisation for the punctuation lane.
 *
 * Separate from `src/engine/tokenizer.ts`: that one answers "which word did the
 * user just finish?" for the keystroke path. This one carves text into
 * sentences and emits every token with offsets, which is what clause analysis
 * needs. The protected-token rules are deliberately consistent with the
 * spelling lane's safeguards.
 */
import type { AnalysedToken, SentenceAnalysis } from './punctuation-types.js';
import { followsAbbreviation } from '../tokenizer.js';

const WORD_CHAR = /[A-Za-zÀ-ɏ'’-]/;

/** Non-space run containing a scheme, host, path, address or code marker. */
function isProtectedRun(run: string): boolean {
  if (run.includes('://') || /^www\./i.test(run)) return true;
  if (run.includes('@') && /\w@\w/.test(run)) return true;
  if (/[\\/]\w/.test(run) && !/^\/+$/.test(run)) return true;
  if (/[_<>{}()[\]=$|`~^*]/.test(run)) return true;
  if (/\d/.test(run)) return true; // versions, decimals, ranges, times
  if (/[a-z][A-Z]/.test(run)) return true; // camelCase identifiers
  return false;
}

function runAround(text: string, index: number): string {
  let start = index;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  return text.slice(start, end);
}

/**
 * Splits text into sentences. Conservative: an ambiguous boundary keeps the
 * text together rather than inventing a sentence, because every downstream
 * rule reasons about "the start of the sentence".
 */
export function splitSentences(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue;

    if (ch === '\n') {
      if (i > start) out.push({ start, end: i });
      start = i + 1;
      continue;
    }

    // Consume trailing closers: `He said "stop." Then...`
    let end = i + 1;
    while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;

    const next = text[end];
    // A boundary needs whitespace (or end of text) after it.
    if (next !== undefined && !/\s/.test(next)) continue;

    if (ch === '.') {
      const before = text.slice(start, i);
      if (followsAbbreviation(text, i + 1)) continue;
      // Decimal or version number: "3.14", "v1.2".
      if (/\d$/.test(before) && /^\d/.test(text.slice(end).trimStart())) continue;
    }
    if (end > start) out.push({ start, end });
    start = end;
  }
  if (start < text.length && text.slice(start).trim().length > 0) {
    out.push({ start, end: text.length });
  }
  return out.map((s) => trimRange(text, s)).filter((s) => s.end > s.start);
}

function trimRange(text: string, range: { start: number; end: number }) {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
}

/** Emits word and punctuation tokens with absolute offsets into `text`. */
export function tokenizeSentence(text: string, start: number, end: number): AnalysedToken[] {
  const tokens: AnalysedToken[] = [];
  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (WORD_CHAR.test(ch)) {
      const from = i;
      while (i < end && (WORD_CHAR.test(text[i]!) || /\d/.test(text[i]!))) i++;
      let to = i;
      // Trailing apostrophes/hyphens belong to punctuation, not the word.
      while (to > from && /['’-]/.test(text[to - 1]!)) to--;
      if (to === from) {
        i = from + 1;
        continue;
      }
      const raw = text.slice(from, to);
      tokens.push(makeToken(raw, from, to, tokens.length, isProtectedRun(runAround(text, from))));
      i = to;
      continue;
    }
    // Punctuation token.
    tokens.push({
      text: ch,
      normalised: ch,
      start: i,
      end: i + 1,
      type: 'punctuation',
      index: tokens.length,
    });
    i++;
  }
  return tokens;
}

function makeToken(
  raw: string,
  start: number,
  end: number,
  index: number,
  isProtected: boolean,
): AnalysedToken {
  const token: AnalysedToken = {
    text: raw,
    normalised: raw.toLowerCase().replace(/[’]/g, "'"),
    start,
    end,
    type: 'unknown',
    index,
  };
  if (isProtected) token.isProtected = true;
  return token;
}

/** Heading, list item or otherwise non-prose line. */
function looksFragmentary(sentenceText: string, tokens: AnalysedToken[]): boolean {
  const trimmed = sentenceText.trim();
  if (trimmed.length === 0) return true;
  if (/^[-*+#>|]/.test(trimmed)) return true; // markdown list/heading/quote
  if (/^\d+[.)]\s/.test(trimmed)) return true; // numbered list
  if (/[:;]$/.test(trimmed)) return true; // stem introducing a list
  const words = tokens.filter((t) => t.type !== 'punctuation');
  // Two words is a legitimate vocative ("Thanks Arjun."); one is not prose.
  if (words.length < 2) return true;
  // ALL CAPS heading.
  const alpha = words.filter((w) => /[A-Za-z]/.test(w.text));
  if (alpha.length > 0 && alpha.every((w) => w.text === w.text.toUpperCase())) return true;
  return false;
}

export function analyseSentences(text: string): SentenceAnalysis[] {
  return splitSentences(text).map(({ start, end }) => {
    const tokens = tokenizeSentence(text, start, end);
    const sentenceText = text.slice(start, end);
    return {
      start,
      end,
      text: sentenceText,
      tokens,
      isFragmentary: looksFragmentary(sentenceText, tokens),
      hasProtectedContent: tokens.some((t) => t.isProtected),
      isQuestion: /\?\s*$/.test(sentenceText),
    };
  });
}

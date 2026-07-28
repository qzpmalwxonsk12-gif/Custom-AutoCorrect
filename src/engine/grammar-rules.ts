/**
 * A tiny set of local, deterministic grammar rules. Everything here must be
 * decidable from two adjacent words - no parsing, no model.
 */
import { matchCase } from './capitalization.js';
import { wordEndingAt } from './tokenizer.js';

/** Words starting with a consonant letter but a vowel sound. */
const H_VOWEL = ['hour', 'hours', 'honest', 'honestly', 'honor', 'honour', 'honorable', 'heir', 'heiress'];
/** Words starting with a vowel letter but a consonant sound ("yu-", "wun-"). */
const U_CONSONANT =
  /^(u(ni|se|su|su|til|tili|ropean|ranium|nion|nique|nit|niform|niversal|niversity|sual|tensil)|eu|one|once)/;

export function indefiniteArticleFor(word: string): 'a' | 'an' | null {
  const w = word.toLowerCase();
  if (!w) return null;
  if (H_VOWEL.includes(w)) return 'an';
  const first = w[0]!;
  if (first === 'h') return null; // ambiguous ("historic"): leave alone
  if ('aeiou'.includes(first)) {
    if (U_CONSONANT.test(w)) return 'a';
    if (first === 'u') return null; // other u-words are too risky to judge
    return 'an';
  }
  if (/^[bcdfgjklmnpqrstvwxyz]/.test(first)) return 'a';
  return null;
}

export interface GrammarFix {
  start: number;
  end: number;
  original: string;
  replacement: string;
  confidence: number;
  reason: string;
}

/**
 * Checks the article immediately before the word at [start,end).
 * "a apple" -> "an apple"; "an car" -> "a car".
 */
export function checkArticle(text: string, start: number, end: number): GrammarFix | null {
  const noun = text.slice(start, end);
  if (!/^[A-Za-z]/.test(noun)) return null;

  let i = start;
  while (i > 0 && /[ \t]/.test(text[i - 1]!)) i--;
  if (i === start) return null; // no whitespace gap: not "a apple"
  const prev = wordEndingAt(text, i);
  if (!prev) return null;
  const prevLower = prev.text.toLowerCase();
  if (prevLower !== 'a' && prevLower !== 'an') return null;

  const wanted = indefiniteArticleFor(noun);
  if (!wanted || wanted === prevLower) return null;

  return {
    start: prev.start,
    end: prev.end,
    original: prev.text,
    replacement: matchCase(prev.text, wanted),
    confidence: 0.93,
    reason: `"${wanted}" is used before "${noun.toLowerCase()}"`,
  };
}

/**
 * Minimal CoNLL-U reader for development-only evaluation.
 *
 * Development scope only. Nothing here is bundled into the extension, and the
 * corpus itself is never modified — the evaluator reads sentences and measures
 * the engine against them.
 *
 * The format details that matter for reconstructing real English text:
 *
 *   - `# text = ...` gives the original sentence verbatim, including spacing.
 *     Preferring it over re-joining tokens is what keeps punctuation and
 *     contractions exact.
 *   - Multiword tokens are ranged ids (`5-6`) covering the tokens that follow.
 *     Their surface form is the one that appears in the text ("don't" spans
 *     "do" + "n't"), so the parts must be skipped when rebuilding.
 *   - Empty nodes have decimal ids (`8.1`). They are not surface tokens at all.
 *   - `SpaceAfter=No` in MISC controls whether a space follows a token, which is
 *     the only way to rebuild text correctly when `# text` is absent.
 */
import { readFileSync } from 'node:fs';

export interface ConlluToken {
  id: string;
  form: string;
  lemma: string;
  /** Universal POS tag. */
  upos: string;
  xpos: string;
  feats: string;
  misc: string;
  /** True when MISC carries SpaceAfter=No. */
  spaceAfter: boolean;
}

export interface ConlluSentence {
  sentId: string;
  /** The `# text = ...` value when present, otherwise rebuilt from tokens. */
  text: string;
  /** True when `text` came from the file rather than being reconstructed. */
  textFromFile: boolean;
  /** Surface tokens only: multiword ranges kept, their parts and empty nodes dropped. */
  tokens: ConlluToken[];
}

function parseMisc(misc: string): { spaceAfter: boolean } {
  if (misc === '_' || !misc) return { spaceAfter: true };
  return { spaceAfter: !misc.split('|').includes('SpaceAfter=No') };
}

/** Rebuilds a sentence from tokens, honouring SpaceAfter. */
export function reconstruct(tokens: readonly ConlluToken[]): string {
  let out = '';
  for (const [index, token] of tokens.entries()) {
    out += token.form;
    if (token.spaceAfter && index < tokens.length - 1) out += ' ';
  }
  return out;
}

/**
 * Parses a CoNLL-U file into sentences.
 *
 * Malformed blocks are skipped rather than throwing: this is evaluation data,
 * and one bad sentence in 16,000 must not stop a measurement run.
 */
export function parseConllu(content: string): ConlluSentence[] {
  const sentences: ConlluSentence[] = [];
  let sentId = '';
  let text: string | null = null;
  let tokens: ConlluToken[] = [];
  /** Ids covered by a multiword range, whose parts must not be emitted. */
  let covered = new Set<string>();

  const flush = (): void => {
    if (tokens.length > 0) {
      const rebuilt = reconstruct(tokens);
      sentences.push({
        sentId,
        text: text ?? rebuilt,
        textFromFile: text !== null,
        tokens,
      });
    }
    sentId = '';
    text = null;
    tokens = [];
    covered = new Set();
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#')) {
      const match = /^#\s*([^=]+?)\s*=\s*(.*)$/.exec(line);
      if (match) {
        const key = match[1]!.trim();
        if (key === 'sent_id') sentId = match[2]!.trim();
        else if (key === 'text') text = match[2]!;
      }
      continue;
    }

    const fields = line.split('\t');
    // A conformant row has ten columns; anything else is malformed.
    if (fields.length < 10) continue;

    const id = fields[0]!;
    // Empty nodes (8.1) are not surface tokens.
    if (id.includes('.')) continue;

    if (id.includes('-')) {
      // Multiword token: its own form is what appears in the text, and the
      // component rows that follow must be skipped.
      const [from, to] = id.split('-').map(Number);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let i = from!; i <= to!; i++) covered.add(String(i));
      }
    } else if (covered.has(id)) {
      continue;
    }

    tokens.push({
      id,
      form: fields[1]!,
      lemma: fields[2]!,
      upos: fields[3]!,
      xpos: fields[4]!,
      feats: fields[5]!,
      misc: fields[9]!,
      spaceAfter: parseMisc(fields[9]!).spaceAfter,
    });
  }
  flush();
  return sentences;
}

export function readConllu(path: string): ConlluSentence[] {
  return parseConllu(readFileSync(path, 'utf8'));
}

/**
 * Sentences suitable as *negative* examples — text the engine should leave
 * alone.
 *
 * Web-treebank English contains genuine misspellings, markup, URLs and
 * fragments. Measuring "did the engine wrongly change correct text" requires
 * text that is actually correct, so this filters hard and accepts a smaller,
 * cleaner sample.
 */
export function isCleanSentence(sentence: ConlluSentence): boolean {
  const text = sentence.text;
  if (!sentence.textFromFile) return false;
  if (text.length < 20 || text.length > 220) return false;
  // ASCII letters, digits and ordinary punctuation only.
  if (!/^[\x20-\x7e]+$/.test(text)) return false;
  // Anything the engine deliberately protects tells us nothing about ranking.
  if (/https?:|www\.|@|\/|\\|_|<|>|\|/.test(text)) return false;
  if (/\d/.test(text)) return false;
  // Needs a reasonable number of ordinary words.
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z']+$/.test(w));
  if (words.length < 5) return false;
  // Shouty or heavily abbreviated text is not representative prose.
  if (words.filter((w) => w === w.toUpperCase() && w.length > 1).length > 1) return false;
  return true;
}

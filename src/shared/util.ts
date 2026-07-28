/** Small platform-independent helpers shared by every layer. */

/** FNV-1a 32-bit, returned as 8 hex chars. Fast, but not cryptographic or secret. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Normalises text before fingerprinting so trivial edits do not break anchors. */
export function normaliseForFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

const UNICODE_APOSTROPHES = /[\u02bc\u2018\u2019\uff07]/gu;

/** Canonical form shared by dictionary, rule, block and learning lookups. */
export function normaliseRuleText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_APOSTROPHES, "'")
    .toLowerCase()
    .normalize('NFC');
}

export function ruleId(original: string, replacement: string): string {
  return `${normaliseRuleText(original)}->${normaliseRuleText(replacement)}`;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  const wrapped = (...args: A) => {
    lastArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const a = lastArgs;
      lastArgs = undefined;
      if (a) fn(...a);
    }, ms);
  };
  wrapped.flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      const a = lastArgs;
      lastArgs = undefined;
      if (a) fn(...a);
    }
  };
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  return wrapped;
}

/**
 * Longest common suffix length of `a` and `b`, case-insensitive.
 * Used to score how well stored "text before" still matches the live text.
 */
export function commonSuffixLength(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  let i = 0;
  const max = Math.min(la.length, lb.length);
  while (i < max && la[la.length - 1 - i] === lb[lb.length - 1 - i]) i++;
  return i;
}

export function commonPrefixLength(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  let i = 0;
  const max = Math.min(la.length, lb.length);
  while (i < max && la[i] === lb[i]) i++;
  return i;
}

/** Extracts the paragraph (blank-line or newline delimited) containing `index`. */
export function paragraphAt(text: string, index: number): { start: number; end: number } {
  const i = clamp(index, 0, text.length);
  let start = text.lastIndexOf('\n', i - 1);
  start = start === -1 ? 0 : start + 1;
  let end = text.indexOf('\n', i);
  if (end === -1) end = text.length;
  return { start, end };
}

const SENTENCE_END = /[.!?][)"'\]]?\s/g;

/** Extracts the sentence containing `index` (best-effort, punctuation based). */
export function sentenceAt(text: string, index: number): { start: number; end: number } {
  const para = paragraphAt(text, index);
  const slice = text.slice(para.start, para.end);
  const local = index - para.start;
  let start = 0;
  let end = slice.length;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(slice)) !== null) {
    const boundary = m.index + m[0].length;
    if (boundary <= local) start = boundary;
    else {
      end = boundary;
      break;
    }
  }
  return { start: para.start + start, end: para.start + end };
}

/** Builds the short "…I think waht happened…" preview shown in the panel. */
export function buildPreview(
  text: string,
  start: number,
  end: number,
  radius: number,
): string {
  if (radius <= 0) return '';
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return (prefix + text.slice(from, to) + suffix).replace(/\s+/g, ' ').trim();
}

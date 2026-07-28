/** Bounded Damerau-Levenshtein plus the edit-shape classifiers used for scoring. */

/**
 * Optimal string alignment distance (adjacent transposition counts as 1).
 * Returns `max + 1` as soon as the distance provably exceeds `max`, so the
 * typing hot path never pays for long comparisons.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prevPrev = new Int32Array(bl + 1);
  let prev = new Int32Array(bl + 1);
  let curr = new Int32Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        v = Math.min(v, prevPrev[j - 2]! + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const spare = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = spare;
  }
  return prev[bl]!;
}

export type EditShape =
  | 'identical'
  | 'transposition'
  | 'deletion' // a has an extra letter
  | 'insertion' // a is missing a letter
  | 'substitution'
  | 'doubled' // "lettter" -> "letter"
  | 'other';

/** Classifies the single-edit relationship between `typed` and `candidate`. */
export function classifyEdit(typed: string, candidate: string): EditShape {
  if (typed === candidate) return 'identical';
  const t = typed.toLowerCase();
  const c = candidate.toLowerCase();
  if (t === c) return 'identical';

  if (t.length === c.length) {
    const diffs: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] !== c[i]) diffs.push(i);
    if (diffs.length === 1) return 'substitution';
    if (diffs.length === 2 && diffs[1] === diffs[0]! + 1) {
      const i = diffs[0]!;
      if (t[i] === c[i + 1] && t[i + 1] === c[i]) return 'transposition';
    }
    return 'other';
  }

  if (t.length === c.length + 1) {
    const idx = firstDiff(t, c);
    if (t.slice(0, idx) + t.slice(idx + 1) === c) {
      // Removing a duplicated letter is a distinct, very common shape.
      if (idx > 0 && t[idx] === t[idx - 1]) return 'doubled';
      return 'deletion';
    }
    return 'other';
  }

  if (c.length === t.length + 1) {
    const idx = firstDiff(t, c);
    if (c.slice(0, idx) + c.slice(idx + 1) === t) return 'insertion';
    return 'other';
  }
  return 'other';
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** True when the two words differ only by one adjacent swap ("waht"/"what"). */
export function isTransposition(a: string, b: string): boolean {
  return classifyEdit(a, b) === 'transposition';
}

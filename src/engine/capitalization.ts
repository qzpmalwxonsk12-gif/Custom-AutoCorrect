/** Capitalisation is preserved by *style*, never by copying characters. */

export type CaseStyle = 'lower' | 'title' | 'upper' | 'mixed';

export function detectCaseStyle(word: string): CaseStyle {
  if (!/[A-Za-z]/.test(word)) return 'lower';
  if (word === word.toLowerCase()) return 'lower';
  if (word === word.toUpperCase()) return 'upper';
  if (word[0] === word[0]!.toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) {
    return 'title';
  }
  return 'mixed';
}

export function applyCaseStyle(target: string, style: CaseStyle): string {
  switch (style) {
    case 'upper':
      return target.toUpperCase();
    case 'title':
      return target.charAt(0).toUpperCase() + target.slice(1).toLowerCase();
    case 'lower':
      return target.toLowerCase();
    case 'mixed':
      return target;
  }
}

/**
 * Rewrites `target` so it wears the same capitalisation as `observed`.
 * "Waht" + "what" -> "What"; "WAHT" -> "WHAT"; "waht" -> "what".
 */
export function matchCase(observed: string, target: string): string {
  const style = detectCaseStyle(observed);
  if (style === 'mixed') return target;
  return applyCaseStyle(target, style);
}

/** Forces a leading capital, used at sentence starts. */
export function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

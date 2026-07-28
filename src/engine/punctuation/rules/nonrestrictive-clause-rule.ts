/**
 * P101 - possible non-restrictive relative clause. SUGGESTION ONLY, FOREVER.
 *
 *   "My brother who lives in London is a doctor."
 *   -> possibly "My brother, who lives in London, is a doctor."
 *
 * This is not a correctness rule: the commas change the meaning.
 *
 *   without commas: the clause identifies *which* brother
 *   with commas:    the clause is extra detail about an already-known brother
 *
 * Only the writer knows which they meant, so this rule never applies
 * automatically, is off by default, and its message explains the distinction
 * rather than implying the original is wrong.
 */
import { buildInsertionIssue, insideQuotes, spanIsProtected } from '../rule-runner.js';
import type {
  AnalysedToken,
  EssentialPunctuationRule,
  PunctuationIssue,
  PunctuationRuleContext,
} from '../punctuation-types.js';

/**
 * Heads that are inherently unique, so a following relative clause is more
 * likely to be extra information than an identifier.
 */
const UNIQUE_HEADS = new Set([
  'mother', 'father', 'mom', 'mum', 'dad', 'wife', 'husband', 'sun', 'moon',
  'earth', 'president', 'ceo', 'manager', 'boss', 'birthday', 'address',
]);

const RELATIVIZERS = new Set(['who', 'which', 'whom', 'whose']);

export const nonrestrictiveClauseRule: EssentialPunctuationRule = {
  id: 'punctuation:nonrestrictive-clause',
  category: 'punctuation',
  scope: 'sentence',
  priority: 40,
  // Never 'automatic'. The runner's decideAction can only lower this.
  defaultAction: 'suggestion',
  settingKey: 'nonrestrictiveClause',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, text, settings, sentence } = context;
    if (spanIsProtected(tokens, 0, tokens.length)) return [];
    const words = tokens.filter((t) => t.type !== 'punctuation');

    for (let i = 1; i < words.length; i++) {
      const relativizer = words[i]!;
      if (!RELATIVIZERS.has(relativizer.normalised)) continue;
      // "that" is restrictive by convention and never takes a comma.
      const head = words[i - 1]!;
      if (head.type === 'punctuation') continue;
      // Already punctuated: nothing to suggest.
      if (/[,;]\s*$/.test(text.slice(0, relativizer.start))) continue;

      const headIsUnique =
        UNIQUE_HEADS.has(head.normalised) ||
        head.type === 'proper-noun' ||
        // "my only brother"
        words.slice(Math.max(0, i - 3), i).some((w) => w.normalised === 'only');
      if (!headIsUnique) continue;

      const issue = buildInsertionIssue({
        ruleId: 'punctuation:nonrestrictive-clause',
        anchorToken: head,
        insert: ',',
        // Deliberately below the automatic threshold in every configuration.
        confidence: 0.8,
        priority: 40,
        message: 'This may be a non-essential relative clause',
        explanation:
          'Adding commas means the clause provides extra information rather than identifying which person or thing you mean. ' +
          'Only add them if the sentence still identifies its subject without the clause.',
        evidence: [
          `relative pronoun "${relativizer.text}"`,
          `head noun "${head.text}" looks uniquely identified`,
          'meaning-changing: suggestion only',
        ],
        defaultAction: 'suggestion',
        settings,
        text,
      });
      if (issue && !insideQuotes(sentence, issue.start)) return [issue];
    }
    return [];
  },

  antiPatterns: [
    (context, issue) => insideQuotes(context.sentence, issue.start),
    /** Hard guarantee: this rule can never emit an automatic action. */
    (_context, issue) => issue.action === 'automatic',
  ],
};

/** Exposed for tests: the rule must never be automatic under any settings. */
export function nonrestrictiveIsAlwaysSuggestion(issues: PunctuationIssue[]): boolean {
  return issues
    .filter((i) => i.ruleId === 'punctuation:nonrestrictive-clause')
    .every((i) => i.action !== 'automatic');
}

export type { AnalysedToken };

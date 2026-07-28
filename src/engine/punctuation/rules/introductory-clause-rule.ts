/**
 * P001 - comma after a sentence-initial dependent clause.
 *
 *   "After I finished the report I went home."
 *   -> "After I finished the report, I went home."
 *
 * Fires only when BOTH clauses are complete (subject + finite verb). That is
 * the whole safety story: it is what stops
 *   "After dinner was enjoyable."      (one clause)
 *   "I left because it was late."      (dependent clause comes second)
 * from being touched.
 */
import { analyseClause, findMainClauseStart } from '../../context/clause-detector.js';
import { INTRODUCTORY_SUBORDINATORS, MULTIWORD_SUBORDINATORS } from '../punctuation-config.js';
import {
  alreadyPunctuated,
  buildInsertionIssue,
  insideQuotes,
  spanIsProtected,
} from '../rule-runner.js';
import type {
  AnalysedToken,
  EssentialPunctuationRule,
  PunctuationIssue,
  PunctuationRuleContext,
} from '../punctuation-types.js';

/** Length of the leading subordinator in tokens, or 0 when absent. */
function leadingSubordinatorLength(tokens: AnalysedToken[]): number {
  const words = tokens.filter((t) => t.type !== 'punctuation');
  if (words.length === 0) return 0;
  for (const phrase of MULTIWORD_SUBORDINATORS) {
    if (words.length <= phrase.length) continue;
    if (phrase.every((word, i) => words[i]?.normalised === word)) return phrase.length;
  }
  return INTRODUCTORY_SUBORDINATORS.has(words[0]!.normalised) ? 1 : 0;
}

export const introductoryClauseRule: EssentialPunctuationRule = {
  id: 'punctuation:introductory-clause',
  category: 'punctuation',
  scope: 'sentence',
  priority: 100,
  defaultAction: 'automatic',
  settingKey: 'introductoryClause',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, sentence, text, settings } = context;
    const markerLength = leadingSubordinatorLength(tokens);
    if (markerLength === 0) return [];

    // Token index just past the subordinator phrase.
    const words = tokens.filter((t) => t.type !== 'punctuation');
    const markerEnd = words[markerLength - 1]!.index;

    const mainStart = findMainClauseStart(tokens, markerEnd);
    if (mainStart <= 0) return [];

    const dependent = analyseClause(tokens, 0, mainStart);
    const main = analyseClause(tokens, mainStart, tokens.length);
    if (!dependent.isDependent || !main.isIndependent) return [];

    // The comma attaches to the last word before the main clause.
    const anchor = previousWordToken(tokens, mainStart);
    if (!anchor) return [];
    if (alreadyPunctuated(text, anchor.end)) return [];
    if (spanIsProtected(tokens, 0, tokens.length)) return [];

    // Confidence: both clauses complete is the core evidence; guessing in
    // either analysis pulls it below the automatic threshold.
    const evidence = [
      `introductory marker "${words.slice(0, markerLength).map((w) => w.text).join(' ')}"`,
      `dependent clause subject+verb (confidence ${dependent.confidence.toFixed(2)})`,
      `main clause subject+verb (confidence ${main.confidence.toFixed(2)})`,
    ];
    let confidence = Math.min(dependent.confidence, main.confidence);
    // Two independently complete clauses is strong structural evidence.
    if (dependent.confidence >= 0.95 && main.confidence >= 0.95) confidence = 0.98;
    // A short introductory clause is more likely to be a phrase misread.
    const introWords = words.filter((w) => w.index < mainStart).length;
    if (introWords < 3) confidence -= 0.15;
    if (sentence.isQuestion) confidence -= 0.1;

    const issue = buildInsertionIssue({
      ruleId: 'punctuation:introductory-clause',
      anchorToken: anchor,
      insert: ',',
      confidence,
      priority: 100,
      message: 'Comma after an introductory clause',
      explanation:
        'A dependent clause that opens a sentence is separated from the main clause by a comma.',
      evidence,
      defaultAction: 'automatic',
      settings,
      text,
    });
    return issue ? [issue] : [];
  },

  antiPatterns: [
    // Never inside quoted material: the quote's punctuation is the source's.
    (context, issue) => insideQuotes(context.sentence, issue.start),
    // Questions where the boundary is often the auxiliary inversion point.
    (context, issue) => context.sentence.isQuestion && issue.confidence < 0.98,
    // The clause must not be the last thing in the sentence.
    (context, issue) => issue.end >= context.sentence.end - 1,
  ],
};

function previousWordToken(tokens: AnalysedToken[], before: number): AnalysedToken | undefined {
  for (let i = before - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.type !== 'punctuation') return token;
  }
  return undefined;
}


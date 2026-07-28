/**
 * P005 - comma before a coordinating conjunction joining two independent
 * clauses.
 *
 *   "I was tired but I kept working."  -> "I was tired, but I kept working."
 *
 * Both sides must independently contain a subject and a finite verb. That
 * single requirement is what rejects every required negative case:
 *   "I was tired but determined."       (right side: adjective only)
 *   "I opened and tested the extension."(right side: shared subject)
 *   "Small but powerful."               (no clause at all)
 *   "Slowly and carefully."             (adverbs)
 *   "Either stay or leave."             (correlative)
 */
import {
  analyseClause,
  inCorrelativeConstruction,
  looksLikeSharedContinuation,
} from '../../context/clause-detector.js';
import { COORDINATORS } from '../punctuation-config.js';
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

export const independentClauseRule: EssentialPunctuationRule = {
  id: 'punctuation:independent-clause',
  category: 'punctuation',
  scope: 'sentence',
  priority: 98,
  defaultAction: 'automatic',
  settingKey: 'independentClause',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, text, settings, sentence } = context;
    if (spanIsProtected(tokens, 0, tokens.length)) return [];

    const issues: PunctuationIssue[] = [];
    for (const token of tokens) {
      if (token.type !== 'conjunction' || !token.isCoordinator) continue;
      if (!COORDINATORS.has(token.normalised)) continue;
      // A coordinator opening the sentence joins nothing.
      if (token.index === 0) continue;
      if (inCorrelativeConstruction(tokens, token.index)) continue;

      const left = analyseClause(tokens, 0, token.index);
      const right = analyseClause(tokens, token.index + 1, tokens.length);
      if (!left.isIndependent || !right.isIndependent) continue;
      if (looksLikeSharedContinuation(tokens, token.index + 1, tokens.length)) continue;

      // The right clause must have its own subject: "and it began correcting"
      // qualifies, "and tested the extension" does not.
      if (right.subjectToken === undefined) continue;
      const rightSubject = tokens[right.subjectToken]!;
      if (rightSubject.index <= token.index) continue;

      const anchor = previousWordToken(tokens, token.index);
      if (!anchor) continue;
      if (alreadyPunctuated(text, anchor.end)) continue;

      let confidence = Math.min(left.confidence, right.confidence);
      // Two unambiguous clauses with explicit subjects is the strongest case.
      if (left.confidence >= 0.95 && right.confidence >= 0.95) confidence = 0.98;
      // A pronoun subject on the right is very strong evidence of a new clause.
      if (rightSubject.type === 'pronoun') confidence = Math.max(confidence, 0.97);
      if (sentence.isQuestion) confidence -= 0.1;

      const issue = buildInsertionIssue({
        ruleId: 'punctuation:independent-clause',
        anchorToken: anchor,
        insert: ',',
        confidence,
        priority: 98,
        message: `Comma before "${token.text}" joining two clauses`,
        explanation:
          'When a coordinating conjunction joins two complete clauses, a comma goes before the conjunction.',
        evidence: [
          `coordinator "${token.text}"`,
          `left clause subject+verb (confidence ${left.confidence.toFixed(2)})`,
          `right clause subject "${rightSubject.text}" (confidence ${right.confidence.toFixed(2)})`,
        ],
        defaultAction: 'automatic',
        settings,
        text,
      });
      if (issue) issues.push(issue);
    }
    return issues;
  },

  antiPatterns: [
    (context, issue) => insideQuotes(context.sentence, issue.start),
    /** Very short sentences are usually fragments, not two clauses. */
    (context) => context.tokens.filter((t) => t.type !== 'punctuation').length < 6,
    /** More than one coordinator: the structure is too uncertain to be sure
     *  which one joins the clauses. */
    (context, issue) => {
      const coordinators = context.tokens.filter((t) => t.isCoordinator);
      return coordinators.length > 1 && issue.confidence < 0.98;
    },
  ],
};

function previousWordToken(tokens: AnalysedToken[], before: number): AnalysedToken | undefined {
  for (let i = before - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token.type !== 'punctuation') return token;
  }
  return undefined;
}


/**
 * P002 - comma after an introductory participial or descriptive phrase.
 *
 *   "After finishing the report I went home."   -> "report, I"
 *   "Having completed the test she left."       -> "test, she"
 *   "Exhausted from work he went to bed."       -> "work, he"
 *
 * The dangerous look-alike is a gerund *subject*:
 *   "Running water is useful."     ("Running water" is the subject)
 *   "Working software matters."
 * Those are rejected by requiring the main clause to have its own subject
 * *and* finite verb after the phrase, and by refusing phrases whose participle
 * is immediately followed by a noun it could be modifying.
 */
import { analyseClause } from '../../context/clause-detector.js';
import {
  INTRODUCTORY_PARTICIPLE_STARTERS,
  PARTICIPLE_PREPOSITIONS,
} from '../punctuation-config.js';
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

type PhraseKind = 'preposition-gerund' | 'having' | 'participle-adjective' | null;

/** Recognises the opening shape of an introductory phrase. */
function phraseKind(words: AnalysedToken[]): PhraseKind {
  const first = words[0];
  const second = words[1];
  if (!first || !second) return null;

  // "After finishing ...", "Before leaving ...", "Upon arriving ..."
  if (PARTICIPLE_PREPOSITIONS.has(first.normalised) && second.isGerundOrParticiple) {
    return 'preposition-gerund';
  }
  // "Having completed ...", "Being ready ..."
  if (first.normalised === 'having' || first.normalised === 'being') return 'having';
  // "Exhausted from work ...", "Determined to win ..."
  if (INTRODUCTORY_PARTICIPLE_STARTERS.has(first.normalised)) return 'participle-adjective';
  return null;
}

export const introductoryParticipleRule: EssentialPunctuationRule = {
  id: 'punctuation:introductory-participle',
  category: 'punctuation',
  scope: 'sentence',
  priority: 95,
  defaultAction: 'automatic',
  settingKey: 'introductoryClause',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, sentence, text, settings } = context;
    const words = tokens.filter((t) => t.type !== 'punctuation');
    if (words.length < 5) return [];

    const kind = phraseKind(words);
    if (kind === null) return [];

    // Find where the main clause starts: the first subject candidate that
    // heads a complete independent clause.
    let mainStart = -1;
    for (let i = 2; i < words.length; i++) {
      const token = words[i]!;
      const isSubjectHead =
        (token.type === 'pronoun' && token.isSubjectCandidate) ||
        token.type === 'proper-noun' ||
        token.type === 'determiner';
      if (!isSubjectHead) continue;
      const rest = analyseClause(tokens, token.index, tokens.length);
      // The candidate must be the subject itself, not a determiner sitting
      // inside the introductory phrase's object.
      if (rest.isIndependent && rest.subjectToken === token.index && rest.confidence >= 0.7) {
        mainStart = token.index;
        break;
      }
    }
    if (mainStart <= 0) return [];

    const anchor = previousWordToken(tokens, mainStart);
    if (!anchor) return [];
    if (alreadyPunctuated(text, anchor.end)) return [];
    if (spanIsProtected(tokens, 0, tokens.length)) return [];

    const main = analyseClause(tokens, mainStart, tokens.length);
    // A pronoun subject is the strongest signal that the phrase has ended.
    const subjectIsPronoun = tokens[mainStart]?.type === 'pronoun';

    let confidence = kind === 'having' || kind === 'preposition-gerund' ? 0.95 : 0.9;
    if (subjectIsPronoun && main.confidence >= 0.95) confidence = 0.98;
    else if (main.confidence < 0.8) confidence -= 0.15;
    if (sentence.isQuestion) confidence -= 0.1;

    const issue = buildInsertionIssue({
      ruleId: 'punctuation:introductory-participle',
      anchorToken: anchor,
      insert: ',',
      confidence,
      priority: 95,
      message: 'Comma after an introductory phrase',
      explanation:
        'An introductory participial or descriptive phrase is separated from the main clause by a comma.',
      evidence: [
        `introductory phrase type: ${kind}`,
        `main clause starts at "${tokens[mainStart]!.text}"`,
        `main clause confidence ${main.confidence.toFixed(2)}`,
      ],
      defaultAction: 'automatic',
      settings,
      text,
    });
    return issue ? [issue] : [];
  },

  antiPatterns: [
    (context, issue) => insideQuotes(context.sentence, issue.start),
    /**
     * Gerund subject: "Running water is useful." The participle is followed
     * directly by a noun and then the sentence's only finite verb, meaning the
     * opening words are a noun phrase, not an introductory phrase.
     */
    (context) => {
      const words = context.tokens.filter((t) => t.type !== 'punctuation');
      const first = words[0];
      const second = words[1];
      if (!first?.isGerundOrParticiple) return false;
      // "Running water is ..." -> second is a noun, third is a finite verb.
      if (second && (second.type === 'noun' || second.type === 'unknown')) {
        const third = words[2];
        if (third?.isFiniteVerb) return true;
      }
      return false;
    },
    /** Past-participle adjective directly modifying the subject:
     *  "Finished products were shipped." */
    (context) => {
      const words = context.tokens.filter((t) => t.type !== 'punctuation');
      const first = words[0];
      const second = words[1];
      if (!first || !second) return false;
      if (!first.isPastParticiple && !INTRODUCTORY_PARTICIPLE_STARTERS.has(first.normalised)) {
        return false;
      }
      // Adjective + noun + finite verb = a plain subject phrase.
      const isNounish = second.type === 'noun' || second.type === 'unknown';
      const third = words[2];
      return isNounish && third?.isFiniteVerb === true;
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


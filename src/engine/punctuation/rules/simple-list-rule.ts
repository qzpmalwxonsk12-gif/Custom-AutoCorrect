/**
 * P004 - commas in a simple parallel list.
 *
 *   "I bought apples oranges bananas and grapes."
 *   -> "I bought apples, oranges, bananas, and grapes."   (Oxford on)
 *   -> "I bought apples, oranges, bananas and grapes."    (Oxford off)
 *
 * Only unpunctuated runs of three or more single-token, same-class items are
 * accepted. Everything else is left alone, which is what keeps these safe:
 *   "I bought fish and chips."          (two items)
 *   "I like peanut butter and jelly."   (compound item)
 *   "I bought red and green apples."    (coordinated modifiers)
 *   "Either stay or leave."             (correlative)
 */
import { inCorrelativeConstruction } from '../../context/clause-detector.js';
import { CORRELATIVE_FIRST } from '../punctuation-config.js';
import { buildReplacementIssue, insideQuotes, spanIsProtected } from '../rule-runner.js';
import type {
  AnalysedToken,
  EssentialPunctuationRule,
  PunctuationIssue,
  PunctuationRuleContext,
  TokenType,
} from '../punctuation-types.js';

/** Classes that can form a parallel list. */
function listClass(token: AnalysedToken): TokenType | null {
  if (token.type === 'noun' || token.type === 'proper-noun') return 'noun';
  if (token.type === 'adjective') return 'adjective';
  if (token.type === 'verb') {
    // "apples oranges bananas" - a plural-shaped word inside a bare sequence
    // is a noun. This is safe because the caller never walks back past the
    // sentence's own finite verb, so a real verb cannot reach here.
    if (token.normalised.endsWith('s')) return 'noun';
    return 'verb';
  }
  // An unknown single word between known list items is usually a noun.
  if (token.type === 'unknown') return 'noun';
  return null;
}

export const simpleListRule: EssentialPunctuationRule = {
  id: 'punctuation:simple-list',
  category: 'punctuation',
  scope: 'sentence',
  priority: 85,
  defaultAction: 'automatic',
  settingKey: 'simpleList',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, text, settings, sentence } = context;
    if (spanIsProtected(tokens, 0, tokens.length)) return [];
    const words = tokens.filter((t) => t.type !== 'punctuation');

    // Locate a coordinator with at least two candidate items before it.
    const coordIndex = words.findIndex(
      (w, i) => i >= 2 && (w.normalised === 'and' || w.normalised === 'or'),
    );
    if (coordIndex < 2) return [];
    const coordinator = words[coordIndex]!;
    if (inCorrelativeConstruction(tokens, coordinator.index)) return [];
    if (CORRELATIVE_FIRST.has(words[0]!.normalised)) return [];

    const finalItem = words[coordIndex + 1];
    if (!finalItem || listClass(finalItem) === null) return [];
    // Anything after the final item (other than sentence punctuation) means
    // this is not a simple list: "red and green apples".
    if (words.length > coordIndex + 2) return [];

    // List items are complements, so they normally follow the sentence's finite
    // verb. Stopping there is what keeps "The cache stores keys and values."
    // from treating "stores" as a list item.
    const clause = context.clauses[0];
    const verbIndex = clause?.verbToken ?? -1;

    // Walk backwards collecting parallel items, ignoring the verb boundary for
    // now so the run can be inspected as a whole.
    const targetClass = listClass(finalItem);
    const run: AnalysedToken[] = [];
    for (let i = coordIndex - 1; i >= 0; i--) {
      const token = words[i]!;
      if (listClass(token) !== targetClass) break;
      run.unshift(token);
    }

    /*
     * A bare list is a fragment with no finite verb ("apples oranges bananas
     * and grapes"). The classifier reads a plural-shaped item as a possible
     * third-person verb, so the clause detector picks one of the list's own
     * items as the sentence verb - and the boundary above then swallows the
     * entire list.
     *
     * That misreading is recognisable: the run starts the sentence, it does not
     * begin with a real verb, and the "verb" sits inside the run itself. The
     * two shapes the boundary protects both fail at least one of those:
     *   "The cache stores keys and values."  run starts at "cache", not at the
     *                                        sentence, because "The" precedes it
     *   "Stores keys and values."            the run begins with a verb
     */
    const runStartsSentence = run.length > 0 && run[0] === words[0];
    const runBeginsWithVerb = run[0]?.type === 'verb';
    const verbInsideRun = verbIndex >= 0 && run.some((token) => token.index === verbIndex);
    const misreadFragment = runStartsSentence && !runBeginsWithVerb && verbInsideRun;

    // Walking backwards produces a contiguous run, so "everything after the
    // verb" is exactly the suffix the original break statement kept.
    const items = misreadFragment
      ? run
      : run.filter((token) => verbIndex < 0 || token.index > verbIndex);

    // Three or more items total (including the one after the coordinator).
    if (items.length < 2) return [];

    // Every gap between items must currently be a bare space: if the writer
    // already punctuated part of the list, leave it alone entirely.
    for (let i = 0; i < items.length - 1; i++) {
      const between = text.slice(items[i]!.end, items[i + 1]!.start);
      if (between.trim().length > 0) return [];
    }
    const beforeCoordinator = text.slice(items[items.length - 1]!.end, coordinator.start);
    if (beforeCoordinator.trim().length > 0) return [];

    const issues: PunctuationIssue[] = [];
    // Every item classified into a real class (no `unknown`) is what makes a
    // bare list unambiguous; morphological guesses about plurals are not a
    // reason to doubt it.
    const anyUnknown = [...items, finalItem].some((t) => t.type === 'unknown');
    const confidence = anyUnknown ? 0.88 : 0.97;

    // A comma after every item except the last pre-coordinator one.
    for (let i = 0; i < items.length - 1; i++) {
      const item = items[i]!;
      const issue = buildReplacementIssue({
        ruleId: 'punctuation:simple-list',
        start: item.start,
        end: item.end,
        replacement: `${text.slice(item.start, item.end)},`,
        confidence,
        priority: 85,
        message: 'Comma between list items',
        explanation: 'Items in a list of three or more are separated by commas.',
        evidence: [`list of ${items.length + 1} parallel ${targetClass} items`],
        defaultAction: 'automatic',
        settings,
        text,
      });
      if (issue) issues.push(issue);
    }

    // The serial (Oxford) comma before the coordinator, if enabled.
    if (settings.oxfordComma) {
      const last = items[items.length - 1]!;
      const issue = buildReplacementIssue({
        ruleId: 'punctuation:simple-list',
        start: last.start,
        end: last.end,
        replacement: `${text.slice(last.start, last.end)},`,
        confidence,
        priority: 85,
        message: 'Serial comma before the final list item',
        explanation:
          'With the Oxford comma enabled, a comma also precedes the conjunction before the last item.',
        evidence: ['oxford comma setting is on'],
        defaultAction: 'automatic',
        settings,
        text,
      });
      if (issue) issues.push(issue);
    }

    return issues.filter((issue) => !insideQuotes(sentence, issue.start));
  },

  antiPatterns: [
    (context, issue) => insideQuotes(context.sentence, issue.start),
    /** Never touch a list that already contains a comma. */
    (context) => context.sentence.text.includes(','),
  ],
};


/**
 * P003 - direct-address (vocative) comma.
 *
 *   "Thanks Arjun."        -> "Thanks, Arjun."
 *   "Let's eat Grandma."   -> "Let's eat, Grandma."
 *   "Mom look at this."    -> "Mom, look at this."
 *
 * The hard part is that the same surface shape can be an object:
 *   "Let's call Grandma."      (Grandma is what we call)
 *   "Help Dad finish dinner."  (Dad is what we help)
 *   "I saw John."              (John is what I saw)
 *
 * Strategy: only fire on tightly constrained patterns, and treat transitive
 * verbs plus any following complement as decisive evidence of an object.
 */
import { ADDRESS_TERMS, GREETING_TERMS, SUBJECT_PRONOUNS } from '../punctuation-config.js';
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

/**
 * Verbs that take a person as their object, so a following name is very
 * likely the object rather than the addressee. "eat" is deliberately absent:
 * "Let's eat Grandma" is the canonical vocative example.
 */
const PERSON_OBJECT_VERBS = new Set([
  'call', 'called', 'calling', 'ask', 'asked', 'asking', 'tell', 'told',
  'telling', 'help', 'helped', 'helping', 'see', 'saw', 'seen', 'seeing',
  'meet', 'met', 'meeting', 'thank', 'thanked', 'thanking', 'invite',
  'invited', 'inviting', 'visit', 'visited', 'visiting', 'text', 'texted',
  'email', 'emailed', 'phone', 'phoned', 'find', 'found', 'follow',
  'followed', 'watch', 'watched', 'love', 'loved', 'like', 'liked', 'know',
  'knew', 'trust', 'trusted', 'pay', 'paid', 'bring', 'brought', 'take',
  'took', 'pick', 'picked', 'drive', 'drove', 'give', 'gave', 'send', 'sent',
]);

function isAddressCandidate(token: AnalysedToken): boolean {
  if (token.type === 'proper-noun') return true;
  return ADDRESS_TERMS.has(token.normalised);
}

export const directAddressRule: EssentialPunctuationRule = {
  id: 'punctuation:direct-address',
  category: 'punctuation',
  scope: 'sentence',
  priority: 90,
  defaultAction: 'automatic',
  settingKey: 'directAddress',

  detect(context: PunctuationRuleContext): PunctuationIssue[] {
    const { tokens, text, settings, sentence } = context;
    const words = tokens.filter((t) => t.type !== 'punctuation');
    if (words.length < 2) return [];
    if (spanIsProtected(tokens, 0, tokens.length)) return [];

    const issues: PunctuationIssue[] = [];

    // --- Pattern A: greeting + name at the start ("Thanks Arjun.") ---
    const first = words[0]!;
    const second = words[1]!;
    if (GREETING_TERMS.has(first.normalised) && isAddressCandidate(second)) {
      // "Thank you ..." is not a vocative.
      if (second.normalised !== 'you' && !alreadyPunctuated(text, first.end)) {
        const trailing = words.length - 2;
        // "Thanks Arjun." / "Hello John" - nothing meaningful after the name.
        const confidence = trailing === 0 ? 0.98 : 0.86;
        const issue = buildInsertionIssue({
          ruleId: 'punctuation:direct-address',
          anchorToken: first,
          insert: ',',
          confidence,
          priority: 90,
          message: 'Comma before a name in direct address',
          explanation:
            'A greeting followed by the person being addressed takes a comma between them.',
          evidence: [`greeting "${first.text}"`, `address term "${second.text}"`],
          defaultAction: 'automatic',
          settings,
          text,
        });
        if (issue) issues.push(issue);
      }
    }

    // --- Pattern B: address term + imperative ("Mom look at this.") ---
    if (isAddressCandidate(first) && words.length >= 3) {
      const verb = second;
      const startsImperative =
        verb.type === 'verb' && verb.isFiniteVerb === true && verb.isPastParticiple !== true;
      // The sentence must have no other subject: "Mom looked at this" is a
      // statement about Mom, not an address.
      const looksStatement = verb.isPastParticiple === true || /ed$/.test(verb.normalised);
      if (startsImperative && !looksStatement && !alreadyPunctuated(text, first.end)) {
        const isKnownTerm = ADDRESS_TERMS.has(first.normalised);
        const issue = buildInsertionIssue({
          ruleId: 'punctuation:direct-address',
          anchorToken: first,
          insert: ',',
          // A kinship/vocative noun is much safer than an arbitrary name,
          // which could simply be the sentence's subject.
          confidence: isKnownTerm ? 0.97 : 0.84,
          priority: 90,
          message: 'Comma after a term of address',
          explanation:
            'When you address someone before telling them to do something, the name is set off by a comma.',
          evidence: [`address term "${first.text}"`, `imperative verb "${verb.text}"`],
          defaultAction: 'automatic',
          settings,
          text,
        });
        if (issue) issues.push(issue);
      }
    }

    // --- Pattern C: imperative clause + sentence-final address term ---
    const lastWord = words[words.length - 1]!;
    if (isAddressCandidate(lastWord) && words.length >= 3) {
      const previous = words[words.length - 2]!;
      const verbBefore = findGoverningVerb(words, words.length - 1);
      const isObject = verbBefore !== undefined && PERSON_OBJECT_VERBS.has(verbBefore.normalised);
      const startsWithVerb =
        words[0]!.type === 'verb' ||
        words[0]!.normalised === "let's" ||
        words[0]!.normalised === 'lets';

      if (
        !isObject &&
        startsWithVerb &&
        !alreadyPunctuated(text, previous.end) &&
        previous.type !== 'determiner' &&
        previous.type !== 'adjective' &&
        previous.type !== 'preposition'
      ) {
        const isKnownTerm = ADDRESS_TERMS.has(lastWord.normalised);
        const issue = buildInsertionIssue({
          ruleId: 'punctuation:direct-address',
          anchorToken: previous,
          insert: ',',
          confidence: isKnownTerm ? 0.97 : 0.85,
          priority: 90,
          message: 'Comma before a name in direct address',
          explanation:
            'A name addressed at the end of a command is separated by a comma. Without it the name reads as the object of the verb.',
          evidence: [
            `imperative opening "${words[0]!.text}"`,
            `sentence-final address term "${lastWord.text}"`,
          ],
          defaultAction: 'automatic',
          settings,
          text,
        });
        if (issue) issues.push(issue);
      }
    }

    return issues.filter((issue) => !insideQuotes(sentence, issue.start));
  },

  antiPatterns: [
    (context, issue) => insideQuotes(context.sentence, issue.start),
    /** The candidate is the object of a person-taking verb. */
    (context, issue) => {
      const words = context.tokens.filter((t) => t.type !== 'punctuation');
      const anchorIndex = words.findIndex((w) => w.end === issue.end);
      if (anchorIndex < 0) return false;
      const anchor = words[anchorIndex]!;
      if (PERSON_OBJECT_VERBS.has(anchor.normalised)) return true;
      // "Help Dad finish dinner." - a verb follows the name, so the name is
      // the subject of that verb, not the addressee.
      const after = words[anchorIndex + 2];
      return after?.type === 'verb' && after.isFiniteVerb !== true;
    },
    /**
     * A personal subject pronoun means this is a statement, not an address:
     * "I thanked Arjun." Vocative-capable pronouns such as "everyone" are
     * deliberately excluded from this veto.
     */
    (context) => {
      const first = context.tokens.find((t) => t.type !== 'punctuation');
      return first !== undefined && SUBJECT_PRONOUNS.has(first.normalised);
    },
  ],
};

function findGoverningVerb(words: AnalysedToken[], beforeIndex: number): AnalysedToken | undefined {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const token = words[i]!;
    if (token.type === 'verb' || token.type === 'auxiliary') return token;
  }
  return undefined;
}

/**
 * The rule catalogue: every correction rule the user can control, and the
 * resolution order that turns global/profile/site overrides into one mode.
 *
 * Platform independent - no `chrome`, `document` or `window` here.
 */

/** What a rule is allowed to do. */
export type RuleControlMode = 'automatic' | 'suggestion' | 'disabled';

export const RULE_CONTROL_MODES: readonly RuleControlMode[] = [
  'automatic',
  'suggestion',
  'disabled',
];

/**
 * Stable rule identifiers. Punctuation ids deliberately match the ids the
 * punctuation lane already emits (`punctuation:<name>`), so per-rule statistics
 * and per-rule controls describe the same thing.
 */
export type CorrectionRuleId =
  | 'spelling:duplicate-letter'
  | 'spelling:missing-letter'
  | 'spelling:extra-letter'
  | 'spelling:adjacent-swap'
  | 'spelling:keyboard-substitution'
  | 'spelling:dictionary'
  | 'spacing:merge'
  | 'spacing:split'
  | 'text:capitalisation'
  | 'text:repeated-word'
  | 'spelling:missing-apostrophe'
  | 'grammar:harper'
  | 'punctuation:introductory-clause'
  | 'punctuation:introductory-participle'
  | 'punctuation:direct-address'
  | 'punctuation:simple-list'
  | 'punctuation:independent-clause'
  | 'punctuation:nonrestrictive-clause';

export type RuleCategory = 'spelling' | 'spacing' | 'text' | 'grammar' | 'punctuation';

export interface RuleDefinition {
  id: CorrectionRuleId;
  label: string;
  /** One line, plain language: what the rule does, with an example. */
  description: string;
  category: RuleCategory;
  defaultMode: RuleControlMode;
  /**
   * True when the rule changes meaning often enough that promoting it to
   * automatic is a decision the user should make deliberately.
   */
  meaningSensitive?: boolean;
}

export const RULE_CATALOGUE: readonly RuleDefinition[] = [
  {
    id: 'spelling:duplicate-letter',
    label: 'Duplicate letters',
    description: 'Removes an accidentally repeated letter: “punctuatioon” → “punctuation”.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:missing-letter',
    label: 'Missing letters',
    description: 'Inserts one missing letter: “becuse” → “because”.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:extra-letter',
    label: 'Extra letters',
    description: 'Removes one superfluous letter: “worlkd” → “world”.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:adjacent-swap',
    label: 'Adjacent swaps',
    description: 'Un-swaps two neighbouring letters: “teh” → “the”.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:keyboard-substitution',
    label: 'Keyboard substitutions',
    description: 'Fixes a letter typed from a neighbouring key: “eorks” → “works”.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:dictionary',
    label: 'Dictionary similarity',
    description:
      'Broader same-length dictionary matching, used when no single-edit explanation fits.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'spacing:merge',
    label: 'Token merging',
    description: 'Closes an accidental space inside a word: “impro vement” → “improvement”.',
    category: 'spacing',
    defaultMode: 'automatic',
    meaningSensitive: true,
  },
  {
    id: 'spacing:split',
    label: 'Token splitting',
    description:
      'Inserts a missing space: “improvementability” → “improvement ability”.',
    category: 'spacing',
    defaultMode: 'automatic',
    meaningSensitive: true,
  },
  {
    id: 'text:capitalisation',
    label: 'Capitalisation',
    description:
      'Capitalises the pronoun “i” and the first word of a sentence: “i was here” → “I was here”.',
    category: 'text',
    defaultMode: 'automatic',
  },
  {
    id: 'text:repeated-word',
    label: 'Repeated words',
    description:
      'Removes a word typed twice in a row: “what what are you doing” → “what are you doing”. '
      + 'Ordinary doubles such as “had had” and “that that” are left alone.',
    category: 'text',
    defaultMode: 'automatic',
  },
  {
    id: 'spelling:missing-apostrophe',
    label: 'Missing apostrophes',
    description:
      'Restores the apostrophe in a contraction: “didnt” → “didn’t”, “oclock” → “o’clock”. '
      + 'Words that are also real words on their own (“cant”, “wont”, “ill”) are left alone.',
    category: 'spelling',
    defaultMode: 'automatic',
  },
  {
    id: 'grammar:harper',
    label: 'Harper grammar',
    description: 'The optional bundled grammar engine. Suggestion-only unless you change it.',
    category: 'grammar',
    defaultMode: 'suggestion',
  },
  {
    id: 'punctuation:introductory-clause',
    label: 'Introductory clause comma',
    description: 'Adds a comma after a leading dependent clause: “When it rains we stay in”.',
    category: 'punctuation',
    defaultMode: 'automatic',
  },
  {
    id: 'punctuation:introductory-participle',
    label: 'Introductory phrase comma',
    description:
      'Adds a comma after a leading descriptive phrase: “After finishing the report I went '
      + 'home” or “Exhausted from work he slept”. A bare “-ing” opener is left alone, because '
      + '“Running water is useful” is a subject, not an introduction.',
    category: 'punctuation',
    defaultMode: 'automatic',
  },
  {
    id: 'punctuation:direct-address',
    label: 'Direct address comma',
    description: 'Sets off a name being addressed: “Thanks John” → “Thanks, John”.',
    category: 'punctuation',
    defaultMode: 'automatic',
  },
  {
    id: 'punctuation:simple-list',
    label: 'List commas',
    description: 'Separates three or more items in a series.',
    category: 'punctuation',
    defaultMode: 'automatic',
  },
  {
    id: 'punctuation:independent-clause',
    label: 'Joined sentence comma',
    description: 'Adds a comma before “and”/“but” joining two complete sentences.',
    category: 'punctuation',
    defaultMode: 'automatic',
  },
  {
    id: 'punctuation:nonrestrictive-clause',
    label: 'Non-restrictive clause commas',
    description:
      'Sets off a “which…” clause. Changes meaning, so this stays a suggestion.',
    category: 'punctuation',
    defaultMode: 'disabled',
    meaningSensitive: true,
  },
];

const BY_ID = new Map<string, RuleDefinition>(RULE_CATALOGUE.map((r) => [r.id, r]));

export function ruleDefinition(id: string): RuleDefinition | undefined {
  return BY_ID.get(id);
}

export function isCorrectionRuleId(value: unknown): value is CorrectionRuleId {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Per-rule overrides, sparse: an absent entry means "use the layer below". */
export type RuleModeMap = Partial<Record<CorrectionRuleId, RuleControlMode>>;

/**
 * Resolves one rule's effective mode.
 *
 * Order, most specific first: this site → active writing profile → the user's
 * global override → the catalogue default. A site override is the user saying
 * "here, specifically", so nothing below it may contradict it.
 */
export function resolveRuleMode(
  id: CorrectionRuleId,
  layers: {
    site?: RuleModeMap | undefined;
    profile?: RuleModeMap | undefined;
    global?: RuleModeMap | undefined;
  },
): RuleControlMode {
  return (
    layers.site?.[id]
    ?? layers.profile?.[id]
    ?? layers.global?.[id]
    ?? BY_ID.get(id)?.defaultMode
    ?? 'automatic'
  );
}

/** Convenience: is this rule allowed to run at all? */
export function ruleEnabled(mode: RuleControlMode): boolean {
  return mode !== 'disabled';
}

/** Convenience: may this rule write into the text without asking? */
export function ruleMayAutoApply(mode: RuleControlMode): boolean {
  return mode === 'automatic';
}

/**
 * Maps a correction type to the rule that produced it, so a history entry can
 * offer "disable this rule" without the producer having to thread an id
 * through every layer.
 */
export function ruleIdForCorrectionType(type: string): CorrectionRuleId | undefined {
  switch (type) {
    case 'duplicate-letter':
      return 'spelling:duplicate-letter';
    case 'missing-letter':
      return 'spelling:missing-letter';
    case 'extra-letter':
      return 'spelling:extra-letter';
    case 'adjacent-swap':
      return 'spelling:adjacent-swap';
    case 'keyboard-proximity':
      return 'spelling:keyboard-substitution';
    case 'spelling':
      return 'spelling:dictionary';
    case 'token-merge':
      return 'spacing:merge';
    case 'token-split':
      return 'spacing:split';
    case 'capitalisation':
      return 'text:capitalisation';
    case 'repeated-word':
      return 'text:repeated-word';
    case 'missing-apostrophe':
      return 'spelling:missing-apostrophe';
    case 'grammar':
      return 'grammar:harper';
    default:
      return undefined;
  }
}

/**
 * Writing profiles: named bundles of thresholds and per-rule modes that suit a
 * kind of writing. A profile never *adds* capability - it can only restrict or
 * relax what the global settings already allow.
 */
import type { RuleModeMap } from './rules.js';

export type WritingProfileId =
  | 'general'
  | 'casual'
  | 'formal'
  | 'fiction'
  | 'academic'
  | 'coding'
  | 'minimal'
  | 'aggressive';

export interface WritingProfile {
  id: WritingProfileId;
  label: string;
  description: string;
  /** Sparse threshold overrides applied on top of the user's settings. */
  autocorrectThreshold?: number;
  suggestionThreshold?: number;
  /** Sparse rule-mode overrides; absent rules fall through to global settings. */
  rules: RuleModeMap;
  /** Turn the contextual (real-word) layer off entirely. */
  contextualEnabled?: boolean;
  /** Turn the essential-punctuation lane off entirely. */
  punctuationEnabled?: boolean;
  /**
   * Refuse to correct anything that looks like code: identifiers, paths,
   * commands, URLs, camelCase / PascalCase / snake_case.
   */
  protectCode?: boolean;
  /**
   * Leave dialogue, sentence fragments and stylistic punctuation alone, and be
   * reluctant to "fix" invented names.
   */
  protectProse?: boolean;
}

export const WRITING_PROFILES: readonly WritingProfile[] = [
  {
    id: 'general',
    label: 'General',
    description: 'The balanced default. Obvious typos are fixed; anything debatable is offered.',
    rules: {},
  },
  {
    id: 'casual',
    label: 'Casual chat',
    description:
      'Fixes spelling but leaves punctuation and sentence shape alone - messages are not essays.',
    punctuationEnabled: false,
    rules: {
      'punctuation:introductory-clause': 'disabled',
      'punctuation:introductory-participle': 'disabled',
      'punctuation:simple-list': 'disabled',
      'punctuation:independent-clause': 'disabled',
      'punctuation:direct-address': 'suggestion',
      'grammar:harper': 'disabled',
    },
  },
  {
    id: 'formal',
    label: 'Formal',
    description: 'Full punctuation and grammar support for letters, reports and email.',
    rules: {
      'punctuation:introductory-clause': 'automatic',
      'punctuation:introductory-participle': 'automatic',
      'punctuation:simple-list': 'automatic',
      'punctuation:independent-clause': 'automatic',
      'punctuation:direct-address': 'automatic',
      'punctuation:nonrestrictive-clause': 'suggestion',
      'grammar:harper': 'suggestion',
    },
  },
  {
    id: 'fiction',
    label: 'Fiction',
    description:
      'Conservative with dialogue, fragments, invented names and deliberate punctuation. '
      + 'Spelling help stays; style enforcement does not.',
    // Raised so a merely-plausible fix cannot rewrite a stylistic choice.
    autocorrectThreshold: 0.96,
    contextualEnabled: false,
    protectProse: true,
    rules: {
      // An invented name is exactly the shape these rules "fix" by accident.
      'spelling:dictionary': 'suggestion',
      'spelling:missing-letter': 'suggestion',
      'spacing:merge': 'suggestion',
      'spacing:split': 'suggestion',
      'text:capitalisation': 'suggestion',
      // Fragments and comma splices are legitimate craft in fiction.
      'punctuation:introductory-clause': 'suggestion',
      'punctuation:introductory-participle': 'suggestion',
      'punctuation:independent-clause': 'disabled',
      'punctuation:simple-list': 'suggestion',
      'punctuation:nonrestrictive-clause': 'disabled',
      'grammar:harper': 'disabled',
    },
  },
  {
    id: 'academic',
    label: 'Academic',
    description:
      'Careful with technical vocabulary and citations: spelling fixes are offered rather '
      + 'than imposed, punctuation is enforced.',
    autocorrectThreshold: 0.95,
    rules: {
      'spelling:dictionary': 'suggestion',
      'spacing:split': 'suggestion',
      'punctuation:introductory-clause': 'automatic',
      'punctuation:simple-list': 'automatic',
      'punctuation:independent-clause': 'automatic',
      'punctuation:nonrestrictive-clause': 'suggestion',
      'grammar:harper': 'suggestion',
    },
  },
  {
    id: 'coding',
    label: 'Coding',
    description:
      'Protects identifiers, code blocks, paths, commands, URLs, camelCase, PascalCase and '
      + 'snake_case. Only unambiguous prose typos are touched.',
    protectCode: true,
    contextualEnabled: false,
    punctuationEnabled: false,
    rules: {
      // Splitting or merging an identifier is always wrong, never a typo fix.
      'spacing:merge': 'disabled',
      'spacing:split': 'disabled',
      'spelling:dictionary': 'disabled',
      'spelling:keyboard-substitution': 'suggestion',
      'text:capitalisation': 'disabled',
      'grammar:harper': 'disabled',
      'punctuation:introductory-clause': 'disabled',
      'punctuation:introductory-participle': 'disabled',
      'punctuation:direct-address': 'disabled',
      'punctuation:simple-list': 'disabled',
      'punctuation:independent-clause': 'disabled',
      'punctuation:nonrestrictive-clause': 'disabled',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Only the most certain single-letter typo fixes. Everything else is silent.',
    // Set just above the best structural candidates (~0.92) and just below the
    // curated typo table (~0.96), so this profile keeps known misspellings and
    // drops everything inferred. A higher bar would silence the table too and
    // contradict the description above.
    autocorrectThreshold: 0.95,
    contextualEnabled: false,
    punctuationEnabled: false,
    rules: {
      'spelling:dictionary': 'disabled',
      'spacing:merge': 'disabled',
      'spacing:split': 'disabled',
      'text:capitalisation': 'disabled',
      'grammar:harper': 'disabled',
      'punctuation:introductory-clause': 'disabled',
      'punctuation:introductory-participle': 'disabled',
      'punctuation:direct-address': 'disabled',
      'punctuation:simple-list': 'disabled',
      'punctuation:independent-clause': 'disabled',
      'punctuation:nonrestrictive-clause': 'disabled',
    },
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description:
      'Applies everything it can as early as it can. Expect more corrections and more '
      + 'that you disagree with - the history panel is your safety net.',
    autocorrectThreshold: 0.8,
    suggestionThreshold: 0.5,
    rules: {
      'spelling:dictionary': 'automatic',
      'spacing:merge': 'automatic',
      'spacing:split': 'automatic',
      'text:capitalisation': 'automatic',
      'grammar:harper': 'automatic',
      'punctuation:introductory-clause': 'automatic',
      'punctuation:introductory-participle': 'automatic',
      'punctuation:direct-address': 'automatic',
      'punctuation:simple-list': 'automatic',
      'punctuation:independent-clause': 'automatic',
      'punctuation:nonrestrictive-clause': 'suggestion',
    },
  },
];

const BY_ID = new Map<string, WritingProfile>(WRITING_PROFILES.map((p) => [p.id, p]));

export function writingProfile(id: string | undefined): WritingProfile {
  return BY_ID.get(id ?? '') ?? BY_ID.get('general')!;
}

export function isWritingProfileId(value: unknown): value is WritingProfileId {
  return typeof value === 'string' && BY_ID.has(value);
}

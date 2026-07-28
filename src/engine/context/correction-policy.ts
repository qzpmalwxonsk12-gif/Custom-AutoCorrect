/**
 * Correction-risk classes and the margins each one demands.
 *
 * The scorer decides which candidate is best. This decides whether that
 * evidence is strong enough, and safe enough, to act on — two separate
 * questions that were previously answered by one global margin.
 *
 * One global margin cannot be right, because the cost of being wrong is not
 * constant. Turning "punctuatioon" into "punctuation" when the user meant
 * something else is a nuisance. Turning "woks" into "works" when they run a
 * kitchen supply shop changes what they said.
 */
import type { ProposalAction } from '../../shared/types.js';
import type { Candidate } from '../candidate-generator.js';

export type CorrectionRiskClass =
  | 'exact-personal-rule'
  | 'invalid-word-single-edit'
  | 'invalid-word-multi-edit'
  | 'valid-word-replacement'
  | 'token-merge'
  | 'token-split'
  | 'punctuation-safe'
  | 'punctuation-meaning-sensitive'
  | 'ai-only';

export interface RiskPolicy {
  /** Minimum score the winner must reach. */
  requiredScore: number;
  /** Minimum lead over the runner-up, on the unclamped scale. */
  requiredMargin: number;
  /** The strongest action this class may ever take. */
  maximumAction: ProposalAction;
  /** Whether personal acceptance may promote this class over time. */
  allowsPersonalPromotion: boolean;
  /** Whether two providers must agree before acting. */
  requiresProviderAgreement: boolean;
}

/**
 * `maximumAction` is a ceiling, never a floor. A class permitting `autocorrect`
 * still produces a suggestion when the margin is thin.
 */
export const RISK_POLICY: Record<CorrectionRiskClass, RiskPolicy> = Object.freeze({
  'exact-personal-rule': {
    requiredScore: 0.6,
    requiredMargin: 0.02,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: true,
    requiresProviderAgreement: false,
  },
  'invalid-word-single-edit': {
    requiredScore: 0.7,
    requiredMargin: 0.06,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: true,
    requiresProviderAgreement: false,
  },
  'invalid-word-multi-edit': {
    requiredScore: 0.75,
    requiredMargin: 0.12,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: true,
    requiresProviderAgreement: false,
  },
  /*
   * The word the user typed is real. The engine's long-standing rule was to
   * never touch these at all; the relaxation is that context may now *offer* an
   * alternative, never impose one, and only on overwhelming evidence.
   */
  'valid-word-replacement': {
    requiredScore: 0.8,
    requiredMargin: 0.35,
    maximumAction: 'suggest',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: false,
  },
  'token-merge': {
    requiredScore: 0.8,
    requiredMargin: 0.2,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: false,
  },
  'token-split': {
    requiredScore: 0.8,
    requiredMargin: 0.2,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: false,
  },
  'punctuation-safe': {
    requiredScore: 0.7,
    requiredMargin: 0.06,
    maximumAction: 'autocorrect',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: false,
  },
  'punctuation-meaning-sensitive': {
    requiredScore: 0.85,
    requiredMargin: 0.25,
    maximumAction: 'suggest',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: false,
  },
  /* Nothing ships that can produce this yet; the entry documents the intent. */
  'ai-only': {
    requiredScore: 0.9,
    requiredMargin: 0.4,
    maximumAction: 'suggest',
    allowsPersonalPromotion: false,
    requiresProviderAgreement: true,
  },
});

export interface ClassifyInput {
  /** True when the word the user typed is itself in the dictionary. */
  originalIsValidWord: boolean;
  candidate?: Candidate | undefined;
  /** Set for corrections that did not come from the dictionary pipeline. */
  correctionType?: string | undefined;
  ruleId?: string | undefined;
  /** Set when the proposal came from a personal or user-created rule. */
  isPersonalRule?: boolean;
}

/** Assigns a correction to its risk class. */
export function classifyRisk(input: ClassifyInput): CorrectionRiskClass {
  if (input.isPersonalRule) return 'exact-personal-rule';

  switch (input.correctionType) {
    case 'token-merge':
      return 'token-merge';
    case 'token-split':
      return 'token-split';
    case 'punctuation':
      return input.ruleId === 'punctuation:nonrestrictive-clause'
        ? 'punctuation-meaning-sensitive'
        : 'punctuation-safe';
    default:
      break;
  }

  // A real word being replaced is the highest-risk spelling case, whatever
  // process produced the alternative.
  if (input.originalIsValidWord) return 'valid-word-replacement';

  const cost = input.candidate?.operationCost ?? 1;
  return cost <= 1 ? 'invalid-word-single-edit' : 'invalid-word-multi-edit';
}

export interface PolicyInput {
  riskClass: CorrectionRiskClass;
  /** Winner's unclamped score. */
  score: number;
  /** Winner minus runner-up, unclamped. */
  margin: number;
  /** The action the scorer would otherwise take. */
  proposedAction: ProposalAction;
  /** True when a second provider proposed the same replacement. */
  providerAgreement?: boolean;
}

export interface PolicyDecision {
  action: ProposalAction;
  riskClass: CorrectionRiskClass;
  /** Why the action was lowered, when it was. */
  reason?: string;
}

/**
 * Applies the class policy to a ranked result.
 *
 * Only ever lowers an action. A class cannot promote a correction the scorer
 * was unwilling to make.
 */
export function applyPolicy(input: PolicyInput): PolicyDecision {
  const policy = RISK_POLICY[input.riskClass];
  const ceiling = policy.maximumAction;

  let action = input.proposedAction;
  let reason: string | undefined;

  if (action === 'autocorrect' && ceiling !== 'autocorrect') {
    action = ceiling;
    reason = `${input.riskClass} may not apply automatically`;
  }
  if (action !== 'none' && input.score < policy.requiredScore) {
    action = 'none';
    reason = `score ${input.score.toFixed(3)} below ${policy.requiredScore} for ${input.riskClass}`;
  }
  if (action === 'autocorrect' && input.margin < policy.requiredMargin) {
    action = 'suggest';
    reason = `margin ${input.margin.toFixed(3)} below ${policy.requiredMargin} for ${input.riskClass}`;
  }
  if (
    action === 'autocorrect'
    && policy.requiresProviderAgreement
    && input.providerAgreement !== true
  ) {
    action = 'suggest';
    reason = `${input.riskClass} requires provider agreement`;
  }

  return reason === undefined
    ? { action, riskClass: input.riskClass }
    : { action, riskClass: input.riskClass, reason };
}

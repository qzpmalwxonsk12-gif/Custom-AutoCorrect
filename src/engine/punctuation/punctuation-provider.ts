/**
 * The essential-punctuation provider: the lane's single public entry point.
 *
 * Synchronous, deterministic and dependency-free (no WASM, no network), so it
 * runs directly in the content script with no message round trip. Results are
 * cached by paragraph fingerprint because the callers re-analyse the same text
 * on every idle pass.
 */
import { fnv1a } from '../../shared/util.js';
import { analyseClause } from '../context/clause-detector.js';
import { resolveInternalOverlaps } from './overlap-resolver.js';
import { DEFAULT_PUNCTUATION_SETTINGS } from './punctuation-config.js';
import { analyseSentences } from './punctuation-tokenizer.js';
import { classifyTokens } from '../context/token-classifier.js';
import { runRules } from './rule-runner.js';
import { directAddressRule } from './rules/direct-address-rule.js';
import { independentClauseRule } from './rules/independent-clause-rule.js';
import { introductoryClauseRule } from './rules/introductory-clause-rule.js';
import { introductoryParticipleRule } from './rules/introductory-participle-rule.js';
import { nonrestrictiveClauseRule } from './rules/nonrestrictive-clause-rule.js';
import { simpleListRule } from './rules/simple-list-rule.js';
import type {
  EssentialPunctuationRule,
  PunctuationAnalysisContext,
  PunctuationIssue,
  PunctuationProvider,
  PunctuationSettings,
  SentenceAnalysis,
} from './punctuation-types.js';

/** Registry in priority order; the runner does not depend on the order. */
export const ESSENTIAL_PUNCTUATION_RULES: EssentialPunctuationRule[] = [
  independentClauseRule,
  introductoryClauseRule,
  introductoryParticipleRule,
  directAddressRule,
  simpleListRule,
  nonrestrictiveClauseRule,
];

/** Rules whose findings may ever be written without asking. */
export const AUTOMATIC_ELIGIBLE_RULES = new Set(
  ESSENTIAL_PUNCTUATION_RULES.filter((r) => r.defaultAction === 'automatic').map((r) => r.id),
);

const MAX_TEXT_LENGTH = 20_000;
const CACHE_LIMIT = 40;

export class EssentialPunctuationProvider implements PunctuationProvider {
  private readonly rules: EssentialPunctuationRule[];
  /** fingerprint+settings -> issues. Insertion-ordered for cheap eviction. */
  private readonly cache = new Map<string, PunctuationIssue[]>();

  constructor(rules: EssentialPunctuationRule[] = ESSENTIAL_PUNCTUATION_RULES) {
    this.rules = rules;
  }

  analyse(text: string, context: PunctuationAnalysisContext): PunctuationIssue[] {
    const settings = context.settings ?? DEFAULT_PUNCTUATION_SETTINGS;
    if (!settings.enabled) return [];
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return [];

    const key = `${fnv1a(text)}|${settingsKey(settings)}`;
    const cached = this.cache.get(key);
    // Decision history is applied *after* the cache, never baked into it: the
    // same text can be analysed for different users/fields, and stats change
    // between calls.
    if (cached) return withStats(cached.map(clone), context);

    const sentences = analyseSentences(text);
    for (const sentence of sentences) classifyTokens(sentence.tokens);

    const issues = runRules({
      text,
      sentences,
      clausesFor: (sentence: SentenceAnalysis) => [
        analyseClause(sentence.tokens, 0, sentence.tokens.length),
      ],
      settings,
      rules: this.rules,
    });

    const resolved = resolveInternalOverlaps(issues).sort((a, b) => a.start - b.start);

    this.cache.set(key, resolved.map(clone));
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return withStats(resolved.map(clone), context);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

function withStats(
  issues: PunctuationIssue[],
  context: PunctuationAnalysisContext,
): PunctuationIssue[] {
  if (!context.stats) return issues;
  return issues.filter((issue) => applyStatsDemotion(issue, context));
}

/**
 * Rule statistics may only ever *lower* an action, never raise one. A rule the
 * user keeps reverting stops applying automatically; promotion in the other
 * direction requires `allowRulePromotion` and is not implemented as automatic
 * escalation of a suggestion-only rule.
 */
function applyStatsDemotion(
  issue: PunctuationIssue,
  context: PunctuationAnalysisContext,
): boolean {
  const stats = context.stats?.[issue.ruleId];
  if (!stats) return true;
  const negative = stats.rejected + stats.reverted;
  if (negative >= 2 && negative > stats.accepted) {
    if (issue.action === 'automatic') issue.action = 'suggestion';
    issue.evidence = [...issue.evidence, 'demoted: previously reverted by you'];
  }
  if (negative >= 6 && stats.accepted === 0) return false; // stop offering
  return true;
}

function settingsKey(settings: PunctuationSettings): string {
  return [
    settings.automatic ? 'a' : '-',
    settings.oxfordComma ? 'o' : '-',
    settings.directAddress ? 'd' : '-',
    settings.introductoryClause ? 'i' : '-',
    settings.independentClause ? 'c' : '-',
    settings.simpleList ? 'l' : '-',
    settings.nonrestrictiveClause ? 'n' : '-',
    settings.suggestionThreshold.toFixed(2),
    settings.automaticThreshold.toFixed(2),
  ].join('');
}

function clone(issue: PunctuationIssue): PunctuationIssue {
  return { ...issue, evidence: [...issue.evidence] };
}

/** Shared instance for the content script. */
export const essentialPunctuationProvider = new EssentialPunctuationProvider();


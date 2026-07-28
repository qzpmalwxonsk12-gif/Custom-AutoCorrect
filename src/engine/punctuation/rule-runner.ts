/**
 * Rule framework: issue construction, shared anti-patterns, and the runner
 * that applies every rule to every sentence.
 *
 * Key invariant: a punctuation *insertion* is normalised into a replacement
 * over a non-empty original span (the preceding word), e.g.
 *
 *   insert "," after "report"  ->  original "report", replacement "report,"
 *
 * That is what keeps these corrections compatible with the existing anchor,
 * locator and reverter, which both require non-empty text on each side.
 */
import { fnv1a } from '../../shared/util.js';
import type {
  AnalysedToken,
  EssentialPunctuationRule,
  PunctuationAction,
  PunctuationIssue,
  PunctuationRuleContext,
  PunctuationRuleId,
  PunctuationSettings,
  SentenceAnalysis,
} from './punctuation-types.js';

export interface IssueDraft {
  ruleId: PunctuationRuleId;
  /** Token after which the comma is inserted. */
  anchorToken: AnalysedToken;
  /** Text to insert, normally ",". */
  insert: string;
  confidence: number;
  priority: number;
  message: string;
  explanation: string;
  evidence: string[];
  defaultAction: 'automatic' | 'suggestion';
  settings: PunctuationSettings;
  /** Text being analysed, for span extraction. */
  text: string;
}

/** Resolves confidence into an action using the configured thresholds. */
export function decideAction(
  confidence: number,
  defaultAction: 'automatic' | 'suggestion',
  settings: PunctuationSettings,
): PunctuationAction {
  if (confidence < settings.suggestionThreshold) return 'none';
  if (defaultAction === 'suggestion') return 'suggestion';
  if (!settings.automatic) return 'suggestion';
  return confidence >= settings.automaticThreshold ? 'automatic' : 'suggestion';
}

/**
 * Builds an insertion issue anchored on the preceding word, so the resulting
 * correction record has a locatable original and replacement.
 */
export function buildInsertionIssue(draft: IssueDraft): PunctuationIssue | null {
  const { anchorToken, insert, text } = draft;
  const start = anchorToken.start;
  const end = anchorToken.end;
  if (end <= start || end > text.length) return null;

  const originalText = text.slice(start, end);
  if (originalText.length === 0) return null;
  const replacementText = originalText + insert;
  if (originalText === replacementText) return null;

  const action = decideAction(draft.confidence, draft.defaultAction, draft.settings);
  if (action === 'none') return null;

  return {
    id: issueId(draft.ruleId, start, end, replacementText),
    ruleId: draft.ruleId,
    category: 'punctuation',
    start,
    end,
    originalText,
    replacementText,
    confidence: Math.min(0.999, Math.max(0, draft.confidence)),
    action,
    priority: draft.priority,
    message: draft.message,
    explanation: draft.explanation,
    evidence: draft.evidence,
  };
}

/** Builds an issue that replaces an explicit span (used by list punctuation). */
export function buildReplacementIssue(
  draft: Omit<IssueDraft, 'anchorToken' | 'insert'> & { start: number; end: number; replacement: string },
): PunctuationIssue | null {
  const { start, end, replacement, text } = draft;
  if (end <= start || end > text.length) return null;
  const originalText = text.slice(start, end);
  if (originalText.length === 0 || originalText === replacement) return null;

  const action = decideAction(draft.confidence, draft.defaultAction, draft.settings);
  if (action === 'none') return null;

  return {
    id: issueId(draft.ruleId, start, end, replacement),
    ruleId: draft.ruleId,
    category: 'punctuation',
    start,
    end,
    originalText,
    replacementText: replacement,
    confidence: Math.min(0.999, Math.max(0, draft.confidence)),
    action,
    priority: draft.priority,
    message: draft.message,
    explanation: draft.explanation,
    evidence: draft.evidence,
  };
}

export function issueId(
  ruleId: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return `${ruleId}@${start}-${end}#${fnv1a(replacement)}`;
}

/* ------------------------------------------------------------------ *
 * Shared anti-patterns
 * ------------------------------------------------------------------ */

/**
 * Guards that apply to every rule. A sentence failing any of these is not
 * analysed at all - cheaper than every rule re-checking, and impossible to
 * forget in a new rule.
 */
export function sentenceIsAnalysable(sentence: SentenceAnalysis): boolean {
  if (sentence.isFragmentary) return false;
  if (sentence.hasProtectedContent) return false;
  // "Thanks Arjun." is three tokens and a valid target; individual rules
  // impose their own, stricter length requirements.
  if (sentence.tokens.length < 3) return false;
  if (sentence.tokens.length > 120) return false; // pathological input
  return true;
}

/** True when the offset sits inside quotation marks within the sentence. */
export function insideQuotes(sentence: SentenceAnalysis, offset: number): boolean {
  const upto = sentence.text.slice(0, offset - sentence.start);
  const doubles = (upto.match(/["“”]/g) ?? []).length;
  if (doubles % 2 === 1) return true;
  // Only count apostrophes that look like quote marks (space-adjacent).
  const singles = (upto.match(/(^|\s)['‘]|['’](\s|$)/g) ?? []).length;
  return singles % 2 === 1;
}

/** True when a comma (or other punctuation) already sits at this boundary. */
export function alreadyPunctuated(text: string, anchorEnd: number): boolean {
  for (let i = anchorEnd; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    return /[,;:.!?—–-]/.test(ch);
  }
  return false;
}

/** True when the token span contains anything we must not touch. */
export function spanIsProtected(tokens: AnalysedToken[], from: number, to: number): boolean {
  for (let i = from; i < to && i < tokens.length; i++) {
    if (tokens[i]!.isProtected) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export interface RunnerInput {
  text: string;
  sentences: SentenceAnalysis[];
  clausesFor: (sentence: SentenceAnalysis) => PunctuationRuleContext['clauses'];
  settings: PunctuationSettings;
  rules: EssentialPunctuationRule[];
}

/** Applies every enabled rule to every analysable sentence. */
export function runRules(input: RunnerInput): PunctuationIssue[] {
  const issues: PunctuationIssue[] = [];
  for (const sentence of input.sentences) {
    if (!sentenceIsAnalysable(sentence)) continue;
    const context: PunctuationRuleContext = {
      text: input.text,
      sentence,
      clauses: input.clausesFor(sentence),
      settings: input.settings,
      tokens: sentence.tokens,
    };

    for (const rule of input.rules) {
      if (rule.settingKey && input.settings[rule.settingKey] === false) continue;
      let produced: PunctuationIssue[];
      try {
        produced = rule.detect(context);
      } catch (e) {
        // A broken rule must never break the lane.
        console.warn(`[autocorrect] punctuation rule ${rule.id} failed:`, e);
        continue;
      }
      for (const issue of produced) {
        const vetoed = rule.antiPatterns?.some((veto) => {
          try {
            return veto(context, issue);
          } catch {
            return true; // a failing guard vetoes, it never permits
          }
        });
        if (!vetoed) issues.push(issue);
      }
    }
  }
  return issues;
}

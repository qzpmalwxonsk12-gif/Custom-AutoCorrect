/**
 * Diagnostic harness (not an assertion suite): prints token classification and
 * clause analysis for cases under investigation. Kept in the repo because the
 * rules are hand-tuned and this is how you see why one did or did not fire.
 */
import { describe, it } from 'vitest';
import { analyseSentences } from '../../src/engine/punctuation/punctuation-tokenizer.js';
import { classifyTokens } from '../../src/engine/context/token-classifier.js';
import { analyseClause } from '../../src/engine/context/clause-detector.js';
import { EssentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { DEFAULT_PUNCTUATION_SETTINGS } from '../../src/engine/punctuation/punctuation-config.js';

const provider = new EssentialPunctuationProvider();

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const CASES = env?.PUNCT_DEBUG?.split('|') ?? [];

describe('punctuation debug', () => {
  it('dumps analysis for PUNCT_DEBUG cases', () => {
    if (CASES.length === 0) return;
    for (const text of CASES) {
      const sentences = analyseSentences(text);
      console.info(`\n=== ${JSON.stringify(text)}`);
      for (const sentence of sentences) {
        classifyTokens(sentence.tokens);
        console.info(
          `  fragmentary=${sentence.isFragmentary} protected=${sentence.hasProtectedContent}`,
        );
        for (const t of sentence.tokens) {
          console.info(
            `   [${t.index}] ${JSON.stringify(t.text).padEnd(14)} ${t.type.padEnd(12)}` +
              ` fin=${t.isFiniteVerb ?? '-'} subj=${t.isSubjectCandidate ?? '-'}` +
              ` ger=${t.isGerundOrParticiple ?? '-'} pp=${t.isPastParticiple ?? '-'}` +
              ` addr=${t.isAddressTerm ?? '-'} guess=${t.isGuess ?? '-'}`,
          );
        }
        const whole = analyseClause(sentence.tokens, 0, sentence.tokens.length);
        console.info(`  clause: ${JSON.stringify(whole)}`);
      }
      const issues = provider.analyse(text, { settings: DEFAULT_PUNCTUATION_SETTINGS });
      console.info(
        `  issues: ${JSON.stringify(
          (issues as Array<{ ruleId: string; action: string; confidence: number; replacementText: string }>).map(
            (i) => `${i.ruleId} ${i.action} ${i.confidence.toFixed(2)} -> ${i.replacementText}`,
          ),
        )}`,
      );
    }
  });
});


/**
 * Deterministic adversarial coverage for token shapes that must never be
 * rewritten automatically.
 *
 * The target words are deliberately chosen from high-confidence shipped typos:
 * if a boundary guard fails, the test reaches a real autocorrection rather than
 * passing because the candidate happened to be weak.
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/engine/correction-engine.js';
import { analyzeToken } from '../../src/engine/tokenizer.js';
import { learning, settings } from '../helpers.js';

type ProtectedKind =
  | 'url'
  | 'email'
  | 'domain'
  | 'version-or-number'
  | 'path'
  | 'code-like'
  | 'structured-code'
  | 'numeric-id'
  | 'markup-or-package'
  | 'hyphen-fragment'
  | 'unicode-boundary';

interface AdversarialCase {
  kind: ProtectedKind;
  text: string;
  target: string;
}

const SEED = 0x51a7_f00d;
const MAX_CASES = 64;
const HIGH_CONFIDENCE_TYPOS = ['waht', 'teh', 'adn', 'becuase', 'recieve'] as const;

function seededPicker(seed: number) {
  let state = seed >>> 0;
  return <T>(values: readonly T[]): T => {
    // xorshift32: deterministic on every JS host because bitwise operations are
    // defined over signed 32-bit integers.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return values[(state >>> 0) % values.length]!;
  };
}

function buildCorpus(): AdversarialCase[] {
  const pick = seededPicker(SEED);
  const cases: AdversarialCase[] = [];
  const add = (
    kind: ProtectedKind,
    renderers: ReadonlyArray<(target: string) => string>,
    targets: readonly string[] = HIGH_CONFIDENCE_TYPOS,
  ) => {
    for (const render of renderers) {
      const target = pick(targets);
      cases.push({ kind, text: render(target), target });
    }
  };

  add('url', [
    (t) => `See https://example.test/${t}?page=1 now`,
    (t) => `Open http://sub.example.test/a/${t}#part now`,
    (t) => `Fetch ftp://files.example.test/${t} now`,
    (t) => `Visit www.example.test/${t} now`,
  ]);
  add('email', [
    (t) => `Mail ${t}@example.test today`,
    (t) => `Mail first+${t}@sub.example.test today`,
    (t) => `Reply to ${t}@xn--bcher-kva.example today`,
  ]);
  add('domain', [
    (t) => `Open ${t}.example.test now`,
    (t) => `Open sub.${t}.example now`,
    (t) => `Resolve www.${t}.test now`,
    (t) => `Inspect ${t}.localhost now`,
  ]);
  add('version-or-number', [
    (t) => `Build v2.${t} shipped`,
    (t) => `Identifier ${t}2026 remains`,
    (t) => `Identifier 2026${t} remains`,
    (t) => `Release ${t}-3.14 remains`,
  ]);
  add('path', [
    (t) => `Open C:\\temp\\${t}\\file.txt now`,
    (t) => `Open /usr/local/${t}/file now`,
    (t) => `Open ..\\${t}\\file now`,
    (t) => `Open ./${t}/file now`,
  ]);
  add('code-like', [
    (t) => `Call ${t}() now`,
    (t) => `Read object.${t} now`,
    (t) => `Set ${t}_value now`,
    (t) => `Set $${t} now`,
    (t) => `Use \`${t}\` now`,
    (t) => `Map ${t}=>value now`,
    (t) => `Resolve ${t}::value now`,
  ]);
  add('structured-code', [
    (t) => `Parse {"key":"${t}"} now`,
    (t) => `Render .box { content: ${t}; } now`,
    (t) => `Run SELECT ${t} FROM items; now`,
    (t) => `Run git --${t} HEAD now`,
    (t) => `Use feature-${t}-flag now`,
    (t) => `Match /${t}+/gi now`,
  ]);
  add('numeric-id', [
    (t) => `Release 2.${t}.1 now`,
    (t) => `Address 192.${t}.1.1 now`,
    (t) => `Decimal 3.${t} remains`,
    (t) => `Scientific 1e-${t} remains`,
    (t) => `Card 41111111${t}1111 remains`,
    (t) => `OTP ${t}482901 remains`,
    (t) => `UUID 123e4567-e89b-12d3-a456-${t}426614174000 remains`,
    (t) => `Commit deadbeef${t}1234 remains`,
    (t) => `Chemical Fe2${t} remains`,
  ]);
  add('markup-or-package', [
    (t) => `Read [guide](https://example.test/${t}) now`,
    (t) => `Render <span>${t}</span> now`,
    (t) => `Install @scope/${t} now`,
    (t) => `Use #${t} and continue`,
    (t) => `Ping @${t} and continue`,
  ]);
  add(
    'hyphen-fragment',
    [
      (t) => `The ${t}-matches remain`,
      (t) => `The matches-${t} remain`,
    ],
    ['mis'],
  );
  add(
    'hyphen-fragment',
    [
      (t) => `A ${t}-like result remains`,
      (t) => `A result-${t} suffix remains`,
    ],
    ['teh', 'adn'],
  );
  add(
    'unicode-boundary',
    [
      (t) => `🙂 https://example.test/${t} 🙂`,
      (t) => `✉️ ${t}@例.example now`,
      (t) => `Open ${t}.例 now`,
    ],
    ['waht', 'teh'],
  );
  add(
    'unicode-boundary',
    [
      (t) => `The ${t}\u2011matches remain`,
      (t) => `The matches\u2013${t} remain`,
    ],
    ['mis'],
  );

  if (cases.length > MAX_CASES) {
    throw new Error(`protected-token corpus grew beyond ${MAX_CASES} cases`);
  }
  return cases;
}

const CORPUS = buildCorpus();

function analyseCase(testCase: AdversarialCase) {
  const start = testCase.text.indexOf(testCase.target);
  if (start < 0) throw new Error(`target ${testCase.target} missing from ${testCase.text}`);
  return analyze(
    {
      text: testCase.text,
      wordEnd: start + testCase.target.length,
      origin: 'https://example.com',
    },
    learning(),
    settings(),
  );
}

describe('deterministic protected-token adversarial corpus', () => {
  it('uses a fixed, bounded corpus whose typo controls really auto-correct', () => {
    expect(CORPUS).toHaveLength(55);
    expect(CORPUS.length).toBeLessThanOrEqual(MAX_CASES);

    for (const target of HIGH_CONFIDENCE_TYPOS) {
      const result = analyze(
        {
          text: `Plain prose ${target} here`,
          wordEnd: `Plain prose ${target}`.length,
          origin: 'https://example.com',
        },
        learning(),
        settings(),
      );
      expect(result?.proposal.action, `plain control ${target}`).toBe('autocorrect');
    }
  });

  it('never automatically rewrites a protected token', () => {
    const automatic: string[] = [];
    for (const testCase of CORPUS) {
      const action = analyseCase(testCase)?.proposal.action;
      if (action === 'autocorrect') {
        automatic.push(
          `${testCase.kind}: ${JSON.stringify(testCase.text)} targeting ${testCase.target}`,
        );
      }
    }
    expect(automatic).toEqual([]);
  });

  it.each([
    ['camelCase', 'getWahtValue', 'getWahtValue'],
    ['PascalCase', 'GetWahtValue', 'GetWahtValue'],
    ['snake_case', 'feature_waht_flag', 'waht'],
    ['kebab-case', 'feature-waht-flag', 'waht'],
    ['mixed alphanumeric id', 'ABCwaht2026', 'ABCwaht'],
  ])('classifies a complete %s token as protected', (_kind, token, word) => {
    const start = token.indexOf(word);
    expect(analyzeToken(token, start, start + word.length).protected).toBe(true);
  });
});

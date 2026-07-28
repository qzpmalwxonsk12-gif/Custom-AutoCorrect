/**
 * Process 7: a dropped apostrophe.
 *
 * This exists because the letter-level processes handled contractions *badly*
 * rather than not at all - "didnt" is one deletion away from "dint", so the
 * engine confidently produced a wrong word. The tests therefore assert the
 * chosen replacement, not merely that something happened.
 */
import { describe, expect, it } from 'vitest';
import {
  createCandidateDiagnostics,
  generateApostropheCandidates,
  generateDeletionCandidates,
} from '../../src/engine/candidate-generator.js';
import { analyze } from '../../src/engine/correction-engine.js';
import { apostropheSupport } from '../../src/engine/data/contractions.js';
import { learning, settings } from '../helpers.js';

function correct(word: string) {
  const text = `I think ${word} `;
  const result = analyze(
    { text, wordEnd: 8 + word.length, origin: 'https://example.com' },
    learning(),
    settings(),
  );
  return result
    ? {
        replacement: result.proposal.replacement,
        to: result.proposal.replacement,
        action: result.proposal.action,
      }
    : null;
}

describe('generateApostropheCandidates', () => {
  it('finds the contraction for a word missing its apostrophe', () => {
    expect(generateApostropheCandidates('didnt').map((c) => c.word)).toEqual(["didn't"]);
    expect(generateApostropheCandidates('oclock').map((c) => c.word)).toEqual(["o'clock"]);
  });

  it('records where the apostrophe went', () => {
    const [candidate] = generateApostropheCandidates('didnt');
    expect(candidate?.missingApostrophe).toEqual({
      insertedIndex: 4,
      insertedCharacter: "'",
    });
  });

  it('ignores a word that already has an apostrophe', () => {
    expect(generateApostropheCandidates("didn't")).toEqual([]);
  });

  it('costs less than any letter edit, so it wins ties', () => {
    const [candidate] = generateApostropheCandidates('didnt');
    expect(candidate!.operationCost).toBeLessThan(1);
  });

  it('checks at most one position per interior character', () => {
    const diagnostics = createCandidateDiagnostics();
    generateApostropheCandidates('didnt', undefined, diagnostics);
    // Interior positions only: never before the first or after the last letter.
    expect(diagnostics.apostropheGenerated).toBe('didnt'.length - 1);
  });
});

/*
 * Found by manual review of UD English EWT false positives: the engine
 * "corrected" the surname "o'neal" to "oneal". The extra-letter deletion
 * process was treating the apostrophe as a deletable character, which turns
 * every contraction and possessive into a correction candidate.
 *
 * An apostrophe inside a word is structure, not a typo. Process 7 exists
 * precisely because a *missing* apostrophe is the common error; deleting a
 * present one is never the fix.
 */
describe('apostrophes are never deleted', () => {
  it('does not offer to strip the apostrophe from a name', () => {
    expect(generateDeletionCandidates("o'neal").map((c) => c.word)).not.toContain('oneal');
  });

  it('does not strip the apostrophe from a contraction', () => {
    for (const word of ["don't", "can't", "it's", "we've", "o'clock"]) {
      const stripped = word.replace("'", '');
      expect(generateDeletionCandidates(word).map((c) => c.word), word).not.toContain(stripped);
    }
  });

  it('still deletes ordinary letters in a word containing an apostrophe', () => {
    // The guard must be about the apostrophe, not about the whole word.
    const candidates = generateDeletionCandidates("can''t");
    expect(candidates.every((c) => c.word.includes("'"))).toBe(true);
  });
});

describe('contractions through the engine', () => {
  it('applies the ones with no plausible competitor', () => {
    for (const [typed, expected] of [
      ['didnt', "didn't"],
      ['hadnt', "hadn't"],
      ['doesnt', "doesn't"],
      ['arent', "aren't"],
      ['aint', "ain't"],
      ['oclock', "o'clock"],
      ['weve', "we've"],
    ] as const) {
      expect(correct(typed), typed).toMatchObject({
        replacement: expected,
        action: 'autocorrect',
      });
    }
  });

  /**
   * These all had a shorter, very common word one deletion away, which used to
   * win on frequency: "thats" became "that", "theyre" became "there".
   */
  it('beats a high-frequency word that is one deletion away', () => {
    for (const [typed, expected, loser] of [
      ['thats', "that's", 'that'],
      ['theyre', "they're", 'there'],
      ['shes', "she's", 'she'],
      ['hes', "he's", 'he'],
      ['ive', "i've", 'give'],
    ] as const) {
      const result = correct(typed);
      expect(result?.replacement, `${typed} should not become ${loser}`).toBe(expected);
    }
  });

  /**
   * The safety property: this process only ever runs on a word the dictionary
   * does not know, so a real word is never "corrected" into a contraction.
   */
  it('leaves words that are already valid alone', () => {
    for (const word of ['cant', 'wont', 'ill', 'lets', 'wheres', 'were', 'well', 'shell']) {
      expect(correct(word), word).toBeNull();
    }
  });

  it('does not disturb the other processes', () => {
    expect(correct('teh')).toMatchObject({ replacement: 'the', action: 'autocorrect' });
    expect(correct('nromal')).toMatchObject({ replacement: 'normal', action: 'autocorrect' });
    expect(correct('punctuatioon')).toMatchObject({
      replacement: 'punctuation',
      action: 'autocorrect',
    });
    expect(correct('worlkd')).toMatchObject({ replacement: 'world', action: 'autocorrect' });
    // Still genuinely ambiguous, so still only offered.
    expect(correct('iprove')).toMatchObject({ replacement: 'improve', action: 'suggest' });
    for (const word of ['book', 'coffee', 'address', 'committee']) {
      expect(correct(word), word).toBeNull();
    }
  });
});

/*
 * Lexical support gate.
 *
 * Dictionary membership alone was far too weak: ESDB carries the possessive of
 * essentially every noun, so "mis" matched "mi's" - the possessive of the
 * musical note. A minimum-length rule was rejected because it would break
 * "hes" and "im" equally; the gate instead asks whether English actually forms
 * this contraction or possessive.
 */
describe('apostrophe insertion requires lexical support', () => {
  it('refuses a possessive of a one- or two-letter stem', () => {
    expect(apostropheSupport('mi', 's').supported).toBe(false);
    expect(apostropheSupport('mi', 's').reason).toBe('stem-too-short');
    expect(correct('mis')?.to).not.toBe("mi's");
  });

  it('keeps every genuine contraction', () => {
    for (const [typed, expected] of [
      ['hes', "he's"],
      ['dont', "don't"],
      ['didnt', "didn't"],
      ['doesnt', "doesn't"],
      ['arent', "aren't"],
      ['im', "i'm"],
      ['ive', "i've"],
      ['theyre', "they're"],
      ['thats', "that's"],
      ['oclock', "o'clock"],
    ] as const) {
      expect(correct(typed)?.to, typed).toBe(expected);
    }
  });

  it('allows a possessive of a common noun', () => {
    expect(apostropheSupport('woodrow', 's').supported).toBe(true);
    expect(apostropheSupport('dog', 's').reason).toBe('possessive-of-common-stem');
  });

  it('refuses a suffix English does not contract with', () => {
    expect(apostropheSupport('some', 'thing').reason).toBe('unsupported-suffix');
    expect(apostropheSupport('any', 'where').supported).toBe(false);
  });

  it('only accepts o for the clock form', () => {
    expect(apostropheSupport('o', 'clock').supported).toBe(true);
    expect(apostropheSupport('x', 'clock').supported).toBe(false);
  });

  /**
   * "cant", "were", "well" and "shell" are all real words, so the pipeline
   * never reaches the apostrophe process for them. They must stay untouched
   * whatever the gate decides.
   */
  it('leaves valid words alone regardless of the gate', () => {
    for (const word of ['cant', 'wont', 'were', 'well', 'shell', 'ill', 'lets']) {
      expect(correct(word), word).toBeNull();
    }
  });
});

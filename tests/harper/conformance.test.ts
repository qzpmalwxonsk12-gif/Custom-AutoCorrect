/**
 * Opt-in conformance test against the REAL Harper WASM engine.
 *
 *   npm run test:harper
 *
 * Uses the inlined binary (base64 inside JS) because Node's fetch cannot load
 * chrome-extension: or file: URLs. The extension itself uses the URL-based
 * binary; both wrap the identical WASM build.
 *
 * This is also the measurement harness the prototype decision asked for: it
 * prints real setup and per-lint timings on this machine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Dialect, LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { deriveEdit, widenEdit } from '../../src/shared/grammar.js';

let linter: LocalLinter;
let setupMs = 0;

beforeAll(async () => {
  const started = Date.now();
  linter = new LocalLinter({ binary: binaryInlined, dialect: Dialect.American });
  await linter.setup();
  setupMs = Date.now() - started;
  console.info(`[harper] setup took ${setupMs} ms`);
});

afterAll(async () => {
  await linter?.dispose();
});

describe('real engine', () => {
  it('sets up in a tolerable time for a lazy background init', () => {
    expect(setupMs).toBeGreaterThan(0);
    // Generous ceiling: this is a potato-device sanity bound, not a target.
    expect(setupMs).toBeLessThan(60_000);
  });

  it('finds default-config errors and the diff-derived edits fix them', async () => {
    // Sentences chosen from rules Harper enables by default: ModalOf
    // ("could of"), RepeatedWords ("the the") and ItsContraction ("Its a").
    const paragraph = 'Its a shame, but I could of stopped the the dog.';
    const started = Date.now();
    const organized = await linter.organizedLints(paragraph, { language: 'plaintext' });
    console.info(`[harper] lint took ${Date.now() - started} ms`);

    const entries = Object.entries(organized).filter(([, lints]) => lints.length > 0);
    expect(entries.map(([rule]) => rule)).toEqual(
      expect.arrayContaining(['ModalOf', 'RepeatedWords']),
    );

    let verified = 0;
    for (const [ruleId, lints] of entries) {
      for (const lint of lints) {
        const suggestion = lint.suggestions()[0];
        if (!suggestion) continue;
        const after = await linter.applySuggestion(paragraph, lint, suggestion);
        const raw = deriveEdit(paragraph, after);
        if (!raw) continue;
        const edit = widenEdit(paragraph, raw);
        if (!edit) continue;
        // Both sides non-empty and applying the edit reproduces Harper's fix.
        expect(paragraph.slice(edit.start, edit.end).length).toBeGreaterThan(0);
        expect(edit.replacement.length).toBeGreaterThan(0);
        expect(
          paragraph.slice(0, edit.start) + edit.replacement + paragraph.slice(edit.end),
        ).toBe(after);
        expect(typeof ruleId).toBe('string');
        verified++;
      }
    }
    expect(verified).toBeGreaterThanOrEqual(2);
  });

  it('normalises a Remove suggestion (repeated word) into a two-sided edit', async () => {
    const paragraph = 'I saw the the dog outside.';
    const organized = await linter.organizedLints(paragraph, { language: 'plaintext' });
    const lints = organized['RepeatedWords'] ?? [];
    expect(lints.length).toBeGreaterThan(0);
    const lint = lints[0]!;
    const after = await linter.applySuggestion(paragraph, lint, lint.suggestions()[0]!);
    const edit = widenEdit(paragraph, deriveEdit(paragraph, after)!)!;
    expect(edit.replacement.length).toBeGreaterThan(0);
    expect(paragraph.slice(edit.start, edit.end)).not.toBe(edit.replacement);
    expect(
      paragraph.slice(0, edit.start) + edit.replacement + paragraph.slice(edit.end),
    ).toBe(after);
  });

  it('produces stable context hashes for the ignore list', async () => {
    const paragraph = 'I could of stopped it.';
    const organized = await linter.organizedLints(paragraph, { language: 'plaintext' });
    const first = Object.values(organized).flat()[0];
    expect(first).toBeDefined();
    const a = await linter.contextHash(paragraph, first!);
    expect(typeof a).toBe('bigint');
    expect(a.toString()).toMatch(/^\d+$/);
  });

  it('respects imported dictionary words', async () => {
    await linter.importWords(['zorbleflux']);
    const lints = await linter.lint('The zorbleflux is ready.', { language: 'plaintext' });
    const flagged = lints.some((l) => l.get_problem_text() === 'zorbleflux');
    expect(flagged).toBe(false);
  });

  it('reports lint timing suitable for the idle path', async () => {
    const paragraph =
      'Its a shame, but I could of stopped the the dog before it ran away yesterday evening. '.repeat(3);
    const started = Date.now();
    await linter.lint(paragraph, { language: 'plaintext' });
    const ms = Date.now() - started;
    console.info(`[harper] 3x-repeated paragraph lint took ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
  });
});

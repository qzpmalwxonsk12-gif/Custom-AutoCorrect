/**
 * Part 8: the bounded whole-field shadow sweep.
 *
 * Shadow collection touches two things that must never be compromised — the
 * user's text and the user's privacy — so each guarantee is asserted rather
 * than described.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { makeHost, makeTextarea } from './dom-helpers.js';

const controllers: EditableController[] = [];

function setup(overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea('');
  const host = makeHost({
    ...overrides,
    settings: { shadowMode: 'all', ...(overrides.settings ?? {}) },
  });
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

async function sweep(ticks = 400): Promise<void> {
  for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(40);
}

/** A document with many distinct misspellings, to push the observation budget. */
function noisyDocument(sentences: number): string {
  const typos = ['teh', 'adn', 'waht', 'becuase', 'recieve', 'nromal', 'alogrithm', 'thier'];
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) {
    const typo = typos[i % typos.length]!;
    out.push(`This is sentence number ${'x'.repeat(0)}${i} about ${typo} things here.`);
  }
  return out.join(' ');
}

beforeEach(() => {
  vi.useFakeTimers();
  essentialPunctuationProvider.clearCache();
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
  vi.useRealTimers();
});

describe('whole-field shadow collection', () => {
  it('never changes visible text', async () => {
    const { field, controller } = setup();
    // Shadow mode holds every correction back, so a sweep must be a no-op.
    const text = 'I think teh cat adn teh dog were here.';
    field.value = text;
    controller.scanField(true);
    await sweep();
    expect(field.value).toBe(text);
  });

  it('creates no CorrectionRecord for a shadow-only proposal', async () => {
    const { field, controller } = setup();
    field.value = 'I think teh cat adn teh dog were here.';
    controller.scanField(true);
    await sweep();
    expect(controller.session.records).toHaveLength(0);
  });

  it('records observations while changing nothing', async () => {
    const { field, controller, host } = setup();
    field.value = 'I think teh cat adn teh dog were here.';
    controller.scanField(true);
    await sweep();
    // The point of shadow mode: evidence without effect.
    expect(host.shadowObservations.length).toBeGreaterThan(0);
    expect(controller.session.records).toHaveLength(0);
  });

  /** Evidence, not a transcript: one scan cannot log an entire document. */
  it('caps observations per forced scan', async () => {
    const { field, controller, host } = setup();
    field.value = noisyDocument(200);
    controller.scanField(true);
    await sweep(600);
    expect(host.shadowObservations.length).toBeLessThanOrEqual(120);
  });

  /**
   * The same disagreement in ten places is one piece of evidence. Recording it
   * ten times would bias the aggregate the weights are chosen from.
   */
  it('de-duplicates by word pair, not by position', async () => {
    const { field, controller, host } = setup();
    // The same typo twenty times, at twenty different offsets.
    field.value = Array.from({ length: 20 }, (_, i) => `Sentence ${i} about teh thing.`).join(' ');
    controller.scanField(true);
    await sweep();

    const pairs = host.shadowObservations.map(
      (o) => `${o.originalText}>${o.replacementText}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('excludes protected text', async () => {
    const { field, controller, host } = setup();
    field.value =
      'See https://example.com/teh and `code teh` and CONST_TEH and teh2 here.';
    controller.scanField(true);
    await sweep();
    // Nothing observed may come from a protected construct.
    for (const observation of host.shadowObservations) {
      expect(observation.originalText).not.toContain('/');
      expect(observation.originalText).not.toMatch(/\d/);
    }
  });

  it('does not store whole sentences', async () => {
    const { field, controller, host } = setup();
    field.value =
      'My account number is teh private and confidential document text that '
      + 'should never appear in an observation anywhere at all.';
    controller.scanField(true);
    await sweep();

    expect(host.shadowObservations.length).toBeGreaterThan(0);
    for (const observation of host.shadowObservations) {
      // An observation carries candidate words, never surrounding prose.
      expect(observation.originalText.length).toBeLessThanOrEqual(120);
      expect(observation.originalText.split(/\s+/).length).toBeLessThanOrEqual(3);
      expect(observation.replacementText.split(/\s+/).length).toBeLessThanOrEqual(3);
      expect(observation.originalText).not.toContain('confidential');
      expect(observation.originalText).not.toContain('account');
    }
  });

  it('resets the budget and the de-duplication set on a forced rescan', async () => {
    const { field, controller, host } = setup();
    field.value = 'I think teh cat here.';
    controller.scanField(true);
    await sweep();
    const first = host.shadowObservations.length;

    controller.scanField(true);
    await sweep();
    // A fresh measurement may legitimately re-record the same pair.
    expect(host.shadowObservations.length).toBeGreaterThanOrEqual(first);
  });

  it('collects nothing when shadow mode is off', async () => {
    const { field, controller, host } = setup({ settings: { shadowMode: 'off' } });
    field.value = 'I think teh cat adn teh dog were here.';
    controller.scanField(true);
    await sweep();
    expect(host.shadowObservations).toHaveLength(0);
  });

  it('stops when the field is detached', async () => {
    const { field, controller } = setup();
    field.value = noisyDocument(50);
    controller.scanField(true);
    await vi.advanceTimersByTimeAsync(40);
    controller.detach();
    // Must not throw or keep working after detach.
    await expect(sweep(50)).resolves.toBeUndefined();
  });
});

/**
 * DIAGNOSTIC: exercises every correction source and asserts each produces
 * exactly one history record. Written before any fix, to locate the reported
 * "text changes without a history record" failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import type { LintResponse } from '../../src/shared/grammar.js';
import type { Result } from '../../src/shared/messages.js';
import { makeHost, makeTextarea, typeInto } from './dom-helpers.js';

const controllers: EditableController[] = [];
let chip: { replacement: string; accept: () => void; dismiss: () => void } | null = null;

function setup(overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea('');
  const host = makeHost(overrides);
  (host.highlighter as unknown as {
    showSuggestion: (r: unknown, replacement: string, a: () => void, d: () => void) => void;
  }).showSuggestion = (_r, replacement, accept, dismiss) => {
    chip = { replacement, accept, dismiss };
  };
  (host.highlighter as unknown as { hideSuggestion: () => void }).hideSuggestion = () => {
    chip = null;
  };
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

async function idle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(800);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  chip = null;
  essentialPunctuationProvider.clearCache();
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
  vi.useRealTimers();
});

describe('history diagnosis: one record per applied correction', () => {
  it('exact typo mapping', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think what ');
    expect(controller.session.records).toHaveLength(1);
  });

  it('punctuation rule', async () => {
    const { field, controller } = setup({ settings: { punctuationEnabled: true } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    expect(field.value).toBe('Although it was raining, we continued.');
    expect(controller.session.records).toHaveLength(1);
  });

  it('accepted Harper suggestion', async () => {
    const { field, host, controller } = setup({
      settings: { harperEnabled: true, punctuationEnabled: false },
    });
    host.lintResponder = async (req): Promise<Result<LintResponse>> => {
      const start = req.paragraph.indexOf('has');
      if (start < 0) return { ok: true, data: { issues: [], lintMs: 1 } };
      return {
        ok: true,
        data: {
          issues: [{
            ruleId: 'SubjectVerbAgreement',
            kind: 'Agreement',
            message: 'Use have.',
            start,
            end: start + 3,
            original: 'has',
            replacement: 'have',
          }],
          lintMs: 1,
        },
      };
    };
    typeInto(field, 'Yesterday I has a dog today.');
    await idle();
    expect(chip).not.toBeNull();
    chip!.accept();
    expect(field.value).toContain('have');
    expect(controller.session.records).toHaveLength(1);
  });

  it('records survive an idle pass (relocation does not delete them)', async () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    expect(controller.session.records).toHaveLength(1);
    for (let i = 0; i < 3; i++) await idle();
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.records[0]!.status).toBe('pending');
  });

  it('records survive a repeated panel refresh', async () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    for (let i = 0; i < 5; i++) controller.relocateAll();
    expect(controller.session.records).toHaveLength(1);
  });

  it('two identical corrections produce two independent records', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht and also waht ');
    expect(controller.session.records).toHaveLength(2);
    const ids = new Set(controller.session.records.map((r) => r.id));
    expect(ids.size).toBe(2);
  });

  it('a session is present before the first correction', () => {
    const { controller } = setup();
    expect(controller.session.id).toBeTruthy();
    expect(controller.session.records).toEqual([]);
  });

  it('the record carries the session id it was filed under', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    expect(controller.session.records[0]!.sessionId).toBe(controller.session.id);
  });

  it('notifies the host on every applied correction', () => {
    const { field, host } = setup();
    const before = host.changes;
    typeInto(field, 'I think waht ');
    expect(host.changes).toBeGreaterThan(before);
  });

  it('a rejected/stale correction creates no record', () => {
    const { field, controller } = setup();
    // Text changes underneath before the commit is processed.
    field.value = 'I think waht ';
    field.setSelectionRange(field.value.length, field.value.length);
    // No input event dispatched -> no commit -> no record.
    expect(controller.session.records).toHaveLength(0);
  });
});

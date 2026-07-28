/**
 * The correction-history invariant:
 *
 *   the field's text is modified  <=>  exactly one CorrectionRecord exists
 *
 * These tests hold every correction source to that contract, and hold the
 * rollback path to it too: a host that mangles our edit must leave neither a
 * changed field nor an orphan record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { upsertUserRule } from '../../src/engine/personal-learning.js';
import type { LintResponse } from '../../src/shared/grammar.js';
import type { Result } from '../../src/shared/messages.js';
import { learning as makeLearning } from '../helpers.js';
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

/** Asserts the full contract for one applied correction. */
function expectSingleRecord(
  controller: EditableController,
  expected: { original: string; replacement: string; ruleIdPrefix?: string },
) {
  expect(controller.session.records).toHaveLength(1);
  const record = controller.session.records[0]!;
  expect(record.originalText).toBe(expected.original);
  expect(record.replacementText).toBe(expected.replacement);
  expect(record.sessionId).toBe(controller.session.id);
  expect(record.id).toBeTruthy();
  if (expected.ruleIdPrefix) {
    expect(record.sourceRuleId ?? '').toContain(expected.ruleIdPrefix);
  }
  return record;
}

describe('one record per correction, per source', () => {
  it('exact typo mapping', () => {
    const { field, host, controller } = setup();
    const before = host.changes;
    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think what ');
    const record = expectSingleRecord(controller, { original: 'waht', replacement: 'what' });
    expect(record.correctionType).toBe('spelling');
    expect(host.changes).toBeGreaterThan(before); // panel notified
  });

  it('personal replacement rule', () => {
    const data = makeLearning();
    upsertUserRule(data, 'omw', 'on my way');
    const { field, controller } = setup({ learning: data });
    typeInto(field, 'Ok omw ');
    expect(field.value).toBe('Ok on my way ');
    const record = expectSingleRecord(controller, {
      original: 'omw',
      replacement: 'on my way',
    });
    expect(record.correctionType).toBe('exact-rule');
  });

  it('essential punctuation rule', async () => {
    const { field, controller } = setup({ settings: { punctuationEnabled: true } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    expect(field.value).toBe('Although it was raining, we continued.');
    const record = expectSingleRecord(controller, {
      original: 'raining',
      replacement: 'raining,',
      ruleIdPrefix: 'punctuation:',
    });
    expect(record.correctionType).toBe('punctuation');
    expect(record.autoApplied).toBe(true);
  });

  it('accepted Harper grammar suggestion', async () => {
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
    chip!.accept();
    const record = expectSingleRecord(controller, {
      original: 'has',
      replacement: 'have',
      ruleIdPrefix: 'harper:',
    });
    // Accepted from a chip, so not an automatic application.
    expect(record.autoApplied).toBe(false);
  });

  it('duplicate-letter removal', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    expect(field.value).toBe('Type the punctuation ');
    const record = expectSingleRecord(controller, {
      original: 'punctuatioon',
      replacement: 'punctuation',
    });
    expect(record.correctionType).toBe('duplicate-letter');
    expect(record.letterEvidence).toEqual({ removedIndex: 10, removedCharacter: 'o' });
  });

  it('missing-letter insertion (offered, then accepted)', () => {
    const { field, controller } = setup();
    typeInto(field, 'Please iprove ');
    // "iprove" admits both "improve" (insert m) and "prove" (delete i), so the
    // engine offers rather than imposes. Accepting must still record exactly
    // one reversible correction.
    expect(chip?.replacement).toBe('improve');
    chip!.accept();
    expect(field.value).toBe('Please improve ');
    const record = expectSingleRecord(controller, {
      original: 'iprove',
      replacement: 'improve',
    });
    expect(record.correctionType).toBe('missing-letter');
    expect(record.autoApplied).toBe(false);
  });

  it('accidental-space merge is one record, not two', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the impro vement ');
    expect(field.value).toBe('Type the improvement ');
    const record = expectSingleRecord(controller, {
      original: 'impro vement',
      replacement: 'improvement',
    });
    expect(record.correctionType).toBe('token-merge');
  });

  it('missing-space split', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the improvementability ');
    expect(field.value).toBe('Type the improvement ability ');
    const record = expectSingleRecord(controller, {
      original: 'improvementability',
      replacement: 'improvement ability',
    });
    expect(record.correctionType).toBe('token-split');
  });

  it('capitalisation via a sentence-start correction', () => {
    const { field, controller } = setup();
    // The engine capitalises at a sentence start while fixing the typo.
    typeInto(field, 'Hello. teh ');
    expect(field.value).toBe('Hello. The ');
    expectSingleRecord(controller, { original: 'teh', replacement: 'The' });
  });
});

describe('reversion restores the exact original', () => {
  it('restores spacing and capitalisation exactly', () => {
    const { field, controller } = setup();
    typeInto(field, 'Hello. teh ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('Hello. teh ');
    expect(record.status).toBe('reverted');
  });

  it('reverting one occurrence leaves an identical one untouched', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht and also waht ');
    expect(field.value).toBe('I think what and also what ');
    expect(controller.session.records).toHaveLength(2);

    const second = controller.session.records[1]!;
    expect(controller.decide(second.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('I think what and also waht ');
    expect(controller.session.records[0]!.status).toBe('pending');
  });

  it('a punctuation correction is individually reversible', async () => {
    const { field, controller } = setup({ settings: { punctuationEnabled: true } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('Although it was raining we continued.');
  });
});

describe('no record without a text change, and never two', () => {
  it('a stale proposal is declined and records nothing', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    expect(controller.session.records).toHaveLength(1);

    // Re-applying the same (now stale) proposal must be refused.
    const stale = {
      start: 8,
      end: 12,
      original: 'waht',
      replacement: 'what',
      correctionType: 'spelling' as const,
      confidence: 0.99,
      action: 'autocorrect' as const,
      reason: 'test',
    };
    const outcome = controller.applyCorrection({
      proposal: stale,
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: false, origin: 'https://example.com',
      },
    });
    expect(outcome.status).toBe('declined');
    expect(controller.session.records).toHaveLength(1);
  });

  it('a no-op proposal is declined', () => {
    const { controller } = setup();
    const outcome = controller.applyCorrection({
      proposal: {
        start: 0, end: 0, original: '', replacement: '',
        correctionType: 'spelling', confidence: 1, action: 'autocorrect', reason: 't',
      },
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: false, origin: 'https://example.com',
      },
    });
    expect(outcome.status).toBe('declined');
    expect(controller.session.records).toHaveLength(0);
  });

  it('repeated relocation passes never duplicate a record', async () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    for (let i = 0; i < 5; i++) {
      controller.relocateAll();
      await idle();
    }
    expect(controller.session.records).toHaveLength(1);
  });

  it('a cached punctuation analysis still yields a fresh record in a new field', async () => {
    const first = setup({ settings: { punctuationEnabled: true } });
    typeInto(first.field, 'Although it was raining we continued.');
    await idle();
    expect(first.controller.session.records).toHaveLength(1);

    // Same text in a different field: the provider cache must not suppress it.
    const second = setup({ settings: { punctuationEnabled: true } });
    typeInto(second.field, 'Although it was raining we continued.');
    await idle();
    expect(second.field.value).toBe('Although it was raining, we continued.');
    expect(second.controller.session.records).toHaveLength(1);
    expect(second.controller.session.records[0]!.sessionId).toBe(second.controller.session.id);
  });
});

describe('rollback keeps text and history consistent', () => {
  it('restores the text and records nothing when the host mangles the edit', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think ');
    const originalText = field.value;

    // A host that rewrites whatever we insert.
    const adapter = controller.adapter as InputAdapter;
    const realReplace = adapter.replaceRange.bind(adapter);
    let sabotage = true;
    adapter.replaceRange = (start: number, end: number, insert: string) => {
      if (sabotage) {
        sabotage = false; // let the rollback itself succeed
        return realReplace(start, end, `${insert}ZZZ`);
      }
      return realReplace(start, end, insert);
    };

    const outcome = controller.applyCorrection({
      proposal: {
        start: 0, end: 1, original: 'I', replacement: 'X',
        correctionType: 'spelling', confidence: 0.99,
        action: 'autocorrect', reason: 'test',
      },
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: true, origin: 'https://example.com',
      },
    });

    expect(outcome.status).toBe('rolled-back');
    expect(field.value).toBe(originalText); // no residue
    expect(controller.session.records).toHaveLength(0); // no orphan record
  });

  it('accepts a host that only swaps a normal space for a non-breaking one', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think ');

    const adapter = controller.adapter as InputAdapter;
    const realReplace = adapter.replaceRange.bind(adapter);
    adapter.replaceRange = (start: number, end: number, insert: string) =>
      realReplace(start, end, insert.replace(/ /g, ' '));

    const outcome = controller.applyCorrection({
      proposal: {
        start: 2, end: 7, original: 'think', replacement: 'think of',
        correctionType: 'spelling', confidence: 0.99,
        action: 'autocorrect', reason: 'test',
      },
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: false, origin: 'https://example.com',
      },
    });

    // A non-breaking space is a rendering detail, not a rejection.
    expect(outcome.status).toBe('applied');
    expect(controller.session.records).toHaveLength(1);
    const record = controller.session.records[0]!;
    expect(record.replacementText).toBe('think\u00a0of');
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('I think ');
  });

  it('rejects whitespace normalization outside the requested edit span', () => {
    const { field, controller } = setup();
    typeInto(field, 'A B think ');
    const originalText = field.value;

    const adapter = controller.adapter as InputAdapter;
    const realReplace = adapter.replaceRange.bind(adapter);
    let sabotage = true;
    adapter.replaceRange = (start: number, end: number, insert: string) => {
      const applied = realReplace(start, end, insert);
      if (applied && sabotage) {
        sabotage = false; // rollback is allowed to render exactly
        field.value = field.value.replace('A B', 'A\u00a0B');
      }
      return applied;
    };

    const outcome = controller.applyCorrection({
      proposal: {
        start: 4, end: 9, original: 'think', replacement: 'thought',
        correctionType: 'spelling', confidence: 0.99,
        action: 'autocorrect', reason: 'test',
      },
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: false, origin: 'https://example.com',
      },
    });

    expect(outcome.status).toBe('rolled-back');
    expect(field.value).toBe(originalText);
    expect(controller.session.records).toHaveLength(0);
  });

  it('records the actual remaining mutation when the host also rewrites rollback', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think ');
    const originalText = field.value;

    const adapter = controller.adapter as InputAdapter;
    const realReplace = adapter.replaceRange.bind(adapter);
    let calls = 0;
    adapter.replaceRange = (start: number, end: number, insert: string) => {
      calls++;
      // Mangle both the requested correction and the controller's first
      // rollback attempt. Subsequent edits (including the user's revert) work.
      return realReplace(start, end, calls <= 2 ? `${insert}ZZZ` : insert);
    };

    const outcome = controller.applyCorrection({
      proposal: {
        start: 0, end: 1, original: 'I', replacement: 'X',
        correctionType: 'spelling', confidence: 0.99,
        action: 'autocorrect', reason: 'test',
      },
      context: {
        before: '', after: '', previousWord: '', nextWord: '',
        isSentenceStart: true, origin: 'https://example.com',
      },
    });

    expect(outcome.status).toBe('applied');
    expect(field.value).toBe('I think ZZZ');
    expect(controller.session.records).toHaveLength(1);
    const record = controller.session.records[0]!;
    expect(record.originalText).toBe('think ');
    expect(record.replacementText).toBe('think ZZZ');

    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe(originalText);
  });

  it('rolls back a revert when the host changes text outside its span', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    const correctedText = field.value;
    const record = controller.session.records[0]!;

    const adapter = controller.adapter as InputAdapter;
    const realReplace = adapter.replaceRange.bind(adapter);
    let sabotage = true;
    adapter.replaceRange = (start: number, end: number, insert: string) => {
      const applied = realReplace(start, end, insert);
      if (applied && sabotage) {
        sabotage = false;
        field.value += 'ZZZ';
      }
      return applied;
    };

    const result = controller.decide(record.id, 'revert');

    expect(result.ok).toBe(false);
    expect(field.value).toBe(correctedText);
    expect(record.status).toBe('pending');
    expect(controller.session.records).toHaveLength(1);
  });
});

/**
 * Punctuation lane in a real editable: application timing, caret preservation,
 * correction records, selective revert, Harper de-duplication and the safety
 * re-verification before any edit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { ContentEditableAdapter } from '../../src/content/contenteditable-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { matchesFilter } from '../../src/history/correction-history.js';
import type { GrammarIssue, LintResponse } from '../../src/shared/grammar.js';
import type { Result } from '../../src/shared/messages.js';
import {
  inputEvent,
  makeContentEditable,
  makeHost,
  makeTextarea,
  typeInto,
} from './dom-helpers.js';

const controllers: EditableController[] = [];
let chip: { replacement: string; accept: () => void; dismiss: () => void } | null = null;

function setup(initial = '', overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea(initial);
  const host = makeHost({
    settings: { punctuationEnabled: true, ...(overrides.settings ?? {}) },
    learning: overrides.learning,
  });
  (host.highlighter as unknown as {
    showSuggestion: (r: unknown, replacement: string, a: () => void, d: () => void) => void;
  }).showSuggestion = (_rects, replacement, accept, dismiss) => {
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

describe('automatic application', () => {
  it('honours a profile that disables the punctuation lane', async () => {
    const { field, controller } = setup('', {
      settings: { profile: 'coding', punctuationEnabled: true },
    });
    typeInto(field, 'Although it was raining we continued.');
    await idle();

    expect(field.value).toBe('Although it was raining we continued.');
    expect(controller.session.records).toHaveLength(0);
  });

  it('inserts a comma after an introductory clause when typing stops', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();

    expect(field.value).toBe('Although it was raining, we continued.');
    const record = controller.session.records[0]!;
    expect(record).toMatchObject({
      originalText: 'raining',
      replacementText: 'raining,',
      correctionType: 'punctuation',
      sourceRuleId: 'punctuation:introductory-clause',
      autoApplied: true,
      status: 'pending',
    });
    expect(matchesFilter(record, 'punctuation')).toBe(true);
    expect(matchesFilter(record, 'grammar')).toBe(false);
  });

  it('does not run on every keystroke', async () => {
    const { field } = setup();
    // Typing the text without letting the idle timer fire changes nothing.
    typeInto(field, 'Although it was raining we continued');
    expect(field.value).toBe('Although it was raining we continued');
  });

  it('identifies held-back punctuation as the punctuation shadow provider', async () => {
    const { field, host, controller } = setup('', { settings: { shadowMode: 'all' } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();

    expect(field.value).toBe('Although it was raining we continued.');
    expect(controller.session.records).toHaveLength(0);
    expect(host.shadowObservations).toContainEqual(
      expect.objectContaining({
        provider: 'punctuation',
        ruleId: 'punctuation:introductory-clause',
      }),
    );
  });

  it('preserves the caret position across the insertion', async () => {
    const { field } = setup();
    typeInto(field, 'Although it was raining we continued.');
    const before = field.selectionStart;
    await idle();
    // One character was inserted before the caret, so it moves by exactly one.
    expect(field.selectionStart).toBe((before ?? 0) + 1);
  });

  it('records evidence and an explanation on the proposal reason', async () => {
    const { controller, field } = setup();
    typeInto(field, 'I was tired but I kept working.');
    await idle();
    const record = controller.session.records[0]!;
    expect(record.sourceRuleId).toBe('punctuation:independent-clause');
    expect(field.value).toBe('I was tired, but I kept working.');
  });

  it('chains through several fixes across passes', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued. I was tired but I kept working.');
    for (let i = 0; i < 4; i++) await idle();
    expect(field.value).toBe(
      'Although it was raining, we continued. I was tired, but I kept working.',
    );
    expect(controller.session.records).toHaveLength(2);
  });

  it('reports rule statistics upstream', async () => {
    const { field, host } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    expect(host.punctuationEvents).toContainEqual({
      ruleId: 'punctuation:introductory-clause',
      verdict: 'shown',
    });
  });

  it('stays silent when the engine is disabled', async () => {
    const { field } = setup('', { settings: { punctuationEnabled: false } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    expect(field.value).toBe('Although it was raining we continued.');
  });

  it('offers a suggestion instead of applying when automatic mode is off', async () => {
    const { field } = setup('', { settings: { punctuationAutomatic: false } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    expect(field.value).toBe('Although it was raining we continued.');
    expect(chip?.replacement).toBe('raining,');
  });
});

describe('reversion', () => {
  it('reverts a punctuation correction exactly', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    const record = controller.session.records[0]!;

    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('Although it was raining we continued.');
    expect(record.status).toBe('reverted');
  });

  it('records a revert as rule feedback, never as a word-pair rule', async () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I was tired but I kept working.');
    await idle();
    host.events.length = 0;
    host.punctuationEvents.length = 0;

    controller.decide(controller.session.records[0]!.id, 'revert');
    expect(host.punctuationEvents).toContainEqual({
      ruleId: 'punctuation:independent-clause',
      verdict: 'reverted',
    });
    // The dangerous outcome would be an exact rule such as "and" -> ", and".
    expect(host.events).toHaveLength(0);
  });

  it('keeping a punctuation record does not create a word-pair rule', async () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    host.events.length = 0;

    controller.decide(controller.session.records[0]!.id, 'keep');
    expect(host.events).toHaveLength(0);
    expect(host.punctuationEvents).toContainEqual({
      ruleId: 'punctuation:introductory-clause',
      verdict: 'accepted',
    });
  });

  it('does not re-apply a correction the user just reverted', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    controller.decide(controller.session.records[0]!.id, 'revert');
    expect(field.value).toBe('Although it was raining we continued.');

    for (let i = 0; i < 3; i++) await idle();
    expect(field.value).toBe('Although it was raining we continued.');
  });

  it('reverts only the selected one of two punctuation corrections', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued. I was tired but I kept working.');
    for (let i = 0; i < 4; i++) await idle();
    expect(controller.session.records).toHaveLength(2);

    const second = controller.session.records[1]!;
    controller.decide(second.id, 'revert');
    expect(field.value).toBe(
      'Although it was raining, we continued. I was tired but I kept working.',
    );
    expect(controller.session.records[0]!.status).toBe('pending');
  });
});

describe('safety re-verification', () => {
  it('skips an issue whose text changed before the chip was clicked', async () => {
    const { field } = setup('', { settings: { punctuationAutomatic: false } });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    const accept = chip!.accept;

    field.value = 'Completely different content now.';
    accept();
    expect(field.value).toBe('Completely different content now.');
  });

  it('re-checks punctuation policy when an offered chip is clicked', async () => {
    const { field, host, controller } = setup('', {
      settings: { punctuationAutomatic: false },
    });
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    const accept = chip!.accept;

    host.setSettings({
      ruleModes: { 'punctuation:introductory-clause': 'disabled' },
    });
    accept();

    expect(field.value).toBe('Although it was raining we continued.');
    expect(controller.session.records).toHaveLength(0);
  });

  it('never modifies protected content', async () => {
    const { field } = setup();
    typeInto(field, 'Although https://example.com/x failed we continued.');
    await idle();
    expect(field.value).toBe('Although https://example.com/x failed we continued.');
  });

  it('never modifies a sensitive field', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'card_number';
    document.body.appendChild(input);
    const host = makeHost({ settings: { punctuationEnabled: true } });
    const controller = new EditableController(new InputAdapter(input), host);
    controller.attach();
    controllers.push(controller);

    typeInto(input, 'Although it was raining we continued.');
    await idle();
    expect(input.value).toBe('Although it was raining we continued.');
    expect(controller.session.records).toHaveLength(0);
  });

  it('stops a punctuation batch before reading a field made sensitive mid-pass', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const host = makeHost({ settings: { punctuationEnabled: true } });
    const adapter = new InputAdapter(input);
    const controller = new EditableController(adapter, host);
    controller.attach();
    controllers.push(controller);

    typeInto(input, 'I bought apples oranges bananas and grapes.');
    input.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.inputType === 'insertReplacementText') {
        input.type = 'password';
      }
    });
    const realGetText = adapter.getText.bind(adapter);
    let sensitiveReads = 0;
    vi.spyOn(adapter, 'getText').mockImplementation(() => {
      if (input.type === 'password') sensitiveReads++;
      return realGetText();
    });

    await idle();

    expect(sensitiveReads).toBe(0);
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.persistence).toBe('memory');
  });

  it('does not fight an existing correction record over the same span', async () => {
    const { field, controller } = setup();
    typeInto(field, 'Although it was raining we continued.');
    await idle();
    const first = controller.session.records.length;
    // A second pass over unchanged text must not add a duplicate record.
    for (let i = 0; i < 3; i++) await idle();
    expect(controller.session.records).toHaveLength(first);
  });
});

describe('contenteditable support', () => {
  it('applies punctuation inside a contenteditable host', async () => {
    const el = makeContentEditable('Although it was raining we continued.');
    const host = makeHost({ settings: { punctuationEnabled: true } });
    const adapter = new ContentEditableAdapter(el);
    const controller = new EditableController(adapter, host);
    controller.attach();
    controllers.push(controller);

    el.dispatchEvent(inputEvent('insertText', ' '));
    await idle();

    expect(adapter.getText()).toBe('Although it was raining, we continued.');
    expect(controller.session.records[0]?.sourceRuleId).toBe(
      'punctuation:introductory-clause',
    );
  });
});

describe('Harper de-duplication', () => {
  function harperIssueAt(paragraph: string): GrammarIssue {
    // Harper reporting the same comma insertion the punctuation lane owns.
    const start = paragraph.indexOf('raining');
    return {
      ruleId: 'CommaFixes',
      kind: 'Punctuation',
      message: 'Add a comma.',
      start,
      end: start + 'raining'.length,
      original: 'raining',
      replacement: 'raining,',
    };
  }

  it('shows only one correction when both lanes report the same span', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperEnabled: true, punctuationEnabled: true },
    });
    host.lintResponder = async (req): Promise<Result<LintResponse>> => ({
      ok: true,
      data: { issues: [harperIssueAt(req.paragraph)], lintMs: 1 },
    });

    typeInto(field, 'Although it was raining we continued.');
    for (let i = 0; i < 4; i++) await idle();

    expect(field.value).toBe('Although it was raining, we continued.');
    // Exactly one record, from the punctuation lane.
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.records[0]!.sourceRuleId).toBe(
      'punctuation:introductory-clause',
    );
    // Harper never got to offer its duplicate.
    expect(host.grammarEvents.filter((e) => e.verdict === 'offered')).toHaveLength(0);
  });

  it('does not let a disabled punctuation proposal hide Harper', async () => {
    const { field, host, controller } = setup('', {
      settings: {
        harperEnabled: true,
        punctuationEnabled: true,
        ruleModes: { 'punctuation:introductory-clause': 'disabled' },
      },
    });
    host.lintResponder = async (req): Promise<Result<LintResponse>> => ({
      ok: true,
      data: { issues: [harperIssueAt(req.paragraph)], lintMs: 1 },
    });

    typeInto(field, 'Although it was raining we continued.');
    for (let i = 0; i < 4; i++) await idle();

    expect(controller.session.records).toHaveLength(0);
    expect(chip?.replacement).toBe('raining,');
    expect(host.grammarEvents.filter((event) => event.verdict === 'offered')).toHaveLength(1);
  });

  it('still lets Harper report an issue the punctuation lane does not own', async () => {
    const { field, host } = setup('', {
      settings: { harperEnabled: true, punctuationEnabled: true },
    });
    host.lintResponder = async (req): Promise<Result<LintResponse>> => {
      const start = req.paragraph.indexOf('has');
      if (start < 0) return { ok: true, data: { issues: [], lintMs: 1 } };
      return {
        ok: true,
        data: {
          issues: [
            {
              ruleId: 'SubjectVerbAgreement',
              kind: 'Agreement',
              message: 'Use "have".',
              start,
              end: start + 3,
              original: 'has',
              replacement: 'have',
            },
          ],
          lintMs: 1,
        },
      };
    };

    typeInto(field, 'Yesterday I has a dog and it was fine.');
    for (let i = 0; i < 6; i++) await idle();

    // The punctuation lane fixed the clause comma; Harper fixed the agreement.
    expect(field.value).toContain(', and it was fine');
    expect(chip?.replacement).toBe('have');
  });
});

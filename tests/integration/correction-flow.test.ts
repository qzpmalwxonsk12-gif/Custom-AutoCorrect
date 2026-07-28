/**
 * End-to-end behaviour of the content-script pipeline: typing produces
 * corrections and records, the panel commands act on them, and reverting is
 * verified against the live text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { addToDictionary } from '../../src/engine/personal-learning.js';
import { textFingerprint } from '../../src/history/correction-history.js';
import { inputEvent, makeHost, makeTextarea, typeInto, type TestHost } from './dom-helpers.js';

const controllers: EditableController[] = [];

function setup(initial = '', hostOverrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea(initial);
  const host = makeHost(hostOverrides);
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
});

describe('typing', () => {
  it('corrects on space and records it', () => {
    const { field, host, controller } = setup();
    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think what ');

    expect(controller.session.records).toHaveLength(1);
    const record = controller.session.records[0]!;
    expect(record).toMatchObject({
      originalText: 'waht',
      replacementText: 'what',
      status: 'pending',
      autoApplied: true,
      correctionType: 'spelling',
    });
    expect(record.contextPreview).toContain('what');
    expect(host.events[0]).toMatchObject({
      type: 'applied',
      original: 'waht',
      replacement: 'what',
      source: 'builtin-typo',
    });
  });

  it('records ESDB pipeline corrections as lexicon learning, not shipped typos', () => {
    const { field, host } = setup();
    typeInto(field, 'The nromal word ');

    expect(field.value).toBe('The normal word ');
    expect(host.events[0]).toMatchObject({
      type: 'applied',
      original: 'nromal',
      replacement: 'normal',
      source: 'lexicon',
    });
  });

  it('applies surriunding through Process 3 and records its keyboard evidence', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'The surriunding area ');

    expect(field.value).toBe('The surrounding area ');
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.records[0]).toMatchObject({
      originalText: 'surriunding',
      replacementText: 'surrounding',
      correctionType: 'keyboard-proximity',
      autoApplied: true,
      keyboardSubstitution: {
        index: 4,
        typedCharacter: 'i',
        replacementCharacter: 'o',
        neighbourMapMatched: true,
        keyDistance: 1,
      },
    });
    expect(host.events[0]).toMatchObject({
      type: 'applied',
      original: 'surriunding',
      replacement: 'surrounding',
      source: 'lexicon',
    });
  });

  it('stores no surrounding context when the radius is zero', () => {
    const { field, controller } = setup('', { settings: { contextRadius: 0 } });
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(record.contextPreview).toBe('');
    expect(record.contextWords).toBeUndefined();
    expect(record.anchor.textBefore).toBe('');
    expect(record.anchor.textAfter).toBe('');
    expect(record.anchor.paragraphFingerprint).toBeUndefined();
    expect(record.anchor.sentenceFingerprint).toBeUndefined();
    expect(record.anchor.domPath).toBeUndefined();
  });

  it('scrubs existing stored context when privacy radius is changed to zero', () => {
    const { field, host, controller } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(record.anchor.paragraphFingerprint).toBeDefined();
    expect(record.contextPreview).not.toBe('');

    host.setSettings({ contextRadius: 0 });
    controller.refreshEligibility();
    expect(record.anchor.textBefore).toBe('');
    expect(record.anchor.textAfter).toBe('');
    expect(record.anchor.paragraphFingerprint).toBeUndefined();
    expect(record.anchor.sentenceFingerprint).toBeUndefined();
    expect(record.anchor.domPath).toBeUndefined();
    expect(record.contextPreview).toBe('');
    expect(record.contextWords).toBeUndefined();
  });

  it('marks a suggestion accepted by the user as not auto-applied', () => {
    const { field, host, controller } = setup('', {
      settings: { autocorrectThreshold: 0.99, suggestionThreshold: 0.5 },
    });
    let accept: (() => void) | undefined;
    (
      host.highlighter as unknown as {
        showSuggestion(
          getRects: () => DOMRect[],
          replacement: string,
          onAccept: () => void,
          onDismiss: () => void,
        ): void;
      }
    ).showSuggestion = (_getRects, _replacement, onAccept) => {
      accept = onAccept;
    };
    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think waht ');
    expect(controller.session.records).toHaveLength(0);
    expect(accept).toBeTypeOf('function');
    accept?.();
    expect(field.value).toBe('I think what ');
    expect(controller.session.records[0]!.autoApplied).toBe(false);
  });

  it('keeps the caret at the end of the typed text', () => {
    const { field } = setup();
    typeInto(field, 'I think waht ');
    expect(field.selectionStart).toBe(field.value.length);
  });

  it('corrects on punctuation and on Enter', () => {
    const { field, controller } = setup();
    typeInto(field, 'Ok teh.');
    expect(field.value).toBe('Ok the.');
    // After a full stop the next word starts a sentence, so it is capitalised.
    typeInto(field, ' becuase\n');
    expect(field.value).toBe('Ok the. Because\n');
    expect(controller.session.records).toHaveLength(2);
  });

  it('does not touch a word while it is still being typed', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht');
    expect(field.value).toBe('I think waht');
    expect(controller.session.records).toHaveLength(0);
  });

  it('preserves capitalisation', () => {
    const { field } = setup();
    typeInto(field, 'Waht now ');
    expect(field.value).toBe('What now ');
  });

  it('handles several corrections in one sentence', () => {
    const { field, controller } = setup();
    typeInto(field, 'teh cat adn teh dog ');
    // The first word starts the text, so the correction is capitalised.
    expect(field.value).toBe('The cat and the dog ');
    expect(controller.session.records).toHaveLength(3);
  });

  it('ignores pasted text', () => {
    const { field, controller } = setup();
    field.value = 'I think waht happened ';
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(inputEvent('insertFromPaste', null));
    expect(field.value).toBe('I think waht happened ');
    expect(controller.session.records).toHaveLength(0);
  });

  it('does nothing while an IME composition is active', () => {
    const { field, controller } = setup();
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    typeInto(field, 'waht ');
    expect(controller.session.records).toHaveLength(0);
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    typeInto(field, 'teh ');
    expect(field.value).toContain('the ');
  });

  it('re-checks every privacy gate before reading a dynamically changed field', () => {
    const cases: Array<{
      name: string;
      block(field: HTMLInputElement, host: TestHost): void;
    }> = [
      { name: 'global switch', block: (_field, host) => host.setSettings({ enabled: false }) },
      {
        name: 'site switch',
        block: (_field, host) =>
          host.setSettings({ siteOverrides: { 'https://example.com': 'off' } }),
      },
      {
        name: 'denylist',
        block: (_field, host) => host.setSettings({ denylist: [location.hostname] }),
      },
      { name: 'sensitive field', block: (field) => { field.type = 'password'; } },
    ];

    for (const testCase of cases) {
      const field = document.createElement('input');
      field.type = 'text';
      document.body.appendChild(field);
      const host = makeHost();
      const adapter = new InputAdapter(field);
      const controller = new EditableController(adapter, host);
      controller.attach();
      controllers.push(controller);
      const read = vi.spyOn(adapter, 'getText');
      read.mockClear();

      testCase.block(field, host);
      field.value = 'waht ';
      field.dispatchEvent(inputEvent('insertText', ' '));
      expect(read, testCase.name).not.toHaveBeenCalled();
      expect(controller.session.records, testCase.name).toHaveLength(0);
    }
  });

  it('does not read a field changed to password when Tab commits the word', () => {
    const field = document.createElement('input');
    field.type = 'text';
    document.body.appendChild(field);
    const host = makeHost();
    const adapter = new InputAdapter(field);
    const controller = new EditableController(adapter, host);
    controller.attach();
    controllers.push(controller);
    const read = vi.spyOn(adapter, 'getText');
    read.mockClear();

    field.type = 'password';
    field.value = 'waht';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(read).not.toHaveBeenCalled();
    expect(controller.session.records).toHaveLength(0);
  });

  it('does not read again if the host makes the field sensitive during our edit', () => {
    const field = document.createElement('input');
    field.type = 'text';
    field.value = 'I think waht ';
    document.body.appendChild(field);
    const host = makeHost();
    const adapter = new InputAdapter(field);
    const controller = new EditableController(adapter, host);
    controller.attach();
    controllers.push(controller);
    field.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.inputType === 'insertReplacementText') {
        field.type = 'password';
      }
    });
    const read = vi.spyOn(adapter, 'getText');
    read.mockClear();

    const outcome = controller.applyCorrection({
      proposal: {
        start: 8, end: 12, original: 'waht', replacement: 'what',
        correctionType: 'spelling', confidence: 0.99,
        action: 'autocorrect', reason: 'test',
      },
      context: {
        before: 'think', after: '', previousWord: 'think', nextWord: '',
        isSentenceStart: false, origin: 'https://example.com',
      },
    });

    expect(outcome.status).toBe('applied');
    // Exactly the pre-application verification read; no password-value read
    // after the host's synchronous input handler changes the field type.
    expect(read).toHaveBeenCalledTimes(1);
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.persistence).toBe('memory');
  });

  it('respects the personal dictionary', () => {
    const { field, controller, host } = setup();
    addToDictionary(host.data, 'waht');
    typeInto(field, 'I think waht ');
    expect(field.value).toBe('I think waht ');
    expect(controller.session.records).toHaveLength(0);
  });

  it('does not correct inside a URL', () => {
    const { field } = setup();
    typeInto(field, 'See https://x.com/teh ');
    expect(field.value).toBe('See https://x.com/teh ');
  });
});

describe('reverting', () => {
  it('restores the original word and records why', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think waht happened ');
    const record = controller.session.records[0]!;
    controller.session.updatedAt = 1;

    const result = controller.decide(record.id, 'revert');
    expect(result.ok).toBe(true);
    expect(field.value).toBe('I think waht happened ');
    expect(record.status).toBe('reverted');
    expect(record.rejectionReason).toBe('revert-once');
    expect(controller.session.updatedAt).toBeGreaterThan(1);
    expect(controller.session.textFingerprint).toBe(textFingerprint(field.value));
    expect(host.events.at(-1)).toMatchObject({ type: 'rejected', reason: 'revert-once' });
  });

  it('does not re-correct the word it just reverted', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    controller.decide(controller.session.records[0]!.id, 'revert');
    expect(field.value).toBe('I think waht ');
    // Typing another word must not resurrect the correction.
    typeInto(field, 'happened ');
    expect(field.value).toBe('I think waht happened ');
  });

  it('reverts only the intended one of two identical corrections', () => {
    const { field, controller } = setup();
    typeInto(field, 'I know waht you meant and I think waht happened ');
    expect(field.value).toBe('I know what you meant and I think what happened ');
    expect(controller.session.records).toHaveLength(2);

    const second = controller.session.records[1]!;
    expect(controller.decide(second.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('I know what you meant and I think waht happened ');
    expect(controller.session.records[0]!.status).toBe('pending');
  });

  it('refuses to revert when the text no longer contains the replacement', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;

    field.value = 'Completely different content now.';
    const result = controller.decide(record.id, 'revert');
    expect(result.ok).toBe(false);
    expect(record.status).toBe('unresolved');
    expect(record.failureReason).toBeTruthy();
    expect(field.value).toBe('Completely different content now.');
  });

  it('focuses the chosen ambiguous occurrence without changing text', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    field.value = 'what and what';
    record.anchor.textBefore = '';
    record.anchor.textAfter = '';
    record.anchor.approximateOffset = 0;
    record.anchor.occurrenceIndex = 0;
    delete record.anchor.paragraphFingerprint;
    delete record.anchor.sentenceFingerprint;

    expect(controller.resolveAmbiguous(record.id, 9, 13).ok).toBe(true);
    expect(field.value).toBe('what and what');
    expect(record.lastKnownRange).toEqual({ start: 9, end: 13 });
    expect(field.selectionStart).toBe(9);
    expect(field.selectionEnd).toBe(13);
    // The refreshed anchor makes a later explicit revert safe.
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('what and waht');
  });

  it('carries the rejection meaning into the learning event', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think waht ');
    controller.decide(controller.session.records[0]!.id, 'revert-never');
    expect(host.events.at(-1)).toMatchObject({ type: 'rejected', reason: 'never-this-pair' });
  });

  it('reverts a selected batch and reports failures', () => {
    const { field, controller } = setup();
    typeInto(field, 'teh cat adn teh dog ');
    const ids = controller.session.records.map((r) => r.id);
    const result = controller.revertSelected(ids);
    expect(result.ok).toBe(true);
    // Reverting restores exactly what the user typed. The correction itself
    // had capitalised "teh" to "The" at the sentence start, so undoing it must
    // give back the lower-case "teh" - not re-derive the case from "The".
    expect(field.value).toBe('teh cat adn teh dog ');
    expect(controller.counts().reverted).toBe(3);
  });
});

describe('accepting', () => {
  it('accepts one correction and learns from it', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'keep').ok).toBe(true);
    expect(record.status).toBe('accepted');
    expect(record.learningApplied).toBe(true);
    expect(host.events.at(-1)).toMatchObject({ type: 'accepted' });
    expect(field.value).toBe('I think what ');
  });

  it('does not learn twice when the same keep decision is retried', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'keep').ok).toBe(true);
    const eventsAfterFirstKeep = host.events.length;
    expect(controller.decide(record.id, 'keep').ok).toBe(true);
    expect(host.events).toHaveLength(eventsAfterFirstKeep);
  });

  it('keeps decision metadata honest when decision learning is disabled', () => {
    const accepted = setup('', { settings: { learnFromDecisions: false } });
    typeInto(accepted.field, 'I think waht ');
    const acceptedRecord = accepted.controller.session.records[0]!;
    expect(accepted.controller.decide(acceptedRecord.id, 'keep').ok).toBe(true);
    expect(acceptedRecord.learningApplied).toBe(false);
    expect(accepted.host.events.some((event) => event.type === 'accepted')).toBe(false);

    const reverted = setup('', { settings: { learnFromDecisions: false } });
    typeInto(reverted.field, 'I think waht ');
    const revertedRecord = reverted.controller.session.records[0]!;
    expect(reverted.controller.decide(revertedRecord.id, 'revert').ok).toBe(true);
    expect(revertedRecord.learningApplied).toBe(false);
    expect(reverted.host.events.some((event) => event.type === 'rejected')).toBe(false);
  });

  it('still applies an explicit never rule when general decision learning is disabled', () => {
    const { field, controller, host } = setup('', {
      settings: { learnFromDecisions: false },
    });
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert-never').ok).toBe(true);
    expect(record.learningApplied).toBe(true);
    expect(host.events.at(-1)).toMatchObject({
      type: 'rejected',
      reason: 'never-this-pair',
    });
  });

  it.each([
    ['revert-lower-confidence', 'lower-confidence'],
    ['revert-context', 'not-in-this-context'],
    ['revert-dictionary', 'never-correct-word'],
  ] as const)(
    'still applies the explicit %s action when general decision learning is disabled',
    (decision, reason) => {
      const { field, controller, host } = setup('', {
        settings: { learnFromDecisions: false },
      });
      typeInto(field, 'I think waht ');
      const record = controller.session.records[0]!;
      expect(controller.decide(record.id, decision).ok).toBe(true);
      expect(record.learningApplied).toBe(true);
      expect(host.events.at(-1)).toMatchObject({ type: 'rejected', reason });
    },
  );

  it('does not accept a reverted record without reapplying its replacement', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(controller.decide(record.id, 'keep').ok).toBe(false);
    expect(record.status).toBe('reverted');
    expect(field.value).toContain('waht');
  });

  it('keeps without learning when asked', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think waht ');
    const before = host.events.length;
    controller.decide(controller.session.records[0]!.id, 'keep-no-learn');
    expect(controller.session.records[0]!.status).toBe('accepted');
    expect(host.events.length).toBe(before);
  });

  it('accepts everything pending at once', () => {
    const { field, controller } = setup();
    typeInto(field, 'teh cat adn teh dog ');
    const result = controller.acceptAll();
    expect(result.ok).toBe(true);
    expect(controller.counts()).toMatchObject({ pending: 0, accepted: 3 });
  });
});

describe('guided review of a long document', () => {
  function longDocument(host: TestHost, field: HTMLTextAreaElement, controller: EditableController) {
    // ~1,000 words of filler with fifteen typos sprinkled through it.
    const filler = 'the quick brown fox jumps over the lazy dog '.repeat(20);
    let typed = '';
    for (let i = 0; i < 15; i++) {
      typed += `${filler}I think waht happened ${i} was fine. `;
    }
    field.value = '';
    field.setSelectionRange(0, 0);
    // Type only the parts that matter, seeding the rest directly.
    for (let i = 0; i < 15; i++) {
      field.value += `${filler}I think `;
      field.setSelectionRange(field.value.length, field.value.length);
      typeInto(field, 'waht ');
      field.value += `happened ${i} was fine. `;
      field.setSelectionRange(field.value.length, field.value.length);
    }
    expect(controller.session.records).toHaveLength(15);
    expect(host.events.filter((e) => e.type === 'applied')).toHaveLength(15);
    return typed;
  }

  it('walks all fifteen corrections with progress tracking', () => {
    const { field, host, controller } = setup();
    longDocument(host, field, controller);

    expect(controller.beginReview().ok).toBe(true);
    expect(controller.reviewState()).toMatchObject({ active: true, position: 1, total: 15 });

    // Keep the first, revert the second, skip the third.
    const first = controller.reviewState()!.currentId!;
    controller.decide(first, 'keep');
    controller.reviewNext();
    const second = controller.reviewState()!.currentId!;
    controller.decide(second, 'revert');
    controller.reviewNext();
    const third = controller.reviewState()!.currentId!;
    controller.decide(third, 'skip');

    expect(controller.reviewState()!.position).toBe(3);
    const counts = controller.counts();
    expect(counts.total).toBe(15);
    expect(counts.accepted).toBe(1);
    expect(counts.reverted).toBe(1);
    expect(counts.pending).toBe(13);
  });

  it('reverts the right occurrence deep inside the document', () => {
    const { field, host, controller } = setup();
    longDocument(host, field, controller);

    const target = controller.session.records[9]!;
    expect(controller.decide(target.id, 'revert').ok).toBe(true);
    // Exactly one "waht" is back, and it is the tenth block.
    expect(field.value.match(/waht/g)).toHaveLength(1);
    expect(field.value).toContain('I think waht happened 9');
  });

  it('exits review and clears its state', () => {
    const { field, host, controller } = setup();
    longDocument(host, field, controller);
    controller.beginReview();
    controller.exitReview();
    expect(controller.reviewState()).toBeNull();
  });

  it('does not advance the in-page review card when its decision fails', () => {
    const { field, host, controller } = setup();
    typeInto(field, 'I think waht ');
    let onAction: ((id: string) => void) | undefined;
    (
      host.highlighter as unknown as {
        showCard(spec: { onAction(id: string): void }): void;
      }
    ).showCard = (spec) => {
      onAction = spec.onAction;
    };
    expect(controller.beginReview().ok).toBe(true);
    const current = controller.reviewState()!.currentId;
    field.value = 'The target is gone.';
    onAction?.('revert');
    expect(controller.reviewState()!.currentId).toBe(current);
  });

  it('refuses to start a review when nothing is pending', () => {
    const { controller } = setup();
    expect(controller.beginReview().ok).toBe(false);
  });
});

describe('text edited after a correction', () => {
  it('marks a record superseded when the user restores the original by hand', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const record = controller.session.records[0]!;

    field.value = field.value.replace('what', 'waht');
    controller.relocateAll();
    expect(record.status).toBe('superseded');
  });

  it('marks a record unresolved when its text disappears', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const record = controller.session.records[0]!;

    field.value = 'An entirely different sentence.';
    controller.relocateAll();
    expect(record.status).toBe('unresolved');
    expect(record.lastKnownRange).toBeUndefined();
  });

  it('recovers a record when the text comes back', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const record = controller.session.records[0]!;
    field.value = 'gone';
    controller.relocateAll();
    expect(record.status).toBe('unresolved');

    field.value = 'I think what happened ';
    controller.relocateAll();
    expect(record.status).toBe('pending');
    expect(record.lastKnownRange).toEqual({ start: 8, end: 12 });
  });

  it('keeps working when text is inserted above the correction', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const record = controller.session.records[0]!;

    field.value = `A new opening paragraph.\n\n${field.value}`;
    controller.relocateAll();
    expect(record.status).toBe('pending');
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('A new opening paragraph.\n\nI think waht happened ');
  });
});

describe('session management', () => {
  it('clears the history without touching the text', () => {
    const { field, controller } = setup();
    typeInto(field, 'teh cat ');
    expect(controller.session.records).toHaveLength(1);
    controller.clearHistory();
    expect(controller.session.records).toHaveLength(0);
    expect(field.value).toBe('The cat ');
  });

  it('adopts a restored session and re-validates its anchors', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const stored = structuredClone(controller.session);
    field.remove();

    const second = setup('I think what happened ');
    second.controller.adoptSession(stored);
    expect(second.controller.session.records).toHaveLength(1);
    expect(second.controller.session.records[0]!.status).toBe('pending');
    expect(field.value).toBe('I think what happened ');
  });

  it('marks restored records unresolved when the document changed completely', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht happened ');
    const stored = structuredClone(controller.session);
    field.remove();

    const second = setup('A totally unrelated document body.');
    second.controller.adoptSession(stored);
    expect(second.controller.session.records[0]!.status).toBe('unresolved');
  });

  it('does not trust a coincidental word from mismatched context-free history', () => {
    const first = setup('', { settings: { contextRadius: 0 } });
    typeInto(first.field, 'I think waht happened ');
    const stored = structuredClone(first.controller.session);
    first.field.remove();

    // The new document happens to contain the old replacement once. With a
    // privacy-minimal anchor there is no surrounding evidence that it is the
    // same occurrence, so reverting must not turn this unrelated "what" into
    // the old typo.
    const second = setup('what', { settings: { contextRadius: 0 } });
    expect(second.controller.adoptSession(stored)).toBe(true);
    const record = second.controller.session.records[0]!;

    expect(record.status).toBe('unresolved');
    expect(record.lastKnownRange).toBeUndefined();
    expect(second.controller.decide(record.id, 'revert').ok).toBe(false);
    expect(second.field.value).toBe('what');
  });

  it('merges corrections made while an asynchronous restore was in flight', () => {
    const first = setup();
    typeInto(first.field, 'I think waht happened ');
    const stored = structuredClone(first.controller.session);
    first.field.remove();

    const second = setup('I think what happened and ');
    typeInto(second.field, 'teh ');
    const localId = second.controller.session.records[0]!.id;
    expect(second.controller.adoptSession(stored)).toBe(true);
    expect(second.controller.session.records).toHaveLength(2);
    expect(second.controller.session.records.some((record) => record.id === localId)).toBe(true);
  });

  it('rejects a restored session with a different identity', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think waht ');
    const stored = structuredClone(controller.session);
    stored.id = 's_different';
    expect(controller.adoptSession(stored)).toBe(false);
    expect(controller.session.records).toHaveLength(1);
  });
});

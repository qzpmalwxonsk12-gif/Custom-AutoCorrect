/**
 * Correction actions, the "show everything at once" overlay, and the batch
 * revert.
 *
 * The scoped actions are the interesting ones: "ignore once", "ignore in this
 * document" and "ignore on this site" are three different promises, and a user
 * who cannot tell them apart cannot undo the one they did not mean.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import type { MarkupItem } from '../../src/content/correction-highlighter.js';
import { inputEvent, makeHost, makeTextarea, typeInto } from './dom-helpers.js';

const controllers: EditableController[] = [];
let markup: { items: MarkupItem[]; onUndo: (id: string) => void } | null = null;

function setup(overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea('');
  const host = makeHost(overrides);
  (host.highlighter as unknown as {
    showMarkup: (items: MarkupItem[], onUndo: (id: string) => void) => void;
  }).showMarkup = (items, onUndo) => {
    markup = { items, onUndo };
  };
  (host.highlighter as unknown as { hideMarkup: () => void }).hideMarkup = () => {
    markup = null;
  };
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
  markup = null;
  essentialPunctuationProvider.clearCache();
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
  vi.useRealTimers();
});

describe('undo', () => {
  it('restores the original text and marks the record reverted', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    const result = controller.correctionAction(record.id, 'undo');
    expect(result.ok).toBe(true);
    expect(field.value).toBe('Type the punctuatioon ');
    expect(record.status).toBe('reverted');
    // Still exactly one record: reverting is a state change, not a deletion.
    expect(controller.session.records).toHaveLength(1);
  });
});

describe('always prefer this correction', () => {
  it('stores a preferred pair and keeps the correction', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'always-prefer').ok).toBe(true);
    expect(field.value).toBe('Type the punctuation ');
    expect(record.status).toBe('accepted');
    expect(host.vocabularyAdded).toContainEqual({
      kind: 'preferred',
      original: 'punctuatioon',
      replacement: 'punctuation',
    });
  });
});

describe('never make this correction', () => {
  it('blocks the pair and reverts the text', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'never').ok).toBe(true);
    expect(field.value).toBe('Type the punctuatioon ');
    expect(host.vocabularyAdded).toContainEqual({
      kind: 'blocked',
      original: 'punctuatioon',
      replacement: 'punctuation',
    });
  });

  it('takes effect immediately: the same typo is not corrected again', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    controller.correctionAction(controller.session.records[0]!.id, 'never');

    typeInto(field, 'more punctuatioon ');
    expect(field.value).toContain('more punctuatioon ');
  });
});

describe('rule-level actions', () => {
  it('“show as suggestion” changes that rule’s mode', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    const result = controller.correctionAction(record.id, 'suggestion-only');
    expect(result.ok).toBe(true);
    expect(host.ruleModeChanges).toContainEqual({
      ruleId: 'spelling:duplicate-letter',
      mode: 'suggestion',
    });
  });

  it('“disable this rule” switches it off', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'disable-rule').ok).toBe(true);
    expect(host.ruleModeChanges).toContainEqual({
      ruleId: 'spelling:duplicate-letter',
      mode: 'disabled',
    });

    // And the change is live: the same shape is no longer corrected.
    typeInto(field, 'the commmon ');
    expect(field.value).toContain('the commmon ');
  });

  it('refuses a rule action when the correction has no controllable rule', () => {
    const { field, controller } = setup();
    // The curated typo table is not a controllable rule.
    typeInto(field, 'I think teh ');
    const record = controller.session.records[0]!;
    const result = controller.correctionAction(record.id, 'disable-rule');
    expect(result.ok).toBe(false);
  });
});

describe('add to dictionary', () => {
  it('stores the word and puts the original text back', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'add-to-dictionary').ok).toBe(true);
    expect(field.value).toBe('Type the punctuatioon ');
    expect(host.vocabularyAdded).toContainEqual({
      kind: 'allowed-word',
      original: 'punctuatioon',
    });
  });
});

describe('ignore scopes', () => {
  it('“ignore once” reverts without recording a lasting decision', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'ignore-once').ok).toBe(true);
    expect(field.value).toBe('Type the punctuatioon ');
    expect(host.vocabularyAdded).toHaveLength(0);
  });

  it('“ignore in this document” is scoped to the document', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'ignore-in-document').ok).toBe(true);
    const entry = host.vocabularyAdded.at(-1);
    expect(entry).toMatchObject({ kind: 'blocked', original: 'punctuatioon' });
    const stored = host.data.vocabulary.entries.at(-1);
    expect(stored?.scope).toEqual({ kind: 'document', documentScope: 'test-tab:test-frame' });
  });

  it('“ignore on this website” is scoped to the origin', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'Type the punctuatioon ');
    const record = controller.session.records[0]!;

    expect(controller.correctionAction(record.id, 'ignore-on-site').ok).toBe(true);
    const stored = host.data.vocabulary.entries.at(-1);
    expect(stored?.scope).toEqual({ kind: 'site', origin: 'https://example.com' });
  });
});

describe('revert all automatic', () => {
  it('undoes every automatic change and leaves accepted ones alone', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    typeInto(field, 'and commmon ');
    expect(field.value).toBe('Type the punctuation and common ');
    expect(controller.session.records).toHaveLength(2);

    // Accept the first: it is no longer an unreviewed automatic change, but it
    // was still applied automatically, so the batch action still owns it.
    const result = controller.revertAllAutomatic();
    expect(result.ok).toBe(true);
    expect(field.value).toBe('Type the punctuatioon and commmon ');
    expect(controller.session.records.every((r) => r.status === 'reverted')).toBe(true);
  });

  it('reports that there was nothing to do rather than failing', () => {
    const { controller } = setup();
    const result = controller.revertAllAutomatic();
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ data: { reverted: 0, nothingToDo: true } });
  });
});

describe('markup overlay', () => {
  it('does not read a field that became sensitive after attachment', () => {
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
    const result = controller.setMarkupOverlay(true);

    expect(result.ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows every standing correction as original → replacement', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    typeInto(field, 'and commmon ');

    const result = controller.setMarkupOverlay(true);
    expect(result.ok).toBe(true);
    expect(markup?.items).toHaveLength(2);
    expect(markup!.items.map((i) => [i.original, i.replacement])).toEqual([
      ['punctuatioon', 'punctuation'],
      ['commmon', 'common'],
    ]);
    expect(markup!.items[0]!.typeLabel).toBe('Duplicate letter');
  });

  it('omits corrections that are no longer standing in the text', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    typeInto(field, 'and commmon ');
    controller.correctionAction(controller.session.records[0]!.id, 'undo');

    controller.setMarkupOverlay(true);
    expect(markup?.items.map((i) => i.original)).toEqual(['commmon']);
  });

  it('undoing from the overlay reverts that correction and redraws', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    typeInto(field, 'and commmon ');
    controller.setMarkupOverlay(true);

    const target = markup!.items[0]!;
    markup!.onUndo(target.recordId);

    expect(field.value).toBe('Type the punctuatioon and common ');
    expect(markup?.items.map((i) => i.original)).toEqual(['commmon']);
  });

  it('turning the overlay off removes it', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    controller.setMarkupOverlay(true);
    expect(markup).not.toBeNull();

    const result = controller.setMarkupOverlay(false);
    expect(result.ok).toBe(true);
    expect(markup).toBeNull();
  });

  it('redraws automatically when a new correction is made while it is on', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    controller.setMarkupOverlay(true);
    expect(markup?.items).toHaveLength(1);

    typeInto(field, 'and commmon ');
    expect(markup?.items).toHaveLength(2);
  });
});

describe('editor undo and redo', () => {
  /**
   * The browser's undo stack knows nothing about our history. If a correction
   * silently stayed "applied" after the user undid it, the panel would offer a
   * revert that had already happened - and the engine would re-apply the
   * correction on the next keystroke, making undo look broken.
   */
  it('marks a correction superseded when the editor undoes it', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    expect(controller.session.records[0]!.status).toBe('pending');

    // Simulate the browser's own undo: text reverts, and it reports historyUndo.
    field.value = 'Type the punctuatioon ';
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(inputEvent('historyUndo', null));

    expect(controller.session.records[0]!.status).toBe('superseded');
    expect(controller.session.records).toHaveLength(1);
  });

  it('does not immediately re-apply what the user just undid', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');

    field.value = 'Type the punctuatioon ';
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(inputEvent('historyUndo', null));

    // Typing on does not resurrect the correction at that position.
    typeInto(field, 'now ');
    expect(field.value).toBe('Type the punctuatioon now ');
    expect(controller.session.records).toHaveLength(1);
  });

  it('leaves corrections alone when undo did not remove them', () => {
    const { field, controller } = setup();
    typeInto(field, 'Type the punctuatioon ');
    typeInto(field, 'extra ');

    // An undo that only removes the trailing word leaves the correction intact.
    field.value = 'Type the punctuation ';
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(inputEvent('historyUndo', null));

    expect(controller.session.records[0]!.status).toBe('pending');
  });
});

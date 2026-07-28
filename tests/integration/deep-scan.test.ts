/**
 * The whole-field sweep, repeated words, capitalisation, and the list-comma
 * fix - driven end to end through the real controller.
 *
 * The passage in these tests is the one that exposed all four gaps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { makeHost, makeTextarea, typeInto } from './dom-helpers.js';

const controllers: EditableController[] = [];

function setup(overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea('');
  const host = makeHost(overrides);
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

/** Runs the sweep to completion, with a hard bound so a bug cannot hang. */
async function sweepToCompletion(max = 400): Promise<void> {
  for (let i = 0; i < max; i++) {
    await vi.advanceTimersByTimeAsync(40);
  }
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

describe('repeated words', () => {
  it('removes a word typed twice while typing', () => {
    const { field, controller } = setup();
    typeInto(field, 'What what ');
    expect(field.value).toBe('What ');
    expect(controller.session.records).toHaveLength(1);
    expect(controller.session.records[0]!.correctionType).toBe('repeated-word');
  });

  it('keeps the first copy, so sentence capitalisation survives', () => {
    const { field } = setup();
    typeInto(field, 'The the cat ');
    expect(field.value).toBe('The cat ');
  });

  it('leaves legitimate doubles alone', () => {
    for (const phrase of ['I had had enough ', 'He said that that was wrong ']) {
      const { field } = setup();
      typeInto(field, phrase);
      expect(field.value, phrase).toBe(phrase);
    }
  });

  it('does not join words separated by punctuation', () => {
    const { field } = setup();
    typeInto(field, 'New York, New York ');
    expect(field.value).toBe('New York, New York ');
  });

  it('is reversible like any other correction', () => {
    const { field, controller } = setup();
    typeInto(field, 'What what ');
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe('What what ');
  });

  it('can be switched off by its rule mode', () => {
    const { field } = setup({ settings: { ruleModes: { 'text:repeated-word': 'disabled' } } });
    typeInto(field, 'What what ');
    expect(field.value).toBe('What what ');
  });
});

describe('capitalisation', () => {
  it('capitalises the pronoun i', () => {
    const { field, controller } = setup();
    typeInto(field, 'what if i ');
    // Both fixes are correct: "what" opens the field, so it is a sentence start.
    expect(field.value).toBe('What if I ');
    expect(
      controller.session.records.every((r) => r.correctionType === 'capitalisation'),
    ).toBe(true);
  });

  it('capitalises the first word of a sentence', () => {
    const { field } = setup();
    typeInto(field, 'Hello. there ');
    expect(field.value).toBe('Hello. There ');
  });

  it('does not capitalise after an abbreviation', () => {
    const { field } = setup();
    typeInto(field, 'Meet Dr. smith ');
    expect(field.value).toBe('Meet Dr. smith ');
  });

  it('leaves deliberate lower-case styles alone', () => {
    const { field } = setup();
    // Mixed case is a style decision, not a mistake.
    typeInto(field, 'The iPhone ');
    expect(field.value).toBe('The iPhone ');
  });

  it('can be switched off by its rule mode', () => {
    const { field } = setup({ settings: { ruleModes: { 'text:capitalisation': 'disabled' } } });
    typeInto(field, 'what if i ');
    expect(field.value).toBe('what if i ');
  });
});

describe('list commas without a verb', () => {
  it('punctuates a bare list fragment', async () => {
    const { field } = setup();
    typeInto(field, 'apples oranges bananas and grapes. ');
    await vi.advanceTimersByTimeAsync(900);
    // One issue is applied per idle pass, so let the lane chain to the end.
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(900);
    // "apples" opens the field, so it is also capitalised.
    expect(field.value).toBe('Apples, oranges, bananas, and grapes. ');
  });

  it('still refuses the shapes the verb boundary protects', async () => {
    for (const phrase of [
      'The cache stores keys and values. ',
      'I bought fish and chips. ',
      'I like peanut butter and jelly. ',
    ]) {
      const { field } = setup();
      typeInto(field, phrase);
      for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(900);
      expect(field.value, phrase).toBe(phrase);
    }
  });
});

describe('whole-field scan', () => {
  it('fixes mistakes in text the caret never visited', async () => {
    const { field, controller } = setup();
    // Text arrives whole, as if pasted: the per-keystroke path never sees it.
    field.value = 'I think teh cat adn teh dog.';
    field.setSelectionRange(0, 0);

    expect(controller.scanField(true).ok).toBe(true);
    await sweepToCompletion();

    expect(field.value).toBe('I think the cat and the dog.');
    expect(controller.session.records).toHaveLength(3);
  });

  it('clears several repeated words in one passage', async () => {
    const { field, controller } = setup();
    field.value = 'What what are you you doing? Dam dam what if if was here.';
    field.setSelectionRange(0, 0);

    expect(controller.scanField(true).ok).toBe(true);
    await sweepToCompletion();

    expect(field.value).toBe('What are you doing? Dam what if was here.');
  });

  it('reports how much there is to check', () => {
    const { field, controller } = setup();
    field.value = 'One sentence here. Another sentence here. A third one.';
    const result = controller.scanField(true);
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ data: { total: 3, done: 0 } });
  });

  it('does nothing when the field is clean', async () => {
    const { field, controller } = setup();
    field.value = 'The cat sat on the mat.';
    controller.scanField(true);
    await sweepToCompletion(40);
    expect(field.value).toBe('The cat sat on the mat.');
    expect(controller.session.records).toHaveLength(0);
  });
});

describe('incremental re-scanning', () => {
  /**
   * The point of the pass bookkeeping: adding text must not re-scan text that
   * has already been checked.
   */
  it('only scans sentences it has not already completed', async () => {
    const { field, controller } = setup({ settings: { deepScanPasses: 3 } });
    field.value = 'The cat sat on the mat. The dog sat on the rug.';
    controller.scanField(true);
    await sweepToCompletion(60);

    let progress = controller.scanField(false);
    expect(progress).toMatchObject({ data: { done: 2, total: 2 } });

    // Append a third sentence: the first two keep their completed passes.
    field.value += ' A bird sat on the wire.';
    progress = controller.scanField(false);
    expect(progress).toMatchObject({ data: { done: 2, total: 3 } });
  });

  it('re-queues a sentence that was edited', async () => {
    const { field, controller } = setup();
    field.value = 'The cat sat on the mat. The dog sat on the rug.';
    controller.scanField(true);
    await sweepToCompletion(60);
    expect(controller.scanField(false)).toMatchObject({ data: { done: 2, total: 2 } });

    // Editing the first sentence changes its fingerprint, so it comes back.
    field.value = 'The cat sat on the floor. The dog sat on the rug.';
    expect(controller.scanField(false)).toMatchObject({ data: { done: 1, total: 2 } });
  });

  it('“Check whole text” forces everything to be looked at again', async () => {
    const { field, controller } = setup();
    field.value = 'The cat sat on the mat. The dog sat on the rug.';
    controller.scanField(true);
    await sweepToCompletion(60);
    expect(controller.scanField(false)).toMatchObject({ data: { done: 2, total: 2 } });

    expect(controller.scanField(true)).toMatchObject({ data: { done: 0, total: 2 } });
  });
});

describe('scanning a selection', () => {
  it('reports that it is working on the selection', () => {
    const { field, controller } = setup();
    field.value = 'One here. I think teh cat. Three here.';
    field.setSelectionRange(10, 25);

    const result = controller.scanField(true, true);
    expect(result).toMatchObject({ data: { selection: true } });
  });

  it('fixes the selected sentence before the rest of the field', async () => {
    const { field, controller } = setup();
    field.value = 'I think teh cat. And teh dog.';
    // Select only the second sentence.
    field.setSelectionRange(17, 28);

    controller.scanField(true, true);
    // One tick is enough to reach the prioritised chunk.
    await vi.advanceTimersByTimeAsync(40);
    expect(field.value).toBe('I think teh cat. And the dog.');
  });

  it('still checks the rest of the field afterwards', async () => {
    const { field, controller } = setup();
    field.value = 'I think teh cat. And teh dog.';
    field.setSelectionRange(17, 28);

    controller.scanField(true, true);
    await sweepToCompletion();
    expect(field.value).toBe('I think the cat. And the dog.');
  });

  it('falls back to the whole field when nothing is selected', () => {
    const { field, controller } = setup();
    field.value = 'One here. Two here.';
    field.setSelectionRange(5, 5);

    const result = controller.scanField(true, true);
    expect(result).toMatchObject({ data: { selection: false, total: 2 } });
  });
});

describe('background scanning', () => {
  it('runs on idle only when the toggle is on', async () => {
    const off = setup({ settings: { deepScanEnabled: false } });
    off.field.value = 'I think teh cat.';
    off.field.setSelectionRange(0, 0);
    typeInto(off.field, ' ');
    await sweepToCompletion(60);
    expect(off.field.value).toContain('teh');

    const on = setup({ settings: { deepScanEnabled: true } });
    on.field.value = 'I think teh cat.';
    on.field.setSelectionRange(0, 0);
    typeInto(on.field, ' ');
    await sweepToCompletion(60);
    expect(on.field.value).toContain('the cat');
  });
});

describe('chained corrections at the caret', () => {
  /**
   * The regression the user found: fixing one mistake can create another.
   * "waht" beside an existing "what" becomes a repeated word that did not
   * exist a moment earlier - and because our own edit is bracketed by
   * `applying`, no input event arrives to prompt a second look.
   */
  it('fixes a repeat that its own spelling correction created', () => {
    const { field, controller } = setup();
    typeInto(field, 'what waht ');
    expect(field.value).toBe('What ');
    // Three separate reversible records: the typo, the repeat, the capital.
    expect(controller.session.records).toHaveLength(3);
  });

  it('works in the other order too', () => {
    const { field } = setup();
    typeInto(field, 'waht what ');
    expect(field.value).toBe('What ');
  });

  it('removes a repeated single letter', () => {
    const { field } = setup();
    // "i" is one character, which the spelling engine ignores by design; that
    // floor must not hide a duplicate.
    typeInto(field, 'what if i i was here ');
    expect(field.value).toBe('What if I was here ');
  });

  it('handles the whole passage that exposed these gaps', () => {
    const { field } = setup();
    typeInto(field, 'Dam dam what if if i i was here ');
    expect(field.value).toBe('Dam what if I was here ');
  });

  it('terminates instead of looping when a chip is offered', () => {
    const { field, controller } = setup();
    // A suggestion changes no text, so the round loop stops immediately.
    typeInto(field, 'Please iprove ');
    expect(field.value).toBe('Please iprove ');
    expect(controller.session.records).toHaveLength(0);
  });

  it('does not re-correct its own output in a loop', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think the ');
    expect(controller.session.records).toHaveLength(1);
  });
});

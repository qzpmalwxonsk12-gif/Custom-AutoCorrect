import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { computeFieldId } from '../../src/content/adapter.js';
import { makeTextarea } from './dom-helpers.js';

afterEach(() => {
  document.body.textContent = '';
});

describe('InputAdapter', () => {
  it('reads text and caret', () => {
    const field = makeTextarea('I think waht happened');
    field.setSelectionRange(12, 12);
    const adapter = new InputAdapter(field);
    expect(adapter.kind).toBe('textarea');
    expect(adapter.getText()).toBe('I think waht happened');
    expect(adapter.getCaret()).toEqual({ start: 12, end: 12 });
  });

  it('replaces a range, fires input, and does not synthesize a premature change event', () => {
    const field = makeTextarea('I think waht happened');
    const adapter = new InputAdapter(field);
    const seen: string[] = [];
    let changes = 0;
    field.addEventListener('input', (e) => seen.push((e as InputEvent).inputType ?? ''));
    field.addEventListener('change', () => changes++);

    expect(adapter.replaceRange(8, 12, 'what')).toBe(true);
    expect(field.value).toBe('I think what happened');
    expect(seen.length).toBeGreaterThan(0);
    expect(changes).toBe(0);
  });

  it('writes through the prototype setter so frameworks notice', () => {
    const field = makeTextarea('teh end');
    const adapter = new InputAdapter(field);
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set');
    adapter.replaceRange(0, 3, 'the');
    expect(spy).toHaveBeenCalled();
    expect(field.value).toBe('the end');
    spy.mockRestore();
  });

  it('rejects out-of-bounds ranges instead of corrupting the text', () => {
    const field = makeTextarea('short');
    const adapter = new InputAdapter(field);
    expect(adapter.replaceRange(0, 99, 'x')).toBe(false);
    expect(adapter.replaceRange(4, 2, 'x')).toBe(false);
    expect(field.value).toBe('short');
  });

  it('restores the caret after a replacement', () => {
    const field = makeTextarea('I think waht happened');
    field.setSelectionRange(21, 21);
    const adapter = new InputAdapter(field);
    adapter.replaceRange(8, 12, 'what');
    adapter.setCaret(21, 21);
    expect(adapter.getCaret()).toEqual({ start: 21, end: 21 });
  });

  it('handles a single-line input as well', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'teh';
    document.body.appendChild(input);
    const adapter = new InputAdapter(input);
    expect(adapter.kind).toBe('input');
    expect(adapter.replaceRange(0, 3, 'the')).toBe(true);
    expect(input.value).toBe('the');
  });

  it('reports disconnection', () => {
    const field = makeTextarea('x');
    const adapter = new InputAdapter(field);
    expect(adapter.isConnected()).toBe(true);
    field.remove();
    expect(adapter.isConnected()).toBe(false);
  });

  it('returns no rects rather than throwing when layout is unavailable', () => {
    const field = makeTextarea('some text');
    const adapter = new InputAdapter(field);
    expect(Array.isArray(adapter.rectsFor(0, 4))).toBe(true);
  });
});

describe('computeFieldId', () => {
  it('is stable for the same element', () => {
    const field = makeTextarea('x');
    field.name = 'body';
    expect(computeFieldId(field)).toBe(computeFieldId(field));
  });

  it('differs between distinct fields', () => {
    const a = makeTextarea('x');
    a.name = 'subject';
    const b = makeTextarea('y');
    b.name = 'body';
    expect(computeFieldId(a)).not.toBe(computeFieldId(b));
  });
});

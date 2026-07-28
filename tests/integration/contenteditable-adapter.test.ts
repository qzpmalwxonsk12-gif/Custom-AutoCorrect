import { afterEach, describe, expect, it } from 'vitest';
import { ContentEditableAdapter } from '../../src/content/contenteditable-adapter.js';
import { makeContentEditable } from './dom-helpers.js';

afterEach(() => {
  document.body.textContent = '';
});

describe('plain-text projection', () => {
  it('flattens inline markup', () => {
    const el = makeContentEditable('I <b>think</b> waht happened');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('I think waht happened');
    adapter.dispose();
  });

  it('inserts newlines between block elements', () => {
    const el = makeContentEditable('<p>First line</p><p>Second line</p>');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('First line\nSecond line\n');
    adapter.dispose();
  });

  it('treats <br> as a newline', () => {
    const el = makeContentEditable('one<br>two');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('one\ntwo');
    adapter.dispose();
  });

  it('skips script and style content', () => {
    const el = makeContentEditable('text<script>var x = 1;</script><style>a{}</style>');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('text');
    adapter.dispose();
  });

  it('skips the extension’s own UI nodes', () => {
    const el = makeContentEditable('visible');
    const ours = document.createElement('span');
    ours.setAttribute('data-personal-autocorrect-ui', 'overlay');
    ours.textContent = 'INTERNAL';
    el.appendChild(ours);
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('visible');
    adapter.dispose();
  });

  it('re-reads text synchronously after the DOM changes', () => {
    const el = makeContentEditable('one');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('one');
    el.append(document.createTextNode(' two'));
    // A controller can read during the same input task, before the observer
    // callback's microtask. Queued records must invalidate the cache now.
    expect(adapter.getText()).toBe('one two');
    adapter.dispose();
  });

  it('re-reads character data and caret synchronously in an input event', () => {
    const el = makeContentEditable('teh');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('teh');
    const node = el.firstChild as Text;
    node.data = 'teh ';
    const range = document.createRange();
    range.setStart(node, 4);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
    expect(adapter.getText()).toBe('teh ');
    expect(adapter.getCaret()).toEqual({ start: 4, end: 4 });
    adapter.dispose();
  });
});

describe('offset mapping and editing', () => {
  it('replaces a range spanning a single text node', () => {
    const el = makeContentEditable('I think waht happened');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.replaceRange(8, 12, 'what')).toBe(true);
    expect(adapter.getText()).toBe('I think what happened');
    adapter.dispose();
  });

  it('replaces inside a nested element', () => {
    const el = makeContentEditable('<p>Hello <em>teh</em> world</p>');
    const adapter = new ContentEditableAdapter(el);
    const start = adapter.getText().indexOf('teh');
    expect(adapter.replaceRange(start, start + 3, 'the')).toBe(true);
    expect(adapter.getText()).toContain('Hello the world');
    adapter.dispose();
  });

  it('emits an input event so the host editor can react', () => {
    const el = makeContentEditable('teh end');
    const adapter = new ContentEditableAdapter(el);
    let seen = 0;
    el.addEventListener('input', () => seen++);
    adapter.replaceRange(0, 3, 'the');
    expect(seen).toBeGreaterThan(0);
    adapter.dispose();
  });

  it('reports the caret position in plain-text offsets', () => {
    const el = makeContentEditable('<p>First</p><p>Second</p>');
    const adapter = new ContentEditableAdapter(el);
    const text = adapter.getText();
    const target = text.indexOf('Second');
    adapter.setCaret(target, target + 6);
    expect(adapter.getCaret()).toEqual({ start: target, end: target + 6 });
    adapter.dispose();
  });

  it('maps native element-boundary carets to the corresponding projected boundary', () => {
    const el = makeContentEditable('<p>First</p><p>Second</p>');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('First\nSecond\n');
    const range = document.createRange();
    range.setStart(el, el.childNodes.length);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(adapter.getCaret()).toEqual({ start: 13, end: 13 });
    adapter.dispose();
  });

  it('fails safely on an empty editor', () => {
    const el = makeContentEditable('');
    const adapter = new ContentEditableAdapter(el);
    expect(adapter.getText()).toBe('');
    expect(adapter.replaceRange(0, 0, 'x')).toBe(false);
    expect(adapter.rectsFor(0, 1)).toEqual([]);
    adapter.dispose();
  });

  it('stops observing after dispose', () => {
    const el = makeContentEditable('text');
    const adapter = new ContentEditableAdapter(el);
    adapter.dispose();
    expect(adapter.getText()).toBe('');
  });
});

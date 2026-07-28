import { afterEach, describe, expect, it } from 'vitest';
import { describeField, fieldKindOf, guardField, isDenied, isSensitiveField } from '../../src/content/field-guard.js';
import { settings } from '../helpers.js';

afterEach(() => {
  document.body.textContent = '';
});

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

describe('field kinds', () => {
  it('accepts text inputs, search inputs and textareas', () => {
    expect(fieldKindOf(input({ type: 'text' }))).toBe('input');
    expect(fieldKindOf(input({ type: 'search' }))).toBe('input');
    expect(fieldKindOf(document.createElement('textarea'))).toBe('textarea');
  });

  it('rejects every other input type', () => {
    for (const type of ['password', 'email', 'tel', 'number', 'date', 'url', 'checkbox']) {
      expect(fieldKindOf(input({ type })), type).toBeNull();
    }
  });
});

describe('sensitive-field detection', () => {
  it('never processes password fields', () => {
    const el = input({ type: 'password' });
    expect(isSensitiveField(el)).toContain('password');
    expect(guardField(el, settings()).allowed).toBe(false);
  });

  it('never processes payment fields', () => {
    const cases: Record<string, string>[] = [
      { type: 'text', autocomplete: 'cc-number' },
      { type: 'text', name: 'card_number' },
      { type: 'text', id: 'cvv' },
      { type: 'text', placeholder: 'Security code' },
      { type: 'text', 'aria-label': 'Credit card' },
    ];
    for (const attrs of cases) {
      const el = input(attrs);
      expect(isSensitiveField(el), JSON.stringify(attrs)).not.toBeNull();
    }
  });

  it('never processes one-time codes or PINs', () => {
    expect(isSensitiveField(input({ type: 'text', autocomplete: 'one-time-code' }))).not.toBeNull();
    expect(isSensitiveField(input({ type: 'text', name: 'otp' }))).not.toBeNull();
    expect(isSensitiveField(input({ type: 'text', name: 'pin' }))).not.toBeNull();
    expect(
      isSensitiveField(input({ type: 'text', inputmode: 'numeric', maxlength: '6' })),
    ).not.toBeNull();
  });

  it('uses the visible label as a hint', () => {
    const label = document.createElement('label');
    label.textContent = 'Card number';
    const el = document.createElement('input');
    el.type = 'text';
    el.id = 'field1';
    label.htmlFor = 'field1';
    document.body.append(label, el);
    expect(isSensitiveField(el)).not.toBeNull();
  });

  it('honours the site opt-out attribute and code editors', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-personal-autocorrect', 'off');
    const el = document.createElement('textarea');
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);
    expect(isSensitiveField(el)).toBe('site opted out');

    const codeField = document.createElement('textarea');
    codeField.setAttribute('spellcheck', 'false');
    document.body.appendChild(codeField);
    expect(isSensitiveField(codeField)).toContain('spellcheck');
  });

  it('allows an ordinary message box', () => {
    const el = document.createElement('textarea');
    el.setAttribute('aria-label', 'Message body');
    document.body.appendChild(el);
    expect(isSensitiveField(el)).toBeNull();
    expect(guardField(el, settings())).toMatchObject({ allowed: true, kind: 'textarea' });
  });
});

describe('read-only and disabled fields', () => {
  it('is skipped', () => {
    const readOnly = input({ type: 'text', readonly: 'readonly' });
    expect(guardField(readOnly, settings()).allowed).toBe(false);
    const disabled = input({ type: 'text', disabled: 'disabled' });
    expect(guardField(disabled, settings()).allowed).toBe(false);
    const aria = input({ type: 'text', 'aria-readonly': 'true' });
    expect(guardField(aria, settings()).allowed).toBe(false);
  });
});

describe('denylist', () => {
  it('matches hostnames and their subdomains', () => {
    const s = settings({ denylist: ['bank.example'] });
    expect(isDenied('bank.example', s)).toBe(true);
    expect(isDenied('login.bank.example', s)).toBe(true);
    expect(isDenied('notbank.example', s)).toBe(false);
    expect(isDenied('other.com', s)).toBe(false);
  });

  it('ignores blank entries', () => {
    expect(isDenied('example.com', settings({ denylist: ['', '  '] }))).toBe(false);
  });
});

describe('describeField', () => {
  it('prefers accessible names', () => {
    const el = document.createElement('textarea');
    el.setAttribute('aria-label', 'Compose your reply');
    expect(describeField(el)).toBe('Compose your reply');
  });

  it('falls back to the placeholder, then the name, then a generic label', () => {
    const withPlaceholder = input({ type: 'text', placeholder: 'Subject' });
    expect(describeField(withPlaceholder)).toBe('Subject');
    const withName = input({ type: 'text', name: 'note' });
    expect(describeField(withName)).toBe('note');
    expect(describeField(document.createElement('textarea'))).toBe('Text area');
  });
});

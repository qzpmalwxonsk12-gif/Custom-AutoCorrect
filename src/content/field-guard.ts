/**
 * Decides which fields may be touched at all.
 *
 * Everything here fails closed: an unrecognised field is skipped, not guessed
 * at. Sensitive-field detection runs before any text is read, so the extension
 * never even observes a password or card number.
 */
import type { Settings } from '../shared/types.js';

export type FieldKind = 'input' | 'textarea' | 'contenteditable';

/** Only these input types are ever considered. */
const ALLOWED_INPUT_TYPES = new Set(['text', 'search', '']);

/** Attribute values that mark a field as sensitive. */
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|one-time-code|current-password|new-password|webauthn)/i;

const SENSITIVE_HINT =
  /(pass(word|wd)?|pwd|card[-_ ]?number|cardnum|cc[-_]?num|credit|cvv|cvc|csc|security[-_ ]?code|otp|one[-_ ]?time|2fa|mfa|verification[-_ ]?code|auth[-_ ]?code|pin\b|secret|token|iban|routing|account[-_ ]?number|ssn|social[-_ ]?security|tax[-_ ]?id|passport|license[-_ ]?number)/i;

export interface GuardResult {
  allowed: boolean;
  kind?: FieldKind;
  reason?: string;
}

export function fieldKindOf(el: Element): FieldKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement) {
    return ALLOWED_INPUT_TYPES.has(el.type.toLowerCase()) ? 'input' : null;
  }
  if (el instanceof HTMLElement && el.isContentEditable) return 'contenteditable';
  return null;
}

function attrBlob(el: HTMLElement): string {
  const parts = [
    el.getAttribute('name'),
    el.id,
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('data-testid'),
    el.getAttribute('autocomplete'),
    el.className && typeof el.className === 'string' ? el.className : '',
  ];
  // The associated <label> often carries the only human-readable hint.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const labels = el.labels;
    if (labels) for (const l of Array.from(labels)) parts.push(l.textContent ?? '');
  }
  return parts.filter(Boolean).join(' ');
}

export function isSensitiveField(el: HTMLElement): string | null {
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    if (!ALLOWED_INPUT_TYPES.has(type)) return `input type="${type}"`;
    if (el.maxLength > 0 && el.maxLength <= 8 && el.inputMode === 'numeric') {
      return 'short numeric field (likely a code)';
    }
  }
  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.test(autocomplete)) {
    return `autocomplete="${autocomplete}"`;
  }
  const blob = attrBlob(el);
  const hit = SENSITIVE_HINT.exec(blob);
  if (hit) return `field looks sensitive ("${hit[0]}")`;

  // Sites that opt out explicitly, and editors that disable spellcheck (almost
  // always code editors) are left alone.
  if (el.closest('[data-personal-autocorrect="off"]')) return 'site opted out';
  if (el.getAttribute('spellcheck') === 'false') return 'spellcheck disabled by the site';
  if (el.closest('code, pre, [role="code"]')) return 'code editor';
  return null;
}

/**
 * Denylist check only. The per-origin on/off switch is applied in the engine
 * instead, so toggling a site back on takes effect immediately without the user
 * having to re-focus the field.
 */
export function isDenied(hostname: string, settings: Settings): boolean {
  return settings.denylist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    return hostname === e || hostname.endsWith(`.${e}`);
  });
}

/** Full check used before attaching to a field. */
export function guardField(el: Element, settings: Settings): GuardResult {
  if (!(el instanceof HTMLElement)) return { allowed: false, reason: 'not an element' };

  const kind = fieldKindOf(el);
  if (!kind) return { allowed: false, reason: 'not a supported editable' };

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return { allowed: false, kind, reason: 'read-only' };
  }
  if (el.getAttribute('aria-readonly') === 'true') {
    return { allowed: false, kind, reason: 'read-only' };
  }

  const sensitive = isSensitiveField(el);
  if (sensitive) return { allowed: false, kind, reason: sensitive };

  if (isDenied(location.hostname, settings)) {
    return { allowed: false, kind, reason: 'site is disabled' };
  }
  return { allowed: true, kind };
}

/** Human-readable name for the panel header. */
export function describeField(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 60);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const label = el.labels?.[0]?.textContent?.trim();
    if (label) return label.slice(0, 60);
    if (el.placeholder) return el.placeholder.trim().slice(0, 60);
    if (el.name) return el.name.slice(0, 60);
  }
  const placeholder = el.getAttribute('data-placeholder') ?? el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim().slice(0, 60);
  if (el.id) return `#${el.id}`;
  return el instanceof HTMLTextAreaElement ? 'Text area' : el.isContentEditable ? 'Editor' : 'Text field';
}

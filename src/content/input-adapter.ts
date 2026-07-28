/** Adapter for <input type="text|search"> and <textarea>. */
import type { EditableAdapter } from './adapter.js';
import { rectsForInputRange, scrollInputRangeIntoView } from './caret-rect.js';
import type { FieldKind } from './field-guard.js';

type Field = HTMLInputElement | HTMLTextAreaElement;

function remainsPlainTextField(field: Field): boolean {
  return (
    field instanceof HTMLTextAreaElement
    || field.type === 'text'
    || field.type === 'search'
  );
}

/**
 * React (and friends) install their own value setter on the element instance;
 * writing through the prototype setter is what makes framework state update.
 */
function setNativeValue(el: Field, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

export class InputAdapter implements EditableAdapter {
  readonly kind: FieldKind;
  readonly element: HTMLElement;
  private readonly field: Field;

  constructor(field: Field) {
    this.field = field;
    this.element = field;
    this.kind = field instanceof HTMLTextAreaElement ? 'textarea' : 'input';
  }

  getText(): string {
    return this.field.value;
  }

  getCaret(): { start: number; end: number } {
    // Chrome throws for selection access on some input types; guard anyway.
    try {
      return {
        start: this.field.selectionStart ?? 0,
        end: this.field.selectionEnd ?? 0,
      };
    } catch {
      const len = this.field.value.length;
      return { start: len, end: len };
    }
  }

  setCaret(start: number, end: number): void {
    try {
      this.field.setSelectionRange(start, end);
    } catch {
      /* field may have been detached or changed type */
    }
  }

  replaceRange(start: number, end: number, insert: string): boolean {
    const before = this.field.value;
    if (start < 0 || end > before.length || start > end) return false;

    const wasActive = document.activeElement === this.field;
    const caret = this.getCaret();

    // Preferred path: execCommand keeps the browser's native undo stack and
    // fires the same events the host page would see from real typing.
    try {
      if (!wasActive) this.field.focus({ preventScroll: true });
      this.field.setSelectionRange(start, end);
      const applied = document.execCommand('insertText', false, insert);
      // execCommand dispatches input synchronously. A page may turn the field
      // into a password in that handler; in that case do not read its value
      // merely to verify an edit the browser already reported as applied.
      if (applied && (!remainsPlainTextField(this.field) || this.field.value !== before)) {
        if (!wasActive) this.restoreFocus(caret);
        return true;
      }
    } catch {
      /* fall through to the manual path */
    }

    // Fallback: write the value directly and announce it.
    try {
      const next = before.slice(0, start) + insert + before.slice(end);
      setNativeValue(this.field, next);
      this.setCaret(start + insert.length, start + insert.length);
      // Verify while the field is still in the eligibility state checked by
      // the controller. The event below may synchronously make it sensitive.
      const changed = this.field.value === next;
      this.field.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertReplacementText',
          data: insert,
        }),
      );
      return changed;
    } catch (e) {
      console.warn('[autocorrect] replaceRange failed:', e);
      return false;
    }
  }

  private restoreFocus(caret: { start: number; end: number }): void {
    this.setCaret(caret.start, caret.end);
    this.field.blur();
  }

  rectsFor(start: number, end: number): DOMRect[] {
    try {
      return rectsForInputRange(this.field, start, end);
    } catch {
      return [];
    }
  }

  scrollRangeIntoView(start: number, end: number): void {
    try {
      scrollInputRangeIntoView(this.field, start, end);
    } catch {
      this.field.scrollIntoView({ block: 'center' });
    }
  }

  focus(): void {
    try {
      this.field.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  isConnected(): boolean {
    return this.field.isConnected;
  }

  dispose(): void {
    /* nothing retained */
  }
}

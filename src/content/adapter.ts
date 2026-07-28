/**
 * The editable abstraction. Everything above this line works in plain-text
 * offsets; each adapter is responsible for mapping those onto its host.
 */
import { fnv1a } from '../shared/util.js';
import type { FieldKind } from './field-guard.js';

export interface EditableAdapter {
  readonly kind: FieldKind;
  readonly element: HTMLElement;

  /** Full plain-text content of the field. */
  getText(): string;
  getCaret(): { start: number; end: number };
  setCaret(start: number, end: number): void;
  /**
   * Replaces [start,end) with `insert`. Returns false when the host refused the
   * edit, in which case the caller must not record a correction.
   */
  replaceRange(start: number, end: number, insert: string): boolean;
  /** Client rects for a text range, used to position temporary highlights. */
  rectsFor(start: number, end: number): DOMRect[];
  scrollRangeIntoView(start: number, end: number): void;
  focus(): void;
  isConnected(): boolean;
  /** Called when the controller detaches. */
  dispose(): void;
}

/**
 * Stable identifier for a field across reloads: structural path + whatever
 * identifying attributes exist. Hashed, so no page content is stored.
 */
export function computeFieldId(el: HTMLElement): string {
  const descriptor = [
    el.tagName,
    el instanceof HTMLInputElement ? el.type : '',
    el.getAttribute('name') ?? '',
    el.id,
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('data-testid') ?? '',
  ].join('|');

  const path: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 6 && node !== document.documentElement) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    let index = 0;
    for (const sib of Array.from(parent.children)) {
      if (sib === node) break;
      if (sib.tagName === node.tagName) index++;
    }
    path.unshift(`${node.tagName}[${index}]`);
    node = parent;
    depth++;
  }
  return `f_${fnv1a(descriptor)}_${fnv1a(path.join('/'))}`;
}

/** Shared by both adapters: are we inside our own UI? */
export function isExtensionNode(node: Node | null): boolean {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.hasAttribute('data-personal-autocorrect-ui')) return true;
    el = el.parentNode;
  }
  return false;
}

/**
 * Adapter for contenteditable hosts.
 *
 * A flat plain-text projection of the subtree is built on demand and cached
 * until a MutationObserver says the DOM changed, so typing does not re-walk the
 * document on every keystroke - only once per committed word.
 *
 * Block boundaries become "\n" in the projection. Those virtual newlines have
 * no text node behind them, so offsets landing on one clamp to the nearest real
 * position rather than throwing.
 */
import { isExtensionNode, type EditableAdapter } from './adapter.js';
import type { FieldKind } from './field-guard.js';

interface Segment {
  node: Text;
  start: number;
  end: number;
}

interface ProjectionRange {
  start: number;
  end: number;
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

export class ContentEditableAdapter implements EditableAdapter {
  readonly kind: FieldKind = 'contenteditable';
  readonly element: HTMLElement;

  private segments: Segment[] = [];
  private projectionRanges = new WeakMap<Node, ProjectionRange>();
  private text = '';
  private dirty = true;
  private observer: MutationObserver | null = null;
  private readonly invalidate = (): void => {
    this.dirty = true;
  };

  constructor(root: HTMLElement) {
    this.element = root;
    // MutationObserver delivery is asynchronous. Mark the projection dirty in
    // the input event path as well so another listener cannot observe stale
    // text or caret offsets in the same task.
    root.addEventListener('beforeinput', this.invalidate, true);
    root.addEventListener('input', this.invalidate, true);
    try {
      this.observer = new MutationObserver(this.invalidate);
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch (e) {
      console.warn('[autocorrect] MutationObserver unavailable:', e);
    }
  }

  private rebuild(): void {
    const segments: Segment[] = [];
    const projectionRanges = new WeakMap<Node, ProjectionRange>();
    let text = '';

    const walk = (node: Node): void => {
      const start = text.length;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node as Text;
        const value = t.data;
        if (value.length > 0) {
          segments.push({ node: t, start: text.length, end: text.length + value.length });
          text += value;
        }
        projectionRanges.set(node, { start, end: text.length });
        return;
      }
      if (!(node instanceof Element)) {
        projectionRanges.set(node, { start, end: text.length });
        return;
      }
      if (SKIP_TAGS.has(node.tagName) || isExtensionNode(node)) {
        projectionRanges.set(node, { start, end: text.length });
        return;
      }
      if (node.tagName === 'BR') {
        text += '\n';
        projectionRanges.set(node, { start, end: text.length });
        return;
      }
      const block = BLOCK_TAGS.has(node.tagName);
      if (block && text.length > 0 && !text.endsWith('\n')) text += '\n';
      for (const child of Array.from(node.childNodes)) walk(child);
      if (block && text.length > 0 && !text.endsWith('\n')) text += '\n';
      projectionRanges.set(node, { start, end: text.length });
    };

    for (const child of Array.from(this.element.childNodes)) walk(child);
    projectionRanges.set(this.element, { start: 0, end: text.length });
    this.segments = segments;
    this.projectionRanges = projectionRanges;
    this.text = text;
    this.dirty = false;
  }

  private ensure(): void {
    // Pull queued records synchronously; otherwise getText/getCaret can run
    // before the observer callback after a host editor mutates a Text node.
    if (this.observer?.takeRecords().length) this.dirty = true;
    if (this.dirty) this.rebuild();
  }

  getText(): string {
    this.ensure();
    return this.text;
  }

  /** Maps a plain-text offset onto a DOM position. */
  private positionAt(offset: number): { node: Text; offset: number } | null {
    this.ensure();
    if (this.segments.length === 0) return null;
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let last: Segment | null = null;
    for (const seg of this.segments) {
      if (clamped >= seg.start && clamped <= seg.end) {
        return { node: seg.node, offset: clamped - seg.start };
      }
      if (seg.end <= clamped) last = seg;
      else break;
    }
    // Offset fell on a virtual newline: clamp to the end of the previous run.
    if (last) return { node: last.node, offset: last.end - last.start };
    const first = this.segments[0]!;
    return { node: first.node, offset: 0 };
  }

  /** Maps a DOM position back to a plain-text offset. */
  private offsetOf(node: Node, offset: number): number | null {
    this.ensure();
    if (node.nodeType === Node.TEXT_NODE) {
      const seg = this.segments.find((s) => s.node === node);
      return seg ? seg.start + Math.min(offset, seg.end - seg.start) : null;
    }
    // Element positions are boundaries between children. At the end of an
    // element, use the previous child's projected end (not its first Text
    // descendant), which is particularly important for block elements.
    const children = Array.from(node.childNodes);
    if (children.length === 0) return this.projectionRanges.get(node)?.start ?? null;
    if (offset < children.length) {
      return this.projectionRanges.get(children[Math.max(0, offset)]!)?.start ?? null;
    }
    return this.projectionRanges.get(children[children.length - 1]!)?.end ?? null;
  }

  private buildRange(start: number, end: number): Range | null {
    const from = this.positionAt(start);
    const to = this.positionAt(end);
    if (!from || !to) return null;
    try {
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      return range;
    } catch {
      return null;
    }
  }

  getCaret(): { start: number; end: number } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    if (!this.element.contains(range.startContainer)) return { start: 0, end: 0 };
    const start = this.offsetOf(range.startContainer, range.startOffset);
    const end = this.offsetOf(range.endContainer, range.endOffset);
    if (start === null || end === null) return { start: 0, end: 0 };
    return { start, end };
  }

  setCaret(start: number, end: number): void {
    const range = this.buildRange(start, end);
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* selection may be locked by the host editor */
    }
  }

  replaceRange(start: number, end: number, insert: string): boolean {
    const before = this.getText();
    const range = this.buildRange(start, end);
    if (!range) return false;

    const sel = window.getSelection();
    if (!sel) return false;

    try {
      this.element.focus({ preventScroll: true });
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      return false;
    }

    // execCommand is the only path that reliably keeps rich editors (and their
    // undo stacks) consistent. It is deprecated but universally implemented.
    try {
      const applied = document.execCommand('insertText', false, insert);
      this.dirty = true;
      // execCommand fires input synchronously. Avoid a post-event text read:
      // the host may have changed this element into a protected/code editor.
      if (applied) return true;
    } catch {
      /* fall through */
    }

    // Fallback: direct DOM edit plus a synthetic input event.
    try {
      range.deleteContents();
      const node = document.createTextNode(insert);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      this.dirty = true;
      // Verify the direct edit before dispatching the event, which may
      // synchronously change the field's privacy classification.
      const changed = this.getText() !== before;
      this.element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertReplacementText',
          data: insert,
        }),
      );
      return changed;
    } catch (e) {
      console.warn('[autocorrect] contenteditable replace failed:', e);
      return false;
    }
  }

  rectsFor(start: number, end: number): DOMRect[] {
    const range = this.buildRange(start, end);
    if (!range) return [];
    try {
      return Array.from(range.getClientRects());
    } catch {
      return [];
    }
  }

  scrollRangeIntoView(start: number, end: number): void {
    const rects = this.rectsFor(start, end);
    const rect = rects[0];
    if (!rect) {
      this.element.scrollIntoView({ block: 'center' });
      return;
    }
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < 0 || rect.bottom > viewportH) {
      window.scrollBy({ top: rect.top - viewportH / 2, behavior: 'smooth' });
    }
  }

  focus(): void {
    try {
      this.element.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  isConnected(): boolean {
    return this.element.isConnected;
  }

  dispose(): void {
    this.element.removeEventListener('beforeinput', this.invalidate, true);
    this.element.removeEventListener('input', this.invalidate, true);
    this.observer?.disconnect();
    this.observer = null;
    this.segments = [];
    this.projectionRanges = new WeakMap();
    this.text = '';
    this.dirty = false;
  }
}

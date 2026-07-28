/**
 * Rectangles for a character range inside <input>/<textarea>.
 *
 * The browser exposes no API for this, so we mirror the field into an offscreen
 * div with identical typography and measure a span there. The mirror is created
 * on demand and removed immediately - nothing is left in the page.
 */
const COPIED_PROPERTIES = [
  'boxSizing',
  'width',
  'height',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textIndent',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const;

export function rectsForInputRange(
  el: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
): DOMRect[] {
  if (!el.isConnected) return [];
  const value = el.value;
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));

  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  mirror.setAttribute('data-personal-autocorrect-ui', 'mirror');
  const ms = mirror.style;
  ms.position = 'absolute';
  ms.top = '0';
  ms.left = '0';
  ms.visibility = 'hidden';
  ms.pointerEvents = 'none';
  ms.overflow = 'hidden';
  ms.whiteSpace = el instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
  ms.overflowWrap = 'break-word';
  for (const prop of COPIED_PROPERTIES) {
    ms[prop] = style[prop] as string;
  }
  // The mirror must be exactly as wide as the field's content box.
  ms.width = `${el.clientWidth}px`;
  if (el instanceof HTMLInputElement) ms.height = `${el.clientHeight}px`;

  const head = document.createTextNode(value.slice(0, s));
  const span = document.createElement('span');
  span.textContent = value.slice(s, e) || '​';
  const tail = document.createTextNode(value.slice(e));
  mirror.append(head, span, tail);
  document.body.appendChild(mirror);

  try {
    const mirrorRect = mirror.getBoundingClientRect();
    const fieldRect = el.getBoundingClientRect();
    const offsetX =
      fieldRect.left + parseFloat(style.borderLeftWidth || '0') - el.scrollLeft;
    const offsetY = fieldRect.top + parseFloat(style.borderTopWidth || '0') - el.scrollTop;

    return Array.from(span.getClientRects()).map((r) => {
      return new DOMRect(
        r.left - mirrorRect.left + offsetX,
        r.top - mirrorRect.top + offsetY,
        r.width,
        r.height,
      );
    });
  } finally {
    mirror.remove();
  }
}

/**
 * Scrolls an <input>/<textarea> so the given range is visible. Textareas are
 * scrolled by line; inputs by horizontal offset.
 */
export function scrollInputRangeIntoView(
  el: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
): void {
  const rects = rectsForInputRange(el, start, end);
  const target = rects[0];
  const fieldRect = el.getBoundingClientRect();
  if (!target) return;

  if (el instanceof HTMLTextAreaElement) {
    const relativeTop = target.top - fieldRect.top + el.scrollTop;
    const desired = relativeTop - el.clientHeight / 2 + target.height / 2;
    el.scrollTop = Math.max(0, desired);
  } else {
    const relativeLeft = target.left - fieldRect.left + el.scrollLeft;
    const desired = relativeLeft - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, desired);
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

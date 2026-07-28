/**
 * All extension-owned visuals live inside a closed shadow root on a small host
 * attached outside the editor. The page can still remove or cover that host,
 * but it cannot traverse the shadow tree or target its controls directly.
 * Nothing is inserted into the user's editable content.
 */
export interface CardAction {
  id: string;
  label: string;
  hint?: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DiffBadgeOptions {
  getRects: () => DOMRect[];
  original: string;
  replacement: string;
  /** Short plain-language reason, e.g. "Removed duplicate letter". */
  explanation?: string;
  /** Shown as an "Undo" button when provided. */
  onUndo?: () => void;
}

/** One entry in the "show every correction at once" overlay. */
export interface MarkupItem {
  recordId: string;
  original: string;
  replacement: string;
  typeLabel: string;
  getRects: () => DOMRect[];
}

export interface RulePromptOptions {
  original: string;
  getRects?: () => DOMRect[];
  /** Return an error string to keep the prompt open, or null on success. */
  onSubmit: (replacement: string) => string | null;
  onCancel?: () => void;
}

export interface CardOptions {
  getRects: () => DOMRect[];
  original: string;
  replacement: string;
  context: string;
  typeLabel: string;
  confidence: number;
  reason: string;
  statusLabel: string;
  progress?: { position: number; total: number };
  actions: CardAction[];
  onAction: (id: string) => void;
}

const STYLE = `
:host { all: initial; }
.layer {
  position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.mark {
  position: fixed; border-radius: 3px; pointer-events: none;
  background: rgba(37, 99, 235, 0.22);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.55);
  transition: opacity 180ms ease-out;
}
.mark.flash { background: rgba(34, 197, 94, 0.28); box-shadow: 0 0 0 1px rgba(34,197,94,.6); }
.mark.fade { opacity: 0; }
.card {
  position: fixed; pointer-events: auto; max-width: 340px; min-width: 240px;
  background: #ffffff; color: #111827; border: 1px solid #d1d5db; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.18); padding: 10px 12px; font-size: 13px; line-height: 1.45;
}
.card .diff { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 15px; }
.card .old { text-decoration: line-through; color: #b91c1c; }
.card .arrow { color: #6b7280; }
.card .new { color: #15803d; font-weight: 600; }
.card .ctx { margin-top: 6px; color: #4b5563; font-size: 12px; font-style: italic;
  overflow-wrap: anywhere; }
.card .meta { margin-top: 6px; color: #6b7280; font-size: 11px; }
.card .progress { float: right; color: #6b7280; font-size: 11px; font-variant-numeric: tabular-nums; }
.card .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.card button {
  font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 6px; cursor: pointer;
  border: 1px solid #d1d5db; background: #f9fafb; color: #111827;
}
.card button:hover { background: #f3f4f6; }
.card button:focus-visible, .chip button:focus-visible {
  outline: 3px solid rgba(37, 99, 235, .45); outline-offset: 2px;
}
.card button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.card button.primary:hover { background: #1d4ed8; }
.card button.danger { color: #b91c1c; border-color: #fca5a5; }
.chip {
  position: fixed; pointer-events: auto; background: #111827; color: #f9fafb;
  border-radius: 8px; padding: 5px 8px; font-size: 12px; display: flex; gap: 8px;
  align-items: center; box-shadow: 0 6px 18px rgba(0,0,0,.25);
}
.chip button { font: inherit; font-size: 12px; border: 0; border-radius: 5px; padding: 2px 8px;
  background: #2563eb; color: #fff; cursor: pointer; }
.chip .dismiss { background: transparent; color: #9ca3af; }
.badge {
  position: fixed; pointer-events: auto; display: flex; align-items: baseline; gap: 6px;
  background: #111827; color: #f9fafb; border-radius: 8px; padding: 4px 8px;
  font-size: 12.5px; box-shadow: 0 6px 18px rgba(0,0,0,.28); max-width: 60vw;
  transition: opacity 260ms ease-out; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.badge.fade { opacity: 0; }
.badge .old { text-decoration: line-through; color: #fca5a5; }
.badge .arrow { color: #9ca3af; }
.badge .new { color: #86efac; font-weight: 600; }
.badge .ws { color: #fca5a5; opacity: .85; }
.badge .why {
  color: #d1d5db; font-size: 11.5px; padding-left: 7px; margin-left: 3px;
  border-left: 1px solid #4b5563;
}
.badge button {
  font: inherit; font-size: 11.5px; border: 0; border-radius: 5px; padding: 2px 7px;
  margin-left: 2px; background: #374151; color: #f9fafb; cursor: pointer;
}
.badge button:hover { background: #4b5563; }
.prompt {
  position: fixed; pointer-events: auto; background: #ffffff; color: #111827;
  border: 1px solid #d1d5db; border-radius: 10px; padding: 11px 12px;
  box-shadow: 0 12px 34px rgba(0,0,0,.22); font-size: 13px; min-width: 260px;
  max-width: 340px;
}
.prompt .title { font-weight: 600; margin-bottom: 2px; }
.prompt .sub { color: #6b7280; font-size: 12px; margin-bottom: 8px; }
.prompt .sub b { color: #b91c1c; text-decoration: line-through; }
.prompt input {
  font: inherit; width: 100%; box-sizing: border-box; padding: 6px 8px;
  border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #111827;
}
.prompt .err { color: #b91c1c; font-size: 11.5px; margin-top: 5px; min-height: 14px; }
.prompt .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.prompt button {
  font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 6px; cursor: pointer;
  border: 1px solid #d1d5db; background: #f9fafb; color: #111827;
}
.prompt button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
@media (prefers-color-scheme: dark) {
  .prompt { background: #1f2937; color: #f3f4f6; border-color: #374151; }
  .prompt .sub { color: #9ca3af; }
  .prompt input { background: #111827; color: #f3f4f6; border-color: #4b5563; }
  .prompt button { background: #374151; border-color: #4b5563; color: #f3f4f6; }
}
.toast {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; pointer-events: none;
  background: #111827; color: #f9fafb; padding: 8px 14px; border-radius: 8px; font-size: 13px;
  box-shadow: 0 6px 18px rgba(0,0,0,.25); max-width: 70vw;
}
.toast.warn { background: #7f1d1d; }
/* Markup overlay: every correction in the field, shown at once. */
.markup {
  position: fixed; pointer-events: auto; display: inline-flex; align-items: baseline;
  gap: 4px; background: #111827; color: #f9fafb; border-radius: 6px;
  padding: 1px 6px; font-size: 12px; line-height: 1.5;
  box-shadow: 0 3px 10px rgba(0,0,0,.3); white-space: nowrap;
  border: 1px solid #374151;
}
.markup .old { text-decoration: line-through; color: #fca5a5; }
.markup .arrow { color: #9ca3af; }
.markup .new { color: #86efac; font-weight: 600; }
.markup .ws { color: #fca5a5; opacity: .85; }
.markup button {
  font: inherit; font-size: 11px; border: 0; border-radius: 4px; padding: 0 5px;
  margin-left: 2px; background: #374151; color: #f9fafb; cursor: pointer;
}
.markup button:hover { background: #4b5563; }
.markup button:focus-visible { outline: 3px solid rgba(37,99,235,.55); outline-offset: 2px; }
.markup-underline {
  position: fixed; pointer-events: none; border-bottom: 2px dotted rgba(37, 99, 235, .85);
}
@media (prefers-contrast: more), (forced-colors: active) {
  .markup { border-color: CanvasText; background: Canvas; color: CanvasText; }
  .markup .old, .markup .new, .markup .arrow { color: CanvasText; }
  .mark { background: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  .mark, .badge { transition: none; }
}
/* Set when the user forces reduced motion in settings, independently of the OS. */
.layer.reduce-motion .mark, .layer.reduce-motion .badge { transition: none; }
@media (prefers-color-scheme: dark) {
  .card { background: #1f2937; color: #f3f4f6; border-color: #374151; }
  .card .ctx, .card .meta { color: #9ca3af; }
  .card .old { color: #fca5a5; }
  .card .new { color: #4ade80; }
  .card button { background: #374151; border-color: #4b5563; color: #f3f4f6; }
  .card button:hover { background: #4b5563; }
  .card button.danger { color: #fca5a5; border-color: #b91c1c; }
}
`;

export class CorrectionHighlighter {
  private host: HTMLElement | null = null;
  private layer: HTMLElement | null = null;

  private held: { getRects: () => DOMRect[]; nodes: HTMLElement[] } | null = null;
  private card: { el: HTMLElement; getRects: () => DOMRect[] } | null = null;
  private chip: { el: HTMLElement; getRects: () => DOMRect[] } | null = null;
  private badge: { el: HTMLElement; getRects: () => DOMRect[] } | null = null;
  private badgeTimer: number | undefined;
  private markup: {
    nodes: Array<{ el: HTMLElement; underline: HTMLElement; item: MarkupItem }>;
    onUndo: (recordId: string) => void;
  } | null = null;
  private prompt: HTMLElement | null = null;
  private repositionBound = () => this.reposition();
  private listening = false;
  private reducedMotion = false;

  private ensure(): HTMLElement {
    if (this.layer) return this.layer;
    const host = document.createElement('div');
    host.setAttribute('data-personal-autocorrect-ui', 'root');
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const layer = document.createElement('div');
    layer.className = this.reducedMotion ? 'layer reduce-motion' : 'layer';
    root.append(style, layer);
    (document.documentElement ?? document.body).appendChild(host);
    this.host = host;
    this.layer = layer;
    return layer;
  }

  /**
   * Forces reduced motion on regardless of the OS setting. The OS preference is
   * already honoured in CSS; this is the "I want it off here too" override.
   */
  setReducedMotion(reduce: boolean): void {
    this.reducedMotion = reduce;
    this.layer?.classList.toggle('reduce-motion', reduce);
  }

  /** True when either the OS or the user's setting asks for reduced motion. */
  private prefersReducedMotion(): boolean {
    if (this.reducedMotion) return true;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  private startListening(): void {
    if (this.listening) return;
    window.addEventListener('scroll', this.repositionBound, true);
    window.addEventListener('resize', this.repositionBound, true);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening) return;
    window.removeEventListener('scroll', this.repositionBound, true);
    window.removeEventListener('resize', this.repositionBound, true);
    this.listening = false;
  }

  /** Brief green flash right after an automatic correction. */
  flash(rects: DOMRect[]): void {
    if (rects.length === 0) return;
    const layer = this.ensure();
    const nodes = rects.map((r) => {
      const el = document.createElement('div');
      el.className = 'mark flash';
      applyRect(el, r);
      layer.appendChild(el);
      return el;
    });
    window.setTimeout(() => {
      for (const n of nodes) n.classList.add('fade');
      window.setTimeout(() => nodes.forEach((n) => n.remove()), 220);
    }, 700);
  }

  /** Persistent highlight for the correction under review. */
  hold(getRects: () => DOMRect[]): void {
    this.clearHold();
    const layer = this.ensure();
    const nodes: HTMLElement[] = [];
    for (const r of getRects()) {
      const el = document.createElement('div');
      el.className = 'mark';
      applyRect(el, r);
      layer.appendChild(el);
      nodes.push(el);
    }
    this.held = { getRects, nodes };
    this.startListening();
  }

  clearHold(): void {
    if (!this.held) return;
    for (const n of this.held.nodes) n.remove();
    this.held = null;
    this.maybeStopListening();
  }

  showCard(options: CardOptions): void {
    this.hideCard();
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Correction review');

    const progress = options.progress
      ? `<span class="progress">${options.progress.position} of ${options.progress.total}</span>`
      : '';
    el.innerHTML = `
      ${progress}
      <div class="diff">
        <span class="old"></span><span class="arrow">→</span><span class="new"></span>
      </div>
      <div class="ctx"></div>
      <div class="meta"></div>
      <div class="actions"></div>`;

    (el.querySelector('.old') as HTMLElement).textContent = options.original;
    (el.querySelector('.new') as HTMLElement).textContent = options.replacement;
    const ctx = el.querySelector('.ctx') as HTMLElement;
    if (options.context) ctx.textContent = options.context;
    else ctx.remove();
    (el.querySelector('.meta') as HTMLElement).textContent =
      `${options.typeLabel} · ${Math.round(options.confidence * 100)}% confidence · ${options.statusLabel}` +
      (options.reason ? ` · ${options.reason}` : '');

    const actions = el.querySelector('.actions') as HTMLElement;
    for (const action of options.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.hint) button.title = action.hint;
      if (action.primary) button.classList.add('primary');
      if (action.danger) button.classList.add('danger');
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // A hostile page can dispatch synthetic events at nodes for which it
        // retained a reference. Only a real user activation may mutate text.
        if (!e.isTrusted) return;
        options.onAction(action.id);
      });
      actions.appendChild(button);
    }
    // Keep the host page from treating clicks on our card as editor clicks.
    el.addEventListener('mousedown', (e) => e.stopPropagation());

    layer.appendChild(el);
    this.card = { el, getRects: options.getRects };
    this.positionNear(el, options.getRects());
    this.startListening();
  }

  hideCard(): void {
    this.card?.el.remove();
    this.card = null;
    this.maybeStopListening();
  }

  /** Small inline offer for medium-confidence suggestions. */
  showSuggestion(
    getRects: () => DOMRect[],
    replacement: string,
    onAccept: () => void,
    onDismiss: () => void,
  ): void {
    this.hideSuggestion();
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = 'chip';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Suggested correction');
    el.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    label.textContent = replacement;
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = 'Apply';
    accept.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.isTrusted) return;
      onAccept();
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'dismiss';
    dismiss.textContent = '✕';
    dismiss.title = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss suggestion');
    dismiss.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.isTrusted) return;
      onDismiss();
    });
    el.append(label, accept, dismiss);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    layer.appendChild(el);
    this.chip = { el, getRects };
    this.positionNear(el, getRects());
    this.startListening();
  }

  hideSuggestion(): void {
    this.chip?.el.remove();
    this.chip = null;
    this.maybeStopListening();
  }

  /**
   * Post-hoc diff for an automatically applied correction: the original struck
   * through beside the replacement, fading on its own. Drawn in the shadow
   * root - the document itself never receives review markup.
   */
  flashDiff(options: DiffBadgeOptions): void {
    this.hideBadge();
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = 'badge';

    const whitespaceChange =
      options.original.replace(/\s/g, '') === options.replacement.replace(/\s/g, '');
    const old = document.createElement('span');
    old.className = 'old';
    const next = document.createElement('span');
    next.className = 'new';
    // A vanished space is invisible struck through, so make spaces visible
    // whenever whitespace is the whole point of the change.
    if (whitespaceChange) {
      old.append(...visibleWhitespace(options.original));
      next.append(...visibleWhitespace(options.replacement));
    } else {
      old.textContent = options.original;
      next.textContent = options.replacement;
    }
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    el.append(old, arrow, next);

    // Announce the whole change as one phrase; the struck-through original and
    // the arrow are decorative once the sentence is read aloud.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute(
      'aria-label',
      `${options.explanation ? `${options.explanation}. ` : ''}`
        + `${options.original} changed to ${options.replacement}`,
    );

    if (options.explanation) {
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = options.explanation;
      el.appendChild(why);
    }

    if (options.onUndo) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideBadge();
        options.onUndo?.();
      });
      el.appendChild(undo);
    }
    el.addEventListener('mousedown', (e) => e.stopPropagation());

    layer.appendChild(el);
    this.badge = { el, getRects: options.getRects };
    this.positionNear(el, options.getRects());
    this.startListening();

    // With reduced motion the badge simply stays a little longer and then
    // vanishes: fading is the animation, so removing it must not also remove
    // the reading time it provided.
    const reduce = this.prefersReducedMotion();
    const timer = window.setTimeout(
      () => {
        if (reduce) {
          if (this.badge?.el === el) this.hideBadge();
          return;
        }
        el.classList.add('fade');
        window.setTimeout(() => {
          if (this.badge?.el === el) this.hideBadge();
        }, 280);
      },
      reduce ? 3900 : 3600,
    );
    this.badgeTimer = timer;
  }

  hideBadge(): void {
    if (this.badgeTimer !== undefined) {
      window.clearTimeout(this.badgeTimer);
      this.badgeTimer = undefined;
    }
    this.badge?.el.remove();
    this.badge = null;
    this.maybeStopListening();
  }

  /**
   * Shows every correction in the field at once: each one is underlined in
   * place and labelled with `original → replacement` just above it.
   *
   * The document is never touched. Everything is drawn in the shadow layer and
   * positioned from the adapter's rects, so the page keeps exactly the text the
   * user will send.
   */
  showMarkup(items: MarkupItem[], onUndo: (recordId: string) => void): void {
    this.hideMarkup();
    if (items.length === 0) return;
    const layer = this.ensure();
    const nodes: Array<{ el: HTMLElement; underline: HTMLElement; item: MarkupItem }> = [];

    for (const item of items) {
      const underline = document.createElement('div');
      underline.className = 'markup-underline';

      const el = document.createElement('div');
      el.className = 'markup';
      el.setAttribute('role', 'group');
      el.setAttribute(
        'aria-label',
        `${item.typeLabel}: ${item.original} changed to ${item.replacement}`,
      );

      const whitespaceChange =
        item.original.replace(/\s/g, '') === item.replacement.replace(/\s/g, '');
      const old = document.createElement('span');
      old.className = 'old';
      const next = document.createElement('span');
      next.className = 'new';
      if (whitespaceChange) {
        old.append(...visibleWhitespace(item.original));
        next.append(...visibleWhitespace(item.replacement));
      } else {
        old.textContent = item.original;
        next.textContent = item.replacement;
      }
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');

      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.title = `Undo: ${item.original} → ${item.replacement}`;
      undo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onUndo(item.recordId);
      });

      el.append(old, arrow, next, undo);
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      layer.append(underline, el);
      nodes.push({ el, underline, item });
    }

    this.markup = { nodes, onUndo };
    this.positionMarkup();
    this.startListening();
  }

  hideMarkup(): void {
    if (!this.markup) return;
    for (const node of this.markup.nodes) {
      node.el.remove();
      node.underline.remove();
    }
    this.markup = null;
    this.maybeStopListening();
  }

  /** True while the "show all corrections" overlay is on screen. */
  get markupVisible(): boolean {
    return this.markup !== null;
  }

  private positionMarkup(): void {
    if (!this.markup) return;
    // Labels are stacked upward when they would overlap, so a paragraph with
    // several corrections stays readable instead of collapsing into one blur.
    const placed: DOMRect[] = [];
    for (const node of this.markup.nodes) {
      const rects = node.item.getRects();
      const first = rects[0];
      if (!first || (first.width === 0 && first.height === 0)) {
        node.el.style.display = 'none';
        node.underline.style.display = 'none';
        continue;
      }
      node.el.style.display = '';
      node.underline.style.display = '';

      const last = rects[rects.length - 1]!;
      const left = Math.min(first.left, last.left);
      const width = Math.max(first.right, last.right) - left;
      node.underline.style.left = `${left}px`;
      node.underline.style.top = `${first.bottom - 1}px`;
      node.underline.style.width = `${Math.max(width, 2)}px`;

      const size = node.el.getBoundingClientRect();
      let top = first.top - size.height - 3;
      let guard = 0;
      while (
        guard++ < 12
        && placed.some(
          (r) =>
            Math.abs(r.top - top) < size.height
            && left < r.right + 6
            && left + size.width > r.left - 6,
        )
      ) {
        top -= size.height + 2;
      }
      if (top < 2) top = first.bottom + 3;
      node.el.style.left = `${Math.max(2, Math.min(left, window.innerWidth - size.width - 4))}px`;
      node.el.style.top = `${top}px`;
      placed.push(new DOMRect(left, top, size.width, size.height));
    }
  }

  /** Modal-ish prompt used by the "Add correction" context-menu action. */
  promptForRule(options: RulePromptOptions): void {
    this.hidePrompt();
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = 'prompt';
    el.innerHTML = `
      <div class="title">Add a correction</div>
      <div class="sub">Replace <b></b> with:</div>
      <input type="text" spellcheck="false" autocomplete="off" />
      <div class="err"></div>
      <div class="row">
        <button type="button" class="cancel">Cancel</button>
        <button type="button" class="primary">Add</button>
      </div>`;
    (el.querySelector('.sub b') as HTMLElement).textContent = options.original;
    const input = el.querySelector('input') as HTMLInputElement;
    const errorEl = el.querySelector('.err') as HTMLElement;

    const close = () => {
      this.hidePrompt();
      options.onCancel?.();
    };
    const submit = () => {
      const error = options.onSubmit(input.value);
      if (error) {
        errorEl.textContent = error;
        input.focus();
        return;
      }
      this.hidePrompt();
    };

    (el.querySelector('.primary') as HTMLElement).addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      submit();
    });
    (el.querySelector('.cancel') as HTMLElement).addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    // Keystrokes must not reach the host page's editor or its shortcuts.
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    el.addEventListener('mousedown', (e) => e.stopPropagation());

    layer.appendChild(el);
    this.prompt = el;
    const rects = options.getRects?.() ?? [];
    if (rects.length > 0) this.positionNear(el, rects);
    else this.centre(el);
    this.startListening();
    input.focus();
    input.select();
  }

  hidePrompt(): void {
    this.prompt?.remove();
    this.prompt = null;
    this.maybeStopListening();
  }

  toast(message: string, kind: 'info' | 'warn' = 'info'): void {
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = `toast ${kind === 'warn' ? 'warn' : ''}`;
    el.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'warn' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.textContent = message;
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
  }

  private positionNear(el: HTMLElement, rects: DOMRect[]): void {
    const rect = rects[0];
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    if (!rect) {
      el.style.left = '16px';
      el.style.top = '16px';
      return;
    }
    // Measure after insertion so we know the real size.
    const size = el.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + size.width > viewportW - 8) left = Math.max(8, viewportW - size.width - 8);
    if (top + size.height > viewportH - 8) top = Math.max(8, rect.top - size.height - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }

  private reposition(): void {
    if (this.held) {
      const rects = this.held.getRects();
      const nodes = this.held.nodes;
      // Rebuild when the shape changed (reflow, wrapped line, etc.).
      if (rects.length !== nodes.length) {
        this.hold(this.held.getRects);
      } else {
        rects.forEach((r, i) => applyRect(nodes[i]!, r));
      }
    }
    if (this.card) this.positionNear(this.card.el, this.card.getRects());
    if (this.chip) this.positionNear(this.chip.el, this.chip.getRects());
    if (this.badge) this.positionNear(this.badge.el, this.badge.getRects());
    if (this.markup) this.positionMarkup();
  }

  private centre(el: HTMLElement): void {
    const size = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, (window.innerWidth - size.width) / 2)}px`;
    el.style.top = `${Math.max(8, (window.innerHeight - size.height) / 3)}px`;
  }

  private maybeStopListening(): void {
    if (!this.held && !this.card && !this.chip && !this.badge && !this.prompt && !this.markup) {
      this.stopListening();
    }
  }

  /** Removes every trace of the extension's UI from the page. */
  destroy(): void {
    this.stopListening();
    if (this.badgeTimer !== undefined) window.clearTimeout(this.badgeTimer);
    this.badgeTimer = undefined;
    this.held = null;
    this.card = null;
    this.chip = null;
    this.badge = null;
    this.markup = null;
    this.prompt = null;
    this.host?.remove();
    this.host = null;
    this.layer = null;
  }
}

/** Renders spaces as visible middots so a whitespace-only fix can be seen. */
function visibleWhitespace(text: string): Node[] {
  const out: Node[] = [];
  for (const part of text.split(/(\s)/)) {
    if (part === '') continue;
    if (/^\s$/.test(part)) {
      const marker = document.createElement('span');
      marker.className = 'ws';
      marker.textContent = '·';
      out.push(marker);
    } else {
      out.push(document.createTextNode(part));
    }
  }
  return out;
}

function applyRect(el: HTMLElement, r: DOMRect): void {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${Math.max(r.width, 2)}px`;
  el.style.height = `${r.height}px`;
}

/**
 * Correction list renderer.
 *
 * Plain DOM with event delegation and incremental rendering: only the first
 * page of items is built, more are appended when the sentinel scrolls into
 * view, so a session with hundreds of corrections stays responsive.
 */
import type { CorrectionRecord } from '../shared/types.js';
import { holdsReplacement } from '../history/correction-record.js';
import { ruleDefinition, ruleIdForCorrectionType } from '../shared/rules.js';
import {
  STATUS_LABEL,
  confidenceText,
  detailRows,
  relativeTime,
  typeLabel,
} from './correction-details.js';

function ruleLabel(ruleId: string): string {
  return ruleDefinition(ruleId)?.label ?? ruleId;
}

export type ItemAction =
  | 'jump'
  | 'accept'
  | 'revert'
  | 'keep-no-learn'
  | 'never'
  | 'dictionary'
  | 'context'
  | 'lower'
  | 'dismiss'
  | 'toggle-details'
  /* Scoped actions - see CorrectionAction in shared/messages.ts. */
  | 'always-prefer'
  | 'suggestion-only'
  | 'disable-rule'
  | 'ignore-once'
  | 'ignore-in-document'
  | 'ignore-on-site';

export interface ListCallbacks {
  onAction(recordId: string, action: ItemAction): void;
  onSelectionChange(ids: string[]): void;
}

export type DisplayMode = 'compact' | 'detailed';

const PAGE = 40;
let nextListInstance = 0;

export class CorrectionList {
  private records: CorrectionRecord[] = [];
  private rendered = 0;
  private currentId: string | undefined;
  private selected = new Set<string>();
  private expanded = new Set<string>();
  private readonly instanceId = ++nextListInstance;
  private nextDomId = 0;
  private readonly domIds = new Map<string, string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly sentinel: HTMLElement,
    private readonly callbacks: ListCallbacks,
  ) {
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);

    try {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) this.renderMore();
      });
      observer.observe(this.sentinel);
    } catch {
      // Without IntersectionObserver everything is rendered eagerly.
      this.renderMore = () => this.appendAll();
    }
  }

  /**
   * Compact mode drops the context line, the meta line and the details block,
   * leaving one row per correction. It is a density control, not a different
   * feature set: every action is still reachable through "⋯".
   */
  setDisplayMode(mode: DisplayMode): void {
    if (this.displayMode === mode) return;
    this.displayMode = mode;
    this.root.classList.toggle('compact', mode === 'compact');
    this.render(this.records, this.currentId);
  }

  private displayMode: DisplayMode = 'detailed';

  render(records: CorrectionRecord[], currentId?: string): void {
    this.records = records;
    this.currentId = currentId;
    this.rendered = 0;
    this.nextDomId = 0;
    this.domIds.clear();
    this.root.textContent = '';
    // Only records whose replacement is still in the document can be bulk
    // reverted. Drop selections as soon as a record leaves that state.
    const selectable = new Set(records.filter(holdsReplacement).map((r) => r.id));
    for (const id of [...this.selected]) if (!selectable.has(id)) this.selected.delete(id);
    this.renderMore();
    this.callbacks.onSelectionChange([...this.selected]);
  }

  private renderMore = (): void => {
    const next = Math.min(this.records.length, this.rendered + PAGE);
    for (let i = this.rendered; i < next; i++) {
      this.root.appendChild(this.buildItem(this.records[i]!));
    }
    this.rendered = next;
  };

  private appendAll(): void {
    for (let i = this.rendered; i < this.records.length; i++) {
      this.root.appendChild(this.buildItem(this.records[i]!));
    }
    this.rendered = this.records.length;
  }

  selection(): string[] {
    return [...this.selected];
  }

  clearSelection(): void {
    this.selected.clear();
    for (const box of Array.from(this.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))) {
      box.checked = false;
    }
    this.callbacks.onSelectionChange([]);
  }

  private buildItem(record: CorrectionRecord): HTMLElement {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.id = record.id;
    if (record.id === this.currentId) {
      li.classList.add('current');
      li.setAttribute('aria-current', 'true');
    }
    if (record.status === 'reverted' || record.status === 'rejected') li.classList.add('reverted');
    if (this.expanded.has(record.id)) li.classList.add('expanded');

    if (holdsReplacement(record)) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.selected.has(record.id);
      box.title = 'Select for bulk revert';
      box.setAttribute(
        'aria-label',
        `Select ${record.originalText} to ${record.replacementText} for bulk revert`,
      );
      li.appendChild(box);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'selection-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      li.appendChild(spacer);
    }

    const body = document.createElement('div');
    body.className = 'body';

    const diff = document.createElement('div');
    diff.className = 'diff';
    const oldSpan = document.createElement('span');
    oldSpan.className = 'old';
    oldSpan.textContent = record.originalText;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const newSpan = document.createElement('span');
    newSpan.className = 'new';
    newSpan.textContent = record.replacementText;
    diff.append(oldSpan, arrow, newSpan);
    body.appendChild(diff);

    const compact = this.displayMode === 'compact';

    if (record.contextPreview && !compact) {
      const ctx = document.createElement('div');
      ctx.className = 'ctx';
      ctx.textContent = `“${record.contextPreview}”`;
      body.appendChild(ctx);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const status = document.createElement('span');
    status.className = `status-tag status-${record.status}`;
    status.textContent = STATUS_LABEL[record.status];
    if (compact) {
      // One line: what kind of change it was, and whether it still stands.
      meta.append(document.createTextNode(`${typeLabel(record.correctionType)} · `), status);
    } else {
      meta.append(
        document.createTextNode(
          `${typeLabel(record.correctionType)} · ${confidenceText(record.confidence)} · `,
        ),
        status,
        document.createTextNode(
          ` · ${record.autoApplied ? 'automatic' : 'accepted suggestion'}`,
        ),
        document.createTextNode(` · ${relativeTime(record.createdAt)}`),
      );
      if (record.sourceRuleId) {
        const rule = document.createElement('span');
        rule.className = 'rule-id';
        rule.textContent = record.sourceRuleId;
        rule.title = 'Rule that produced this correction';
        meta.append(document.createTextNode(' · '), rule);
      }
    }
    body.appendChild(meta);

    if (record.failureReason) {
      const warn = document.createElement('div');
      warn.className = 'warn';
      warn.textContent = record.failureReason;
      body.appendChild(warn);
    }

    body.appendChild(this.buildActions(record));
    body.appendChild(this.buildMoreActions(record));
    body.appendChild(this.buildDetails(record));

    li.appendChild(body);
    return li;
  }

  private buildActions(record: CorrectionRecord): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'actions';
    const add = (action: ItemAction, label: string, title?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = action;
      b.textContent = label;
      if (title) b.title = title;
      wrap.appendChild(b);
    };

    const live = record.status !== 'superseded';
    if (live) add('jump', 'Go to', 'Scroll to this correction and highlight it');

    switch (record.status) {
      case 'pending':
      case 'skipped':
        add('accept', 'Accept');
        add('revert', 'Reject & revert');
        break;
      case 'accepted':
      case 'auto-accepted':
        add('revert', 'Revert');
        break;
      case 'unresolved':
        add('dismiss', 'Remove from list');
        break;
      default:
        break;
    }
    const ids = this.idsFor(record.id);
    add('toggle-details', '⋯', 'More actions and details');
    const toggle = wrap.lastElementChild as HTMLButtonElement;
    toggle.setAttribute(
      'aria-label',
      `More actions and details for ${record.originalText} to ${record.replacementText}`,
    );
    toggle.setAttribute('aria-expanded', String(this.expanded.has(record.id)));
    toggle.setAttribute('aria-controls', `${ids.more} ${ids.details}`);
    return wrap;
  }

  private buildMoreActions(record: CorrectionRecord): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'more';
    wrap.id = this.idsFor(record.id).more;
    const add = (action: ItemAction | 'undo', label: string, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = action;
      b.textContent = label;
      b.title = title;
      wrap.appendChild(b);
    };
    const holds = holdsReplacement(record);
    // Records written before rule controls existed have no stamped rule; fall
    // back to the display type so their entries still offer the action.
    const ruleId = record.controlRuleId ?? ruleIdForCorrectionType(record.correctionType);
    // Punctuation and grammar are learned per rule, never as word pairs, so
    // "always prefer this" would be meaningless (or dangerous) for them.
    const wordPair =
      !record.sourceRuleId?.startsWith('punctuation:')
      && !record.sourceRuleId?.startsWith('harper:');

    if (holds) {
      if (record.status === 'pending' || record.status === 'skipped') {
        add('keep-no-learn', 'Keep, don’t learn', 'Leave the replacement but do not reinforce the rule');
      }
      add('undo', 'Undo', 'Restore the original text');
      if (wordPair) {
        add(
          'always-prefer',
          'Always prefer this',
          `Always replace “${record.originalText}” with “${record.replacementText}”`,
        );
      }
      add('lower', 'Revert & lower confidence', 'Revert and require stronger evidence next time');
      add(
        'never',
        'Never make this correction',
        `Never replace “${record.originalText}” with “${record.replacementText}”`,
      );
      if (record.contextWords?.previous || record.contextWords?.next) {
        add('context', 'Not in this context', 'Keep the rule but block it in this neighboring-word context');
      }
    }

    if (ruleId) {
      add(
        'suggestion-only',
        'Show this rule as a suggestion',
        `Stop “${ruleLabel(ruleId)}” from changing text on its own`,
      );
      add('disable-rule', 'Disable this rule', `Turn “${ruleLabel(ruleId)}” off entirely`);
    }

    add('dictionary', `Add “${record.originalText}” to dictionary`, 'Never correct this word again');
    add('ignore-once', 'Ignore once', 'Undo this one, but keep the rule as it is');
    add('ignore-in-document', 'Ignore in this document', 'Do not offer this again while this page is open');
    add('ignore-on-site', 'Ignore on this website', 'Do not offer this again on this site');
    return wrap;
  }

  private buildDetails(record: CorrectionRecord): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'details';
    wrap.id = this.idsFor(record.id).details;
    const dl = document.createElement('dl');
    for (const [key, value] of detailRows(record)) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    wrap.appendChild(dl);
    return wrap;
  }

  private onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>('button[data-action]');
    const li = target.closest<HTMLElement>('.item');
    if (!li?.dataset.id) return;
    const id = li.dataset.id;

    if (!button) {
      // Clicking the row itself jumps to the correction.
      if (!(target instanceof HTMLInputElement)) this.callbacks.onAction(id, 'jump');
      return;
    }
    const action = button.dataset.action as ItemAction;
    if (action === 'toggle-details') {
      li.classList.toggle('expanded');
      const isExpanded = li.classList.contains('expanded');
      button.setAttribute('aria-expanded', String(isExpanded));
      if (isExpanded) this.expanded.add(id);
      else this.expanded.delete(id);
      return;
    }
    this.callbacks.onAction(id, action);
  };

  private onChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const li = target.closest<HTMLElement>('.item');
    const id = li?.dataset.id;
    if (!id) return;
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record || !holdsReplacement(record)) {
      target.checked = false;
      this.selected.delete(id);
      this.callbacks.onSelectionChange([...this.selected]);
      return;
    }
    if (target.checked) this.selected.add(id);
    else this.selected.delete(id);
    this.callbacks.onSelectionChange([...this.selected]);
  };

  private idsFor(recordId: string): { more: string; details: string } {
    let base = this.domIds.get(recordId);
    if (!base) {
      base = `correction-list-${this.instanceId}-${++this.nextDomId}`;
      this.domIds.set(recordId, base);
    }
    return { more: `${base}-more`, details: `${base}-details` };
  }
}

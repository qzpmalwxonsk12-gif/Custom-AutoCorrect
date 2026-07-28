/**
 * Guided review: the progress bar plus keyboard shortcuts.
 *
 * The shortcuts live in the panel document, never in the page, so they cannot
 * clash with a website's own key handling.
 */
import type { PanelCommand, PanelState } from '../shared/messages.js';
import type { ReviewAction, Settings } from '../shared/types.js';

export interface ReviewElements {
  bar: HTMLElement;
  progress: HTMLElement;
  hint: HTMLElement;
  keep: HTMLButtonElement;
  revert: HTMLButtonElement;
  skip: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  exit: HTMLButtonElement;
}

type Dispatch = (command: PanelCommand) => Promise<boolean>;

const KEY_NAMES: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
};

function keyLabel(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^Key/, '');
}

export class ReviewMode {
  private currentId: string | undefined;
  private active = false;

  constructor(
    private readonly el: ReviewElements,
    private readonly getSettings: () => Settings,
    private readonly dispatch: Dispatch,
  ) {
    el.keep.addEventListener('click', () => void this.decide('keep'));
    el.revert.addEventListener('click', () => void this.decide('revert'));
    el.skip.addEventListener('click', () => void this.decide('skip'));
    el.prev.addEventListener('click', () => void this.dispatch({ type: 'review-previous' }));
    el.next.addEventListener('click', () => void this.dispatch({ type: 'review-next' }));
    el.exit.addEventListener('click', () => void this.dispatch({ type: 'exit-review' }));
    document.addEventListener('keydown', this.onKeyDown);
  }

  update(state: PanelState | null): void {
    const review = state?.review ?? null;
    this.active = review?.active ?? false;
    this.currentId = review?.currentId;
    this.el.bar.hidden = !this.active;
    if (!review) return;
    this.el.progress.textContent = `Reviewing ${review.position} of ${review.total}`;

    const s = this.getSettings();
    this.el.hint.textContent = s.shortcutsEnabled
      ? `${keyLabel(s.reviewShortcuts.keep)} keep · ${keyLabel(s.reviewShortcuts.revert)} revert · ` +
        `${keyLabel(s.reviewShortcuts.next)} next · ${keyLabel(s.reviewShortcuts.previous)} back · ` +
        `${keyLabel(s.reviewShortcuts.dictionary)} dictionary · ${keyLabel(s.reviewShortcuts.never)} never · ` +
        `${keyLabel(s.reviewShortcuts.exit)} exit`
      : 'Keyboard shortcuts are disabled in settings.';
  }

  private async decide(
    kind: 'keep' | 'revert' | 'skip' | 'dictionary' | 'never',
  ): Promise<void> {
    if (!this.currentId) return;
    const decision =
      kind === 'keep'
        ? 'keep'
        : kind === 'revert'
          ? 'revert'
          : kind === 'skip'
            ? 'skip'
            : kind === 'dictionary'
              ? 'revert-dictionary'
              : 'revert-never';
    // One content-side command makes the decision and advances only if it
    // succeeded. A missing/ambiguous revert therefore stays current.
    await this.dispatch({ type: 'review-decide', recordId: this.currentId, decision });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const settings = this.getSettings();
    if (!settings.shortcutsEnabled) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const map = settings.reviewShortcuts;
    const code = event.code;
    const match = (Object.keys(map) as ReviewAction[]).find((action) => map[action] === code);
    if (!match) return;
    event.preventDefault();

    switch (match) {
      case 'keep':
        void this.decide('keep');
        break;
      case 'revert':
        void this.decide('revert');
        break;
      case 'next':
        void this.dispatch({ type: 'review-next' });
        break;
      case 'previous':
        void this.dispatch({ type: 'review-previous' });
        break;
      case 'dictionary':
        void this.decide('dictionary');
        break;
      case 'never':
        void this.decide('never');
        break;
      case 'exit':
        void this.dispatch({ type: 'exit-review' });
        break;
    }
  };
}

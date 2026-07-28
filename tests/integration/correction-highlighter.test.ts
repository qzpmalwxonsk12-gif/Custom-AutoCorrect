import { afterEach, describe, expect, it } from 'vitest';
import { CorrectionHighlighter } from '../../src/content/correction-highlighter.js';

const highlighters: CorrectionHighlighter[] = [];

function makeHighlighter(): CorrectionHighlighter {
  const highlighter = new CorrectionHighlighter();
  highlighters.push(highlighter);
  return highlighter;
}

function layerOf(highlighter: CorrectionHighlighter): HTMLElement {
  return (highlighter as unknown as { layer: HTMLElement | null }).layer!;
}

function rect(): DOMRect {
  return {
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    right: 50,
    bottom: 30,
    width: 40,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  for (const highlighter of highlighters.splice(0)) highlighter.destroy();
});

describe('in-page correction UI isolation', () => {
  it('keeps its controls in a closed shadow root', () => {
    const highlighter = makeHighlighter();
    highlighter.showCard({
      getRects: () => [rect()],
      original: 'waht',
      replacement: 'what',
      context: 'I typed waht here',
      typeLabel: 'Spelling',
      confidence: 0.96,
      reason: 'Common typo',
      statusLabel: 'Pending',
      actions: [{ id: 'keep', label: 'Keep', primary: true }],
      onAction: () => undefined,
    });

    const host = document.querySelector<HTMLElement>('[data-personal-autocorrect-ui="root"]');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).toBeNull();
    expect(layerOf(highlighter).querySelector('[role="region"]')).not.toBeNull();

    highlighter.destroy();
    expect(document.querySelector('[data-personal-autocorrect-ui="root"]')).toBeNull();
  });

  it('rejects synthetic card action clicks', () => {
    const actions: string[] = [];
    const highlighter = makeHighlighter();
    highlighter.showCard({
      getRects: () => [rect()],
      original: 'waht',
      replacement: 'what',
      context: '',
      typeLabel: 'Spelling',
      confidence: 0.96,
      reason: '',
      statusLabel: 'Pending',
      actions: [{ id: 'revert', label: 'Revert', danger: true }],
      onAction: (id) => actions.push(id),
    });

    layerOf(highlighter).querySelector<HTMLButtonElement>('button')!.click();
    expect(actions).toEqual([]);
  });

  it('rejects synthetic suggestion accept and dismiss clicks', () => {
    let accepts = 0;
    let dismissals = 0;
    const highlighter = makeHighlighter();
    highlighter.showSuggestion(
      () => [rect()],
      'what',
      () => accepts++,
      () => dismissals++,
    );

    const buttons = layerOf(highlighter).querySelectorAll<HTMLButtonElement>('.chip button');
    buttons[0]!.click();
    buttons[1]!.click();
    expect(accepts).toBe(0);
    expect(dismissals).toBe(0);
    expect(buttons[1]!.getAttribute('aria-label')).toBe('Dismiss suggestion');
  });
});

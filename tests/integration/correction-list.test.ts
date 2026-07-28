import { afterEach, describe, expect, it } from 'vitest';
import { CorrectionList } from '../../src/side-panel/correction-list.js';
import type { CorrectionRecord, CorrectionStatus } from '../../src/shared/types.js';
import { recordAt } from '../helpers.js';

function makeRecord(
  id: string,
  status: CorrectionStatus,
  contextWords?: { previous: string; next: string },
): CorrectionRecord {
  const record = recordAt('I think what happened', 8, 'waht', 'what');
  record.id = id;
  record.status = status;
  if (contextWords) record.contextWords = contextWords;
  return record;
}

function setup() {
  const root = document.createElement('ul');
  const sentinel = document.createElement('div');
  document.body.append(root, sentinel);
  const selectionChanges: string[][] = [];
  const actions: Array<[string, string]> = [];
  const list = new CorrectionList(root, sentinel, {
    onAction: (id, action) => actions.push([id, action]),
    onSelectionChange: (ids) => selectionChanges.push(ids),
  });
  return { root, list, selectionChanges, actions };
}

afterEach(() => {
  document.body.textContent = '';
});

describe('correction list selection', () => {
  it('offers bulk selection only while the replacement is still present', () => {
    const { root, list } = setup();
    const records = [
      makeRecord('pending', 'pending'),
      makeRecord('skipped', 'skipped'),
      makeRecord('accepted', 'accepted'),
      makeRecord('auto', 'auto-accepted'),
      makeRecord('reverted', 'reverted'),
      makeRecord('rejected', 'rejected'),
      makeRecord('unresolved', 'unresolved'),
      makeRecord('superseded', 'superseded'),
    ];

    list.render(records, 'pending');

    const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(4);
    expect([...boxes].every((box) => box.getAttribute('aria-label')?.includes('bulk revert'))).toBe(true);
    expect(root.querySelector('[data-id="pending"]')?.getAttribute('aria-current')).toBe('true');
    expect(root.querySelectorAll('.selection-spacer')).toHaveLength(4);
  });

  it('drops a selection when its record is no longer revertible', () => {
    const { root, list, selectionChanges } = setup();
    const record = makeRecord('target', 'pending');
    list.render([record]);

    const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(list.selection()).toEqual(['target']);

    record.status = 'reverted';
    list.render([record]);
    expect(list.selection()).toEqual([]);
    expect(selectionChanges.at(-1)).toEqual([]);
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe('correction list actions', () => {
  it('shows actions only when they still have the stated effect', () => {
    const { root, list } = setup();
    list.render([
      makeRecord('pending', 'pending'),
      makeRecord('contextual', 'skipped', { previous: 'think', next: 'happened' }),
      makeRecord('accepted', 'accepted'),
    ]);

    expect(root.querySelector('[data-id="pending"] [data-action="keep-no-learn"]')).not.toBeNull();
    expect(root.querySelector('[data-id="accepted"] [data-action="keep-no-learn"]')).toBeNull();
    expect(root.querySelector('[data-id="pending"] [data-action="context"]')).toBeNull();
    expect(root.querySelector('[data-id="contextual"] [data-action="context"]')).not.toBeNull();
  });

  it('connects the details toggle to both controlled regions', () => {
    const { root, list } = setup();
    list.render([makeRecord('target', 'pending')]);

    const toggle = root.querySelector<HTMLButtonElement>('[data-action="toggle-details"]')!;
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controlled = toggle.getAttribute('aria-controls')!.split(' ');
    expect(controlled).toHaveLength(2);
    expect(controlled.every((id) => document.getElementById(id))).toBe(true);

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-id="target"]')?.classList.contains('expanded')).toBe(true);
  });

  it('shows concise keyboard-substitution evidence in the side panel', () => {
    const { root, list } = setup();
    const record = makeRecord('keyboard', 'pending');
    record.originalText = 'surriunding';
    record.replacementText = 'surrounding';
    record.correctionType = 'keyboard-proximity';
    record.keyboardSubstitution = {
      index: 4,
      typedCharacter: 'i',
      replacementCharacter: 'o',
      neighbourMapMatched: true,
      keyDistance: 1,
    };

    list.render([record]);
    const details = root.querySelector('[data-id="keyboard"] .details')?.textContent ?? '';
    expect(details).toContain('Keyboard-neighbour substitution');
    expect(details).toContain('Position 5: i → o');
    expect(details).toContain('ESDB');
    expect(details).not.toContain('keyDistance');
  });
});

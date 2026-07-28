/**
 * Per-rule modes, shadow mode, pause and per-field disabling, exercised through
 * the real controller against a real field.
 *
 * Each of these can silently stop the extension working, so each one is held to
 * the same two questions: did the text change, and was exactly one record kept?
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController, touchesCodeDelimiter } from '../../src/content/editable-controller.js';
import { essentialPunctuationProvider } from '../../src/engine/punctuation/punctuation-provider.js';
import { upsertEntry } from '../../src/shared/vocabulary.js';
import { makeHost, makeTextarea, typeInto } from './dom-helpers.js';

const controllers: EditableController[] = [];
let chip: { replacement: string; accept: () => void; dismiss: () => void } | null = null;

function setup(overrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea('');
  const host = makeHost(overrides);
  (host.highlighter as unknown as {
    showSuggestion: (r: unknown, replacement: string, a: () => void, d: () => void) => void;
  }).showSuggestion = (_r, replacement, accept, dismiss) => {
    chip = { replacement, accept, dismiss };
  };
  (host.highlighter as unknown as { hideSuggestion: () => void }).hideSuggestion = () => {
    chip = null;
  };
  const controller = new EditableController(new InputAdapter(field), host);
  controller.attach();
  controllers.push(controller);
  return { field, host, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
  chip = null;
  essentialPunctuationProvider.clearCache();
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
  vi.useRealTimers();
});

describe('baseline', () => {
  it('corrects and records with default settings', () => {
    const { field, controller } = setup();
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think the ');
    expect(controller.session.records).toHaveLength(1);
  });
});

describe('per-rule modes', () => {
  it('“suggestion only” stops a rule writing text but still offers it', () => {
    const { field, controller } = setup({
      settings: { ruleModes: { 'spelling:duplicate-letter': 'suggestion' } },
    });
    typeInto(field, 'Type the punctuatioon ');

    expect(field.value).toBe('Type the punctuatioon ');
    expect(controller.session.records).toHaveLength(0);
    expect(chip?.replacement).toBe('punctuation');

    // Accepting the chip still produces exactly one record.
    chip!.accept();
    expect(field.value).toBe('Type the punctuation ');
    expect(controller.session.records).toHaveLength(1);
  });

  it('“disabled” produces neither a change nor a suggestion', () => {
    const { field, controller } = setup({
      settings: { ruleModes: { 'spelling:duplicate-letter': 'disabled' } },
    });
    typeInto(field, 'Type the punctuatioon ');

    expect(field.value).toBe('Type the punctuatioon ');
    expect(controller.session.records).toHaveLength(0);
    expect(chip).toBeNull();
  });

  it('leaves other rules alone when one is disabled', () => {
    const { field, controller } = setup({
      settings: { ruleModes: { 'spelling:duplicate-letter': 'disabled' } },
    });
    typeInto(field, 'Try nromal ');
    expect(field.value).toBe('Try normal ');
    expect(controller.session.records).toHaveLength(1);
  });

  it('applies a site override ahead of the global mode', () => {
    const { field } = setup({
      settings: {
        ruleModes: { 'spelling:adjacent-swap': 'automatic' },
        siteRuleModes: { 'https://example.com': { 'spelling:adjacent-swap': 'disabled' } },
      },
    });
    typeInto(field, 'Try nromal ');
    expect(field.value).toBe('Try nromal ');
  });

  /**
   * The curated typo table is not one of the controllable rules: it is a list
   * of known misspellings, not a similarity heuristic. Disabling dictionary
   * similarity must not take it down with it.
   */
  it('does not let a rule mode disable the curated typo table', () => {
    const { field } = setup({
      settings: {
        ruleModes: {
          'spelling:dictionary': 'disabled',
          'spelling:adjacent-swap': 'disabled',
        },
      },
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think the ');
  });
});

describe('writing profiles', () => {
  it('the minimal profile keeps curated typo fixes', () => {
    const { field } = setup({ settings: { profile: 'minimal' } });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think the ');
  });

  it('the minimal profile stops the broad dictionary rule', () => {
    const { field, controller } = setup({ settings: { profile: 'minimal' } });
    typeInto(field, 'Type the improvementability ');
    // Splitting is disabled in this profile, so the token is left as typed.
    expect(field.value).toBe('Type the improvementability ');
    expect(controller.session.records).toHaveLength(0);
  });

  it('the coding profile refuses to touch a word beside a delimiter', () => {
    const { field, controller } = setup({ settings: { profile: 'coding' } });
    typeInto(field, 'call teh() ');
    expect(field.value).toBe('call teh() ');
    expect(controller.session.records).toHaveLength(0);
  });

  it('recognises the delimiters that mark an expression', () => {
    expect(touchesCodeDelimiter('call teh() here', 5, 8)).toBe(true);
    expect(touchesCodeDelimiter('a.teh here', 2, 5)).toBe(true);
    expect(touchesCodeDelimiter('I think teh cat', 8, 11)).toBe(false);
  });
});

describe('shadow mode', () => {
  it('records the correction instead of making it', () => {
    const { field, controller, host } = setup({ settings: { shadowMode: 'all' } });
    typeInto(field, 'Type the punctuatioon ');

    expect(field.value).toBe('Type the punctuatioon ');
    expect(controller.session.records).toHaveLength(0);
    expect(host.shadowObservations).toHaveLength(1);

    const [observation] = host.shadowObservations;
    expect(observation!.originalText).toBe('punctuatioon');
    expect(observation!.replacementText).toBe('punctuation');
    expect(observation!.wouldHave).toBe('autocorrect');
    expect(observation!.provider).toBe('spelling');
  });

  it('“experimental” holds back only the meaning-sensitive rules', () => {
    const { field, controller, host } = setup({ settings: { shadowMode: 'experimental' } });
    typeInto(field, 'Type the punctuatioon ');

    // A duplicate-letter fix is not experimental, so it applies as normal.
    expect(field.value).toBe('Type the punctuation ');
    expect(controller.session.records).toHaveLength(1);
    expect(host.shadowObservations).toHaveLength(0);
  });

  it('records a spacing fix under “experimental” without changing text', () => {
    const { field, host } = setup({ settings: { shadowMode: 'experimental' } });
    typeInto(field, 'Type the improvementability ');

    expect(field.value).toBe('Type the improvementability ');
    expect(host.shadowObservations.some((o) => o.provider === 'spacing')).toBe(true);
  });
});

describe('pause', () => {
  it('suspends corrections without discarding the session', () => {
    const { field, controller, host } = setup();
    typeInto(field, 'I think teh ');
    expect(controller.session.records).toHaveLength(1);

    host.paused = true;
    typeInto(field, 'and waht ');
    expect(field.value).toBe('I think the and waht ');
    // The earlier record survives the pause.
    expect(controller.session.records).toHaveLength(1);

    host.paused = false;
    typeInto(field, 'adn ');
    expect(field.value).toBe('I think the and waht and ');
    expect(controller.session.records).toHaveLength(2);
  });
});

describe('per-field disabling', () => {
  it('stops corrections in that field only', () => {
    const { field, controller, host } = setup();
    host.setSettings({
      disabledFields: [`https://example.com|${controller.fieldId}`],
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think teh ');
    expect(controller.session.records).toHaveLength(0);
  });
});

describe('personal vocabulary', () => {
  it('never corrects an allowed word', () => {
    const { field, host } = setup();
    upsertEntry(host.data.vocabulary, {
      kind: 'allowed-word',
      original: 'teh',
      scope: { kind: 'global' },
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think teh ');
  });

  it('never applies a blocked pair', () => {
    const { field, host } = setup();
    upsertEntry(host.data.vocabulary, {
      kind: 'blocked',
      original: 'teh',
      replacement: 'the',
      scope: { kind: 'global' },
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think teh ');
  });

  it('ignores a block scoped to a different site', () => {
    const { field, host } = setup();
    upsertEntry(host.data.vocabulary, {
      kind: 'blocked',
      original: 'teh',
      replacement: 'the',
      scope: { kind: 'site', origin: 'https://elsewhere.example' },
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think the ');
  });

  it('invalidates the resolved view when storage replaces a same-size snapshot', () => {
    const { field, host } = setup();
    upsertEntry(host.data.vocabulary, {
      kind: 'allowed-word',
      original: 'teh',
      scope: { kind: 'global' },
    });
    typeInto(field, 'I think teh ');
    expect(field.value).toBe('I think teh ');

    // Storage/config propagation replaces snapshots wholesale. The number of
    // entries can stay unchanged even though their meaning changed.
    host.data.vocabulary = {
      version: host.data.vocabulary.version,
      entries: [{
        id: 'blocked|waht|what|g',
        kind: 'blocked',
        original: 'waht',
        replacement: 'what',
        scope: { kind: 'global' },
        createdAt: Date.now(),
      }],
    };
    typeInto(field, 'and waht ');

    expect(field.value).toBe('I think teh and waht ');
  });
});

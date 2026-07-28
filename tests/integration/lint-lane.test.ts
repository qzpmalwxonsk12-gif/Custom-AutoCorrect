/**
 * Grammar (Harper) lane behaviour with a mocked host: request gating,
 * one-in-flight queueing, stale-response rejection, paragraph-fingerprint
 * validation, chip accept/dismiss, and the learning branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAdapter } from '../../src/content/input-adapter.js';
import { EditableController } from '../../src/content/editable-controller.js';
import type { GrammarIssue, LintResponse } from '../../src/shared/grammar.js';
import type { Result } from '../../src/shared/messages.js';
import { fnv1a } from '../../src/shared/util.js';
import { learning as makeLearning } from '../helpers.js';
import { inputEvent, makeHost, makeTextarea, typeInto } from './dom-helpers.js';

const PARAGRAPH = 'Yesterday I has a dog and it was fine.';

function agreementIssue(paragraph: string): GrammarIssue {
  const start = paragraph.indexOf('has');
  return {
    ruleId: 'SubjectVerbAgreement',
    kind: 'Agreement',
    message: 'Use "have" here.',
    start,
    end: start + 3,
    original: 'has',
    replacement: 'have',
    ignoreHash: '424242',
  };
}

function respond(issues: GrammarIssue[]): Result<LintResponse> {
  return { ok: true, data: { issues, lintMs: 1 } };
}

interface ChipCapture {
  replacement: string;
  accept: () => void;
  dismiss: () => void;
}

const controllers: EditableController[] = [];
let chip: ChipCapture | null = null;

function setup(initial = '', hostOverrides: Parameters<typeof makeHost>[0] = {}) {
  const field = makeTextarea(initial);
  const host = makeHost({
    // These tests exercise the Harper lane in isolation. The punctuation lane
    // runs first in the same idle pass, so it is switched off here; the two
    // lanes' interaction is covered in punctuation-lane.test.ts.
    settings: {
      harperEnabled: true,
      punctuationEnabled: false,
      ...(hostOverrides.settings ?? {}),
    },
    learning: hostOverrides.learning,
  });
  // Capture chips so tests can click them.
  (host.highlighter as unknown as {
    showSuggestion: (r: unknown, replacement: string, a: () => void, d: () => void) => void;
  }).showSuggestion = (_rects, replacement, accept, dismiss) => {
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

/** Flushes the idle timer plus the microtasks of a resolved lint response. */
async function idle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(800);
  await vi.advanceTimersByTimeAsync(0);
}

/** Flushes promise reactions without advancing a newly scheduled idle pass. */
async function settleResponse(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  chip = null;
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.detach();
  document.body.textContent = '';
  vi.useRealTimers();
});

describe('request gating', () => {
  it('lints the caret paragraph after idle and offers a chip', async () => {
    const { host } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    const { field } = { field: document.querySelector('textarea')! };
    typeInto(field, PARAGRAPH);
    await idle();

    expect(host.lintRequests).toHaveLength(1);
    expect(host.lintRequests[0]!.paragraph).toBe(PARAGRAPH);
    expect(host.lintRequests[0]!.fingerprint).toBe(fnv1a(PARAGRAPH));
    expect(chip?.replacement).toBe('have');
    expect(host.grammarEvents).toEqual([
      { ruleId: 'SubjectVerbAgreement', verdict: 'offered' },
    ]);
  });

  it('sends nothing when Harper is disabled', async () => {
    const { field, host } = setup('', { settings: { harperEnabled: false } });
    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(0);
  });

  it('skips short paragraphs', async () => {
    const { field, host } = setup();
    typeInto(field, 'short one ');
    await idle();
    expect(host.lintRequests).toHaveLength(0);
  });

  it('does not re-lint an unchanged clean paragraph', async () => {
    const { field, host } = setup();
    host.lintResponder = async () => respond([]);
    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(1);
    // Another idle pass without text changes: cache hit, no second request.
    field.dispatchEvent(inputEvent('deleteContentBackward', null));
    field.dispatchEvent(inputEvent('insertText', 'x'));
    field.value = PARAGRAPH; // net result identical
    await idle();
    expect(host.lintRequests).toHaveLength(1);
  });

  it('keeps exactly one request in flight and coalesces the rest', async () => {
    const { field, host } = setup();
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(1);

    // More typing while the first request is pending: no second request yet.
    typeInto(field, ' More words arrive now.');
    await idle();
    expect(host.lintRequests).toHaveLength(1);

    // Releasing the stale response triggers exactly one follow-up request.
    release(respond([]));
    await idle();
    expect(host.lintRequests).toHaveLength(2);
    expect(host.lintRequests[1]!.paragraph).toBe(`${PARAGRAPH} More words arrive now.`);
  });
});

describe('async-result safety gates', () => {
  it('drops a pending response after the controller detaches', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperAutoApply: true },
    });
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(1);

    controller.detach();
    release(respond([agreementIssue(PARAGRAPH)]));
    await settleResponse();

    expect(field.value).toBe(PARAGRAPH);
    expect(controller.session.records).toHaveLength(0);
    expect(chip).toBeNull();
    expect(host.grammarEvents).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(host.lintRequests).toHaveLength(1);
  });

  it('drops a pending response when Harper is disabled', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperAutoApply: true },
    });
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(1);

    host.setSettings({ harperEnabled: false });
    release(respond([agreementIssue(PARAGRAPH)]));
    await settleResponse();

    expect(field.value).toBe(PARAGRAPH);
    expect(controller.session.records).toHaveLength(0);
    expect(chip).toBeNull();
    expect(host.grammarEvents).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(host.lintRequests).toHaveLength(1);
  });

  it('drops a pending response when IME composition starts', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperAutoApply: true },
    });
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    expect(host.lintRequests).toHaveLength(1);

    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    release(respond([agreementIssue(PARAGRAPH)]));
    await settleResponse();

    expect(field.value).toBe(PARAGRAPH);
    expect(controller.session.records).toHaveLength(0);
    expect(chip).toBeNull();
    expect(host.grammarEvents).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(host.lintRequests).toHaveLength(1);
  });

  it('drops a response whose linted bytes shifted (stale rejection)', async () => {
    const { field, host } = setup();
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    const staleIssue = agreementIssue(PARAGRAPH);

    // Typing at the START of the paragraph shifts every offset in the
    // in-flight response.
    field.setSelectionRange(0, 0);
    typeInto(field, 'Well ');
    release(respond([staleIssue]));
    await idle();

    // The stale offsets were never used: no chip from the first response.
    expect(host.grammarEvents.filter((e) => e.verdict === 'offered')).toHaveLength(0);
    expect(field.value).toContain('has');
  });

  it('still uses a response when the same paragraph only grew at the end', async () => {
    const { field, host } = setup();
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    const issue = agreementIssue(PARAGRAPH);

    // Appending leaves the linted slice byte-identical at the same offsets,
    // so the finding is still verified-safe to offer.
    typeInto(field, ' Extra.');
    release(respond([issue]));
    await idle();
    expect(chip?.replacement).toBe('have');
  });

  it('drops a response whose paragraph fingerprint no longer matches', async () => {
    const { field, host, controller } = setup();
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    typeInto(field, PARAGRAPH);
    await idle();

    // Mutate the text *without* an input event (host page script), so the
    // version counter alone cannot catch it - the fingerprint must.
    field.value = field.value.replace('dog', 'cat');
    void controller; // text changed behind the controller's back
    release(respond([agreementIssue(PARAGRAPH)]));
    await idle();

    expect(chip).toBeNull();
  });

  it('skips an issue whose span text drifted even when the paragraph matches', async () => {
    const { field, host } = setup();
    const issue = { ...agreementIssue(PARAGRAPH), original: 'had' };
    host.lintResponder = async () => respond([issue]);
    typeInto(field, PARAGRAPH);
    await idle();
    expect(chip).toBeNull();
  });
});

describe('chip decisions', () => {
  it('accepting applies the fix, records a grammar record, and counts acceptance', async () => {
    const { field, host, controller } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(field, PARAGRAPH);
    await idle();
    expect(chip).not.toBeNull();

    chip!.accept();
    expect(field.value).toBe(PARAGRAPH.replace('has', 'have'));

    const record = controller.session.records[0]!;
    expect(record).toMatchObject({
      originalText: 'has',
      replacementText: 'have',
      correctionType: 'grammar',
      sourceRuleId: 'harper:SubjectVerbAgreement',
      sourceIgnoreHash: '424242',
      autoApplied: false,
      learningApplied: true,
    });
    // Per-rule stats got offered + accepted; the word-pair model got nothing.
    expect(host.grammarEvents.map((e) => e.verdict)).toEqual(['offered', 'accepted']);
    expect(host.events.filter((e) => e.type === 'applied')).toHaveLength(0);
  });

  it('dismissing counts a rejection with the ignore hash and never re-offers', async () => {
    const { field, host } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(field, PARAGRAPH);
    await idle();

    chip!.dismiss();
    expect(host.grammarEvents.at(-1)).toEqual({
      ruleId: 'SubjectVerbAgreement',
      verdict: 'rejected',
      ignoreHash: '424242',
    });

    // Same text, same issue offered again by the engine: suppressed locally.
    typeInto(field, ' ');
    field.value = PARAGRAPH;
    field.setSelectionRange(PARAGRAPH.length, PARAGRAPH.length);
    field.dispatchEvent(inputEvent('deleteContentBackward', null));
    await idle();
    expect(chip).toBeNull();
    expect(host.grammarEvents.filter((e) => e.verdict === 'offered')).toHaveLength(1);
  });

  it('re-verifies the span at click time', async () => {
    const { field, host } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(field, PARAGRAPH);
    await idle();
    const accept = chip!.accept;

    // Host page rewrites the field between chip display and the click.
    field.value = 'Completely different text now.';
    accept();
    expect(field.value).toBe('Completely different text now.');
    expect(host.grammarEvents.filter((e) => e.verdict === 'accepted')).toHaveLength(0);
  });

  it('re-checks current rule policy when a previously offered chip is accepted', async () => {
    const { field, host, controller } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(field, PARAGRAPH);
    await idle();
    const accept = chip!.accept;

    host.setSettings({ ruleModes: { 'grammar:harper': 'disabled' } });
    accept();

    expect(field.value).toBe(PARAGRAPH);
    expect(controller.session.records).toHaveLength(0);
    expect(host.grammarEvents.filter((event) => event.verdict === 'accepted')).toHaveLength(0);
  });
});

describe('rich-editor hostility (the Wattpad class of problems)', () => {
  it('uses a response that raced an edit in a DIFFERENT paragraph', async () => {
    const text = `${PARAGRAPH}\nAnother paragraph sits down here fine.`;
    const { field, host } = setup();
    let release!: (r: Result<LintResponse>) => void;
    host.lintResponder = () => new Promise((resolve) => (release = resolve));

    field.value = text;
    field.setSelectionRange(PARAGRAPH.length, PARAGRAPH.length); // caret in P1
    field.dispatchEvent(inputEvent('insertText', ' '));
    await idle();
    expect(host.lintRequests.at(-1)!.paragraph).toBe(PARAGRAPH);

    // While the response is in flight, the user types in paragraph 2.
    field.setSelectionRange(text.length, text.length);
    typeInto(field, ' More.');

    release(respond([agreementIssue(PARAGRAPH)]));
    await idle();
    // P1 is byte-identical, so the chip must still appear.
    expect(chip?.replacement).toBe('have');
  });

  it('keeps a visible chip through synthetic no-op input events', async () => {
    const { field, host } = setup();
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(field, PARAGRAPH);
    await idle();
    expect(chip).not.toBeNull();

    // Autosave-style synthetic event: plain Event, no text change.
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(chip).not.toBeNull();

    // A real edit still dismisses it.
    typeInto(field, 'x');
    expect(chip).toBeNull();
  });

  it('backs off after repeated silent text churn instead of looping', async () => {
    const { field, host } = setup();
    const releases: Array<(r: Result<LintResponse>) => void> = [];
    host.lintResponder = () => new Promise((resolve) => releases.push(resolve));

    typeInto(field, PARAGRAPH);
    await idle();
    for (let round = 0; round < 3; round++) {
      // The site rewrites the field with no input event, shifting the linted
      // bytes so the in-flight response's fingerprint fails.
      field.value = `~${field.value}`;
      releases[round]!(respond([]));
      await idle();
    }
    const after = host.lintRequests.length;
    expect(after).toBe(3); // three drops -> backoff, no fourth request
    await idle();
    expect(host.lintRequests.length).toBe(after);
  });

  it('windows an oversized single-block document instead of skipping it', async () => {
    const { field, host } = setup();
    host.lintResponder = async () => respond([]);
    const huge = ('word '.repeat(1200) + 'I has a dog. ').trim(); // ~6000 chars, no newlines
    field.value = huge;
    field.setSelectionRange(huge.length, huge.length);
    field.dispatchEvent(inputEvent('insertFromPaste', null));
    await idle();

    expect(host.lintRequests).toHaveLength(1);
    const req = host.lintRequests[0]!;
    expect(req.paragraph.length).toBeLessThanOrEqual(4000);
    // The window ends where the document does (caret at the end).
    expect(huge.endsWith(req.paragraph)).toBe(true);
    // No cut-off word at the window start.
    expect(huge[huge.length - req.paragraph.length - 1]).toBe(' ');
  });
});

describe('multiple issues and document sweeping', () => {
  const TWO_ISSUE_TEXT = 'i like that more better today.';
  /** Isolates the grammar lane: our own capitalisation rule would otherwise
   *  fix "i" first and remove one of the two issues under test. */
  const NO_CAPITALISATION = {
    settings: { ruleModes: { 'text:capitalisation': 'disabled' as const } },
  };

  /** Builds both issues from whatever paragraph the host was asked to lint,
   *  deliberately in reverse offset order to prove the lane sorts them. */
  function issuesFor(paragraph: string): GrammarIssue[] {
    const out: GrammarIssue[] = [];
    const mb = paragraph.indexOf('more better');
    if (mb >= 0) {
      out.push({
        ruleId: 'AdjectiveDoubleDegree',
        kind: 'Redundancy',
        message: 'Redundant comparative.',
        start: mb,
        end: mb + 'more better'.length,
        original: 'more better',
        replacement: 'better',
      });
    }
    if (paragraph.startsWith('i ')) {
      out.push({
        ruleId: 'CapitalizePersonalPronouns',
        kind: 'Capitalization',
        message: 'Capitalize I.',
        start: 0,
        end: 1,
        original: 'i',
        replacement: 'I',
      });
    }
    return out;
  }

  it('offers the earliest issue in the text first', async () => {
    const { field, host } = setup('', NO_CAPITALISATION);
    host.lintResponder = async (req) => respond(issuesFor(req.paragraph));
    typeInto(field, TWO_ISSUE_TEXT);
    await idle();
    expect(chip?.replacement).toBe('I');
  });

  it('chains to the next issue after accepting (the "gives up" regression)', async () => {
    const { field, host, controller } = setup('', NO_CAPITALISATION);
    host.lintResponder = async (req) => respond(issuesFor(req.paragraph));
    typeInto(field, TWO_ISSUE_TEXT);
    await idle();

    chip!.accept();
    expect(field.value).toBe('I like that more better today.');

    // No further typing: the accept itself must schedule the next pass.
    await idle();
    expect(chip?.replacement).toBe('better');
    chip!.accept();
    expect(field.value).toBe('I like that better today.');
    expect(controller.session.records).toHaveLength(2);
  });

  it('chains to the next issue after dismissing', async () => {
    const { field, host } = setup('', NO_CAPITALISATION);
    host.lintResponder = async (req) => respond(issuesFor(req.paragraph));
    typeInto(field, TWO_ISSUE_TEXT);
    await idle();
    expect(chip?.replacement).toBe('I');

    chip!.dismiss();
    await idle();
    expect(chip?.replacement).toBe('better');
  });

  it('sweeps every paragraph of pasted text, not just the caret paragraph', async () => {
    const { field, host } = setup('', NO_CAPITALISATION);
    host.lintResponder = async () => respond([]);
    const pasted = [
      'this is paragraph number one right here.',
      'this is paragraph number two right here.',
      'this is paragraph number three right here.',
    ].join('\n');

    field.value = pasted;
    field.setSelectionRange(pasted.length, pasted.length);
    field.dispatchEvent(inputEvent('insertFromPaste', null));

    for (let i = 0; i < 5; i++) await idle();

    const linted = host.lintRequests.map((r) => r.paragraph).sort();
    expect(linted).toEqual([
      'this is paragraph number one right here.',
      'this is paragraph number three right here.',
      'this is paragraph number two right here.',
    ]);
  });

  it('suppresses paragraph-start capitalization flags on hard-wrapped lines', async () => {
    const { field, host } = setup();
    host.lintResponder = async (req) => {
      if (!req.paragraph.startsWith('meeting?')) return respond([]);
      return respond([
        {
          ruleId: 'SentenceCapitalization',
          kind: 'Capitalization',
          message: 'Capitalize this sentence.',
          start: 0,
          end: 'meeting'.length,
          original: 'meeting',
          replacement: 'Meeting',
        },
      ]);
    };
    // A hard-wrapped paste: line 2 starts mid-sentence.
    const pasted = 'Whom is going to the\nmeeting? That is the question.';
    field.value = pasted;
    field.setSelectionRange(pasted.length, pasted.length);
    field.dispatchEvent(inputEvent('insertFromPaste', null));

    for (let i = 0; i < 4; i++) await idle();
    expect(chip).toBeNull();
    expect(host.grammarEvents.filter((e) => e.verdict === 'offered')).toHaveLength(0);
  });
});

describe('automatic application', () => {
  function autoSetup(learningOverride?: ReturnType<typeof makeLearning>) {
    const built = setup('', {
      settings: { harperAutoApply: true },
      learning: learningOverride,
    });
    built.host.lintResponder = async (req) =>
      respond(req.paragraph.includes('has') ? [agreementIssue(req.paragraph)] : []);
    return built;
  }

  it('applies a finding without asking and records it as automatic', async () => {
    const { field, host, controller } = autoSetup();
    typeInto(field, PARAGRAPH);
    await idle();

    expect(field.value).toBe(PARAGRAPH.replace('has', 'have'));
    expect(chip).toBeNull(); // no confirmation was requested
    const record = controller.session.records[0]!;
    expect(record).toMatchObject({
      correctionType: 'grammar',
      sourceRuleId: 'harper:SubjectVerbAgreement',
      autoApplied: true,
      status: 'pending',
    });
    // Surfaced, but not counted as an acceptance the user never gave.
    expect(host.grammarEvents).toEqual([
      { ruleId: 'SubjectVerbAgreement', verdict: 'offered' },
    ]);
  });

  it('keeps automatic Harper corrections active when suggestion chips are hidden', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperAutoApply: true, showSuggestionChips: false },
    });
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);

    typeInto(field, PARAGRAPH);
    await idle();

    expect(field.value).toBe(PARAGRAPH.replace('has', 'have'));
    expect(chip).toBeNull();
    expect(controller.session.records).toHaveLength(1);
  });

  it('routes auto-apply through shadow mode without touching text', async () => {
    const { field, host, controller } = setup('', {
      settings: { harperAutoApply: true, shadowMode: 'all' },
    });
    host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);

    typeInto(field, PARAGRAPH);
    await idle();

    expect(field.value).toBe(PARAGRAPH);
    expect(controller.session.records).toHaveLength(0);
    expect(chip).toBeNull();
    expect(host.grammarEvents).toHaveLength(0);
    expect(host.shadowObservations).toHaveLength(1);
    expect(host.shadowObservations[0]).toMatchObject({
      provider: 'grammar',
      ruleId: 'grammar:harper',
      originalText: 'has',
      replacementText: 'have',
      wouldHave: 'autocorrect',
    });
  });

  it('never auto-applies a rule measured as unreliable', async () => {
    const { field, host } = setup('', { settings: { harperAutoApply: true } });
    host.lintResponder = async (req) => {
      const start = req.paragraph.indexOf('wont');
      if (start < 0) return respond([]);
      return respond([
        {
          ruleId: 'NominalWants',
          kind: 'Miscellaneous',
          message: 'Did you mean want?',
          start,
          end: start + 4,
          original: 'wont',
          replacement: 'want',
        },
      ]);
    };
    typeInto(field, 'We wont be there until eight today.');
    await idle();
    // Offered as a suggestion, never written into the text.
    expect(field.value).toBe('We wont be there until eight today.');
    expect(chip?.replacement).toBe('want');
  });

  it('demotes a rule to suggestion after the user reverts it twice', async () => {
    const learning = makeLearning();
    learning.grammarStats.SubjectVerbAgreement = { offered: 5, accepted: 0, rejected: 2 };
    const { field } = autoSetup(learning);
    typeInto(field, PARAGRAPH);
    await idle();
    expect(field.value).toBe(PARAGRAPH); // untouched
    expect(chip?.replacement).toBe('have');
  });

  it('chains through several findings in one pass', async () => {
    const { field, host, controller } = setup('', { settings: { harperAutoApply: true } });
    host.lintResponder = async (req) => {
      const issues: GrammarIssue[] = [];
      const dbl = req.paragraph.indexOf('the the');
      if (dbl >= 0) {
        issues.push({
          ruleId: 'RepeatedWords',
          kind: 'Repetition',
          message: 'Repeated word.',
          start: dbl,
          end: dbl + 'the the'.length,
          original: 'the the',
          replacement: 'the',
        });
      }
      const has = req.paragraph.indexOf('has');
      if (has >= 0) issues.push(agreementIssue(req.paragraph));
      return respond(issues);
    };
    typeInto(field, 'Today the the dog has a bone.');
    for (let i = 0; i < 4; i++) await idle();

    expect(field.value).toBe('Today the dog have a bone.');
    expect(controller.session.records).toHaveLength(2);
    expect(controller.session.records.every((r) => r.autoApplied)).toBe(true);
  });

  it('is bounded: a self-renewing finding cannot loop forever', async () => {
    const { field, host } = setup('', { settings: { harperAutoApply: true } });
    // A pathological rule whose replacement re-triggers itself at a new offset.
    host.lintResponder = async (req) => {
      const start = req.paragraph.indexOf('x');
      if (start < 0) return respond([]);
      return respond([
        {
          ruleId: 'Pathological',
          kind: 'Grammar',
          message: 'Grow.',
          start,
          end: start + 1,
          original: 'x',
          replacement: 'xx',
        },
      ]);
    };
    typeInto(field, 'A sentence with x inside it.');
    for (let i = 0; i < 60; i++) await idle();
    // The 50-apply chain budget stops it; without the cap this never settles.
    expect(host.lintRequests.length).toBeLessThanOrEqual(60);
    expect(field.value.length).toBeLessThan('A sentence with x inside it.'.length + 60);
  });

  it('honours a recent manual revert instead of re-applying', async () => {
    const { field, controller, host } = autoSetup();
    typeInto(field, PARAGRAPH);
    await idle();
    const record = controller.session.records[0]!;
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe(PARAGRAPH);

    host.lintRequests.length = 0;
    for (let i = 0; i < 3; i++) await idle();
    // The revert guard keeps it reverted.
    expect(field.value).toBe(PARAGRAPH);
  });
});

describe('review decisions on grammar records', () => {
  async function applied() {
    const built = setup();
    built.host.lintResponder = async (req) => respond([agreementIssue(req.paragraph)]);
    typeInto(built.field, PARAGRAPH);
    await idle();
    chip!.accept();
    const record = built.controller.session.records[0]!;
    built.host.grammarEvents.length = 0;
    built.host.events.length = 0;
    return { ...built, record };
  }

  it('keeping a grammar record never creates a word-pair rule', async () => {
    const { controller, host, record } = await applied();
    expect(controller.decide(record.id, 'keep').ok).toBe(true);
    expect(record.status).toBe('accepted');
    expect(host.events).toHaveLength(0); // no 'accepted' word-pair event
    expect(record.learningApplied).toBe(true);
  });

  it('reverting a grammar record feeds rule stats and the ignore hash', async () => {
    const { controller, field, host, record } = await applied();
    expect(controller.decide(record.id, 'revert').ok).toBe(true);
    expect(field.value).toBe(PARAGRAPH);
    expect(record.status).toBe('reverted');
    expect(host.grammarEvents).toEqual([
      { ruleId: 'SubjectVerbAgreement', verdict: 'rejected', ignoreHash: '424242' },
    ]);
    expect(host.events).toHaveLength(0); // word-pair model untouched
  });

  it('revert-never additionally disables the Harper rule', async () => {
    const { controller, host, record } = await applied();
    expect(controller.decide(record.id, 'revert-never').ok).toBe(true);
    expect(host.grammarEvents[0]).toMatchObject({
      verdict: 'rejected',
      disableRule: true,
    });
  });

  it('revert-dictionary still adds a single word to the personal dictionary', async () => {
    const { controller, host, record } = await applied();
    expect(controller.decide(record.id, 'revert-dictionary').ok).toBe(true);
    expect(host.grammarEvents[0]).toMatchObject({ verdict: 'rejected' });
    expect(host.events).toEqual([
      expect.objectContaining({ type: 'rejected', reason: 'never-correct-word' }),
    ]);
  });
});

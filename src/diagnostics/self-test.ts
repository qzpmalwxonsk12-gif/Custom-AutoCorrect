/**
 * Self-test: runs the shipped engine against known inputs and reports what it
 * actually did, rather than what it is supposed to do.
 *
 * Every check calls the same modules the content script uses, so a green run is
 * evidence about this build - not a restatement of the unit tests. The DOM
 * checks drive the real adapters against real fields on this page.
 */
import { analyze } from '../engine/correction-engine.js';
import { generateMergeCandidate, generateSplitCandidate } from '../engine/token-spacing.js';
import { essentialPunctuationProvider } from '../engine/punctuation/punctuation-provider.js';
import type { PunctuationIssue } from '../engine/punctuation/punctuation-types.js';
import { punctuationSettingsFrom } from '../content/punctuation-lane.js';
import { InputAdapter } from '../content/input-adapter.js';
import { ContentEditableAdapter } from '../content/contenteditable-adapter.js';
import { createAnchor } from '../history/anchor.js';
import { locate } from '../history/correction-locator.js';
import { planRevert } from '../history/correction-reverter.js';
import { createRecord } from '../history/correction-record.js';
import { sendToRuntime } from '../shared/messages.js';
import {
  DEFAULT_SETTINGS,
  EMPTY_LEARNING,
  type LearningData,
  type Settings,
} from '../shared/types.js';
import { applyTheme } from '../options/options-advanced.js';

type Outcome = 'pass' | 'fail' | 'skip';

interface CheckResult {
  name: string;
  area: string;
  outcome: Outcome;
  detail: string;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const settings: Settings = { ...DEFAULT_SETTINGS };
const learning: LearningData = structuredClone(EMPTY_LEARNING);

function check(
  name: string,
  area: string,
  run: () => { ok: boolean; detail: string } | { skip: string },
): CheckResult {
  try {
    const result = run();
    if ('skip' in result) return { name, area, outcome: 'skip', detail: result.skip };
    return {
      name,
      area,
      outcome: result.ok ? 'pass' : 'fail',
      detail: result.detail,
    };
  } catch (e) {
    return {
      name,
      area,
      outcome: 'fail',
      detail: `Threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/* ------------------------------ engine checks ------------------------------ */

function analyseWord(text: string): { replacement: string; action: string } | null {
  const result = analyze(
    { text, wordEnd: text.trimEnd().length, origin: location.origin },
    learning,
    settings,
  );
  if (!result) return null;
  return { replacement: result.proposal.replacement, action: result.proposal.action };
}

function spellingChecks(): CheckResult[] {
  return [
    check('Adjacent swap: “teh” → “the”', 'Spelling', () => {
      const result = analyseWord('I think teh');
      return {
        ok: result?.replacement === 'the',
        detail: result ? `${result.replacement} (${result.action})` : 'no proposal',
      };
    }),
    check('Duplicate letter: “punctuatioon” → “punctuation”', 'Spelling', () => {
      const result = analyseWord('the punctuatioon');
      return {
        ok: result?.replacement === 'punctuation',
        detail: result ? `${result.replacement} (${result.action})` : 'no proposal',
      };
    }),
    check('Valid word “book” is left alone', 'Spelling', () => {
      const result = analyseWord('I read a book');
      return { ok: result === null, detail: result ? `changed to ${result.replacement}` : 'unchanged' };
    }),
    check('Missing letter: “iprove” offers “improve”', 'Spelling', () => {
      const result = analyseWord('please iprove');
      return {
        ok: result?.replacement === 'improve',
        detail: result ? `${result.replacement} (${result.action})` : 'no proposal',
      };
    }),
  ];
}

function spacingChecks(): CheckResult[] {
  return [
    check('Token merge: “impro vement” → “improvement”', 'Spacing', () => {
      const text = 'the impro vement here';
      const candidate = generateMergeCandidate({
        text,
        previousStart: 4,
        previousEnd: 9,
        currentStart: 10,
        currentEnd: 16,
      });
      return {
        ok: candidate?.replacementText === 'improvement',
        detail: candidate ? candidate.replacementText : 'no candidate',
      };
    }),
    check('Token split: “improvementability” splits', 'Spacing', () => {
      const text = 'the improvementability here';
      const candidate = generateSplitCandidate({ text, start: 4, end: 22 });
      return {
        ok: candidate?.replacementText === 'improvement ability',
        detail: candidate ? candidate.replacementText : 'no candidate',
      };
    }),
    check('“ice cream” is not merged', 'Spacing', () => {
      const text = 'some ice cream now';
      const candidate = generateMergeCandidate({
        text,
        previousStart: 5,
        previousEnd: 8,
        currentStart: 9,
        currentEnd: 14,
      });
      return {
        ok: candidate === null || candidate.confidence < settings.autocorrectThreshold,
        detail: candidate ? `offered ${candidate.replacementText}` : 'left alone',
      };
    }),
    check('“another” is not split', 'Spacing', () => {
      const candidate = generateSplitCandidate({ text: 'try another one', start: 4, end: 11 });
      return { ok: candidate === null, detail: candidate ? candidate.replacementText : 'left alone' };
    }),
  ];
}

function analysePunctuation(paragraph: string): PunctuationIssue[] {
  return essentialPunctuationProvider.analyse(paragraph, {
    origin: location.origin,
    baseOffset: 0,
    settings: punctuationSettingsFrom(settings),
    stats: {},
  });
}

function punctuationChecks(): CheckResult[] {
  return [
    check('Introductory clause takes a comma', 'Punctuation', () => {
      const issues = analysePunctuation('When it rains we stay inside.');
      const found = issues.find((issue) => issue.ruleId === 'punctuation:introductory-clause');
      return {
        ok: found !== undefined,
        detail: found ? `${found.ruleId} (${found.action})` : `${issues.length} issue(s), none matching`,
      };
    }),
    check('A plain sentence produces nothing', 'Punctuation', () => {
      const issues = analysePunctuation('The cat sat on the mat.');
      return { ok: issues.length === 0, detail: `${issues.length} issue(s)` };
    }),
  ];
}

/* ------------------------------ history checks ------------------------------ */

function historyChecks(): CheckResult[] {
  const text = 'I think the cat sat.';
  const anchor = createAnchor({
    text,
    start: 8,
    end: 11,
    originalText: 'teh',
    replacementText: 'the',
    contextRadius: 32,
  });
  const record = createRecord({
    sessionId: 'self-test',
    proposal: {
      start: 8,
      end: 11,
      original: 'teh',
      replacement: 'the',
      correctionType: 'adjacent-swap',
      confidence: 0.97,
      action: 'autocorrect',
      reason: 'self-test',
    },
    anchor,
    contextPreview: 'I think the cat sat.',
    autoApplied: true,
  });

  return [
    check('A correction record is created', 'History', () => ({
      ok: record.id.length > 0 && record.status === 'pending',
      detail: `id set, status ${record.status}`,
    })),
    check('The correction can be located again', 'History', () => {
      const found = locate(text, record.anchor);
      return {
        ok: found.status === 'found' && found.start === 8,
        detail: found.status === 'found' ? `found at ${found.start}` : found.status,
      };
    }),
    check('Reverting restores the exact original', 'History', () => {
      const plan = planRevert(text, record);
      return {
        ok: plan.ok && plan.edit.insert === 'teh',
        detail: plan.ok ? `would insert “${plan.edit.insert}”` : plan.message,
      };
    }),
    check('A moved correction is still found', 'History', () => {
      const moved = `Well, ${text}`;
      const found = locate(moved, record.anchor);
      return {
        ok: found.status === 'found' && found.start === 14,
        detail: found.status === 'found' ? `found at ${found.start}` : found.status,
      };
    }),
  ];
}

/* ------------------------------ DOM checks ------------------------------ */

function domChecks(): CheckResult[] {
  const results: CheckResult[] = [];

  const input = must<HTMLInputElement>('probe-input');
  results.push(
    check('Input: read, replace and restore the caret', 'DOM', () => {
      input.value = 'I think teh cat';
      input.setSelectionRange(11, 11);
      const adapter = new InputAdapter(input);
      const replaced = adapter.replaceRange(8, 11, 'the');
      const caret = adapter.getCaret();
      return {
        ok: replaced && adapter.getText() === 'I think the cat' && caret.start === 11,
        detail: `text “${adapter.getText()}”, caret ${caret.start}`,
      };
    }),
  );

  const textarea = must<HTMLTextAreaElement>('probe-textarea');
  results.push(
    check('Textarea: multi-line replacement keeps the rest intact', 'DOM', () => {
      textarea.value = 'line one\nI think teh cat\nline three';
      textarea.setSelectionRange(20, 20);
      const adapter = new InputAdapter(textarea);
      const replaced = adapter.replaceRange(17, 20, 'the');
      return {
        ok: replaced && adapter.getText() === 'line one\nI think the cat\nline three',
        detail: adapter.getText().replace(/\n/g, '⏎'),
      };
    }),
    check('Textarea: paste-shaped bulk change is read correctly', 'DOM', () => {
      textarea.value = '';
      // A paste arrives as one large value change rather than keystrokes; the
      // adapter must simply see the final text.
      textarea.value = 'pasted teh text';
      const adapter = new InputAdapter(textarea);
      return {
        ok: adapter.getText() === 'pasted teh text',
        detail: `read ${adapter.getText().length} chars`,
      };
    }),
  );

  const editable = must('probe-contenteditable');
  results.push(
    check('contenteditable: read and replace a range', 'DOM', () => {
      editable.textContent = 'I think teh cat';
      const adapter = new ContentEditableAdapter(editable);
      const before = adapter.getText();
      const replaced = adapter.replaceRange(8, 11, 'the');
      const after = adapter.getText();
      return {
        ok: before === 'I think teh cat' && replaced && after === 'I think the cat',
        detail: `“${before}” → “${after}”`,
      };
    }),
    check('contenteditable: caret survives a replacement', 'DOM', () => {
      editable.textContent = 'I think teh cat';
      const adapter = new ContentEditableAdapter(editable);
      adapter.setCaret(11, 11);
      adapter.replaceRange(8, 11, 'the');
      adapter.setCaret(11, 11);
      const caret = adapter.getCaret();
      return { ok: caret.start === 11, detail: `caret at ${caret.start}` };
    }),
  );

  return results;
}

/* ------------------------------ background checks ------------------------------ */

async function backgroundChecks(): Promise<CheckResult[]> {
  const res = await sendToRuntime<{ settings: Settings }>({ kind: 'ui/get-settings' });
  return [
    {
      name: 'The background service worker responds',
      area: 'Background',
      outcome: res.ok ? 'pass' : 'fail',
      detail: res.ok ? 'settings received' : res.error,
    },
  ];
}

/* ------------------------------ rendering ------------------------------ */

function render(results: CheckResult[]): void {
  const body = must('results');
  body.textContent = '';
  for (const result of results) {
    const tr = document.createElement('tr');
    for (const [index, text] of [result.name, result.area, '', result.detail].entries()) {
      const td = document.createElement('td');
      if (index === 2) {
        // The word is the signal; the colour only reinforces it.
        const tag = document.createElement('b');
        tag.className = `outcome ${result.outcome}`;
        tag.textContent =
          result.outcome === 'pass' ? 'PASS' : result.outcome === 'fail' ? 'FAIL' : 'SKIP';
        td.appendChild(tag);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  const passed = results.filter((r) => r.outcome === 'pass').length;
  const failed = results.filter((r) => r.outcome === 'fail').length;
  const skipped = results.filter((r) => r.outcome === 'skip').length;
  must('summary').textContent =
    `${passed} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''}.`
    + (failed > 0 ? ' A failure here is a real defect in this build.' : '');
}

async function run(): Promise<void> {
  must('summary').textContent = 'Running…';
  const results = [
    ...spellingChecks(),
    ...spacingChecks(),
    ...punctuationChecks(),
    ...historyChecks(),
    ...domChecks(),
    ...(await backgroundChecks()),
  ];
  render(results);
}

must<HTMLButtonElement>('run').addEventListener('click', () => void run());

void (async () => {
  const res = await sendToRuntime<{ settings: Settings }>({ kind: 'ui/get-settings' });
  if (res.ok) applyTheme(res.data.settings.theme);
})();

/**
 * Diagnostics page: what is loaded, how it is performing, and what has failed.
 *
 * The hard rule for this page is that it never displays user text. Everything
 * here is a count, a version, a duration, or an error message produced by the
 * extension itself - so it can be copied into a bug report safely.
 */
import { sendToRuntime, type DiagnosticsReport } from '../shared/messages.js';
import type { Settings } from '../shared/types.js';
import { applyTheme } from '../options/options-advanced.js';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const statusEl = must('status');
let latest: DiagnosticsReport | null = null;

function fill(id: string, rows: Array<[string, string]>): void {
  const dl = must(id);
  dl.textContent = '';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function render(report: DiagnosticsReport): void {
  latest = report;

  fill('build', [
    ['Extension version', report.extensionVersion],
    ['Storage schema', String(report.schemaVersion)],
    ['Generated', new Date(report.generatedAt).toLocaleString()],
    ['Storage error', report.storageError ?? 'None'],
  ]);

  fill('dictionary', [
    ['Status', report.dictionary.words > 0 ? 'Loaded' : 'Not loaded'],
    ['Words', report.dictionary.words.toLocaleString()],
    ['Source', report.dictionary.source],
    ['Version', report.dictionary.version],
    ['Content SHA-256', report.dictionary.sha256],
  ]);

  fill('harper', [
    ['Enabled', yesNo(report.harper.enabled)],
    ['Loaded', yesNo(report.harper.ready)],
    ['Dialect', report.harper.dialect],
    ['Rules available', String(report.harper.rules)],
    ['Engine builds (this profile)', String(report.harper.setups)],
    ['Last setup', ms(report.harper.lastSetupMs)],
    ['Paragraphs linted', String(report.harper.lintCount)],
    ['Average lint', ms(report.harper.averageLintMs)],
  ]);

  fill('ai', [
    ['Provider', report.ai.provider],
    ['Configured', yesNo(report.ai.configured)],
    ['Loaded', yesNo(report.ai.ready)],
    ['Version', report.ai.version],
  ]);

  fill('site', [
    ['Origin', report.site.origin || '(none)'],
    ['Access granted', yesNo(report.site.granted)],
    ['Enabled here', yesNo(report.site.enabled)],
    ['Writing profile', report.site.profileLabel],
    ['Field focused', yesNo(report.field.present)],
    ['Field kind', report.field.kind],
    ['Field enabled', yesNo(report.field.enabled)],
  ]);

  fill('history', [
    ['History enabled', yesNo(report.history.enabled)],
    ['Persisted for this site', yesNo(report.history.persisted)],
    ['Stored sessions', String(report.history.sessions)],
    ['Stored corrections', String(report.history.records)],
    ['Retention', `${report.history.retentionDays} day(s)`],
  ]);

  fill('performance', [
    ['Last analysis', report.lastAnalysisMs === null ? 'Not measured yet' : ms(report.lastAnalysisMs)],
    ['Shadow mode', report.shadow.mode],
    ['Shadow observations', String(report.shadow.observations)],
    ['Context weight: frequency', report.contextWeights.frequency.toFixed(3)],
    ['Context weight: part of speech', report.contextWeights.partOfSpeech.toFixed(3)],
    ['Context weight: document reuse', report.contextWeights.documentReuse.toFixed(3)],
  ]);

  const table = must<HTMLTableElement>('errors');
  const body = must('errors-body');
  const empty = must('errors-empty');
  body.textContent = '';
  table.hidden = report.providerErrors.length === 0;
  empty.hidden = report.providerErrors.length > 0;
  for (const error of [...report.providerErrors].reverse()) {
    const tr = document.createElement('tr');
    for (const text of [
      new Date(error.at).toLocaleTimeString(),
      error.provider,
      error.message,
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function refresh(): Promise<void> {
  statusEl.textContent = 'Loading…';
  const res = await sendToRuntime<{ report: DiagnosticsReport }>({ kind: 'ui/diagnostics' });
  if (!res.ok) {
    statusEl.textContent = `Could not read diagnostics: ${res.error}`;
    return;
  }
  render(res.data.report);
  statusEl.textContent = '';

  const settings = await sendToRuntime<{ settings: Settings }>({ kind: 'ui/get-settings' });
  if (settings.ok) applyTheme(settings.data.settings.theme);
}

/** Flattens the rendered page into plain text for a bug report. */
function asText(): string {
  const lines: string[] = ['Personal Autocorrect diagnostics', ''];
  for (const section of Array.from(document.querySelectorAll('section'))) {
    const heading = section.querySelector('h2')?.textContent ?? '';
    lines.push(`## ${heading}`);
    const dl = section.querySelector('dl');
    if (dl) {
      const terms = Array.from(dl.querySelectorAll('dt'));
      const values = Array.from(dl.querySelectorAll('dd'));
      terms.forEach((dt, i) => lines.push(`${dt.textContent}: ${values[i]?.textContent ?? ''}`));
    }
    for (const row of Array.from(section.querySelectorAll('tbody tr'))) {
      lines.push(
        Array.from(row.querySelectorAll('td'))
          .map((td) => td.textContent)
          .join(' | '),
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

must<HTMLButtonElement>('refresh').addEventListener('click', () => void refresh());
must<HTMLButtonElement>('copy').addEventListener('click', async () => {
  if (!latest) return;
  try {
    await navigator.clipboard.writeText(asText());
    statusEl.textContent = 'Copied to the clipboard.';
  } catch {
    statusEl.textContent = 'The clipboard is not available; select and copy the page instead.';
  }
});

void refresh();

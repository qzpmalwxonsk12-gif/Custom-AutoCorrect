/**
 * The settings added by the quality-of-life work: writing profiles, per-rule
 * modes, shadow-mode inspection and personal vocabulary.
 *
 * Kept separate from `options.ts` so neither file becomes unreadable; both
 * share the same `sendToRuntime` protocol and neither owns state the other
 * needs.
 */
import { sendToRuntime, type ShadowLogResponse } from '../shared/messages.js';
import type { LearningData, Settings } from '../shared/types.js';
import { RULE_CATALOGUE, RULE_CONTROL_MODES, type RuleControlMode } from '../shared/rules.js';
import { WRITING_PROFILES, writingProfile, type WritingProfileId } from '../shared/profiles.js';
import {
  scopeLabel,
  type PersonalVocabulary,
  type VocabularyEntry,
  type VocabularyKind,
} from '../shared/vocabulary.js';

type Ctx = {
  settings: () => Settings;
  learning: () => LearningData;
  setStatus: (message: string, isError?: boolean) => void;
  reload: () => Promise<void>;
};

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const MODE_LABELS: Record<RuleControlMode | 'default', string> = {
  default: 'Default',
  automatic: 'Automatic',
  suggestion: 'Suggestion only',
  disabled: 'Disabled',
};

/* ------------------------------ writing profiles ------------------------------ */

function fillProfileSelect(select: HTMLSelectElement, includeNone = false): void {
  select.textContent = '';
  if (includeNone) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Use the default profile';
    select.appendChild(option);
  }
  for (const profile of WRITING_PROFILES) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    select.appendChild(option);
  }
}

export function renderProfiles(ctx: Ctx): void {
  const select = el<HTMLSelectElement>('profile-select');
  const description = el('profile-description');
  const siteSelect = el<HTMLSelectElement>('site-profile-value');
  const list = el('site-profile-list');
  if (!select || !description || !siteSelect || !list) return;

  if (select.options.length === 0) fillProfileSelect(select);
  if (siteSelect.options.length === 0) fillProfileSelect(siteSelect);

  const settings = ctx.settings();
  select.value = settings.profile;
  description.textContent = writingProfile(settings.profile).description;

  list.textContent = '';
  const entries = Object.entries(settings.siteProfiles);
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No per-website profiles. Every site uses the default above.';
    list.appendChild(empty);
    return;
  }
  for (const [origin, profileId] of entries) {
    const row = document.createElement('div');
    row.className = 'list-row';
    const name = document.createElement('span');
    name.textContent = origin;
    const value = document.createElement('span');
    value.className = 'muted';
    value.textContent = writingProfile(profileId).label;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove the profile assigned to ${origin}`);
    remove.addEventListener('click', () => {
      const siteProfiles = { ...ctx.settings().siteProfiles };
      delete siteProfiles[origin];
      void save(ctx, { siteProfiles });
    });
    row.append(name, value, remove);
    list.appendChild(row);
  }
}

async function save(ctx: Ctx, patch: Partial<Settings>): Promise<void> {
  const res = await sendToRuntime({ kind: 'ui/set-settings', patch });
  if (!res.ok) {
    ctx.setStatus(res.error, true);
    return;
  }
  ctx.setStatus('Saved.');
  await ctx.reload();
}

export function wireProfiles(ctx: Ctx): void {
  el<HTMLSelectElement>('profile-select')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value as WritingProfileId;
    void save(ctx, { profile: value });
  });

  el<HTMLButtonElement>('site-profile-add')?.addEventListener('click', () => {
    const originInput = el<HTMLInputElement>('site-profile-origin');
    const valueSelect = el<HTMLSelectElement>('site-profile-value');
    if (!originInput || !valueSelect) return;
    let origin: string;
    try {
      origin = new URL(originInput.value.trim()).origin;
    } catch {
      ctx.setStatus('Enter a full origin, for example https://example.com', true);
      return;
    }
    const siteProfiles = {
      ...ctx.settings().siteProfiles,
      [origin]: valueSelect.value as WritingProfileId,
    };
    originInput.value = '';
    void save(ctx, { siteProfiles });
  });
}

/* ------------------------------ rule controls ------------------------------ */

export function renderRuleControls(ctx: Ctx): void {
  const root = el('rule-controls');
  if (!root) return;
  root.textContent = '';

  const settings = ctx.settings();
  const profile = writingProfile(settings.profile);
  const categories = new Map<string, typeof RULE_CATALOGUE[number][]>();
  for (const rule of RULE_CATALOGUE) {
    const bucket = categories.get(rule.category) ?? [];
    bucket.push(rule);
    categories.set(rule.category, bucket);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    spelling: 'Spelling',
    spacing: 'Word boundaries',
    text: 'Text',
    grammar: 'Grammar',
    punctuation: 'Punctuation',
  };

  for (const [category, rules] of categories) {
    const heading = document.createElement('h3');
    heading.textContent = CATEGORY_LABELS[category] ?? category;
    root.appendChild(heading);

    for (const rule of rules) {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const text = document.createElement('div');
      const label = document.createElement('b');
      label.textContent = rule.label;
      const description = document.createElement('div');
      description.className = 'hint';
      description.textContent = rule.description;
      text.append(label, description);

      // The profile can already be forcing a mode; saying so prevents the
      // "I set it to automatic and nothing happened" confusion.
      const fromProfile = profile.rules[rule.id];
      if (fromProfile) {
        const note = document.createElement('div');
        note.className = 'hint profile-note';
        note.textContent = `The ${profile.label} profile sets this to ${MODE_LABELS[fromProfile]}.`;
        text.appendChild(note);
      }

      const select = document.createElement('select');
      select.setAttribute('aria-label', `Mode for ${rule.label}`);
      for (const mode of ['default', ...RULE_CONTROL_MODES] as const) {
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = MODE_LABELS[mode];
        select.appendChild(option);
      }
      select.value = settings.ruleModes[rule.id] ?? 'default';
      select.addEventListener('change', () => {
        const ruleModes = { ...ctx.settings().ruleModes };
        if (select.value === 'default') delete ruleModes[rule.id];
        else ruleModes[rule.id] = select.value as RuleControlMode;
        void save(ctx, { ruleModes });
      });

      row.append(text, select);
      root.appendChild(row);
    }
  }
}

/* ------------------------------ shadow mode ------------------------------ */

export function wireShadow(ctx: Ctx): void {
  el<HTMLButtonElement>('shadow-refresh')?.addEventListener('click', () => void renderShadow(ctx));
  el<HTMLButtonElement>('shadow-clear')?.addEventListener('click', async () => {
    const res = await sendToRuntime({ kind: 'ui/clear-shadow-log' });
    if (!res.ok) {
      ctx.setStatus(res.error, true);
      return;
    }
    ctx.setStatus('Observations cleared.');
    await renderShadow(ctx);
  });
}

export async function renderShadow(ctx: Ctx): Promise<void> {
  const summaryEl = el('shadow-summary');
  const list = el('shadow-list');
  if (!summaryEl || !list) return;

  const res = await sendToRuntime<ShadowLogResponse>({ kind: 'ui/get-shadow-log' });
  if (!res.ok) {
    summaryEl.textContent = res.error;
    ctx.setStatus(res.error, true);
    return;
  }
  const { observations, summary } = res.data;
  summaryEl.textContent =
    summary.total === 0
      ? 'No observations recorded yet.'
      : `${summary.total} observation(s): ${summary.wouldHaveAutocorrected} would have been `
        + `applied, ${summary.wouldHaveSuggested} offered. `
        + `${summary.agreements} agreed with another provider, ${summary.disagreements} disagreed.`;

  list.textContent = '';
  for (const observation of observations.slice(-100).reverse()) {
    const row = document.createElement('div');
    row.className = 'list-row';

    const diff = document.createElement('span');
    const old = document.createElement('s');
    old.textContent = observation.originalText;
    diff.append(old, document.createTextNode(' → '), document.createTextNode(observation.replacementText));

    const meta = document.createElement('span');
    meta.className = 'muted';
    const agreement = observation.disagreedWith?.length
      ? ` · disagreed with ${observation.disagreedWith.map((d) => d.provider).join(', ')}`
      : observation.agreedWith?.length
        ? ` · agreed with ${observation.agreedWith.join(', ')}`
        : '';
    meta.textContent =
      `${observation.ruleId} · ${Math.round(observation.confidence * 100)}% · `
      + `would have ${observation.wouldHave === 'autocorrect' ? 'applied' : 'suggested'}`
      + agreement;

    row.append(diff, meta);
    list.appendChild(row);
  }
}

/* ------------------------------ vocabulary ------------------------------ */

const KIND_LABELS: Record<VocabularyKind, string> = {
  'allowed-word': 'Allowed word',
  name: 'Name',
  capitalisation: 'Capitalisation',
  preferred: 'Preferred',
  blocked: 'Blocked',
  phrase: 'Phrase',
};

/** Kinds that are meaningless without a right-hand side. */
const NEEDS_REPLACEMENT = new Set<VocabularyKind>(['capitalisation', 'preferred', 'blocked']);

export function renderVocabulary(ctx: Ctx): void {
  const list = el('vocab-list');
  if (!list) return;
  list.textContent = '';

  const vocabulary: PersonalVocabulary = ctx.learning().vocabulary;
  if (vocabulary.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Nothing here yet. Entries you add from the correction panel appear here too.';
    list.appendChild(empty);
    return;
  }

  const sorted = [...vocabulary.entries].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.original.localeCompare(b.original),
  );
  for (const entry of sorted) {
    list.appendChild(vocabularyRow(ctx, entry));
  }
}

function vocabularyRow(ctx: Ctx, entry: VocabularyEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'list-row';

  const text = document.createElement('span');
  text.textContent = entry.replacement
    ? `${entry.original} → ${entry.replacement}`
    : entry.original;

  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = `${KIND_LABELS[entry.kind]} · ${scopeLabel(entry.scope)}`;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', `Remove ${entry.original} from your vocabulary`);
  remove.addEventListener('click', async () => {
    const res = await sendToRuntime({ kind: 'ui/remove-vocabulary', id: entry.id });
    if (!res.ok) {
      ctx.setStatus(res.error, true);
      return;
    }
    ctx.setStatus('Removed.');
    await ctx.reload();
  });

  row.append(text, meta, remove);
  return row;
}

export function wireVocabulary(ctx: Ctx): void {
  const kind = el<HTMLSelectElement>('vocab-kind');
  const original = el<HTMLInputElement>('vocab-original');
  const replacement = el<HTMLInputElement>('vocab-replacement');
  const scope = el<HTMLSelectElement>('vocab-scope');
  const origin = el<HTMLInputElement>('vocab-origin');
  const add = el<HTMLButtonElement>('vocab-add');
  if (!kind || !original || !replacement || !scope || !origin || !add) return;

  const sync = (): void => {
    const needs = NEEDS_REPLACEMENT.has(kind.value as VocabularyKind);
    replacement.hidden = !needs;
    replacement.required = needs;
    origin.hidden = scope.value !== 'site';
  };
  kind.addEventListener('change', sync);
  scope.addEventListener('change', sync);
  sync();

  add.addEventListener('click', async () => {
    const word = original.value.trim();
    if (!word) {
      ctx.setStatus('Enter a word or phrase first.', true);
      return;
    }
    const entryKind = kind.value as VocabularyKind;
    if (NEEDS_REPLACEMENT.has(entryKind) && !replacement.value.trim()) {
      ctx.setStatus(`A ${KIND_LABELS[entryKind].toLowerCase()} entry needs a replacement.`, true);
      return;
    }
    let entryScope: VocabularyEntry['scope'] = { kind: 'global' };
    if (scope.value === 'site') {
      try {
        entryScope = { kind: 'site', origin: new URL(origin.value.trim()).origin };
      } catch {
        ctx.setStatus('Enter a full origin, for example https://example.com', true);
        return;
      }
    }
    const res = await sendToRuntime({
      kind: 'ui/add-vocabulary',
      entry: {
        kind: entryKind,
        original: word,
        ...(replacement.value.trim() ? { replacement: replacement.value.trim() } : {}),
        scope: entryScope,
      },
    });
    if (!res.ok) {
      ctx.setStatus(res.error, true);
      return;
    }
    original.value = '';
    replacement.value = '';
    ctx.setStatus('Added.');
    await ctx.reload();
  });

  el<HTMLButtonElement>('vocab-export')?.addEventListener('click', async () => {
    const res = await sendToRuntime<{ bundle: unknown }>({ kind: 'ui/export-vocabulary' });
    if (!res.ok) {
      ctx.setStatus(res.error, true);
      return;
    }
    const blob = new Blob([JSON.stringify(res.data.bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `personal-autocorrect-vocabulary-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    ctx.setStatus('Exported.');
  });

  const file = el<HTMLInputElement>('vocab-file');
  el<HTMLButtonElement>('vocab-import')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    const payload = await chosen.text();
    file.value = '';
    const res = await sendToRuntime<{ imported: number }>({
      kind: 'ui/import-vocabulary',
      payload,
    });
    if (!res.ok) {
      ctx.setStatus(res.error, true);
      return;
    }
    ctx.setStatus(`Imported ${res.data.imported} entr${res.data.imported === 1 ? 'y' : 'ies'}.`);
    await ctx.reload();
  });
}

/* ------------------------------ diagnostics links ------------------------------ */

export function wireDiagnosticsLinks(): void {
  el<HTMLButtonElement>('open-diagnostics')?.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics/diagnostics.html') });
  });
  el<HTMLButtonElement>('open-self-test')?.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics/self-test.html') });
  });
}

/* ------------------------------ theme ------------------------------ */

/**
 * Applies the chosen theme to an extension page. `system` removes the
 * attribute entirely so the CSS media queries take over again.
 */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export type OptionsContext = Ctx;

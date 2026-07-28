/**
 * Transport-independent host for the Harper grammar engine.
 *
 * This class knows nothing about where it runs: the caller supplies the WASM
 * URL and a metrics sink. Today it is instantiated inside the MV3 service
 * worker (LocalLinter blocks the SW event loop, which is acceptable because
 * every request is paragraph-sized and off the typing path). If measurement
 * shows repeated worker eviction makes setup cost hurt, the same class moves
 * into an offscreen document unchanged - only the instantiation site differs.
 *
 * This is the ONLY file in the extension allowed to import 'harper.js'.
 */
import {
  createBinaryModuleFromUrl,
  Dialect,
  LocalLinter,
  type Lint,
  type LintConfig,
} from 'harper.js';
import { deriveEdit, widenEdit, type GrammarIssue, type LintResponse } from '../shared/grammar.js';
import type { HarperDialect, LearningData, Settings } from '../shared/types.js';

/** Lint kinds our own spelling engine already owns; Harper must not duplicate. */
const SUPPRESSED_KINDS = new Set(['Spelling']);

/** Hard cap on issues surfaced per paragraph; the rest wait for a re-lint. */
const MAX_ISSUES_PER_PARAGRAPH = 8;

const DIALECTS: Record<HarperDialect, Dialect> = {
  american: Dialect.American,
  british: Dialect.British,
  australian: Dialect.Australian,
  canadian: Dialect.Canadian,
  indian: Dialect.Indian,
};

export interface HarperMetrics {
  /** ms the last engine setup took (dictionary build + wasm compile). */
  setupMs: number;
  /** Engine setups performed by this host instance (1 unless disposed). */
  setups: number;
  lintCount: number;
  totalLintMs: number;
  lastLintMs: number;
}

export interface HarperHostOptions {
  wasmUrl: string;
  /** Called after setup and after each lint, e.g. to persist reinit counts. */
  onMetrics?: (metrics: HarperMetrics) => void;
}

/** Serialisable status for the options page. */
export interface HarperStatus {
  ready: boolean;
  metrics: HarperMetrics;
  /** Bare rule names known to the engine (available once ready). */
  availableRules: string[];
}

interface AppliedConfig {
  dialect: HarperDialect;
  disabledRules: string;
  dictionary: string;
  ignoredLints: string;
}

export class HarperHost {
  private readonly wasmUrl: string;
  private readonly onMetrics?: (metrics: HarperMetrics) => void;
  private linter: LocalLinter | null = null;
  private setupPromise: Promise<void> | null = null;
  private applied: AppliedConfig | null = null;
  private availableRules: string[] = [];
  private metrics: HarperMetrics = {
    setupMs: 0,
    setups: 0,
    lintCount: 0,
    totalLintMs: 0,
    lastLintMs: 0,
  };
  /** Serialises lint calls: the wasm instance is single-threaded anyway. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: HarperHostOptions) {
    this.wasmUrl = options.wasmUrl;
    this.onMetrics = options.onMetrics;
  }

  status(): HarperStatus {
    return {
      ready: this.linter !== null,
      metrics: { ...this.metrics },
      availableRules: [...this.availableRules],
    };
  }

  private async ensureReady(settings: Settings): Promise<LocalLinter> {
    if (!this.linter) {
      if (!this.setupPromise) {
        this.setupPromise = (async () => {
          const started = Date.now();
          const linter = new LocalLinter({
            binary: createBinaryModuleFromUrl(this.wasmUrl, 'full'),
            dialect: DIALECTS[settings.harperDialect] ?? Dialect.American,
          });
          await linter.setup();
          try {
            const config = await linter.getLintConfig();
            this.availableRules = Object.keys(config).sort();
          } catch {
            this.availableRules = [];
          }
          this.linter = linter;
          this.metrics.setupMs = Date.now() - started;
          this.metrics.setups++;
          this.onMetrics?.({ ...this.metrics });
        })().catch((e) => {
          // Allow a later call to retry instead of caching the failure forever.
          this.setupPromise = null;
          throw e;
        });
      }
      await this.setupPromise;
    }
    return this.linter!;
  }

  /**
   * Applies dialect, disabled rules, user dictionary and ignored lints when
   * they differ from what the engine currently has. Cheap when nothing changed.
   */
  private async applyConfig(settings: Settings, learning: LearningData): Promise<void> {
    const linter = await this.ensureReady(settings);
    const wanted: AppliedConfig = {
      dialect: settings.harperDialect,
      disabledRules: [...settings.harperDisabledRules].sort().join(','),
      dictionary: [...learning.dictionary].sort().join(','),
      ignoredLints: learning.grammarIgnoredLints.join(','),
    };
    const current = this.applied;
    if (
      current &&
      current.dialect === wanted.dialect &&
      current.disabledRules === wanted.disabledRules &&
      current.dictionary === wanted.dictionary &&
      current.ignoredLints === wanted.ignoredLints
    ) {
      return;
    }

    if (!current || current.dialect !== wanted.dialect) {
      await linter.setDialect(DIALECTS[settings.harperDialect] ?? Dialect.American);
    }

    if (!current || current.disabledRules !== wanted.disabledRules) {
      // Only touch rules the engine actually has; never invent config keys.
      const config: LintConfig = {};
      const disabled = new Set(settings.harperDisabledRules);
      const previouslyDisabled = new Set(
        current ? current.disabledRules.split(',').filter(Boolean) : [],
      );
      for (const rule of this.availableRules) {
        if (disabled.has(rule)) config[rule] = false;
        else if (previouslyDisabled.has(rule)) config[rule] = null;
      }
      if (Object.keys(config).length > 0) await linter.setLintConfig(config);
    }

    if (!current || current.dictionary !== wanted.dictionary) {
      if (learning.dictionary.length > 0) await linter.importWords(learning.dictionary);
    }

    if (!current || current.ignoredLints !== wanted.ignoredLints) {
      const alreadyIgnored = new Set(
        current ? current.ignoredLints.split(',').filter(Boolean) : [],
      );
      for (const hash of learning.grammarIgnoredLints) {
        if (alreadyIgnored.has(hash)) continue;
        try {
          await linter.ignoreLintHash(BigInt(hash));
        } catch {
          /* a malformed persisted hash must not break linting */
        }
      }
    }
    this.applied = wanted;
  }

  /** Lints one paragraph and returns fully validated, serialisable issues. */
  async lint(
    paragraph: string,
    settings: Settings,
    learning: LearningData,
  ): Promise<LintResponse> {
    const run = this.queue.then(async (): Promise<LintResponse> => {
      const setupsBefore = this.metrics.setups;
      const setupStarted = this.linter === null;
      await this.applyConfig(settings, learning);
      const linter = this.linter!;

      const started = Date.now();
      const organized = await linter.organizedLints(paragraph, { language: 'plaintext' });
      const issues: GrammarIssue[] = [];

      for (const [ruleId, lints] of Object.entries(organized)) {
        for (const lint of lints) {
          if (issues.length >= MAX_ISSUES_PER_PARAGRAPH) break;
          try {
            const issue = await this.serialiseLint(linter, paragraph, ruleId, lint);
            if (issue) issues.push(issue);
          } catch (e) {
            console.warn('[autocorrect] harper lint serialisation failed:', e);
          } finally {
            tryFree(lint);
          }
        }
      }

      const lintMs = Date.now() - started;
      this.metrics.lintCount++;
      this.metrics.totalLintMs += lintMs;
      this.metrics.lastLintMs = lintMs;
      this.onMetrics?.({ ...this.metrics });

      const response: LintResponse = { issues, lintMs };
      if (setupStarted && this.metrics.setups > setupsBefore) {
        response.setupMs = this.metrics.setupMs;
      }
      return response;
    });
    // Keep the queue alive even when a call fails.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async serialiseLint(
    linter: LocalLinter,
    paragraph: string,
    ruleId: string,
    lint: Lint,
  ): Promise<GrammarIssue | null> {
    const kind = lint.lint_kind();
    if (SUPPRESSED_KINDS.has(kind)) return null;

    const suggestions = lint.suggestions();
    const suggestion = suggestions[0];
    if (!suggestion) {
      for (const s of suggestions) tryFree(s);
      return null;
    }

    try {
      // Deriving the edit by applying Harper's own suggestion and diffing
      // avoids the scalar-vs-UTF-16 span mismatch and normalises all three
      // suggestion kinds (Replace/Remove/InsertAfter) into one replace edit.
      const after = await linter.applySuggestion(paragraph, lint, suggestion);
      const rawEdit = deriveEdit(paragraph, after);
      if (!rawEdit) return null;
      const edit = widenEdit(paragraph, rawEdit);
      if (!edit) return null;

      const issue: GrammarIssue = {
        ruleId,
        kind,
        message: lint.message().slice(0, 300),
        start: edit.start,
        end: edit.end,
        original: paragraph.slice(edit.start, edit.end),
        replacement: edit.replacement,
      };
      try {
        issue.ignoreHash = (await linter.contextHash(paragraph, lint)).toString();
      } catch {
        /* hash is optional; rejection just cannot feed Harper's ignore list */
      }
      return issue;
    } finally {
      for (const s of suggestions) tryFree(s);
    }
  }

  /** Feeds one rejected lint hash into the live engine (persistence is the
   *  caller's job via LearningData.grammarIgnoredLints). */
  async ignoreHash(hash: string): Promise<void> {
    if (!this.linter) return; // will be imported from learning on next setup
    try {
      await this.linter.ignoreLintHash(BigInt(hash));
      if (this.applied) this.applied.ignoredLints += `,${hash}`;
    } catch (e) {
      console.warn('[autocorrect] harper ignoreLintHash failed:', e);
    }
  }

  /** Adds words to the live engine's dictionary (no-op when not started). */
  async importWords(words: string[]): Promise<void> {
    if (!this.linter || words.length === 0) return;
    try {
      await this.linter.importWords(words);
      if (this.applied) this.applied.dictionary += `,${words.join(',')}`;
    } catch (e) {
      console.warn('[autocorrect] harper importWords failed:', e);
    }
  }

  async dispose(): Promise<void> {
    const linter = this.linter;
    this.linter = null;
    this.setupPromise = null;
    this.applied = null;
    if (linter) {
      try {
        await linter.dispose();
      } catch {
        /* wasm teardown is best-effort */
      }
    }
  }
}

/** wasm-bindgen objects hold linear memory; free eagerly but never fatally. */
function tryFree(value: unknown): void {
  try {
    (value as { free?: () => void }).free?.();
  } catch {
    /* already freed */
  }
}

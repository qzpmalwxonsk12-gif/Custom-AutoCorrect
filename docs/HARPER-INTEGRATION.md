# Harper integration — change log and handoff

> **Update:** a third lane, the essential-punctuation engine, now runs *before*
> Harper in the same idle pass (`runPunctuationPass()` in
> `editable-controller.ts`). It publishes the spans it claims, and the Harper
> lane skips any finding overlapping one, so the two never produce duplicate
> panel entries. See `docs/PUNCTUATION.md`. Harper-lane tests set
> `punctuationEnabled: false` to isolate the lane under test.

Written for whoever (human or agent) touches this codebase next. This documents
what the Harper grammar integration added, every file it touched, the
invariants it relies on, and what was deliberately left out. Nothing outside
this feature was modified.

## What was added, in one paragraph

harper.js 2.4.0 (Rust→WASM grammar checker, Apache-2.0, fully offline) runs
as an **asynchronous grammar lane** beside the synchronous per-word and
essential-punctuation lanes. The WASM (~18 MB) is bundled into the extension and loaded
lazily in the MV3 service worker via `LocalLinter`; nothing loads until the
user enables Harper in options (**default off**). Findings surface as
suggestion chips by default and never run on the keystroke path. The separate
`harperAutoApply` setting can apply validated, low-risk findings automatically;
subjective kinds and denied/demoted rules remain suggestions. Accepted or
automatic findings become ordinary `CorrectionRecord`s
(`correctionType: 'grammar'`, `sourceRuleId: 'harper:<Rule>'`) with full
panel/review/revert support. Accept/reject decisions are counted **per Harper
rule id** in `LearningData.grammarStats`. Those counters can demote automatic
application; promotion remains unimplemented. Rejections also feed Harper's own
context-hash ignore list, persisted as decimal strings in
`LearningData.grammarIgnoredLints`.

## Word and grammar-lint flow

```
word lane (unchanged, sync, keystroke path)
  onInput commit char -> analyze() -> autocorrect/suggest -> record

lint lane (new, async, idle path only)
  runIdleWork (700 ms debounce / blur)
    -> maybeRequestLint(): caret paragraph, raw FNV fingerprint
    -> host.requestLint -> bg 'content/lint' -> HarperHost.lint()
    -> handleLintResponse(): THREE GATES (below) -> chip
    -> accept: applyProposal(suggestion) -> grammar record + 'accepted' stat
    -> dismiss: session-local suppression + 'rejected' stat + ignore hash
```

### The async-safety gates (all in `editable-controller.ts`)

1. **One-active-request-per-field.** `lintInFlight` blocks a second request;
   `lintDirty` coalesces everything that happened meanwhile into exactly one
   follow-up request after the response lands.
2. **Current-controller and eligibility checks.** A response is dropped after
   detach/reset, when the request generation is obsolete, when Harper/output is
   disabled, or when the field is no longer eligible.
3. **Fingerprint-first staleness.** The paragraph slice at the recorded offsets
   must re-hash (raw FNV-1a, not normalised — offsets matter) to the requested
   fingerprint, and each issue's span text must still equal `issue.original`
   (`validateIssue`). A version mismatch alone is diagnostic: if an edit
   happened elsewhere while this exact slice stayed byte-identical, the result
   remains safe to use. This avoids starving rich editors that emit synthetic
   input events while still catching mutation inside the linted slice.

`validateIssue` additionally enforces: personal dictionary (single-word
issues), blocked word pairs, session-local dismissals, and no overlap with any
live correction record's range.

## Why spans come from a diff, not from Harper's `Span`

Harper spans count **Unicode scalar values** (Rust chars), not UTF-16 code
units — an emoji earlier in the paragraph shifts every offset. Instead of
converting, `HarperHost.serialiseLint()` applies Harper's own suggestion via
`linter.applySuggestion()` and diffs the before/after strings
(`deriveEdit` in `src/shared/grammar.ts`). This yields UTF-16 offsets by
construction and collapses all three suggestion kinds (Replace / Remove /
InsertAfter) into one replace-edit. `widenEdit` then (a) snaps to word
boundaries (minimal diff of has→have is "s"→"ve"; widened to "has"→"have") and
(b) absorbs a neighbour word when one side is empty, because the
anchor/locator/reverter machinery requires non-empty original *and*
replacement. Both functions are pure and unit-tested.

## Learning separation (important invariant)

Harper findings must **never** enter the word-pair learning model — accepting
"your"→"you're" as an exact rule would be a correctness disaster. Enforced in
three places in `editable-controller.ts`:

- `applyProposal`: skips the `applied` learn event when
  `proposal.ruleId` starts with `harper:`;
- `decide('keep')`: skips the `accepted` learn event for harper records;
- `revert()`: sends `grammarFeedback({verdict:'rejected', ignoreHash,
  disableRule})` instead of the `rejected` learn event. `revert-never` maps to
  `disableRule: true` (adds the bare rule name to
  `settings.harperDisabledRules`). `revert-dictionary` additionally sends the
  normal dictionary-add path, but only for single-word originals.

Harper's own **Spelling** lint kind is suppressed in the host
(`SUPPRESSED_KINDS`) — the existing spelling engine owns misspellings.

## Files

### New
| File | Contents |
|---|---|
| `src/shared/grammar.ts` | Pure: `GrammarIssue`/`LintRequest`/`LintResponse`/`GrammarFeedback` types, `deriveEdit`, `widenEdit`, `validateIssue`, `issueKey`, `recordGrammarFeedback`, `harper:` id helpers. **Must never import harper.js** (content bundle stays Harper-free — verified: no `harper_wasm` string in `dist/content`). |
| `src/background/harper-host.ts` | `HarperHost` class — the **only** file importing `harper.js`. Lazy `LocalLinter` setup (timed), config stamping (dialect/disabled rules/dictionary/ignored hashes), serialised lint queue, lint serialisation via applySuggestion+diff, `wasm-bindgen` object `free()` hygiene. Transport-independent: constructor takes `{wasmUrl, onMetrics}`; to move to an offscreen document, instantiate it there and forward the same three calls (`lint`, `ignoreHash`, `importWords`). |
| `vitest.harper.config.ts` | Opt-in config for the real-WASM suite. |
| `tests/harper/conformance.test.ts` | Real engine: setup/lint timing, diff-edit round-trips against actual suggestions, Remove-kind normalisation, context hashes, importWords. Run: `npm run test:harper`. |
| `tests/unit/grammar-shared.test.ts` | deriveEdit/widenEdit/validateIssue/stats. |
| `tests/integration/lint-lane.test.ts` | Mocked-host lane tests: gating, one-in-flight, stale rejection, fingerprint validation, chip accept/dismiss, review branches. |

### Modified
| File | Change |
|---|---|
| `src/shared/types.ts` | Settings: `harperEnabled` (default **false**), `harperDialect`, `harperDisabledRules`. LearningData: `grammarStats`, `grammarIgnoredLints`. CorrectionRecord: optional `sourceIgnoreHash`. |
| `src/shared/messages.ts` | ContentMessage: `content/lint`, `content/grammar-feedback`. UiMessage: `ui/harper-status`. |
| `src/storage/migrations.ts` | Normalisation for all new fields (`normaliseGrammarStats`, hash-format filter, dialect/rule-list validation). |
| `src/background/message-router.ts` | Lazy `HarperHost` singleton (`chrome.runtime.getURL('vendor/harper/harper_wasm_bg.wasm')`); handlers for the two content messages and `ui/harper-status`; persisted metrics under storage key `harperMetrics` (cross-restart `setups` = the re-initialisation count to watch); live-dictionary sync on `add-dictionary`; host disposal on `ui/reset-learning`. |
| `src/content/editable-controller.ts` | The lint lane (fields + `maybeRequestLint`/`handleLintResponse`/`offerGrammarIssue`/accept/dismiss), `lintVersion` bumps, the three learning-separation branches. `ControllerHost` gained `requestLint` + `grammarFeedback`. |
| `src/content/session-controller.ts` | Implements the two new host methods as runtime messages. |
| `src/options/options.html` + `options.ts` | "Harper grammar engine" section: enable toggle (generic `data-setting` binder), dialect select, status line (setup count/ms, avg lint ms via `ui/harper-status`), disabled-rules chips with re-enable, per-rule stats table. |
| `manifest.json` | `content_security_policy.extension_pages` gained `'wasm-unsafe-eval'` (required for WASM in MV3). |
| `scripts/build.mjs` | Copies the WASM to `dist/vendor/harper/` + Harper LICENSE to `dist/licenses/`; `external: ['fs']` on the service-worker bundle (harper glue has a dead Node-only `import("fs")` fallback that esbuild otherwise tries to resolve). |
| `vitest.config.ts` | Include list restricted to unit/integration/browser so `tests/harper` never runs in the default suite. |
| `package.json` | `test:harper` script. |
| `tests/integration/dom-helpers.ts` | `TestHost` gained `lintRequests`, `grammarEvents`, `lintResponder` seams. |
| `tests/unit/migrations.test.ts` | One fixture extended with the new learning fields. |

## Historical measurement snapshot

These numbers came from the original real-WASM integration run on its
development machine; they are not current-device guarantees. Re-run
`npm run test:harper` for conformance and timing on the release machine.

- Engine setup: **~2.5–2.7 s** (paid once per service-worker lifetime, only
  when Harper is enabled *and* a paragraph needs linting).
- Lint: **~15–55 ms** per paragraph.
- Bundles: service worker 1.4 MB (glue included), WASM asset 18.2 MB,
  content script unchanged (no Harper code in it).

The persisted `harperMetrics.setups` counter (visible in options) is the
number that decides the offscreen-document question: if it climbs steeply
during normal use, worker eviction is re-charging the ~2.6 s setup too often
and `HarperHost` should move to an offscreen document. The class needs no
changes for that — only the instantiation site and a message hop.

## Lane behaviour details (added after first field testing)

First real-browser testing surfaced three lane defects, all fixed and
regression-tested in `tests/integration/lint-lane.test.ts`:

1. **Paragraph sweeping.** Originally only the caret paragraph was linted, so
   pasted multi-paragraph text was never checked. `nextLintTarget()` now
   prefers the caret paragraph, then sweeps unvisited paragraphs top-down, one
   per idle pass, self-chaining passes while clean paragraphs remain (budget:
   `autoLintPasses` ≤ 12 between user inputs; clean cache cap 200). Paragraphs
   whose issue was already offered are skipped by the sweep (`lintOffered`)
   unless the caret is in them, so an ignored chip cannot nag from afar.
2. **Chip chaining.** Accepting or dismissing a grammar chip now schedules the
   idle pass that surfaces the next issue (accepting changes the paragraph
   fingerprint, forcing a re-lint; dismissal is suppressed per issue key). The
   original build dead-ended after the first decision, which read as "multiple
   errors in one line makes it give up".
3. **Deterministic ordering.** Issues are offered earliest-offset-first, not
   in the engine's rule-map iteration order.

Also added: `validateIssue` drops `Capitalization` findings at paragraph
offset 0 when the preceding document text does not end a sentence. Paragraphs
are linted in isolation, so a hard-wrapped line ("…going to the\nmeeting?")
looks like a sentence start to the engine and produced bogus
`meeting -> Meeting` suggestions.

### Rich-editor hardening (after the Wattpad report)

Sites like Wattpad broke the lane in ways a plain textarea never exercises;
all hardened and regression-tested under "rich-editor hostility":

1. **Fingerprint-first staleness.** The version counter no longer auto-drops
   responses; the byte-exact slice fingerprint plus per-issue span check is
   the correctness gate. Editors that fire synthetic input events constantly
   (autosave/state syncing) were bumping the version on every tick and
   starving the lane of every response. A response that raced an edit in a
   *different* paragraph (or an append to the same one) is verified-safe and
   still used.
2. **Synthetic no-op events keep chips alive.** An input event with no
   `inputType` and byte-identical text no longer dismisses a visible chip
   (the O(n) text compare is paid only while a chip is showing).
3. **Drop-streak backoff.** Three consecutive fingerprint-invalidated
   responses trip the 30 s backoff, so a DOM-rewriting editor cannot drive an
   endless lint loop.
4. **Oversized-block windowing.** Single-block editors (no `\n` in the
   projection) used to be skipped entirely above 10 k chars; now a ≤4 k
   window is carved around the caret, snapped to whitespace. The
   capitalization guard already covers the mid-sentence window start.
5. **Content-free `console.debug` diagnostics** at every lane gate (request,
   response, drop reason, per-issue skip reason, offer). Enable "Verbose" in
   DevTools and filter for `autocorrect` to see the lane decide.

## Automatic application (`harperAutoApply`, default off)

When on, a validated finding is written straight into the text on the idle
pass instead of showing a chip. The record is identical to a chip-accepted one
except `autoApplied: true`, so the panel, review mode and revert all work
unchanged. A fading before/after badge (`highlighter.flashDiff`) shows what
changed, with an **Undo** button wired to `decide(id, 'revert')`; whitespace-
only changes render spaces as middots so a removed space is visible. Nothing is
inserted into the document - the badge lives in the shadow root like every
other visual.

**Gating** (`autoApplyDecision` in `src/shared/grammar.ts`, pure + unit-tested):
the setting must be on, the rule must not be in `AUTO_APPLY_DENY_RULES`
(currently `NominalWants` - measured rewriting "wont" to "want", wrong whenever
the user meant "won't", and the only rule that fires there because Spelling is
suppressed), the kind must not be in `AUTO_APPLY_DENY_KINDS` (`Style`,
`Readability` - taste, not correctness), and the user's own history must not
argue against it (`rejected >= 2 && rejected > accepted` demotes the rule back
to suggestion-only). `isSuppressed` is also consulted so a word the user just
reverted is not re-corrected.

**Stats semantics:** an auto-apply records `offered`, never `accepted` - the
user never agreed to it. Only an explicit keep counts as acceptance, and a
revert counts as a rejection. That keeps `accepted`/`rejected` an honest signal
of rule quality and is what drives the demotion rule above.

**Loop safety:** two budgets, both reset only by *genuine* user input (the
`autoLintPasses = 0` reset sits below the `applying` and
`insertReplacementText` guards, so our own edits cannot renew it):
`autoLintPasses` ≤ 12 for clean-paragraph sweeping, `autoAppliedChain` ≤ 50 for
productive applies. A regression test drives a pathological rule whose output
re-triggers itself and asserts the chain terminates.

## Panel filter: "Auto grammar"

`FilterKey` gained `auto-grammar`, backed by `isAutoAppliedGrammar()` in
`correction-history.ts`: `autoApplied && correctionType === 'grammar' &&
isHarperRuleId(sourceRuleId)`. All three clauses matter - the word lane's own
autocorrections are also `autoApplied`, and a chip the user accepted is a
grammar record but not an automatic one. Use it to audit everything the grammar
engine changed on its own initiative in a session.

## Context-menu actions

New permission: `contextMenus` (no user-visible warning). Two items on a text
selection, created in `src/background/context-menus.ts`:

- **Always correct "%s" to…** - asks the page to prompt for the replacement
  (`bg/prompt-rule` → `highlighter.promptForRule`, drawn in the shadow root at
  the selection, Enter submits / Escape cancels, keydown is stopped so site
  shortcuts and the editor never see it), then `content/create-rule` →
  `upsertUserRule` (mode `autocorrect`, confidence 0.99). If no content script
  is reachable (site not enabled, restricted page) the options page opens as a
  discoverable fallback and the toolbar badge flashes `!`.
- **Never correct "%s"** - completes in the background (`addToDictionary` plus
  a live `harper.importWords`), with a green `✓` badge flash and an in-page
  toast.

Validation is shared by all three entry points via `validateRulePair`
(context menu, in-page prompt, background handler), so they cannot disagree.
Selection text is untrusted: it is whitespace-collapsed and truncated to 64
characters before use.

## Known gaps / deliberate omissions

- **No promotion.** Stats are recorded per rule and are read to demote
  auto-application after repeated rejections, but no rule is promoted from
  those counters.
- **One chip at a time** (by design), but chips chain: each decision
  triggers the pass that surfaces the next issue.
- **Dictionary removals don't reach a live engine.** `importWords` is
  additive; a removed word stays in Harper's session dictionary until the
  worker restarts. Harmless (its Spelling kind is suppressed anyway).
- **`ui/import` doesn't rebuild a live engine's ignore list** until the next
  worker restart (stamps only grow). Same class of harmlessness.
- **Full rule-config UI** (`getStructuredLintConfig`) not built; disabled
  rules currently accumulate via "never apply this rule" during review, and
  can be re-enabled in options.
- **jsdom cannot run the WASM**, so default-suite lane tests use a mocked
  host. Real-engine behaviour is covered by `npm run test:harper` only.
- The imported-session normaliser (`parseImportedSessions`) may strip
  `sourceIgnoreHash` from records on import; the only consequence is that
  reverting such a record cannot feed Harper's ignore list.

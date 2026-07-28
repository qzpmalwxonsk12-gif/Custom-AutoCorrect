# Personal Autocorrect stress-test report

Review date: 2026-07-28  
Platform: Windows, Node 24.17, Vitest 2.1.9, jsdom  
Scope: deterministic engine, controller/history invariants, protected text,
Harper and punctuation lanes, personal/shadow state, evaluation, performance,
and production bundle

## Result

The review found real defects and fixed the ones for which a bounded,
deterministic regression could be written. The strongest result is not merely
that ordinary examples pass: the engine now has seeded adversarial properties
for all seven candidate processes, a positive-control protected-token corpus,
hostile-editor history tests, and explicit async lifecycle tests.

No production score weight was changed. In particular, the frequency weight
remains `0.04` and every unvalidated context signal remains at zero.

This is **not real-browser certification**. DOM/controller tests use jsdom, and
the Harper benchmark invokes the real local WASM package from Node. Chrome's
native undo stack, framework-specific editor contracts, the extension URL
loader, service-worker suspension, and actual browser process boundaries were
not exercised by Playwright, Puppeteer, or WebDriver.

## Evidence ledger

| Check | Result | What it establishes |
|---|---:|---|
| `npm.cmd test` | 59 files, 1,209/1,209 tests passed | Unit, jsdom integration, and tooling regressions |
| `npm.cmd run typecheck` | passed | TypeScript consistency |
| `npm.cmd test -- tests/integration/lint-lane.test.ts` | 37/37 passed | Final Harper lifecycle, policy, hidden-chip, and auto-apply behavior |
| Seeded ranking properties | 7/7 passed | All seven bounded processes, deterministic ordering, inert weights, raw margins |
| Protected-token adversarial suite | 7/7 tests passed | 55 protected contexts, five complete-token shapes, and five positive controls |
| `npm.cmd run evaluate` | 5 files, 16/16 tests passed | Final corpus, signal, false-positive, and frequency-sweep reports |
| Expanded benchmark | all five enforced budgets passed; 24 workloads measured | All candidate processes, ranking/context, spacing, punctuation, history/revert, typical, busy, and 5 MiB paths |
| Repository encoding gate | 228 project text files clean | Recursive supported-text coverage, including previously missed arrow sequences |
| Real Harper conformance | 6/6 passed | Local `harper.js` WASM setup and lint behavior |
| Production build and bundle gate | passed | All outputs build and remain below configured ceilings |

The detailed benchmark and bundle measurements are in
`artifacts/codex-review/PERFORMANCE.md` and
`artifacts/codex-review/BUNDLE-ANALYSIS.md`.

## 1. Candidate generation and ranking

### Seeded one-edit recovery

`tests/unit/seeded-ranking-adversarial-properties.test.ts` uses seed
`0x5eedc0de`. It generates 70 replayable mutations, ten for each process:

1. same-length/same-first-letter bucket similarity;
2. adjacent swap;
3. one QWERTY-neighbour substitution;
4. duplicate-letter removal;
5. missing-letter insertion;
6. extra-letter deletion; and
7. dropped-apostrophe insertion.

Every target was recovered through its expected strongest process. The test
also asserts the actual search bounds:

- no more than ten returned candidates;
- exactly `n - 1` adjacent swaps;
- at most `n * 8` keyboard substitutions;
- at most `n - 1` duplicate checks;
- at most `(n + 1) * 26` missing-letter checks;
- at most `n` deletion checks;
- at most `n - 1` apostrophe checks; and
- Process 1 examines no more than its length/first-letter bucket.

Running the same seed twice yields the same complete trace.

### Merge and ordering properties

- A candidate found by more than one process is emitted once. For `wprks`,
  `works` retains the stronger direct QWERTY evidence rather than the weaker
  bucket-only explanation.
- Dictionary insertion order does not affect candidate order. Reversing a
  synthetic dictionary gives the same result for `eorks`.
- `eorks` has three valid physical-neighbour readings in the test dictionary:
  `works`, `dorks`, and `forks`. This is an important counterexample to the
  tempting assumption that it has only two. Ranking and margin checks, not
  first-hit selection, are therefore essential.
- Score ties break by operation cost, then stronger direct edit evidence, and
  only finally lexically.

### Score-signal isolation

A hostile test supplies a `Proxy` context and document-evidence object that
throw if read. With all their corresponding weights at zero, ranking completes
without accessing them, every disabled term remains exactly zero, and the
candidate order matches the no-context run. A disabled signal is therefore
behaviorally inert, not merely multiplied by zero after doing work.

### Raw score and one-margin invariant

The adversarial `thats` case pushes both `"that's"` and `that` above the
display-confidence ceiling. Ranking still selects `"that's"` on the unclamped
scores; alphabetical fallback cannot replace the stronger result. The action
gate uses the same raw winner/runner-up margin and clamps only the final display
confidence.

### Calibration counterexamples

- At the shipped weights, `iprove` ranks `improve` above the more frequent
  `iphone` because the direct one-edit explanation is stronger.
- At the shipped frequency weight `0.04`, `mastter` ranks `master`. Raising only
  frequency to `0.06` flips it to `matter`. This is a measured calibration
  boundary, not a reason to change production in this review.
- Genuine dropped apostrophes such as `didnt` recover `"didn't"`. The ESDB-only
  false reading `mis` -> `"mi's"` is rejected by lexical-support rules.

## 2. Protected-token and privacy stress

### Deterministic protected corpus

`tests/unit/protected-token-fuzz.test.ts` uses seed `0x51a7f00d` and a hard
64-case cap. The current corpus contains 55 contexts across:

- URL, e-mail, bare-domain, version/number, and path shapes;
- function/member/snake/code-fence and other code-like shapes;
- JSON, CSS, SQL, flags, kebab identifiers, and regular-expression shapes;
- numeric IDs, IP-like runs, scientific notation, cards, OTPs, UUIDs, hashes,
  and chemical-like identifiers;
- markdown links, HTML, packages, hashtags, and handles;
- ASCII and Unicode hyphen fragments; and
- Unicode characters next to dotted or e-mail runs.

Five complete-token assertions cover camelCase, PascalCase, snake_case,
kebab-case, and a mixed alphanumeric ID.

This is not a vacuous "nothing happened" test. The plain-prose controls
`waht`, `teh`, `adn`, `becuase`, and `recieve` are first proved to produce real
automatic corrections. Those same high-confidence typos must never be
auto-rewritten inside the protected shapes.

### Counterexamples found during the review

The first adversarial pass exposed:

- `becuase.example.test`;
- `waht.localhost`;
- `waht()`;
- `teh.例`;
- `mis‑matches`; and
- `matches–mis`.

A later structured-code expansion exposed:

- `{"key":"teh"}`;
- `.box { content: teh; }`;
- `SELECT becuase FROM items`; and
- `feature-waht-flag`.

All are now covered by fixed regressions. The fixes are conservative boundary
classification: Unicode dash handling, a function-call suffix, Unicode-aware
dotted runs, balanced-brace/SQL recognition, and sandwiched or repeated dash
protection. They do not add an unbounded parser or dictionary scan.

### Dynamic sensitive fields

The integration tests change a normal field into a password/code-like field at
several hostile boundaries:

- before a Tab-triggered commit;
- before opening the markup overlay;
- synchronously from the host's `input` handler after an extension edit; and
- after the first edit in a multi-fix punctuation batch.

The controller re-runs privacy eligibility before the read. The adapters verify
their direct fallback before dispatching the host event, and the controller
does not read the field again if that event makes it sensitive. A correction
already made at that exact boundary retains a context-free, memory-only undo
record so visible text and history do not diverge.

These tests instrument adapter reads. They establish no extra application-level
read in the modeled paths; they do not prove that a browser or host framework
never copies field content internally.

## 3. Editor, history, and rollback hostility

### One visible mutation, one record

`tests/integration/history-invariant.test.ts` exercises exact typos, personal
rules, punctuation, accepted Harper findings, duplicate/missing/extra letters,
token merge/split, and sentence capitalization. For every successful
correction, exactly one reversible record is created.

### Host rewrite after apply

Adversarial adapters:

- append unexpected text to the requested replacement;
- normalize a requested ordinary space to NBSP;
- normalize whitespace elsewhere in the field;
- mangle both the correction and its first rollback attempt; and
- refuse or rewrite restoration.

The whole field is compared with the expected result. Equivalent normalization
inside the requested edit can be recorded truthfully. Mutation outside the
requested span is rejected and rolled back. If rollback itself is rewritten,
the controller derives and records the actual remaining mutation so the panel
still has a truthful undo handle and does not learn false word-pair evidence.

### Host rewrite during revert

Reversion now checks the complete expected field, not only the target span. If
the host appends or normalizes collateral text, the controller restores the
pre-revert field and leaves the correction record actionable; if restoration
fails, the record becomes unresolved instead of falsely claiming success.

### Restored minimal-history collision

A context-free record restored from a mismatched document fingerprint used to
be able to attach to one coincidental matching word. The regression keeps the
history visible but marks it unresolved and denies edit authority until its
stored fingerprint matches.

### Contenteditable same-task cache

MutationObserver delivery is asynchronous. A DOM mutation followed by a
controller read in the same input task previously could use the old flat-text
projection and old offsets. The adapter now invalidates on `beforeinput` and
`input` as well as observer delivery. Tests mutate character data and selection
and then read text/caret synchronously.

This models the race in jsdom. It does not validate every rich-editor DOM
projection or native undo contract in Chrome.

## 4. Harper async lane

The final Harper integration stress covers:

- one request in flight, with later work coalesced;
- pending response after controller detach;
- pending response after Harper is disabled;
- pending response while IME composition starts;
- byte/fingerprint drift and issue-span drift;
- a harmless edit in another paragraph;
- repeated silent host churn and backoff;
- a 4,000-character window over an oversized block;
- deterministic earliest-issue ordering;
- chaining after accept, dismiss, and automatic application;
- a bounded self-renewing finding;
- recent manual-revert suppression;
- rule statistics and review actions;
- central rule/personal-vocabulary/shadow gating;
- policy re-check when an old chip is clicked; and
- automatic Harper operation when suggestion chips are hidden.

The detach fix uses both attachment state and a generation number. Disable and
IME state are checked again when the promise resolves. Text offsets are trusted
only while the exact linted bytes still match.

Harper auto-apply and chip acceptance now pass through the same proposal gate as
synchronous providers. Shadow-all records the action without changing text,
blocked/allowed personal vocabulary remains authoritative, current rule mode is
re-read at click time, and a recent user revert prevents immediate re-apply.

The hidden-chip regression was found by source inspection: request and response
gates required `showSuggestionChips` even when `harperAutoApply` was true. The
final condition allows work when either output path is enabled; suggestions are
still not displayed when chips are off.

## 5. Punctuation and sentence boundaries

The punctuation lane now:

- uses profile-projected settings, so the coding profile can disable it;
- emits `correctionType: "punctuation"` and the punctuation shadow provider;
- clears stale claims before every pass;
- publishes a claim only after dismissal, overlap, rule-mode, personal, and
  shadow gates have accepted the proposal;
- stops between batch edits if the field becomes sensitive;
- rechecks policy when a chip is clicked;
- does not create catastrophic word-pair learning such as
  `and -> ", and"`; and
- lets Harper surface an issue that a disabled/stale punctuation proposal does
  not own.

Spelling, capitalization, and punctuation segmentation previously maintained
inconsistent abbreviation rules. Punctuation sentence splitting now delegates
to the shared `followsAbbreviation` logic. Regressions distinguish lowercase
sentence-final `no.` from abbreviation `No.`, and cover `Dr.`, initials,
`e.g.`, and decimals.

The punctuation corpus remains 74 positive and 118 negative fixtures and
reports 100% precision/recall on that authored set. That result is only about
the fixture distribution; it is not a claim of general natural-language
precision.

## 6. Shadow mode and personal vocabulary

- Shadow observations are bounded, snippets are capped, and forced scans have
  a per-sweep budget.
- A detached controller stops collecting.
- The same repeated pair is de-duplicated within a sweep.
- Agreement/disagreement pairing now requires the same origin; equal text from
  unrelated sites no longer creates a cross-origin relationship.
- A same-size storage snapshot replacement now invalidates the resolved
  personal-vocabulary view by source and entries identity, not entry count
  alone.

The cache contract assumes storage/config propagation replaces snapshots
wholesale. Arbitrary in-place mutation of an existing entry object remains
outside that contract.

## 7. Evaluation

The old frequency sweep compared the active `0.04` configuration against
itself, making the production row necessarily report no difference. The
evaluation now defines an explicit zero-frequency baseline, tests
`0.02, 0.04, 0.06, 0.08, 0.10`, and asserts that the shipped weight is included.

The generated report currently records for `0.04`:

- 29 winner disagreements from the zero-frequency baseline;
- 14 cases where the frequency-informed winner restores the synthetic
  original;
- 0 cases where the zero-frequency winner was the known original;
- 0 higher-operation-cost overrides; and
- no production-weight change made by this review.

The final main run parsed 2,001 sentences, classified 1,045 as usable clean
prose, sampled 300, and attempted 299 synthetic corruptions: 270 restored the
known original, 26 chose another word, and 3 were missed. These figures describe
the deterministic sample; “another word” is not automatically a confirmed
engine defect because a synthetic mutation can have more than one valid
reading.

The latest generated unmodified-text report contains 13 apparent changes and
0 confirmed engine false positives after applying the checked-in manual review.
The prior confirmed `mis` and `o'neal` cases disappeared because the underlying
token/apostrophe defects were fixed; their classifications remain in
`review.json` as historical, reproducible evidence.

Evaluation limitations remain substantial:

- only a fixed 300-clean-sentence sample is used in the main sweep;
- corruptions are synthetic one-edit mutations;
- corpus reconstruction deliberately skips some structures;
- manual classification can be wrong; and
- corpus results do not model editor events or browser integration.

## 8. Performance and bundle

The expanded benchmark passed all five enforced budgets. The final run reports
a worst measured p99 of 15.937 ms against the 30 ms ceiling and full
percentiles for all 24 workloads.
The real local Harper conformance suite passed 6/6. See `PERFORMANCE.md` for
warm-up, sample sizes, percentiles, and the important exclusions.

The production build and bundle gate pass. The final content script is about
1,746.2 KiB with about 53.8 KiB of configured headroom; total unpacked output is
about 22,808.6 KiB. Harper WASM dominates the package, and dictionary/frequency
data are duplicated across entry bundles. This is a size and cold-start risk,
not a failing ceiling.

## 9. What this report does not claim

- No real Chrome, Firefox, or Android UI was automated.
- No third-party rich editor was opened.
- Native browser undo/redo behavior was not measured.
- Service-worker suspension/restart timing was not stress-tested in Chrome.
- No heap-retention or multi-hour soak test was run.
- No network call is required by production correction, but this review did not
  packet-capture a browser session.
- The finite protected corpus does not prove every future code/identifier
  grammar is recognized.
- A passing authored punctuation corpus is not an external language benchmark.

## 10. Documentation and release tooling

The frequency/context documentation and runtime evidence strings now match the
active production weight (`0.04`) and the provider-specific policy scope. The
encoding gate previously checked only three named files and missed mojibake
arrows in its own default document. A failing-first regression now creates a
nested fixture project; the checker recursively scans supported project text,
excludes dependencies/build/generated reports, recognizes the missing arrow
forms, and reports 228 checked files clean.

## 11. Exact changed-file inventory

Production/runtime:

- `src/content/contenteditable-adapter.ts`
- `src/content/editable-controller.ts`
- `src/content/input-adapter.ts`
- `src/content/punctuation-lane.ts`
- `src/engine/context/candidate-order.ts`
- `src/engine/context/candidate-scoring.ts`
- `src/engine/context/rule-context-provider.ts`
- `src/engine/correction-engine.ts`
- `src/engine/data/frequency.ts`
- `src/engine/punctuation/punctuation-tokenizer.ts`
- `src/engine/tokenizer.ts`
- `src/shared/shadow-mode.ts`

Permanent tests and evaluation:

- `tests/evaluation/evaluator.ts`
- `tests/evaluation/report.ts`
- `tests/evaluation/ud-evaluation.test.ts`
- `tests/integration/correction-actions.test.ts`
- `tests/integration/correction-flow.test.ts`
- `tests/integration/history-invariant.test.ts`
- `tests/integration/lint-lane.test.ts`
- `tests/integration/punctuation-lane.test.ts`
- `tests/integration/rule-controls.test.ts`
- `tests/integration/shadow-sweep.test.ts`
- `tests/unit/correction-engine.test.ts`
- `tests/unit/encoding-check.test.mjs`
- `tests/unit/protected-token-fuzz.test.ts`
- `tests/unit/punctuation-engine.test.ts`
- `tests/unit/seeded-ranking-adversarial-properties.test.ts`
- `tests/unit/shadow-mode.test.ts`
- `vitest.config.ts`

Tooling and documentation:

- `scripts/benchmark.mjs`
- `scripts/check-bundle-size.mjs`
- `scripts/fix-encoding.mjs`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT-ENGINE.md`
- `docs/CONTROLS.md`
- `docs/DICTIONARY.md`
- `docs/HARPER-INTEGRATION.md`
- `docs/LIMITATIONS.md`
- `docs/PRIVACY.md`
- `docs/PUNCTUATION.md`
- `docs/SPELLING-AND-HISTORY.md`
- `docs/THREAT-MODEL.md`

Review/evaluation outputs:

- `artifacts/codex-review/CODEBASE-MAP.md`
- `artifacts/codex-review/STRESS-TEST-REPORT.md`
- `artifacts/codex-review/BUGS-FOUND.md`
- `artifacts/codex-review/PERFORMANCE.md`
- `artifacts/codex-review/BUNDLE-ANALYSIS.md`
- `artifacts/context-evaluation/character-context.md`
- `artifacts/context-evaluation/document-reuse.md`
- `artifacts/context-evaluation/frequency-regressions.md`
- `artifacts/context-evaluation/frequency-weight-sweep.md`
- `artifacts/context-evaluation/part-of-speech.md`
- `artifacts/context-evaluation/pos-ground-truth.md`
- `artifacts/context-evaluation/sentence-position.md`
- `artifacts/context-evaluation/ud-apparent-false-positives.md`

`dist/` was regenerated by the verified production build; its exact output
composition and byte counts are in `BUNDLE-ANALYSIS.md`.

Confirmed fixed and open defects, with their individual reproductions and
smallest fixes, are catalogued in `artifacts/codex-review/BUGS-FOUND.md`.

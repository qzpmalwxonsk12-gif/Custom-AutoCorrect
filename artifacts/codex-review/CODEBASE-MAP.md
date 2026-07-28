# Current codebase map

Review date: 2026-07-28  
Repository examined: `C:\Users\Arjun\ChatgptTesting`  
Review point: before any production or stress-test change in this review

## 1. Baseline and environment

The repository on disk, not an earlier review, is the source of truth for this
map.

Environment:

| Item | Value |
|---|---|
| OS | Microsoft Windows NT 10.0.26200.0, x64 |
| Node | v24.17.0 |
| npm | 11.13.0 |
| TypeScript target | ES2022 |
| Chrome target | Chrome 116 |
| Test runner | Vitest 2 |
| DOM integration environment | jsdom |

There is no `.git` directory at this workspace root. `git status` therefore
fails with “not a git repository”, so there is no authoritative clean/dirty
working-tree state or commit identity to report. Existing files must be treated
as user-owned.

### Commands run before changes

| Command | Result |
|---|---|
| `npm.cmd run check` | Passed |
| `npm.cmd run evaluate` | Passed after rerunning outside the restricted sandbox |
| `npm.cmd run test:harper` | Passed after rerunning outside the restricted sandbox |
| `npm.cmd run benchmark:enforce` | Passed after rerunning outside the restricted sandbox |

`npm.cmd run check` covered encoding verification, dictionary/frequency/bigram
regeneration checks, TypeScript, the default unit/integration suite, production
build, and bundle ceilings.

Verified baseline:

| Measurement | Result |
|---|---:|
| Default test files | 56 |
| Default tests | 1,171 passed |
| Dictionary words | 107,901 |
| ESDB source duplicates removed | 2,001 |
| Frequency words | 40,459 |
| Frequency bands | 7 |
| Attested bigrams | 676 |
| Content script | 1,742.8 kB / 1,800 kB |
| Service worker | 1,437.6 kB / 1,800 kB |
| UI | 1,800.8 kB / 2,100 kB |
| Harper WASM | 17,803.9 kB / 20,000 kB |
| AI/model assets | 0 kB / 20,000 kB |
| Total unpacked | 22,805.1 kB / 46,000 kB |

Dictionary content hash:
`d2541bde...` (the full value is emitted by the generator check).

The evaluation suite parsed 2,001 UD English EWT sentences, found 1,045 usable
sentences, and used 300 clean sentences. Of 299 attempted corruptions, 270 were
restored, 27 were changed to a different word, and 2 were missed. The
unmodified-corpus pass reported 14 apparent false positives and **1 currently
confirmed false positive after manual review**, not the reported baseline of
zero. The confirmed current case is the `mis` fragment in `mis-matches`, which
is automatically changed to `is`.

The real Harper suite passed 6 tests. Measured setup was about 2.5 seconds,
first lint about 65 ms, and three warm paragraph lints about 17 ms total in that
run.

The enforced benchmark passed. Selected results:

| Operation | Median | p95 | p99 | Worst |
|---|---:|---:|---:|---:|
| Dictionary lookup | 0.0003 ms | 0.0004 | 0.0005 | 0.0008 |
| Adjacent swaps | 0.0037 ms | 0.0068 | 0.0111 | 0.0134 |
| Typical full decision | 0.8331 ms | 1.135 | 1.224 | 1.227 |
| Busy candidate case | 4.295 ms | 5.296 | 5.878 | 6.213 |
| 5 MiB field decision | 5.364 ms | 6.021 | 6.772 | 6.989 |

The default suite intentionally excludes the real Harper WASM tests and the
large UD evaluation. There is no real-browser automation dependency. Browser-
facing integration is currently exercised with jsdom.

Static declarations currently break down as 40 unit files / 674 tests, 16
integration files / 259 tests, 1 Harper file / 6 tests, and 5 evaluation files
/ 15 tests. `tests/browser/**` is configured but empty. The evaluation suite
skips rather than fails if UD EWT is missing, so a green `npm run evaluate` is
only meaningful when its output confirms that the corpus was actually parsed.

## 2. Layer and ownership map

### Runtime entry points

| Responsibility | File |
|---|---|
| MV3 manifest and permissions | `manifest.json` |
| Content-script entry | `src/content/content-script.ts` |
| Per-frame controller | `src/content/session-controller.ts` |
| Per-editable controller | `src/content/editable-controller.ts` |
| Background entry | `src/background/service-worker.ts` |
| Background message/config owner | `src/background/message-router.ts` |
| Harper engine host | `src/background/harper-host.ts` |
| Side panel | `src/side-panel/side-panel.ts` |
| Options and advanced controls | `src/options/options.ts`, `src/options/options-advanced.ts` |

The background is the single writer for settings and learned data. Content
scripts hold snapshots and own live editable text and per-field correction
sessions.

### Editable abstraction

| Responsibility | File / export |
|---|---|
| Adapter contract | `src/content/adapter.ts` / `EditableAdapter` |
| Input and textarea adapter | `src/content/input-adapter.ts` / `InputAdapter` |
| Rich editable projection | `src/content/contenteditable-adapter.ts` / `ContentEditableAdapter` |
| Field eligibility | `src/content/field-guard.ts` / `guardField`, `isSensitiveField` |
| Caret geometry | `src/content/caret-rect.ts` |

`ContentEditableAdapter` projects text nodes and block boundaries into a flat
UTF-16 string, maps offsets back to DOM ranges, and invalidates its cache from
both `beforeinput`/`input` and a `MutationObserver`.

### Deterministic correction engine

| Responsibility | File / export |
|---|---|
| Top-level word analysis | `src/engine/correction-engine.ts` / `analyze` |
| Context construction | `src/engine/correction-engine.ts` / `buildContext` |
| Token extraction/protection | `src/engine/tokenizer.ts` / `wordEndingAt`, `analyzeToken` |
| Seven word candidate processes | `src/engine/candidate-generator.ts` |
| QWERTY neighbour source of truth | `src/engine/keyboard-distance.ts` / `KEY_NEIGHBOURS` |
| Unified score | `src/engine/context/candidate-scoring.ts` / `scoreCandidate` |
| Shared comparator | `src/engine/context/candidate-order.ts` / `compareByScore` |
| Ranked decision | `src/engine/context/rule-context-provider.ts` |
| Risk classification/policy | `src/engine/context/correction-policy.ts` |
| Confidence/display action | `src/engine/confidence-scorer.ts` |
| Personal rule/context evidence | `src/engine/personal-learning.ts`, `src/engine/context-scorer.ts` |
| Standalone capitalisation | `src/engine/sentence-capitalisation.ts` |
| Token merge/split | `src/engine/token-spacing.ts` |
| Repeated words | `src/engine/repeated-words.ts` |

The seven word candidate processes are:

1. same length and same first-letter bucket;
2. adjacent transposition;
3. one QWERTY-neighbour substitution;
4. duplicate-letter removal;
5. one missing-letter insertion;
6. one extra-letter deletion;
7. one apostrophe insertion.

Token merge, token split, repeated words, and standalone capitalisation are
separate providers in the controller rather than `CandidateProcess` values.

### Punctuation and shared language analysis

| Responsibility | File |
|---|---|
| Punctuation provider/cache | `src/engine/punctuation/punctuation-provider.ts` |
| Sentence/token analysis | `src/engine/punctuation/punctuation-tokenizer.ts` |
| Token classification | `src/engine/context/token-classifier.ts` |
| Clause analysis | `src/engine/context/clause-detector.ts` |
| Overlap resolution | `src/engine/punctuation/overlap-resolver.ts` |
| Punctuation/controller bridge | `src/content/punctuation-lane.ts` |
| Six rules | `src/engine/punctuation/rules/*.ts` |

The punctuation provider cache is bounded at 40 entries and applies personal
rule statistics after the cache, so context-dependent demotion is not cached as
an intrinsic winner.

### History and persistence

| Responsibility | File / export |
|---|---|
| Anchor creation/refresh | `src/history/anchor.ts` |
| Record creation/transitions | `src/history/correction-record.ts` |
| Relocation | `src/history/correction-locator.ts` |
| Revert plan | `src/history/correction-reverter.ts` |
| Session counts/retention | `src/history/correction-history.ts` |
| Guided review | `src/history/review-session.ts` |
| Session persistence | `src/storage/session-storage.ts` |
| Settings/learning storage | `src/storage/storage.ts` |
| Validation/migrations | `src/storage/migrations.ts` |

Storage uses `chrome.storage.local`. Sessions are one key per session and
serialised through a promise tail. Settings and learning are normalised at the
storage boundary. Session context is stripped or bounded again in the
background before persistence.

## 3. Synchronous input-to-history flow

The current committed-word flow is:

```text
input / key event
  -> SessionController has attached an EditableController
  -> EditableController.onInput / onKeyDown
  -> refreshEligibility() and field guard
  -> commitNearCaret()
  -> repeated-word check
  -> token merge/split check
  -> correction-engine.analyze()
       -> wordEndingAt()
       -> analyzeToken() protected-token decision
       -> buildContext()
       -> exact user/personal rule layer
       -> curated typo layer
       -> generateCandidates() (all seven processes, merged and bounded)
       -> ruleContextProvider.rank()
            -> scoreCandidate() for every retained candidate
            -> compareScored() / compareByScore()
            -> raw best-minus-second margin
       -> display confidence/action
       -> classifyRisk() / applyPolicy()
       -> legacy real-word contextual/confusion layer when spelling declines
       -> local a/an rule
  -> coding-profile delimiter guard
  -> gateProposal()
       -> per-rule mode
       -> personal vocabulary and document ignore
       -> shadow mode
  -> isSuppressed() revert/ping-pong guard
  -> applyCorrection() or suggestion chip
  -> createAnchor() + createRecord()
  -> session + learning notification
  -> background persistence after debounce
```

If word analysis does nothing, capitalisation runs last. All synchronous
providers are intended to pass through `gateProposal` before an automatic
write or chip.

## 4. Asynchronous Harper lifecycle

The implemented Harper path is distinct from the reserved future async ranking
slot:

```text
700 ms idle
  -> punctuation lane first
  -> maybeRequestLint()
  -> nextLintTarget(): caret paragraph first, <=4,000-char window
  -> one in-flight request per field
  -> content/lint message
  -> background HarperHost singleton
  -> lazy bundled WASM setup
  -> serialised LocalLinter queue
  -> suggestion applied to a copy and diffed into UTF-16 edit
  -> LintResponse
  -> exact paragraph-slice fingerprint check
  -> validateIssue(): bounds, exact target, legacy dictionary/block, overlap
  -> punctuation-claim overlap check
  -> Harper auto-apply policy or chip
  -> applyCorrection()
```

Controller caches for clean/offered paragraphs are capped at 200. Three
consecutive stale paragraph responses trigger a 30-second controller backoff.
Clean self-chaining is capped at 12 passes and productive automatic fixes at
50.

`src/engine/context/async-context.ts` is a future provider contract, not wired
to live text. It independently provides request/session/fingerprint/target
verification, a one-active-request queue, stale backoff, and a hard suggestion
ceiling. `asyncContextProviders` is empty.

## 5. Mutation inventory

Searches covered `replaceRange`, `setRangeText`, `execCommand`, `insertText`,
`Range.deleteContents`, `Range.insertNode`, editable `.value` assignment,
`textContent`, `innerText`, and `innerHTML`.

Provider/reversion calls to `EditableAdapter.replaceRange`:

1. `EditableController.applyCorrection()` — normal provider application.
2. `EditableController.rollback()` — whole-field recovery after a rejected host rendering.
3. `EditableController.revert()` — an explicit history reversion.

Adapter implementations:

- `InputAdapter.replaceRange()` tries `execCommand('insertText')`, then uses the
  native input/textarea value setter and dispatches
  `insertReplacementText`.
- `ContentEditableAdapter.replaceRange()` tries `execCommand('insertText')`,
  then uses `Range.deleteContents()`/`insertNode()` and dispatches
  `insertReplacementText`.

Other `.value`, `textContent`, and `innerHTML` assignments found in `src/` are
UI rendering, diagnostics self-tests, or adapter internals. No correction
provider directly edits user text.

The mutation *call* invariant currently holds, but Phase 1 found correctness
risks around the central path:

- a host-rendered NBSP is accepted as equivalent, while the record stores the
  requested ordinary-space replacement; literal relocation then cannot find
  it for reversion;
- whole-field whitespace equivalence can accept a host mutation outside the
  target span;
- the documented “one margin” rule is weakened by recomputing a clamped
  confidence margin and taking `Math.max` with the ranked raw margin;
- Harper reaches `applyCorrection` without the common `gateProposal` choke
  point.

These are Phase 2 reproduction targets, not yet classified as fixed defects in
this pre-change map.

## 6. Current score signals

Production weights are read from `src/engine/context/score-weights.ts`.

| Signal | Declared | Implemented | Unit tested | Corpus/ground-truth evaluated | Production | Shadow |
|---|---|---|---|---|---:|---:|
| `editOperation` | yes | yes | yes | indirectly | 1.00 | 1.00 |
| `frequency` | yes | yes | yes | UD sweep | **0.04** | 0.04 |
| `partOfSpeech` | yes | yes | yes | POS and UD | 0 | 0 |
| `wordContext` | yes | placeholder | inertness only | no | 0 | 0 |
| `sentencePosition` | yes | yes | yes | UD | 0 | 0.01 |
| `documentReuse` | yes | yes | yes | report/shadow | 0 | 0.02 |
| `personalHistory` | yes | placeholder score term | inertness only | no | 0 | 0 |
| `knownPhrase` | yes | placeholder | inertness only | no | 0 | 0 |
| `characterContext` | yes | yes | yes | UD; harmful at tested weights | 0 | 0 |

`rankAdjustment` is an additional unweighted, pre-existing personal
rule/context nudge. It is not the placeholder `personalHistory` term.

There are also two older active signals inside `editOperation` and the legacy
layers:

- `candidateGenerationScore()` includes a compact hand-authored common-word
  prior with a coefficient of 0.18. This is separate from the corpus frequency
  term at 0.04.
- personal acceptance/context evidence changes the unweighted
  `rankAdjustment`, while hand-authored real-word confusion patterns operate
  in the later contextual layer. Declared score terms at zero do not mean these
  older mechanisms are inactive.

Zero-weight implemented signals are skipped rather than merely multiplied
after calculation. Current tests establish their behavioural inertness.
Production and shadow both use `rankCandidates` and the same comparator.

No disabled signal is justified for activation by the baseline evaluation.
The current evaluation in fact makes higher frequency weights look better on
this 300-sentence sample than the historical documentation, but this review
does not treat that as sufficient evidence to retune production.

## 7. Generated and vendor data

### ESDB dictionary

```text
vendor/esdb/en_US.txt
  -> scripts/generate-dictionary.mjs
  -> src/engine/data/dictionary-data.ts
  -> src/engine/data/dictionary-metadata.ts
  -> src/engine/data/dictionary.ts
```

The generator normalises apostrophes/case, removes malformed or duplicate
entries, sorts deterministically, writes metadata/hashes, and supports
`--check`. Runtime builds one shared `Set` and one length/first-letter bucket
map at module load.

### Corpus frequency

```text
vendor/frequency/en_common.txt
  -> scripts/generate-frequency.mjs
  -> frequency-data.ts / frequency-metadata.ts
  -> frequency.ts
```

The source has 50,000 fully accounted input rows. The generated output retains
40,459 dictionary-compatible words in seven quantised bands. Direct entries
outrank morphological fallback, and unknowns return no frequency boost.

`vendor/frequency/README.md` still says redistribution licensing must be
confirmed before public shipping even though the generated data is in the
production bundle. That is a release/provenance issue outside an algorithmic
fix and must not be silently represented as resolved.

### Character bigrams

```text
vendor/character-ngrams/*
  -> scripts/generate-bigrams.mjs
  -> src/engine/data/bigram-data.ts
```

There are 676 attested pairs. Character context is implemented but remains at
zero after negative evaluation.

The bigram generator does not currently reject duplicate source keys before
`Map.set`, and the vendor bigram/trigram material lacks the ESDB pipeline's
strong version/licence/hash provenance. The 17,556-entry trigram file has no
runtime importer and is excluded from production.

### Evaluation and Harper

- UD English EWT lives under `vendor/evaluation/UD_English-EWT` and is used
  only by `tests/evaluation`. Current evaluation uses the development split;
  train/test and the `not-to-release` source tree are not runtime inputs.
- Harper JS is imported only by `src/background/harper-host.ts`.
- The build copies Harper’s WASM and licence, not its tests or sources.
- Production `dist/` contains no UD/conllu report or evaluation code.
- `scripts/build.mjs` copies only an explicit static-file list and `public/`
  top-level files; vendor evaluation and the root LanguageTool archive are not
  copied.
- Searches of `dist/` found no `UD_English`, `conllu`,
  `tests/evaluation`, or evaluation-report strings.

The large root `languagetool-master.zip` and zero-byte `languagetool` file do
not enter the build. They remain unexplained development residue and consume
workspace disk, not extension bundle bytes.

## 8. Settings, profiles, vocabulary, and shadow

- Effective global/site/profile/rule configuration is resolved in
  `src/shared/effective-settings.ts` and `src/shared/profiles.ts`.
- Rule ids/modes are defined in `src/shared/rules.ts`.
- Vocabulary validation/scopes/views are in `src/shared/vocabulary.ts`.
- Shadow observation shape, global 500-entry cap, and summaries are in
  `src/shared/shadow-mode.ts`.
- The controller adds a stricter 120-observation cap per forced scan and
  deduplicates by provider and word pair.
- Shadow observations store bounded original/replacement spans and origin, not
  surrounding sentences.

The controller’s vocabulary-view cache is currently stamped only by entry
count. Replacing one vocabulary snapshot with a different snapshot of the same
length can therefore retain stale allow/block decisions. This is a high-value
Phase 2 regression target.

## 9. Test organisation

| Suite | Location | Default? |
|---|---|---|
| Unit | `tests/unit/**/*.test.ts` | yes |
| DOM integration | `tests/integration/**/*.test.ts` | yes, jsdom |
| Browser-shaped jsdom | `tests/browser/**/*.test.ts` | configured, currently absent |
| Harper conformance | `tests/harper/**/*.test.ts` | `npm run test:harper` |
| UD/signal evaluation | `tests/evaluation/**/*.test.ts` | `npm run evaluate` |

Existing coverage is broad across the seven generators, frequency, ranking,
punctuation corpus, adapters, history/locator/reverter, storage/migrations,
learning, vocabulary, shadow sweeps, Harper races, and performance.

Important gaps selected for adversarial testing:

- no seeded cross-process property suite;
- no permanent protected-text mixed-content fuzz matrix;
- no regression that reverts an accepted NBSP-normalised correction;
- no Harper shadow/vocabulary gate regression;
- no pending-Harper-after-detach/disable/composition regression;
- no same-count vocabulary-cache invalidation regression;
- no restoration test preventing a privacy-minimal stale session from
  reverting an unrelated unique word;
- no test proving the final policy receives exactly the ranked raw margin;
- no real browser automation; jsdom cannot validate native undo-stack
  behaviour or framework-specific editor contracts.

The normal `build` command regenerates only the dictionary. Frequency and
bigram staleness are checked by `check`, not by `build`. The enforced benchmark
is also outside `check`.

## 10. Bundle constraints

`scripts/check-bundle-size.mjs` enforces:

| Group | Ceiling |
|---|---:|
| Content script | 1,800 kB |
| Service worker | 1,800 kB |
| UI | 2,100 kB |
| Harper WASM | 20,000 kB |
| Optional AI model | 20,000 kB |
| Total | 46,000 kB |

The content script has only about 57 kB of remaining headroom. The dictionary
is its dominant JS data, and the frequency table duplicates strings already
present in the dictionary. Encoding frequency bands by dictionary index is a
real possible reduction, but it changes generated data and runtime lookup; it
is not a safe incidental stress-test refactor.

Harper is about 78% of the unpacked extension and is copied as a separate WASM
asset. Its JS glue is in the service worker, not the content script.

## 11. Documentation disagreements

The documentation combines several historical states.

Confirmed stale or contradictory statements include:

- `docs/CONTEXT-ENGINE.md` says frequency is still zero near Stage 1, then
  correctly says it is 0.04 later.
- Its signal table lists frequency as zero.
- Its known-limitations section says no context weight is above zero,
  describes a 1,407-word authored bootstrap, and says eight signals are
  unimplemented; current generated frequency is corpus-derived with 40,459
  entries and five of nine score terms are implemented.
- It says shadow ranking is not called from content, but
  `correction-engine.ts` calls `compareRankings` whenever shadow mode is on.
- It contained mojibake arrows in the async flow.
- `scripts/check-bundle-size.mjs` still says frequency weight is zero.
- `docs/HARPER-INTEGRATION.md` and `docs/PUNCTUATION.md` have early tables/text
  saying Harper is suggestion-only, while later documentation and code support
  optional conservative auto-apply.
- `docs/SPELLING-AND-HISTORY.md` says there are exactly two adapter
  `replaceRange` calls; there are three including rollback.
- `src/engine/candidate-generator.ts` and some architecture text still call
  the dictionary engine a three-process pipeline although seven word processes
  now run.
- Several documented bundle/performance figures are older than the verified
  baseline.
- `NO_CONTEXT_WEIGHTS` copies the active frequency weight despite its comment
  saying every term is zero; `isNeutral` intentionally ignores measured
  frequency, but its generated evidence string says “all context weights are
  zero”.
- The current frequency sweep uses `DEFAULT_WEIGHTS` (already 0.04) as its
  baseline. Its 0.04 row is therefore necessarily “no disagreements” and the
  harness can no longer reproduce the historical zero-to-0.04 activation
  evidence claimed in source comments.
- The punctuation fixture contains 74 positive and 118 negative cases, while
  `docs/PUNCTUATION.md` says 74 + 124.

These are documentation/diagnostic defects unless a Phase 2 reproduction shows
behavioural impact.

Phase 2 resolved the stale frequency/context claims, async-flow mojibake,
pipeline count, benchmark figures and runtime diagnostic comments. This list
is retained as the pre-change familiarisation record; final dispositions are in
`BUGS-FOUND.md` and `STRESS-TEST-REPORT.md`.

## 12. Highest-risk seams entering Phase 2

Ordered by likely user impact:

1. **Sensitive-field reads before re-guarding.** `commitNearCaret()` reads text
   before `commitOnce()` checks eligibility; `refreshMarkupOverlay()` reads
   without an eligibility check. A dynamically retyped password/code field can
   therefore be observed even if the eventual correction is refused.
2. **Harper lifecycle escape.** `detach()` does not invalidate an in-flight
   lint, and response handling checks connection rather than controller
   attachment. A pending result may survive access revoke/controller stop.
3. **Harper common-gate bypass.** Harper auto-apply and chip paths do not pass
   through `gateProposal`, so shadow-all and current personal vocabulary are
   not uniformly authoritative.
4. **Reversion after host space normalisation.** Accepted NBSP/narrow/figure
   spaces are not what the literal anchor records.
5. **Stale restored privacy-minimal history.** A mismatched restored document
   with one exact replacement can satisfy the locator’s unique-occurrence
   floor and permit reversion of unrelated text.
6. **Two effective margins.** The ranked raw margin is combined with a second
   confidence margin, then penalised again before policy.
7. **Confirmed `mis` false positive.** The short hyphen fragment is changed to
   `is` automatically.
8. **Sentence-boundary divergence.** `tokenizer.ts`,
   `punctuation-tokenizer.ts`, `buildContext`, and `util.sentenceAt` maintain
   separate punctuation/abbreviation logic. For example punctuation’s
   case-insensitive abbreviation set treats lowercase `no.` as non-terminal,
   while spelling sentence-start logic correctly distinguishes it from `No.`.
9. **Vocabulary cache identity.** Same-size vocabulary replacement can leave a
   stale view.
10. **Exceptional central-path failure.** Host mutation plus failed rollback,
    or an exception after a successful adapter write, needs adversarial proof
    that it cannot leave an unrecoverable visible change.
11. **Punctuation history is mislabeled.** `proposalFromIssue()` stamps
    `correctionType: 'grammar'`; history filtering expects `'punctuation'`.
    Existing tests currently codify the wrong type, and punctuation shadow
    attribution can consequently report the grammar provider.
12. **Raw punctuation claims can hide Harper.** Claims are published before
    dismissal, rule-mode, overlap, and proposal gating, and early-return paths
    can retain stale claims. A disabled or stale punctuation issue may suppress
    an otherwise valid Harper finding.
13. **Profile resolution is not uniform.** Spelling uses profile-projected
    settings, while punctuation reads raw settings. Profile-level
    `punctuationEnabled` and `protectProse` therefore have dead or surprising
    behaviour.
14. **Risk-policy coverage is narrower than the type table.** Production calls
    `applyPolicy()` in the invalid-word dictionary path, not as a global final
    policy for punctuation, spacing, Harper, or legacy real-word context.
15. **Revert validation is span-only.** Unlike apply, reversion does not compare
    the whole field against the expected result, so a synchronous host mutation
    elsewhere can be left as collateral text while the record is marked
    reverted.

This list deliberately separates reproducible targets from fixes. Phase 2 must
first add a failing regression or deterministic minimal reproduction for each
confirmed defect and must not activate any zero-weight signal.

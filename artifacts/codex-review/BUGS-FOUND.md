# Personal Autocorrect bugs found

Review date: 2026-07-28

This catalogue distinguishes:

- **fixed defects**: reproduced by a deterministic test or a direct
  control-flow counterexample, minimally repaired, and covered by a passing
  regression;
- **open confirmed defects/design gaps**: current source still demonstrates the
  behavior; and
- **remaining risks/limitations**: important unknowns or trade-offs, but not
  defects proven by this review.

Severity is based on user impact: **critical** (credential/private-data
exposure or unrecoverable broad mutation), **high** (silent wrong text,
privacy-boundary read, or broken undo authority), **medium** (feature/policy
failure with bounded impact), and **low** (diagnostic, documentation, or
maintenance defect).

“Fixed” below means the current unit/jsdom regression passes. It does not mean
that the same path was certified in a real browser.

## Fixed defects

PA-001–PA-003 and PA-007–PA-022 are the 19 defects fixed in this review.
PA-004–PA-006 are retained in sequence because the requested adversarial cases
explicitly revisit them, but their protections already existed at the review
baseline; they are classified as historical/not reproducible rather than
claimed as new fixes.

### PA-001 — Text was read before re-checking dynamic field privacy

- **Severity:** high (privacy boundary)
- **Reproducer/test:** change an attached text input to `type=password`, then
  press Tab; or enable the history markup overlay after a field becomes
  sensitive. `correction-flow.test.ts` instruments `getText` for the Tab path,
  and `correction-actions.test.ts` does the same for markup.
- **Root cause:** some public/event entry points read from the adapter before
  the later correction path called its eligibility guard.
- **Smallest fix:** centralize a side-effect-free `processingBlockReason()` and
  call `refreshEligibility()` before each such read; hide stale visuals while
  blocked.
- **Verification:** the dynamic re-guard, password-on-Tab, and sensitive-markup
  regressions pass.
- **Status:** **fixed**

### PA-002 — A host could make a field sensitive during an extension edit, followed by another read

- **Severity:** high (privacy boundary and history consistency)
- **Reproducer/test:** a host `input` listener changes a normal field to a
  password after the extension replacement; a punctuation batch similarly
  changes classification after its first comma.
- **Root cause:** adapter fallback verification and controller post-apply
  verification happened after dispatching the synchronous host event; a batch
  also assumed eligibility remained stable across edits.
- **Smallest fix:** verify direct adapter writes before dispatch, re-check the
  field classification after an applied edit, avoid all post-event reads once
  protected, retain only a context-free memory record for an already-visible
  edit, and re-guard between punctuation edits.
- **Verification:** `does not read again if the host makes the field sensitive
  during our edit` and `stops a punctuation batch before reading a field made
  sensitive mid-pass` pass.
- **Status:** **fixed**

### PA-003 — Protected-token boundary gaps allowed automatic code/domain rewrites

- **Severity:** high (silent mutation outside prose)
- **Reproducer/test:** the review observed automatic rewrites in:
  `becuase.example.test`, `waht.localhost`, `waht()`, `teh.例`,
  `mis‑matches`, `matches–mis`, `{"key":"teh"}`,
  `.box { content: teh; }`, `SELECT becuase FROM items`, and
  `feature-waht-flag`.
- **Root cause:** the boundary rules were ASCII-centric, did not treat `(` as a
  sticky function-call suffix, and had no conservative recognition for
  brace-delimited code, common SQL shape, or a token sandwiched by dashes.
- **Smallest fix:** add Unicode dash boundaries, a Unicode-aware dotted-run
  check, the function-call suffix, bounded brace/SQL context checks, and
  sandwiched/double-dash protection. No general parser or full scan was added.
- **Verification:** the fixed-seed corpus contains 55 contexts plus five
  complete-token shapes; all protected cases stay non-automatic while five
  plain-prose typo controls prove the engine would otherwise autocorrect.
- **Status:** **fixed**

### PA-004 — Historical: ESDB membership alone made `mis` a dropped-apostrophe candidate for `"mi's"`

- **Classification:** not reproducible at the review baseline (historical high)
- **Reproducer/test:** `generateApostropheCandidates("mis")` included `"mi's"`
  because ESDB legitimately contains the possessive of the musical note.
- **Root cause:** Process 7 treated any dictionary member formed by inserting
  one apostrophe as linguistically supported.
- **Existing protection:** require a supported English contraction suffix/stem, or a
  possessive whose stem has minimum length and measured frequency support.
- **Verification:** apostrophe tests retain `didnt -> didn't`, `im -> I'm`,
  and ordinary possessives, while both the dedicated and seeded adversarial
  tests reject `"mi's"`.
- **Status:** **pre-existing fix reverified; adversarial coverage expanded**

### PA-005 — Historical: extra-letter deletion stripped valid apostrophes

- **Classification:** not reproducible at the review baseline (historical high)
- **Reproducer/test:** the UD review found `o'neal -> oneal`; the same generator
  shape could strip apostrophes from contractions and possessives.
- **Root cause:** the extra-letter process regarded the in-word apostrophe as a
  deletable character.
- **Existing protection:** never delete an apostrophe in Process 6; Process 7 handles
  the inverse, genuinely common missing-apostrophe error.
- **Verification:** `apostrophes are never deleted` covers `o'neal`, common
  contractions, and a doubled-apostrophe control where an ordinary duplicate
  may still be removed.
- **Status:** **pre-existing fix reverified; adversarial coverage expanded**

### PA-006 — Historical: clamping before ranking could turn unequal candidates into an alphabetical tie

- **Classification:** not reproducible at the review baseline (historical high)
- **Reproducer/test:** hostile rank adjustment pushes both `"that's"` and
  `that` above the `0.99` display ceiling. The old local spelling sort could
  clamp both to the same value and fall through to another tie-breaker.
- **Root cause:** winner selection reused display confidence, which is a
  bounded presentation value, instead of preserving ranking evidence.
- **Existing protection:** rank once through the shared context ranker on an unclamped
  `rawScore`; clamp only the final confidence after winner and margin are known.
- **Verification:** the seeded adversarial and `context-ranking` tests assert
  scores above 1, the correct order, and comparator determinism.
- **Status:** **pre-existing fix reverified; adversarial coverage expanded**

### PA-007 — Autocorrection used two effective ambiguity margins

- **Severity:** high (thin-margin result could be promoted)
- **Reproducer/test:** the pre-change dictionary branch combined the unified
  raw winner margin with a second margin recomputed from clamped confidences,
  then applied another ambiguity penalty.
- **Root cause:** ranking and display-confidence decisions had evolved as
  separate layers, each trying to enforce the same rule.
- **Smallest fix:** use exactly `best.rawScore - second.rawScore` from the
  unified ranking decision; use that one value for demotion and policy, and use
  confidence only for the score threshold/display.
- **Verification:** `reports an unclamped margin`, the above-ceiling adversarial
  property, and ambiguous generated-word regressions pass.
- **Status:** **fixed**

### PA-008 — Pending Harper results survived controller detach, disable, or IME start

- **Severity:** high (stale UI/edit after authority changed)
- **Reproducer/test:** start a deferred lint, then detach the controller,
  disable Harper, or begin composition before resolving the promise.
- **Root cause:** response handling primarily relied on element connection and
  text/version state; detachment did not invalidate the request, and current
  enable/composition state was not a complete response gate.
- **Smallest fix:** mark the controller inactive before cleanup, increment a
  lint generation on detach, capture it per request, and re-check attachment,
  generation, current settings, composition, and field eligibility on response.
- **Verification:** all three `async-result safety gates` regressions pass.
- **Status:** **fixed**

### PA-009 — Harper bypassed rule, personal-vocabulary, and shadow policy

- **Severity:** high (user policy ignored)
- **Reproducer/test:** Harper auto-apply in `shadowMode: "all"` changed text;
  an old suggestion could also be accepted after its rule/personal-vocabulary
  policy changed.
- **Root cause:** Harper had bespoke apply and accept paths that called the
  correction writer without the common `gateProposal()` choke point.
- **Smallest fix:** construct a normal proposal and run both auto and chip paths
  through the common gate; re-run that gate at click time.
- **Verification:** lint-lane tests cover shadow auto-apply without mutation,
  current rule-policy recheck, personal feedback, and recent-revert
  suppression.
- **Status:** **fixed**

### PA-010 — Hiding suggestion chips also disabled Harper auto-apply

- **Severity:** medium (enabled feature silently did nothing)
- **Reproducer/test:** with `harperEnabled=true`,
  `harperAutoApply=true`, and `showSuggestionChips=false`, the controller sent
  no useful lint work and left `Yesterday I has ...` unchanged. The regression
  was observed failing before the fix.
- **Root cause:** request, response, and reschedule gates required the
  presentation setting even when the automatic output path was enabled.
- **Smallest fix:** permit Harper work when
  `showSuggestionChips || harperAutoApply`; keep the later suggestion display
  itself conditional on chips.
- **Verification:** `keeps automatic Harper corrections active when suggestion
  chips are hidden` passes; the focused lint suite passes 37/37.
- **Status:** **fixed**

### PA-011 — Context-free restored history could capture a coincidental word in another document state

- **Severity:** high (wrong text reverted from stale history)
- **Reproducer/test:** restore a privacy-minimal record under the same field
  identity but a different text fingerprint containing one coincidental copy of
  the replacement.
- **Root cause:** with no surrounding context, the locator's unique-occurrence
  floor could provide enough apparent authority even though the stored
  fingerprint disagreed.
- **Smallest fix:** retain such history for review, but attach a required stored
  fingerprint guard; clear its live range and mark it unresolved until the
  document fingerprint matches.
- **Verification:** `does not trust a coincidental word from mismatched
  context-free history` passes alongside normal session adoption/merge tests.
- **Status:** **fixed**

### PA-012 — Host rewrites could leave changed text without a truthful correction record

- **Severity:** critical (mutation/history invariant)
- **Reproducer/test:** adapters append unexpected text to the requested
  replacement, normalize whitespace outside the edit, or mangle both the edit
  and the first rollback.
- **Root cause:** span-only verification could accept collateral host changes;
  a failed rollback could then leave text whose actual before/after shape was
  not represented by the proposed record.
- **Smallest fix:** compare the complete field with the expected result; roll
  back the complete pre-edit state; if rollback is rewritten, derive and widen
  the actual residual edit, record that exact mutation, and suppress learning
  from it.
- **Verification:** history-invariant tests cover successful rollback, accepted
  in-span NBSP, rejected out-of-span normalization, and a reversible record for
  the actual residual mutation.
- **Status:** **fixed**

### PA-013 — Revert validation ignored collateral host mutation

- **Severity:** high (undo could corrupt other text and claim success)
- **Reproducer/test:** a host appends `ZZZ` or normalizes unrelated text while
  the controller reverts one correction.
- **Root cause:** the revert path verified only the edited target span and then
  marked the record reverted.
- **Smallest fix:** calculate the complete expected post-revert field and
  require exact equality; otherwise restore the complete pre-revert state and
  leave/mark the record unresolved when restoration is impossible.
- **Verification:** `rolls back a revert when the host changes text outside its
  span` passes.
- **Status:** **fixed**

### PA-014 — Contenteditable text/caret projection could be stale in the same input task

- **Severity:** high (wrong offsets or wrong text edited)
- **Reproducer/test:** prime the adapter cache, mutate text-node character data,
  move the selection, dispatch `input`, and call `getText()`/`getCaret()` before
  MutationObserver delivery.
- **Root cause:** observer callbacks run asynchronously; observer-only
  invalidation left a same-task stale window.
- **Smallest fix:** invalidate the projection synchronously on captured
  `beforeinput` and `input` events as well as through MutationObserver.
- **Verification:** the contenteditable adapter tests read the new text and
  caret synchronously and confirm listener cleanup on dispose.
- **Status:** **fixed**

### PA-015 — Punctuation corrections were recorded and shadowed as grammar

- **Severity:** medium (incorrect history/filtering/diagnostics)
- **Reproducer/test:** apply or shadow an introductory-clause comma and inspect
  the record/provider.
- **Root cause:** `proposalFromIssue()` stamped
  `correctionType: "grammar"`, so the common provider mapping reported Harper's
  class.
- **Smallest fix:** emit `correctionType: "punctuation"` while retaining the
  punctuation rule ID and per-rule feedback path.
- **Verification:** punctuation history tests and `identifies held-back
  punctuation as the punctuation shadow provider` pass.
- **Status:** **fixed**

### PA-016 — Raw or stale punctuation claims could hide a valid Harper issue

- **Severity:** medium (grammar issue silently suppressed)
- **Reproducer/test:** disable the deterministic punctuation rule while Harper
  reports the same span; the old claim still owned the span.
- **Root cause:** claims were published before dismissal, overlap, rule-mode,
  personal, and shadow gates, and some early returns retained a prior pass's
  claims.
- **Smallest fix:** clear claims at the beginning of every pass and publish only
  the one surviving offered proposal after all gates.
- **Verification:** `does not let a disabled punctuation proposal hide Harper`,
  duplicate-span, and unrelated-Harper-issue tests pass.
- **Status:** **fixed**

### PA-017 — Writing-profile punctuation settings were ignored

- **Severity:** medium (profile contract broken)
- **Reproducer/test:** select the coding profile while raw
  `punctuationEnabled` remains true, then type an introductory clause.
- **Root cause:** spelling received profile-projected settings, but punctuation
  read raw settings.
- **Smallest fix:** call `withProfile()` before checking/configuring the
  punctuation lane.
- **Verification:** `honours a profile that disables the punctuation lane`
  passes.
- **Status:** **fixed**

### PA-018 — Sentence-boundary implementations disagreed on abbreviations

- **Severity:** medium (wrong sentence split/capitalization/punctuation)
- **Reproducer/test:** lowercase sentence-final `no.` must end a sentence, while
  abbreviation `No. 12`, `Dr. Smith`, initials, `e.g.`, and decimals must not
  split.
- **Root cause:** spelling/capitalization and punctuation maintained separate
  abbreviation sets and case rules.
- **Smallest fix:** make punctuation sentence splitting delegate to the shared
  `followsAbbreviation()` implementation.
- **Verification:** punctuation-engine, sentence-position, capitalization, and
  deep-scan abbreviation regressions pass.
- **Status:** **fixed**

### PA-019 — Same-size personal-vocabulary replacement left a stale resolved view

- **Severity:** medium (new allow/block decision ignored)
- **Reproducer/test:** replace a one-entry allowed-word snapshot with a
  one-entry blocked-pair snapshot and type the newly blocked pair.
- **Root cause:** cache invalidation used entry count as its effective stamp, so
  equal-size snapshots looked unchanged.
- **Smallest fix:** include vocabulary-object and entries-array identity in the
  cache key, matching the storage layer's wholesale-snapshot contract.
- **Verification:** `invalidates the resolved view when storage replaces a
  same-size snapshot` passes.
- **Status:** **fixed**

### PA-020 — Shadow agreement could correlate identical text across origins

- **Severity:** medium (privacy/diagnostic cross-site association)
- **Reproducer/test:** append near-simultaneous observations with the same
  original text but different origins and providers.
- **Root cause:** recent-observation matching used text, provider, and time, but
  not origin.
- **Smallest fix:** require equal origins before adding agreement or
  disagreement links.
- **Verification:** `does not infer agreement between unrelated origins`
  passes; same-origin agreement/disagreement remains covered.
- **Status:** **fixed**

### PA-021 — Frequency evaluation compared production `0.04` with itself

- **Severity:** medium (invalid activation evidence)
- **Reproducer/test:** the old sweep inherited `DEFAULT_WEIGHTS` as baseline and
  then tested a `0.04` row, which necessarily had zero disagreements despite
  documentation claiming it measured activation from zero.
- **Root cause:** the baseline drifted when production frequency changed from
  zero, but the diagnostic reused the mutable production default.
- **Smallest fix:** define and assert an explicit zero-frequency baseline,
  enumerate tested weights including production, and print both configurations
  in every generated report.
- **Verification:** evaluation configuration tests pass; the current `0.04`
  row reports 29 disagreements, 14 better, 0 worse, and 0 operation-cost
  overrides instead of a self-comparison.
- **Status:** **fixed**

### PA-022 — The encoding gate missed nested files and mojibake arrows

- **Severity:** low (release/tooling)
- **Reproducer/test:** create `src/nested/fixture.ts` containing a
  Windows-1252-misdecoded UTF-8 arrow, then run
  `node scripts/fix-encoding.mjs --check` from that fixture project. The old
  checker exited successfully because its default scope was three hard-coded
  files and its replacement table did not include arrow sequences.
- **Root cause:** a one-off repair utility had been placed in the main `check`
  chain without becoming a project-text scan, and its known-sequence table was
  incomplete.
- **Smallest fix:** recursively inspect a reviewed set of text extensions while
  excluding dependencies, build output and generated reports; add right/down/
  double-arrow and middle-dot patterns; repair the context-engine document.
- **Verification:** the new regression failed first with exit code 0, then
  passed after the fix. The default gate now reports 228 project text files
  clean.
- **Status:** **fixed**

## Open confirmed defects and design gaps

### PA-O01 — The advertised correction-risk policy is not a global final gate

- **Severity:** medium
- **Reproducer/control-flow proof:** `correction-policy.ts` defines classes for
  valid-word replacement, token merge/split, punctuation, and AI results.
  Production calls `applyPolicy()` only inside the generated invalid-word
  dictionary branch of `correction-engine.ts`; valid dictionary words
  short-circuit before that branch, and controller punctuation/spacing/Harper
  paths do not call it.
- **Root cause:** a policy abstraction broader than the one integration point
  was introduced without routing every provider through a common risk-policy
  stage.
- **Smallest viable fix:** either narrow the exported policy/type/docs to the
  one supported branch, or place one provider-neutral risk gate after
  `gateProposal()` with provider-specific calibrated thresholds and regression
  tests. Applying today's spelling thresholds blindly to other providers would
  be unsafe.
- **Verification needed:** one test per declared class proving the final action
  can only be demoted, plus corpus/fixture calibration for every newly governed
  provider.
- **Status:** **open**

### PA-O02 — `protectProse` is resolved from a writing profile but has no runtime consumer

- **Severity:** low
- **Reproducer/control-flow proof:** the fiction profile sets
  `protectProse: true`; `resolveSettings()` returns it; repository search finds
  no production read outside that resolver.
- **Root cause:** the profile schema exposes a policy bit before a concrete
  engine behavior was attached to it.
- **Smallest viable fix:** define the exact intended behavior and consume it at
  a bounded common gate, or remove/rename the option until it has semantics.
- **Verification needed:** a profile-level integration test demonstrating the
  intended difference from the standard profile without weakening protected
  fields or identifiers.
- **Status:** **open**

## Remaining risks and limitations — not confirmed bugs

These items must not be read as failed behavior. They are evidence gaps,
release questions, or conscious trade-offs.

### Browser/editor coverage

- There is no automated real-Chrome suite. jsdom cannot certify
  `execCommand`, native undo stacks, selection behavior, closed shadow UI,
  extension URL loading, or third-party framework reconciliation.
- No Wattpad/Google Docs/Notion/contenteditable integration matrix was run.
- Service-worker suspend/restart and multi-tab storage races were not exercised
  across real browser processes.

### Privacy verification

- The source and tests support local-only correction and guard modeled
  sensitive fields, but no packet capture or browser network-instrumentation
  test was run.
- The 55-case protected corpus is deliberately finite. Future identifier,
  markup, or multilingual boundary shapes can still reveal a missing guard.

### Evaluation and language quality

- The main UD sample is 300 clean sentences with synthetic one-edit
  corruptions; that is too small and artificial for broad language-quality
  claims.
- Manual review categories can contain judgment error.
- The authored punctuation fixture's 100% result is a regression guarantee, not
  external precision.
- `mastter` flips from `master` to `matter` if frequency alone is raised from
  `0.04` to `0.06`; production is safe at the tested weight, but the example
  demonstrates sensitivity to future retuning.
- `eorks` legitimately yields `works`, `dorks`, and `forks`; no rule can remove
  that inherent ambiguity without additional measured context.

### Data provenance and release

- `vendor/frequency/README.md` still requires redistribution-license clearance
  for the frequency source. That is a release blocker/question, not a runtime
  algorithm failure.
- Bigram provenance is weaker than ESDB provenance, and the generated trigram
  payload is not currently consumed by production.
- The Harper WASM dependency is local, but a production release should pin and
  record the exact reviewed artifact/hash in its release process.

### Performance and size

- Enforced local latency budgets pass, but heap retention, cold frequency-map
  construction, multi-hour soak behavior, and weak-device/browser variance
  were not measured.
- The content bundle has limited configured headroom. Dictionary/frequency data
  are duplicated across entry bundles, and Harper WASM dominates total size.
  These are optimization opportunities, not current ceiling failures.
- The Harper Node benchmark does not exercise `chrome.runtime.getURL()` or
  service-worker cold-start behavior.

### Cache and mutation contracts

- Personal-vocabulary invalidation now matches the current wholesale-snapshot
  storage contract. Mutating entry objects in place without replacing the
  source/entries identity is not supported by that cache contract.
- An adapter can always be more hostile than the modeled sabotage. The central
  path now records a derivable residual mutation, but a browser/framework that
  makes an edit unobservable or non-reversible can only be surfaced as an
  unresolved error.

## Final disposition

The review did not force a redesign or activate speculative scoring. It fixed
the concrete privacy, wrong-text, history, async, punctuation, cache, and
evaluation defects above; retained explicit open items where evidence or
calibration is missing; and leaves real-browser validation as the most valuable
next testing layer.

# Architecture

## 1. Design goals, in priority order

1. **Precision over recall.** A wrong automatic correction costs far more than a
   missed one, because the user may not notice it. Every layer is allowed to
   decline.
2. **Nothing leaves the device.** There is no external runtime network path.
   The only runtime asset fetch is an extension URL for the bundled Harper WASM.
3. **Instant.** Candidate work is bounded by a length/first-letter dictionary
   bucket and small generated sets. Context windows and token runs are bounded;
   fenced-code detection uses an allocation-free native marker search.
4. **Reviewable.** Every automatic change is recorded, locatable and reversible
   long after it happened.
5. **Portable.** The engine is plain TypeScript with no DOM or `chrome` access,
   so an Android keyboard can reuse it unchanged.

## 2. Layer map

```
┌─────────────────────────────────────────────────────────────────┐
│ src/engine/      pure correction logic - no DOM, no chrome       │
│   tokenizer · edit-distance · keyboard-distance · capitalization │
│   generated ESDB dictionary + one-time bucket index               │
│   7 bounded candidate generators · context/confidence scorers     │
│   grammar-rules · personal-learning · manual-edit-diff           │
│   correction-engine  (analyze() = the only entry point)          │
├─────────────────────────────────────────────────────────────────┤
│ src/history/     pure record logic - strings in, plans out       │
│   anchor · correction-locator · correction-reverter              │
│   correction-record · correction-history · review-session        │
├─────────────────────────────────────────────────────────────────┤
│ src/content/     the only layer that touches a web page          │
│   field-guard · adapter (input | contenteditable) · caret-rect   │
│   correction-highlighter · editable-controller                   │
│   session-controller · content-script                            │
├─────────────────────────────────────────────────────────────────┤
│ src/background/  router + single writer for learning data        │
│ src/storage/     chrome.storage.local, batched, migrated         │
│ src/side-panel/  history, filters, search, guided review         │
│ src/popup/ src/options/                                          │
└─────────────────────────────────────────────────────────────────┘
```

The two pure layers hold ~70% of the logic and 100% of the risky decisions.
That is what makes the behaviour testable without a browser.

## 3. Correction pipeline

`analyze(text, wordEnd, origin)` runs once per committed word. The existing
safety and personal layers stay ahead of generated spelling candidates:

| # | Layer | Source of truth | Typical action |
|---|-------|-----------------|----------------|
| 1 | Guards | `analyzeToken` | decline (URL, code, digits, caps, …) |
| 2 | Personal dictionary | `LearningData.dictionary` | decline |
| 3 | User rules | `source: 'user-created'` | autocorrect at 0.99 |
| 4 | Learned rules | `source: 'personal-learning'` | mode decides |
| 5 | Typo table | `data/typos.ts` (≈300 pairs) | autocorrect at ≈0.96 |
| 6 | ESDB bounded candidate pipeline | generated `en_US` data + buckets | ranked spelling decision |
| 7 | Context | `data/confusions.ts` | suggest (autocorrect only when opted in *and* learned) |
| 8 | Grammar | `grammar-rules` (a/an) | autocorrect at 0.93 |

Blocked pairs, per-site rule overrides and context blocks are applied inside
each layer via `ruleUsable()`, so a rejection learned once is honoured by every
path that could produce the same replacement.

### ESDB spelling pipeline

The dictionary module evaluates once in each JavaScript realm that imports it
and creates:

```ts
dictionary.words.has(word)
dictionary.byLengthAndFirstLetter.get(length)?.get(firstLetter)
```

Chrome frames and the MV3 worker cannot share a JavaScript heap, so each
injected frame—and each worker lifetime—owns its own singleton. It is never
rebuilt per keystroke, but this per-realm replication is a real cold-start and
memory trade-off of bundling the full list offline.

Candidate generation runs three core Idea Version 1 processes:

1. **Same length + first letter.** Score only the relevant bucket using position
   matches, letter overlap and prefix similarity. Never scan the full
   dictionary.
2. **Adjacent swap.** Generate exactly `n - 1` one-pair swaps and check each with
   `dictionary.words.has()`. Rank every valid result instead of accepting the
   first.
3. **Keyboard proximity.** Substitute one character at a time with its QWERTY
   neighbours from the explicit `KEY_NEIGHBOURS` map, checking membership after
   each substitution. Coordinates are scoring evidence only and cannot remove
   a map-listed candidate. It never performs multi-character permutations.

Four supplemental single-edit processes then check duplicate-letter removal,
one missing-letter insertion, one extra-letter deletion and one apostrophe
insertion. They also use exact membership lookups, run unconditionally, and do
not turn the search into a dictionary scan or a multi-edit permutation search.

The map is symmetrical except where the required two-key corner model
deliberately conflicts with a surrounding key: `q–s`, `z–s`, `m–h` and `m–k`.
Those four pairs are declared centrally beside the map and enforced by tests.

The combined set is deduplicated and capped at ten candidates. Its base
generation score is `0.72 × similarity + 0.18 × legacy common-word prior +
process/keyboard evidence − operation-cost penalty`. Unified ranking adds the
separately generated corpus-frequency term at weight `0.04` and any applicable
learned pair/context adjustment. ESDB's alphabetical order is never treated as
frequency. The raw winner-to-runner-up lead is measured on the unclamped scale;
display confidence is computed and clamped only after the winner is fixed. A
generated spelling winner auto-applies only when confidence clears
`autocorrectThreshold` and the raw lead is at least `0.06`, after which the
spelling-risk policy may only lower the action. The other correction lanes use
their own gates; the broader policy classes declared in
`context/correction-policy.ts` are not a global dispatcher today.

### Cost

Processes 2–7 perform a word-length-bounded number of `Set` lookups.
Process 1 visits only one prebuilt bucket; its cost depends on that bucket's
size, not on the complete dictionary. Text context and surrounding-token loops
are bounded; fenced-code detection searches markers without allocating a copy
of the document prefix. Layers 1-5 still short-circuit before candidate
generation. `npm run benchmark` separately reports one-time dictionary/index
initialisation and warmed lookup, adjacent-swap, busy-bucket and 5 MiB-field
median/p95/p99/max timings. Those numbers describe the machine that ran the
command rather than a universal browser guarantee.

## 4. Event flow

```
keystroke
   │  input event (inputType, data)
   ▼
EditableController.onInput
   │  commit char?  ── no ──▶ schedule idle work (700 ms)
   │  yes
   ▼
commitNearCaret()  →  spacing merge/split?  →  analyze()  →  proposal | null
   │
   ├── action 'autocorrect' ──▶ applyCorrection()   ← the only write path
   │        adapter.replaceRange (execCommand, then a verified fallback)
   │        compare the whole field against the expected result
   │        │      (whitespace-normalised: nbsp is not a rejection)
   │        ├── mismatch ──▶ rollback the whole field ──▶ 'rolled-back'
   │        │                 rollback fails ──▶ 'unrecorded' + error log
   │        restore caret (shiftCaret)
   │        createAnchor + createRecord  → session      ← always, if text changed
   │        learn('applied') → background → storage
   │        flash overlay
   │        host.changed() → debounced state push → background → side panel
   │
   └── action 'suggest' ──▶ suggestion chip (non-destructive)
```

`applyCorrection()` is the single point at which any engine — spelling,
punctuation, Harper, capitalisation, token merge/split or a personal rule — is
allowed to modify a field, and it returns a typed outcome (`applied`,
`declined`, `rolled-back`, `unrecorded`) rather than a nullable record. The
invariant it enforces is that the text is modified **if and only if** exactly
one `CorrectionRecord` exists. `tests/integration/history-invariant.test.ts`
holds it in place; see
[SPELLING-AND-HISTORY.md](SPELLING-AND-HISTORY.md) for the failure it replaced.

Idle work (debounced 700 ms after the last edit, and on blur) re-validates
anchors, looks for a single-word manual edit worth learning from, auto-accepts
stale pending corrections if configured, runs essential punctuation before
Harper, and finally advances the optional whole-text sweep.

### Loop prevention

* `applying` brackets every programmatic edit; input events are ignored while it
  is set.
* Events with `inputType === 'insertReplacementText'` (what we dispatch) are
  ignored unconditionally.
* `recentlyApplied` refuses a correction that is the exact inverse of one just
  made at the same offset.
* `revertGuards` refuses to re-correct a word the user reverted in the last five
  minutes, at that position - this covers the window before the learning update
  has propagated back from the background.

## 5. Text anchoring

A correction is stored with several independent hints, none of which is trusted
alone (`TextAnchor`). The sentence fingerprint is retained for metadata/future
locator work but is not currently a locator weight. A legacy DOM-path field is
accepted on old imports but ignored and stripped before persistence:

| Hint | Weight | Survives |
|------|--------|----------|
| `textBefore` (≤ contextRadius chars) | 0.30 | edits elsewhere |
| `textAfter` | 0.20 | edits elsewhere |
| `approximateOffset` (decays over ~400 chars) | 0.15 | small insertions |
| `occurrenceIndex` | 0.10 | rewording |
| `paragraphFingerprint` (FNV-1a) | 0.15 | edits in other paragraphs |
| exact-case match | 0.10 | capitalisation changes |

`locate()` enumerates every whole-word occurrence of the target, scores each,
normalises by the weight actually available (so a privacy-minimal anchor with
`contextRadius: 0` is judged on the signals it has), and then decides:

* **found** - best ≥ `minScore` and beats the runner-up by ≥ `margin`;
* **found (single occurrence)** - only one candidate exists and it clears a
  lower floor: there is nothing to confuse it with;
* **ambiguous** - two plausible positions, or one position whose context no
  longer resembles what was stored;
* **missing** - the text is simply not there.

`ambiguous` and `missing` never produce an edit. This is the mechanism behind
the rule *"never claim a correction can be reverted unless the implementation
verifies its location and context"*.

Successful relocations above 0.85 refresh the anchor, so a document that evolves
gradually keeps accurate anchors instead of drifting until it breaks.

## 6. Reversion algorithm

`planRevert(text, record)` returns either an edit or a typed refusal:

1. Locate the **replacement** (never the offset alone).
2. Refuse on `missing` / `ambiguous`, with a message the panel shows verbatim.
3. Verify the located substring still equals the replacement, case-insensitively.
4. Build the restored text with `matchCase(observed, original)` - the
   capitalisation currently in the document wins, so `What` → `Waht`, not
   `waht`.
5. Return `{start, end, insert}`; the caller applies it through the adapter,
   re-verifies what the host actually rendered, then maps the caret with
   `shiftCaret`.

If the adapter refuses the edit, or the host mangles it, the record becomes
`unresolved` with a `failureReason` rather than being reported as reverted.

`resolveAmbiguous(recordId, start, end)` lets the user break a tie by hand. It
verifies the chosen range, refreshes the anchor, focuses and highlights the
occurrence, but does not edit. A later explicit revert goes through the normal
verified reversion path.

## 7. Session lifecycle

```
focusin on an allowed field
   └─ sessionId = hash(origin | tab/frame | path hash | fieldId)
      ├─ restore from storage (if enabled)  → adoptSession() → relocateAll()
      └─ new in-memory session
         ↓ corrections append records
         ↓ debounced persist (1 s) unless memory-only
pagehide → flush
retention sweep on worker start → sessions older than N days are deleted
```

`fieldId` is a hash of the element's identifying attributes plus a six-level
structural path, so it survives re-renders that keep the same shape. A restored
session whose text no longer matches is not discarded: every record is
re-located, and the ones that cannot be found become `unresolved` (visible in
the panel, with an explanation) rather than silently vanishing.

## 8. Storage design

| Key | Contents | Write pattern |
|-----|----------|---------------|
| `schemaVersion` | number | on migration |
| `settings` | `Settings` | serial durable write per confirmed change |
| `learning` | rules, dictionary, blocked pairs, pending patterns | serial durable write per learning event |
| `session:<id>` | one `CorrectionSession` | content-side 1 s debounce, then one durable batch |
| `sessionIndex` | id/origin/updatedAt/counters | atomically in the same patch as its session |

The background service worker is the **single writer** for `learning`; content
scripts hold a read-only snapshot refreshed by a `bg/config` broadcast. This
removes the read-modify-write races that would otherwise occur across tabs.

Storage failures never break typing. Failed reads are not mistaken for a fresh
profile, failed writes are not published into the cache, and callers receive an
error; `lastStorageError()` also exposes the latest failure to the options page.

## 9. Message protocol

```
content ──content/config──────────▶ background      (pull settings + learning)
content ──content/state───────────▶ background ──panel/state──▶ side panel
content ──content/learn───────────▶ background      (single writer, then re-broadcast)
content ──content/persist-session─▶ background ─────▶ storage

panel   ──ui/command──────────────▶ background ──bg/command──▶ content (active frame)
panel   ──ui/request-state────────▶ background      (cached per tab)
options ──ui/set-settings─────────▶ background ──bg/config──▶ every content script
```

The background caches the last `PanelState` per tab plus the frame that sent it,
so panel commands reach the frame that owns the focused field - including
same-origin iframes. Tab activation, removal and navigation invalidate the cache.

## 10. Chrome permission plan

| Permission | Why |
|------------|-----|
| `storage` | settings, learning data, sessions |
| `sidePanel` | the review UI |
| `scripting` | register/inject the content script on granted origins |
| `activeTab` | read the current tab's URL in the popup, on click |
| `optional_host_permissions: *://*/*` | **not granted at install** |

There are **no** declared host permissions and no static `content_scripts`
block. The user grants a site from the popup; `permissions.onAdded` then
re-registers a dynamic content script for exactly the granted origins, so the
choice survives restarts. Removing access in the options page unregisters it.

## 11. Testing strategy

* **Unit (node)** - dictionary normalisation/determinism and bucket filtering;
  each spelling process; distances, tokenizer guards, confidence, learning
  transitions, anchors, locator, reverter, status machine, review queue and
  migrations.
* **Integration (jsdom)** - adapters against real DOM nodes, field guards
  against real attributes, and a full type → record → review → revert loop
  including a 1,000-word document with fifteen corrections.
* **Manual** - the compatibility matrix in `docs/LIMITATIONS.md`; rich editors
  cannot be meaningfully emulated in jsdom, so they are checked by hand.
* **Benchmark (node)** - deterministic workloads with warm-up and percentile
  reporting. This detects regressions but is not a hard real-time proof.

`npm run check` verifies encoding and all generated language data, then runs
typecheck, the default tests, a production build and bundle-size checks.
`npm run evaluate` and `npm run test:harper` are deliberately separate.

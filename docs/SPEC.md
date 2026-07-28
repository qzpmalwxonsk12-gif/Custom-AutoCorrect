# Functional specification

Status key: **✔ built** (Phase 2 + the parts of Phase 3-6 that Phase 2 needed),
**◐ partial**, **✗ later phase**.

## 1. Correction behaviour

| ID | Requirement | Status |
|----|-------------|--------|
| C1 | Corrections trigger on space, punctuation, Enter and Tab | ✔ |
| C2 | A word is never modified while the caret is still inside it | ✔ |
| C3 | The caret and selection survive a correction | ✔ |
| C4 | Capitalisation style is preserved (`Waht`→`What`, `WAHT` untouched) | ✔ |
| C5 | Sentence-initial corrections are capitalised | ✔ |
| C6 | Corrections never fire inside URLs, e-mails, paths, handles, code fences, inline code, identifiers, numbers or all-caps tokens | ✔ |
| C7 | Capitalised words mid-sentence are treated as names by the generative layer | ✔ |
| C8 | Real-word errors (`form`/`from`) use context, and only suggest by default | ✔ |
| C9 | Local grammar rules (`a`/`an`) | ✔ |
| C10 | Medium-confidence proposals appear as a dismissible chip | ✔ |
| C11 | Composition (IME) input is never corrected mid-composition | ✔ |
| C12 | Pasted text is never auto-corrected and never used as learning evidence | ✔ |
| C13 | Password inputs are excluded; payment, OTP and other sensitive text fields are detected conservatively from metadata | ◐ |
| C14 | Per-site and global on/off switches | ✔ |
| C15 | The extension's own edits cannot trigger correction loops; arbitrary page-generated input remains an adversarial case | ◐ |
| C16 | Process 1 searches only the same-length, same-first-letter ESDB bucket and retains at most ten ranked candidates | ✔ |
| C17 | Process 2 evaluates exactly the `n - 1` adjacent swaps; Process 3 evaluates one-character substitutions from an explicit QWERTY-neighbour map, with coordinates used only for ranking | ✔ |
| C18 | A spelling candidate auto-applies only when it clears the configured score threshold and the runner-up margin | ✔ |

## 2. Correction history

| ID | Requirement | Status |
|----|-------------|--------|
| H1 | Every automatic correction produces a record | ✔ |
| H2 | Records carry original, replacement, type, confidence, status, time, context preview, rule id, auto-applied flag, learned flag | ✔ |
| H3 | One session per editable element, keyed by origin + field identity | ✔ |
| H4 | Sessions optionally survive reloads and are re-validated on restore | ✔ |
| H5 | Statuses: pending, accepted, auto-accepted, reverted, rejected, skipped, unresolved, superseded | ✔ |
| H6 | Illegal status transitions are refused | ✔ |
| H7 | Records that can no longer be located are marked, never mis-located | ✔ |
| H8 | Records the user overwrote by hand become `superseded` | ✔ |
| H9 | Sessions expire on a user-set retention schedule | ✔ |
| H10 | Pending corrections can auto-accept after N minutes | ✔ |
| H11 | Keyboard-proximity records retain the changed position, typed key, replacement key, map match and optional scoring distance | ✔ |

## 3. Side panel

| ID | Requirement | Status |
|----|-------------|--------|
| P1 | Header: field name, site, counts (total/pending/accepted/reverted/unresolved) | ✔ |
| P2 | Autocorrect on/off and per-site on/off | ✔ |
| P3 | "Review N corrections", "Accept all", "Revert selected", "Clear" | ✔ |
| P4 | Entry shows original → replacement, context, type, confidence, status, age | ✔ |
| P5 | Per-entry actions: go to, accept, reject & revert, keep-without-learning, never this replacement, not in this context, add to dictionary, details | ✔ |
| P6 | Filters: pending, accepted, reverted, unresolved, spelling, grammar, contextual, personal, low confidence | ✔ |
| P7 | Search across original, replacement, context and type | ✔ |
| P8 | Long histories render incrementally | ✔ |
| P9 | Panel stays in sync with typing, focus changes and tab changes | ✔ |
| P10 | Current-paragraph / current-field filters | ✗ (Phase 3) |

## 4. Jump to correction

Clicking an entry:

1. sends the command to the frame that owns the focused field; ✔
2. focuses the editable element; ✔
3. relocates the correction from its anchors (never from the raw offset); ✔
4. scrolls it into view (mirror-measured for `input`/`textarea`, `Range` rects
   for `contenteditable`); ✔
5. selects the corrected text and holds an overlay highlight; ✔
6. shows a floating card with `original → replacement`, context, type,
   confidence and actions; ✔
7. reports `ambiguous` or `unresolved` instead of guessing. ✔

The comparison is drawn in a closed, extension-owned shadow root on a small host
element appended outside the editor. The host is part of the page DOM and can be
removed or covered by the page, but no markup is inserted into the editable
content.

## 5. Guided review

| ID | Requirement | Status |
|----|-------------|--------|
| R1 | "Review N corrections" starts a queue in document order | ✔ |
| R2 | Progress shown as `4 of 15` in the panel and on the card | ✔ |
| R3 | Each step jumps, highlights and shows the comparison | ✔ |
| R4 | Actions: keep, keep-without-learning, revert, revert & lower confidence, revert & never, revert & dictionary, revert only in this context, skip, stop | ✔ |
| R5 | A successful decision advances automatically; a failed decision stays current | ✔ |
| R6 | Keyboard shortcuts, configurable, panel-only so no site can clash | ✔ |
| R7 | Deleted records are reconciled out of the queue | ✔ |

## 6. Rejection learning

| Decision | Text | Learning effect |
|----------|------|-----------------|
| Keep | unchanged | `accepted++`, context words recorded |
| Keep, don't learn | unchanged | nothing recorded |
| Revert | original restored | when decision learning is enabled, `reverted++`; confidence can demote the rule |
| Revert & lower confidence | original restored | `reverted += 2`, forced to suggestion-only |
| Revert & never this pair | original restored | rule blocked and disabled, id added to `blockedPairs` |
| Revert & never this word | original restored | word added to the dictionary, which vetoes every rule rewriting it |
| Revert, not in this context | original restored | neighbouring words added to `blockedPrevious`/`blockedNext` |
| Skip | unchanged | `skipped++` only |

## 7. Learning from manual edits

Evidence is collected only when the diff between two snapshots is a **single
word**, both sides are alphabetic, neither is protected by the token guards, the
change is not an undo of one of our own corrections, and the size change is
under 24 characters. After `manualEditEvidence` sightings (default 3) a rule is
created **in suggestion mode** - it has to be accepted three times before it
starts applying automatically.

## 8. Non-functional requirements

| ID | Requirement | How it is met |
|----|-------------|---------------|
| N1 | No perceptible typing latency | no full-dictionary scan; bounded token/context work plus allocation-free fenced-code marker search; benchmark covers busy buckets and a 5 MiB field |
| N2 | No network dependency | zero network code in the build |
| N3 | Bounded dictionary lifetime | one ESDB size-60 `Set` and bucket index per importing frame/worker realm, never per keystroke; isolated realms cannot share memory |
| N4 | Long documents stay responsive | contenteditable projection cached until a mutation; relocation capped at 200 records per pass; incremental list rendering |
| N5 | Few storage writes | panel/config pushes are debounced; sessions use a 1 s per-field batch; acknowledged storage writes are durable |
| N6 | Minimal permissions | no host permissions at install; opt-in by scheme + hostname match pattern |
| N7 | No large frameworks | plain DOM with no runtime dependencies |
| N8 | Engine reusable off-web | `src/engine` and `src/history` import nothing platform-specific |
| N9 | Strict types | `tsc --noEmit` with `strict`, `noUnusedLocals`, `noImplicitOverride` |
| N10 | Failures should be visible, not silent | ◐ user actions surface errors, but some storage/config failures remain console-only |

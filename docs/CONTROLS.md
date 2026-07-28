# Controls: status, rules, profiles, vocabulary and shadow mode

How the extension is steered — from the toolbar, from a correction, and from
the settings page — and how those layers resolve when they disagree.

## 1. Toolbar status

The popup answers "what is it doing right now?" in one screen: state, site,
corrections this session, whether history is on, and whether the grammar engine
and the (not yet shipped) AI provider are loaded.

Five states, resolved in [status.ts](../src/shared/status.ts):

| State | Means | How to leave it |
|---|---|---|
| `active` | Watching text fields on this page | — |
| `paused` | Temporarily suspended | Resume, or wait for the timer |
| `disabled` | Off globally, for this site, or for this field | Turn it back on |
| `loading` | Content script has no configuration yet | Usually resolves itself |
| `error` | A provider or storage failure | See diagnostics |

An error outranks every other state, including a pause. A silent failure is the
thing a user is least able to diagnose alone, so it is never hidden behind a
more benign explanation.

**Pause is not disable.** Pausing is temporary and self-reversing; disabling is
a decision that persists. They are separate states with separate badges because
collapsing them makes "why is nothing happening?" unanswerable. Pause survives
in three forms: 5 minutes, 30 minutes, or until the tab closes. The timer is
checked lazily rather than scheduled — an MV3 service worker can be evicted at
any moment, so a timer that "fires" is not something to rely on. A tab pause is
cleared when the tab closes, because Chrome reuses tab ids.

The badge never relies on colour: each state has distinct badge text (`❚❚`,
`OFF`, `…`, `!`, or blank for active), a distinct dot shape in the popup, and a
tooltip that spells the state out.

## 2. Correction feedback

Every automatic correction now shows what changed, why, and a way out:

```
punctuatioon → punctuation │ Removed duplicate letter │ [Undo]
```

The badge is drawn in the extension's own closed shadow root — the document
never receives review markup, so the text you send is exactly the text you see.
It fades after ~3.6 s. **The history record is created before the badge appears
and outlives it**, so the correction stays reversible from the panel forever.

Explanations are deliberately short ("Removed duplicate letter", "Joined
accidental word break", "Added introductory-clause comma"): the panel carries
the full technical reason, and a badge read mid-sentence has about four words'
worth of attention.

With reduced motion (either the OS setting or Settings → Motion), the badge does
not fade — it stays slightly longer and then disappears. Removing the animation
must not also remove the reading time the animation provided.

## 3. Show all corrections at once

The panel's **Show all corrections in the text** toggle draws every standing
correction in the field simultaneously: the original struck through, an arrow,
then the replacement, with the corrected span underlined in place.

```
   punctuatioon → punctuation [Undo]      commmon → common [Undo]
The p̲u̲n̲c̲t̲u̲a̲t̲i̲o̲n̲ and the c̲o̲m̲m̲o̲n̲ case.
```

Labels stack upward when they would overlap, so a dense paragraph stays
readable. Only corrections still standing in the text are shown — reverted ones
disappear from the overlay. Undoing from the overlay reverts that one
correction and redraws the rest. The overlay follows focus: it is a per-field
view, so moving to another field redraws it for that field.

## 4. Correction actions

Each history entry offers, beyond keep/revert:

| Action | Scope | Effect |
|---|---|---|
| Undo | this occurrence | Restores the original text |
| Always prefer this | everywhere | Stores a preferred pair |
| Never make this correction | everywhere | Blocks the pair, reverts |
| Show this rule as a suggestion | the rule | Rule may offer, not apply |
| Disable this rule | the rule | Rule stops entirely |
| Add to dictionary | everywhere | Word is never corrected |
| Ignore once | this occurrence | Reverts, learns nothing |
| Ignore in this document | this document | Blocked while the page lives |
| Ignore on this website | this origin | Blocked on this site |

The three "ignore" actions are three different promises. Conflating them is how
a user ends up unable to get back a correction they did not mean to lose, so
each is scoped explicitly and the panel confirms which one was applied.

**Punctuation and grammar are never learned as word pairs.** "Always prefer
this" is refused for them, because an exact rule mapping `and → , and` would
fire everywhere. They are preferred or disabled *per rule* instead.

## 5. Rule controls

Every rule group can be set to **Automatic**, **Suggestion only** or
**Disabled** — duplicate letters, missing letters, extra letters, adjacent
swaps, keyboard substitutions, token merging, token splitting, capitalisation,
repeated words, Harper grammar, and each essential-punctuation rule. The
catalogue lives in [rules.ts](../src/shared/rules.ts).

Resolution, most specific first:

```
site override  →  writing profile  →  global override  →  catalogue default
```

One subtlety worth stating plainly. Enforcement uses only the *explicit*
overrides; the catalogue default is for display. Several rules are already
gated by their own long-standing settings (`harperAutoApply`,
`punctuationNonrestrictiveClause`, …), and applying a catalogue default on top
would gate them twice — quietly changing behaviour the older setting is still
responsible for. `ruleOverride()` returns `undefined` when no layer has an
opinion, and the lane then behaves exactly as it did before rule controls
existed.

**The curated typo table is not rule-controlled.** `teh → the` comes from a
list of known misspellings, not from dictionary similarity. Switching off
"Dictionary similarity" must not silently disable a curated fix — especially
since the Minimal profile explicitly promises to keep exactly those. Curated and
personal replacements are governed by their own settings; the record stores
which catalogue rule governs it (`controlRuleId`) rather than re-deriving it
from the display type, which cannot tell the two apart.

## 6. Writing profiles

Eight profiles, assignable globally and per website:

| Profile | Behaviour |
|---|---|
| General | The balanced default |
| Casual chat | Spelling only; punctuation and grammar stay out |
| Formal | Full punctuation and grammar |
| Fiction | Conservative with dialogue, fragments, invented names, style |
| Academic | Careful with technical vocabulary; punctuation enforced |
| Coding | Protects identifiers, paths, commands, URLs, case styles |
| Minimal | Only the most certain typo fixes |
| Aggressive | Applies everything it can, as early as it can |

A profile wins over the threshold sliders, because selecting a profile *is* an
explicit user choice and each profile documents what it does. The settings page
says so next to any rule a profile is currently forcing, so "I set it to
automatic and nothing happened" has a visible answer.

Profiles resolve rule modes; they do not silently opt the user into heavyweight
features. In particular, **Formal** or **Aggressive** can make the Harper rule
automatic only when Harper itself is enabled and `harperAutoApply` is on.
Likewise, a profile cannot promote the meaning-sensitive punctuation rule past
its hard suggestion ceiling.

**Fiction** raises the automatic bar to 0.96, turns the contextual layer off,
demotes dictionary matching and capitalisation to suggestions, and disables the
comma-between-sentences rule outright — fragments and comma splices are craft in
fiction, not errors. Invented names are exactly the shape that dictionary
similarity "fixes" by accident.

**Coding** disables merging, splitting, dictionary similarity, capitalisation,
grammar and all punctuation, and adds a guard beyond the tokenizer's existing
identifier rules: a word flush against `(`, `.`, `/`, `=`, `:`, a quote or a
bracket is part of an expression, not prose. Ordinary writing rarely puts those
characters against a word, so the false-positive cost is low.

**Minimal** sits at 0.95 — deliberately above the best structural candidates
(~0.92) and below the curated typo table (~0.96). A higher bar would silence the
table too and contradict the profile's own description.

## 7. Shadow mode

In shadow mode providers analyse text and record what they *would* have done,
without changing a character.

* `off` — normal operation.
* `experimental` — only the meaning-sensitive rules are held back and recorded:
  non-restrictive clauses, token merging and token splitting.
* `all` — nothing is applied; everything is recorded.

Each observation stores the proposed correction, the rule and provider, the
confidence, whether it would have been automatic or a suggestion, and whether
another provider agreed or disagreed with it on the same span. Agreement is
recorded on both sides, so the relationship reads correctly from either end.

Observations are capped at 500, truncate text to 120 characters, and live in
memory unless persistence is explicitly enabled. They are evidence about a rule,
not a text archive. Protected fields never reach a provider in the first place,
so they cannot be observed.

This is the intended path for the future AI provider: measure it against the
shipping engine on real writing before it is allowed to change anything.

## 8. Personal vocabulary

Six kinds of entry — allowed words, names and proper nouns, preferred
capitalisation, preferred corrections, blocked corrections, allowed phrases —
each with a scope of **everywhere**, **one website**, or **this document only**.

Entries are stored in the learning data, so they travel with the existing
export/import. Vocabulary also has its own versioned JSON format
(`personal-autocorrect-vocabulary`, version 1) for moving just the word list.
Import **merges** rather than replaces: importing a colleague's list should add
their words, not discard yours.

A malformed row is dropped rather than failing the whole file, but a wrong
*format* is a hard error — silently importing nothing looks identical to
success.

## 9. History panel

* **Filters**: spelling, spacing, punctuation, grammar, automatic, suggestion,
  reverted, plus the existing status filters.
* **Grouping**: none, website, field, paragraph, or time. Paragraph grouping
  reuses the anchor fingerprint that already exists for relocation, and names
  each group by the text around its first correction — a fingerprint means
  nothing to a reader.
* **Display**: compact (one row each) or detailed. Compact is a density
  control, not a reduced feature set; every action stays reachable via "⋯".
* **Batch actions**: keep all, review individually, revert selected, and
  **revert all automatic** — which undoes every change the extension made on
  its own and leaves anything you accepted alone. Reverts run newest-first so
  earlier offsets stay valid.
* Each entry shows its source rule id, confidence, whether it was automatic or
  an accepted suggestion, and the operation that produced it.

The invariant is unchanged and still enforced:

```
successful text change  ⇔  exactly one reversible CorrectionRecord
```

## 9a. Checking the whole text

Until now the engine only ever examined **the word you had just finished**.
Anything pasted, typed before the extension attached, or edited earlier in the
paragraph was never looked at — which is why a passage full of mistakes yielded
only two or three corrections.

Two controls in the panel fix that:

**Check whole text** runs one full sweep now, from the top, regardless of what
has already been checked.

**Keep checking in the background** (with a **Passes** count, 1–10) leaves the
sweep running on idle. It is off by default because it does real work.

### The caret path re-checks its own work

A correction routinely creates the conditions for the next one. Fixing `waht`
beside an existing `what` produces a repeated word that did not exist a moment
earlier:

```
what waht    →  what what   (typo fixed)   →  what   (repeat removed)
```

The extension used to stop after the first fix. Its own edits are bracketed by
an `applying` flag so it never reacts to them, so no input event arrived to
prompt a second look, and the newly-created mistake sat there until the user
typed something else. The committed word is now re-examined after any change,
bounded at four rounds, terminating as soon as a round changes nothing — which
is also what stops an offered suggestion from looping.

This is separate from the background sweep: chains at the caret are fixed
immediately, whether or not the sweep is switched on.

### Right-click to check now

Two context-menu items:

* **Check "…" now** — appears with text selected. The selected sentences jump to
  the front of the queue; the rest of the field is still checked afterwards, so
  nothing is skipped, only reordered.
* **Check this text now** — appears in any editable field, with no selection
  needed.

The selection is read from the live range by the content script rather than
taken from Chrome's `selectionText`, which is whitespace-collapsed and length
capped and so would not reliably match the field's real contents.

### How the sweep works

The unit is a **sentence**, identified by a fingerprint of its own text. Each
tick takes the next sentence that has not reached the pass target, applies at
most one correction inside it, and reschedules. Applying one edit per tick is
what keeps offsets trustworthy: the edit changes the sentence, which changes its
fingerprint, which puts it back in the queue to be looked at again.

Typing always outranks the sweep — an input event cancels the pending tick, and
it resumes on the next idle moment with its bookkeeping intact.

### Why it is incremental

Because identity is the sentence's own text, appending never invalidates what
came before:

```
500 words checked 5 times   →  every sentence fingerprinted, credited 5 passes
user types 200 more words   →  the existing fingerprints are unchanged
next sweep                  →  only the new sentences are queued
```

Editing a sentence changes its fingerprint, which correctly returns it to zero
passes; the sentences around it keep their credit.

### What "passes" actually buys

A pass matters when a sentence **changed** during it — fixing one mistake can
reveal another, and the grammar lane reports one finding at a time. A pass over
*unchanged* text is deterministic: repeating it cannot produce a different
answer. So a sentence that completes a pass with nothing to do is credited with
every remaining pass at once.

That is why setting 5 passes does not cost five times the work — only text that
actually changed is re-examined. The exception is the asynchronous grammar lane:
if Harper is enabled and has not yet answered for a sentence, that sentence earns
a single pass and is revisited.

The sweep applies automatic-grade corrections only. A background pass that
popped a suggestion chip for every sentence would be unusable, so suggestions
are left for when the caret arrives.

## 10. Diagnostics and self-test

**Diagnostics** (`diagnostics/diagnostics.html`) reports dictionary status and
version, Harper status/version/timings, AI provider status, the active site and
field, history status, last analysis duration, provider errors, and the current
profile. **It contains no text you have typed** — only counts, versions,
durations and the extension's own error messages — so it can be copied into a
bug report safely.

**Self-test** (`diagnostics/self-test.html`) runs the shipped engine against
known inputs and reports what it actually did: input, textarea and
`contenteditable` fields; spelling; token merge and split; punctuation; history
creation, location and reversion; paste-shaped bulk changes; and caret
preservation. It drives the real adapters against real fields on the page, so a
green run is evidence about this build rather than a restatement of the unit
tests. The fields stay visible so a failure can be reproduced by hand.

## 11. Reliability and accessibility

* **Versioned migrations.** Schema 2 carries existing per-rule punctuation
  choices and the Harper auto-apply flag into the new rule-control model. A
  user who switched the Oxford comma off does not find it back on after an
  update. Steps are idempotent.
* **Undo and redo.** The browser's undo stack knows nothing about our history.
  On `historyUndo`/`historyRedo` every record is re-located; those whose
  replacement has vanished are marked `superseded` and given a revert guard, so
  the engine does not immediately re-apply what the user just undid.
* **IME composition** is skipped entirely (`compositionstart`/`compositionend`
  plus `isComposing`), and **paste/drop** is never treated as typing evidence.
* **Stale-response rejection** for the grammar lane is unchanged:
  fingerprint-first, so a response is used only when the linted slice is still
  byte-identical.
* **Accessibility**: every control has a label; the undo badge and the markup
  overlay announce the whole change as one phrase with the arrow marked
  decorative; status regions are `aria-live`; no state is signalled by colour
  alone; `prefers-contrast`/`forced-colors` styles are provided; themes are
  system/light/dark/high-contrast; motion follows the system or can be forced.

## 12. Known limitations

* **A bare “-ing” opener never takes a comma.** “After finishing the report I
  went home” and “Exhausted from work he slept” are handled; “Running late I
  left” is not, because “Running water is useful” has the identical shape and is
  a subject rather than an introduction. Distinguishing them needs more than
  local structure, so the rule declines both.
* **A list used as a subject is not punctuated.** “Apples oranges and grapes are
  nice” is left alone: the rule refuses when anything follows the final item.
  Bare list fragments and lists after a verb both work.
* Repeated-word removal keeps a short allowlist of ordinary doubles (“had had”,
  “that that”, “is is”). A genuine stutter using one of those words is left in
  place — removing a legitimate one is the worse error.
* Sentence-start capitalisation treats a capitalised abbreviation (“Sat.”,
  “Dr.”) as non-terminal but the lower-case spelling as a sentence end, so “he
  sat. then” is fixed and “Meet Sat. then” is not. An unusual lower-case
  abbreviation will be capitalised after.
* The AI provider is **not installed in this build**. It is reported explicitly
  as absent in the popup and diagnostics rather than omitted, so its absence is
  never mistaken for a failure.
* Grouped history renders one list per group; bulk selection still operates on
  the ungrouped view.
* `protectCode` uses a delimiter heuristic. It is deliberately conservative and
  will occasionally decline a genuine prose typo that sits against punctuation.
* Shadow-mode agreement is matched on identical original text within 60 seconds.
  Two providers looking at the same word much further apart are not paired.
* Per-tab pauses key on Chrome's tab id, which is reused after a tab closes; the
  entry is removed on close, but a service-worker eviction during that exact
  moment could leave a stale id until the next pause change.

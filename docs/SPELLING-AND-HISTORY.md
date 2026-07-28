# Correction history, letter operations and word-boundary fixes

Covers the centralised correction-application path, the four letter-level
spelling processes, the operation-cost ranking, and the two word-boundary
corrections.

## 1. The correction-history invariant

> the field's text is modified **⟺** exactly one `CorrectionRecord` exists

Everything that can change text goes through one method,
`EditableController.applyCorrection()`. There are exactly two calls to
`adapter.replaceRange()` in the codebase: one inside `applyCorrection`, one
inside `revert`. No provider may write to a field any other way.

```
spelling engine ────────┐
punctuation engine ─────┤
Harper grammar ─────────┤
capitalisation ─────────┼──► applyCorrection() ──► CorrectionRecord
token merge / split ────┤          │                     │
personal rules ─────────┘          │                session history
                                   │                     │
                              rollback on              side panel
                              inconsistency
```

`applyCorrection` returns a typed outcome rather than a nullable record:

| Outcome | Meaning |
|---|---|
| `applied` | text changed, exactly one record exists |
| `declined` | nothing was changed (stale target, no-op, editor refused) |
| `rolled-back` | text was changed then restored; no record, no residue |
| `unrecorded` | text changed and rollback failed — logged as an error, and the record is still created so the change stays reversible |

### The bug that was fixed

The previous implementation verified its edit by comparing only the inserted
span:

```ts
const observed = newText.slice(edit.start, edit.start + edit.insert.length);
if (observed !== edit.insert) { this.snapshot = newText; return null; }
```

Two defects followed from this:

1. **Silent divergence.** When the host rendered anything other than what was
   requested, the method returned `null` — but the text had *already changed*.
   That is precisely "the extension changes text without recording it". The
   most common trigger is a `contenteditable` host normalising a plain space to
   a non-breaking space, which is exactly what the new token-split correction
   inserts.
2. **A span-only check cannot see damage outside the span.** A host that
   appended or rewrote text elsewhere passed the check unnoticed.

Both are fixed: the whole field is now compared against the expected result,
whitespace-normalised so a non-breaking space is not mistaken for a rejection;
and any real mismatch rolls the edit back rather than leaving it unrecorded.

### Reversion restores what the user actually typed

A correction can change capitalisation ("teh" at a sentence start becomes
"The"). Re-deriving the case from the replacement gave back "Teh". Reversion
now restores `originalText` verbatim whenever the document still shows exactly
what we wrote, and only transfers the observed capitalisation when something
else has since re-cased the word.

### If the panel looks empty

An empty panel now explains itself: autocorrect switched off, the site switched
off, history kept in memory only, an active search, or a filter other than
"All". This exists because those settings are **per Chrome profile**, so the
same build can appear to work in one profile and not another.

## 2. Letter-level processes

| Process | Operation | Cost | Example |
|---|---|---|---|
| 1 | same-length, same-first-letter bucket | 2–4 | broad similarity |
| 2 | adjacent transposition | 1 | `owrks → works` |
| 3 | QWERTY-neighbour substitution | 1 | `eorks → works` |
| 4 | **duplicate-letter removal** | 1 | `punctuatioon → punctuation` |
| 5 | **missing-letter insertion** | 1 | `iprove → improve` |
| 6 | **extra-letter deletion** | 1 | `worlkd → world` |
| 7 | **apostrophe insertion** | 0.5 | `didnt → didn't` |

Processes 4–7 supplement the three core Idea Version 1 searches. All seven run
unconditionally: a weak result from an earlier process never prevents a later
one, and the winner is chosen across the merged set.

Insertion tests `(n + 1) × 26` strings against exact dictionary membership —
182 lookups for a six-letter word, never a dictionary scan. Every candidate
records its evidence (`removedIndex`/`removedCharacter`,
`insertedIndex`/`insertedCharacter`), which the panel displays:

```
punctuatioon → punctuation
Removed accidental duplicate letter: o at position 11
```

A word the dictionary already knows is never rewritten, so `book`, `coffee`,
`letter`, `address`, `success` and `committee` are untouched.

### Process 7: the dropped apostrophe

This was added because the letter processes handled contractions *badly* rather
than not at all. `didnt` is one deletion from `dint`, `thats` one deletion from
`that`, `theyre` one deletion from `there` — so the engine confidently produced
a wrong word rather than declining. The dictionary already carried 18,761
apostrophe forms; the right answer was always one lookup away.

It tries an apostrophe at each interior position (at most n−1 exact lookups) and
is deliberately the cheapest operation in the table at 0.5, with the strongest
process prior. That asymmetry is justified by a property unique to this process:
**it only ever runs on a word the dictionary does not recognise**, and a non-word
that becomes a word by adding one apostrophe is essentially always that
contraction.

Two ranking bugs had to be fixed to make it work at all:

* `costPenalty` was a lookup keyed by exact integer, so the fractional cost 0.5
  fell through to the *worst* penalty — the opposite of what was intended.
* `scoreSpelling` clamps to 0.99, so `that's` and `that` both hit the ceiling
  and tied, and the **alphabetical** fallback then picked `that`. Ranking and
  the ambiguity margin now fall back to the unclamped generation score, which
  still carries the difference.

Words that are valid on their own are skipped by the layer above, so `cant`,
`wont`, `ill`, `lets`, `wheres`, `were` and `shell` are never touched — the
ambiguity is real and the safe answer is to leave them. `im` is handled by the
typo table instead, being below the generator's three-character floor, and the
capitalisation rule then lifts `i'm`, `i've`, `i'll` and `i'd` to their capital.

## 3. Operation cost — why `iprove` becomes `improve`

Similarity alone preferred `iphone` (same length, same first letter, four
aligned characters) over `improve` (one aligned character). Every candidate now
carries the cost of the edit that explains it, and cost dominates ranking:

```
exact rule                    0
one swap / neighbour / letter 1
one arbitrary substitution    2
same-length bucket match      3
multi-operation candidate     4
```

Measured for `iprove`:

| Candidate | Process | Cost | Similarity |
|---|---|---|---|
| `improve` | 5 (insert `m`) | 1 | 0.950 |
| `prove` | 6 (delete `i`) | 1 | 0.950 |
| `iphone` | 1 (bucket) | 3 | 0.617 |
| `ignore` | 1 (bucket) | 4 | 0.508 |

`improve` wins outright. **It is offered, not imposed**, because `prove` is an
equally simple single edit — the engine has two cost-1 explanations and refuses
to choose silently. Clicking the chip applies it and records it like any other
correction.

There is one ranking and one comparator, operating on an unclamped score. The
winner is fixed before display confidence is calculated, so a later confidence
clamp cannot re-order candidates. The two values are deliberately not
identical: ranking includes the active corpus-frequency term, while confidence
also determines whether the selected winner clears the user's action threshold.

## 4. Word-boundary corrections

Both live in `src/engine/token-spacing.ts` as pure functions, and both produce
**one** correction record covering the whole span — never two word records.

### Accidental internal space — `impro vement → improvement`

Requires exactly one plain space, two letter-only fragments, neither protected,
and a joined form that is a real word. When **both** fragments are themselves
valid words ("ice cream", "New York", "peanut butter") the merge is never
automatic; it is offered only when the compound is more frequent than the pair,
and otherwise not at all.

A subtlety worth knowing: `impro` alone would have been auto-completed to
`improv` before the second half was typed, destroying the evidence the merge
needs. Appending a letter to a short token is the signature of an unfinished
word, so that shape is now only ever *offered*, which leaves the merge free to
fire on the following commit.

### Missing space — `improvementability → improvement ability`

Never splits a word the dictionary knows (`another`, `software`, `without`,
`something`, `database`). Requires a word of at least 8 characters and
fragments of at least 3, because a 107k-word list can decompose almost any
misspelling otherwise (`waht → wa + ht`, `iprove → ip + rove`). Splits are
ranked by fragment frequency and length balance, and a narrow margin between
the best two keeps the result a suggestion. Short compounds such as
`helloworld` and `webbrowser` stay suggestions.

Identifiers, `snake_case`, `CamelCase`, URLs, e-mail addresses, file paths and
anything containing digits are refused outright.

## 5. Pipeline order

```
protected token / field checks
site and field disabling
blocked corrections
personal dictionary
exact personal replacement
high-confidence learned replacement
built-in exact typo mapping
already-valid word handling
  ├── duplicate-letter removal
  ├── adjacent-letter swap
  ├── keyboard-neighbour substitution
  ├── missing-letter insertion
  ├── extra-letter deletion
  ├── apostrophe insertion
  └── same-length bucket search      ← all merged, then ranked by cost
word-boundary merge / split          ← controller level, spans two tokens
context and personal-history scoring
automatic correction, suggestion, or nothing
```

Word-boundary work happens in the controller because it spans tokens. An
automatic-grade spacing fix is applied before the single-word engine runs; a
spacing *suggestion* is only offered if the word engine found nothing, so a
weak boundary guess can never suppress a strong word correction.

## 6. Measured performance

`tests/unit/spelling-performance.test.ts` exercises the supplemental generators,
spacing searches and complete decisions against their local budgets.
`npm run benchmark` reports warmed median/p95/p99/max values for the shipped
engine, and `npm run benchmark:enforce` gates lookup and Process 2 at p95
`<1 ms`, typical decisions at p95 `<15 ms`, and busy-bucket/5 MiB-field
decisions at p99 `<30 ms`. Timing values are intentionally not frozen in this
document because they vary with CPU, Node/V8 version and scheduler load.

## 7. Known limitations

* **`woks` is not corrected to `works`.** `woks` is a valid dictionary word
  (plural of wok). Rewriting it would breach the stronger invariant that a
  recognised word is never altered by the spelling layer. The brief listed this
  as a positive case; the invariant wins.
* **`thnks → thanks` is resolved by the exact-typo table, not by insertion.**
  Both `thanks` and `thinks` are single insertions, and `thinks` carries the
  higher frequency prior (0.896 vs 0.500). Structure cannot decide it, so the
  pair is listed in the typo table where lexical facts belong.
* **`iprove` is a suggestion, not an automatic correction** (see §3).
* Merging and splitting stay deliberately conservative: changing spaces changes
  meaning ("a part"/"apart", "in to"/"into"), so ambiguous cases are offered or
  ignored rather than applied.
* ESDB itself has no frequency counts. Ranking therefore combines a legacy
  compact prior with a separately sourced, seven-band corpus table covering
  40,459 dictionary words. Words outside that table remain unranked, and the
  corpus source's redistribution status still needs confirmation before a
  public release (see `vendor/frequency/README.md`).
* The `unrecorded` outcome is theoretically reachable if a host both mangles an
  edit and refuses the rollback. It is logged as an error and the record is
  still created so the change remains reversible.

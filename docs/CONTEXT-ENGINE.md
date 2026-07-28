# The context-ranking architecture

Context **ranks candidates the spelling engine already produced**. It never
invents a replacement. That separation is what keeps a future model from
proposing arbitrary text, and what lets the deterministic engine remain the
source of truth about what a plausible correction even is.

The central rule:

```
exactly one candidate score
exactly one comparator
exactly one final correction-policy decision
```

## The seven candidate processes

Unchanged. All seven run and merge into one ranked set.

| # | Process | Cost |
|---|---|---|
| 1 | Same-length, same-first-letter bucket | 2–4 |
| 2 | Adjacent transposition | 1 |
| 3 | QWERTY-neighbour substitution | 1 |
| 4 | Duplicate-letter removal | 1 |
| 5 | Missing-letter insertion | 1 |
| 6 | Extra-letter deletion | 1 |
| 7 | Apostrophe insertion | 0.5 |

## Stage 0 — shared linguistic analysis

The token classifier (13 token types), the clause detector and the closed-class
word lists were private to the punctuation engine. The spelling lane had two
strings, `previousWord` and `nextWord`, and nothing else.

They now live in `src/engine/context/`:

```
context-types.ts       TokenType, AnalysedToken, ClauseAnalysis
lexical-classes.ts     determiners, pronouns, auxiliaries, prepositions, …
token-classifier.ts    moved, unchanged
clause-detector.ts     moved, unchanged
context-features.ts    sentence features for a target span
```

`punctuation-types.ts` and `punctuation-config.ts` re-export what moved, so the
punctuation rules are untouched. There is one implementation of each, and
`tests/unit/context-features.test.ts` asserts both lanes get identical answers
for the same sentence.

`EngineContext` gained `previousTokenType`, `nextTokenType`, `sentenceText`,
`sentenceTokens` and `targetClause`. All optional and best effort: sentence
analysis is skipped above 4,000 characters, and every consumer treats absence as
"no extra evidence" rather than as a failure.

**Cost on the hot path: 0.125 ms per `buildContext`**, and 0.007 ms when the
field is over the limit. Measured, not assumed — this runs on every committed
word, so it is the most performance-sensitive change here.

## Stage 1 — word frequency

The old prior covered **228 words**. Everything else scored a flat 0.5, which
meant frequency could not distinguish `hats` from `ghats` from `that`.

```
vendor/frequency/en_common.txt      ranked source (most frequent first)
scripts/generate-frequency.mjs      generator, with --check
src/engine/data/frequency-data.ts   generated, banded packed strings
src/engine/data/frequency-metadata.ts  provenance and hashes
src/engine/data/frequency.ts        runtime lookup
```

**40,459 words in 7 quantised bands** — 177× the previous prior. Stored as
band-grouped packed strings rather than an object literal: one allocation at
parse time instead of tens of thousands. A word absent from the table but whose
base is listed inherits the base's band one step down.

`npm run check` runs `generate:frequency --check`, which fails if the committed
output does not match the source. The data cannot silently drift.

### The dataset

**Corpus-derived.** `top_english_words_lower_50000.txt` from
`david47k/top-english-wordlists`, built on the Google Books English Ngram
corpus. `FREQUENCY_METADATA.corpusDerived` is `true`, and a test pins the exact
source SHA-256 so a silent substitution fails the build.

Two hashes, deliberately distinct: `sourceSha256` covers the list as
downloaded, `generatedSha256` covers this generator's emitted output. They
answer different questions and are never collapsed into one ambiguous `sha256`.

### Complete accounting

Every one of the 50,000 source lines lands in exactly one bucket, and the
generator fails if they do not sum:

| Bucket | Count |
|---|---:|
| Accepted (in ESDB) | 40,459 |
| Absent from ESDB | 8,736 |
| Duplicates | 0 |
| Normalisation collisions | 0 |
| Invalid or filtered | 805 |
| **Total** | **50,000** |

The 805 filtered are all abbreviations with a trailing full stop — `p.`, `j.`,
`a.`, `m.`, `pp.`, `c.` — rejected by the word-format rule. They are correctly
excluded; what was wrong was excluding them silently. 805 entries vanished
without trace on the first run, which is why the invariant now exists.

The corpus-frequency term is active in production at weight **0.04**. The
fixed-seed sweep supporting the current value is under "Measured evidence"
below; the ESDB list's alphabetical order is never used as frequency.

## Stage 2 — one scorer, one comparator

There were three sort sites: two comparators in the generator, and a third in
the correction engine. The engine's sort ran on a value `scoreSpelling` had
already clamped to `0.99`, so two genuinely different candidates could both
reach the ceiling, tie, and be separated by **alphabetical order**. That is
exactly how `thats` resolved to `that` rather than `that's`.

Now:

```
context/candidate-order.ts     the one tie-break sequence
context/candidate-scoring.ts   the one score, unclamped
context/context-provider.ts    SyncContextProvider / AsyncContextProvider
context/rule-context-provider.ts  the deterministic implementation
```

`candidate-order.ts` imports `Candidate` as a **type only**, so it has no
runtime dependency on the generator and there is no import cycle. Both generator
comparators and the provider call `compareByScore`.

Tie-break sequence, most meaningful first:

1. higher raw score
2. lower operation cost
3. stronger direct edit evidence
4. higher contextual support
5. higher frequency
6. lexical order — last, purely for determinism

Clamping happens **once**, in `correction-engine.ts`, after ranking and after
the margin has been measured on the unclamped scale.

Score terms, each with its own weight:

| Term | Weight | Stage |
|---|---:|---|
| `editOperation` | **1** | existing behaviour, not a new signal |
| `frequency` | **0.04** | 1 |
| `partOfSpeech` | 0 | 3 |
| `wordContext` | 0 | 3 |
| `sentencePosition` | 0 | 3 |
| `documentReuse` | 0 | 3 |
| `personalHistory` | 0 | 3 |
| `knownPhrase` | 0 | 3 |
| `characterContext` | 0 | 3 |

With `DEFAULT_WEIGHTS`, corpus frequency is the only active context term.
`rawScore` is the existing generation score plus the weighted frequency band
and the pre-existing `rankAdjustment`; the other declared terms contribute
zero.

`rankAdjustment` — the pre-existing personal nudge — is applied unweighted and
separately, because it is current behaviour rather than a new signal.

## Stage 3 — context signals

The **mechanism** is complete: per-term weights defaulting to zero, a term
breakdown on every scored candidate, evidence strings in every decision, and a
shadow comparison that runs both weight sets and reports what moved.

`context/shadow-comparison.ts` returns, for a given weight change: the current
winner, the experimental winner, whether the winner changed, both margins, both
provisional actions, whether the action changed, and **which term was
responsible**. It returns `null` when nothing changed, so the log records
differences rather than noise.

**Five of eight context signals are implemented**: `frequency`, `partOfSpeech`,
`documentReuse`, `characterContext` and `sentencePosition`. The remaining three —
`wordContext`, `knownPhrase` and `personalHistory` — are declared, summed,
diagnosed and weighted at zero. Nothing claims they improve quality, because
their score implementations do not exist.

**One signal is active in production: `frequency`, at 0.04.** Every other term
is at zero, and each zero is now a *measured* decision rather than an absence of
evidence. See "Measured evidence" below for the numbers behind each one.

### `partOfSpeech`

Uses the shared Stage 0 classifier — there is one POS implementation in this
repository and this is not a second one. It answers a narrow question: does this
candidate's word class fit after a determiner, before an adverb, after a
subject? A determiner before the slot favours a noun over a verb; a following
adverb favours a verb.

Deliberately weak, and it returns **zero** for most slots, which is the honest
answer: most positions constrain nothing. It cannot separate `improve` from
`prove` — both are verbs — and a test asserts exactly that rather than pretending
otherwise.

### `documentReuse`

A word already used correctly in this document is more likely to be what the
writer meant. That helps names, product names and project jargon.

The limits are the design:

* **Only dictionary words accumulate evidence.** A repeated misspelling must
  never become self-justifying — that turns one typo into a permanent one.
* Per controller, so nothing leaks between documents.
* Bounded to 400 tracked words with least-recently-seen eviction.
* Occurrences cap at 5; the boost caps at 1 and reaches it after 3.
* Stores a normalised word, two counts and a timestamp — **never the text**.
* Rebuilt from the field's own content, so deleting a word stops it counting.

Note that `kubernetes` is *not* tracked: it is not in ESDB. Domain vocabulary
the dictionary does not know is what the personal dictionary is for; document
reuse only strengthens words already recognised as real.

### `characterContext`

Character-bigram plausibility from a 676-entry table (all 676 letter pairs
attested), log-scaled to one byte each, stored base64 and decoded lazily on
first use. The score is **relative to the typed token** — `plausibility(candidate)
- plausibility(typed)` — not an absolute plausibility, because absolute
plausibility mostly measures word length.

Relative scoring was not enough to save it. See the evaluation below.

### `sentencePosition`

Answers one narrow question: given where the typed token sits, is this
candidate's word class possible there? Position comes from `EngineContext` and
the shared sentence analysis — no second tokenizer, sentence detector, POS
classifier or clause detector was written for it.

Every rule is a **prohibition**, never a preference:

* A determiner or coordinator cannot end a sentence ("I gave it to the.").
* A possessive cannot sit before a full stop — the positional half of the
  `mis` → `mi's` guard, whose real work is done by the contraction table.
* A determiner cannot sit immediately before a comma or semicolon.
* A capitalised dictionary form proposed for a lower-case token is weak negative
  evidence **mid-sentence only**. At a sentence start every word is capitalised,
  so case carries no information and the rule is switched off. This is why
  `iPhone` cannot climb over `improve` and `prove` for `iprove`.
* Opening on a coordinating conjunction is unusual, not forbidden — the smallest
  penalty here.
* Inside a heading or fragment every opinion above is halved, because fragments
  routinely end on a preposition or determiner.

The signal never proposes capitalisation and never awards a positive score for
being capitalised; the only capitalisation rule is a penalty.

**Two classes were removed after ground truth rejected them**, and both
rejections were correct English: auxiliaries end sentences constantly through
ellipsis ("Yes, I have.") and prepositions strand just as often ("Who are you
talking to?"). Penalising auxiliaries turned `hve` → `have` into `hve` → `he`.

#### Defect found and fixed while implementing this

`isSentenceStart` in `tokenizer.ts` treated **every** full stop as a sentence
boundary. `Dr. Smith`, `e.g. apples`, `i.e. this` and `Fig. 4` all produced false
sentence starts. Two other places in the engine already handled abbreviations,
and the copy in `sentence-capitalisation.ts` still missed dotted forms, because
its regex captured only `g` from `e.g.`.

The abbreviation check now lives once, in `tokenizer.ts`, exported and shared
with the capitalisation lane. The duplicate is gone. This corrects
`EngineContext.isSentenceStart` for every consumer, not only this signal.

### Whole-field collection

The sweep already routed through the same `analyze` path, so it collected
observations from the moment it existed. What was added is the bounding: at most
120 observations per forced scan, de-duplicated by word pair rather than by
position — the same disagreement in ten places is one piece of evidence, and
recording it ten times would bias the aggregate.

## Measured evidence — the frequency weight

`npm run evaluate` against UD English EWT (dev split, 2,001 sentences, 1,045
usable as clean prose):

| Measurement | Result |
|---|---|
| CoNLL-U reconstruction vs the corpus `# text` field | **100.0%** |
| Clean sentences evaluated | 300 |
| Apparent false positives | 13 raw; **0 confirmed after review** |
| Synthetic corruptions attempted | 299 |
| Restored exactly | 270 (**90.3%**) |
| Corrected to something else | 26 |
| Missed | 3 |
| Ranking disagreements (`0` baseline vs production `0.04`) | 29 |
| On known corruptions: production **better** | **14** |
| On known corruptions: production **worse** | **0** |
| On known corruptions: neutral | 4 |
| Disagreements where frequency beat the lowest-cost candidate | **0** |

The last row is the safety property. Frequency broke ties among equally-cheap
candidates and never once overrode a better edit explanation.

Those figures are from the fixed-seed `20260728` run reproduced on 2026-07-28.
`artifacts/context-evaluation/frequency-weight-sweep.md` is the generated
report; `npm run evaluate` regenerates it and the other signal reports.

### The required `iprove` regression

Under the experimental frequency weight:

```
improve  cost 1  freq 224  score 0.9843
prove    cost 1  freq 224  score 0.9843
iphone   cost 3  freq 0    score 0.3940
ignore   cost 4  freq 192  score 0.2762
```

`iPhone` is nowhere near, and frequency did not rescue it. `improve` and `prove`
remain exactly tied — both cost 1, both band 224 — so it stays a suggestion,
which is the documented behaviour.

## Measured evidence — the signals that stayed at zero

Three signals have now been measured against ground truth and **all three stay
at weight 0**. Each entry below is a decision backed by numbers, not an
unfinished feature.

Method is the same in every case: corrupt a known word in a UD English EWT
sentence, rank the candidates under the shipped weights, rank them again with
one term raised, and judge the winner against the word that was actually
corrupted. Counting winner *changes* is not evidence — only better against
worse. Full reports live in `artifacts/context-evaluation/`.

### `partOfSpeech` — break-even

396 corruptions, 199 with POS evidence.

| weight | changes | better | worse | cost overrides |
|---:|---:|---:|---:|---:|
| 0.01–0.04 | 3 | 1 | 2 | 0 |

Against frequency's current 14-better/0-worse result this is not enough. POS cannot separate
`improve` from `prove` — both are verbs — and that is the common case among the
near-ties that actually matter.

### `characterContext` — measurably harmful

1,030 corruptions; every candidate set receives evidence.

| weight | changes | better | worse | neutral | cost overrides |
|---:|---:|---:|---:|---:|---:|
| 0.005 | 9 | 2 | **4** | 3 | 0 |
| 0.010 | 9 | 2 | **4** | 3 | 0 |
| 0.020 | 14 | 4 | **6** | 4 | 0 |
| 0.040 | 29 | 9 | **12** | 8 | 0 |

Worse than break-even at *every* weight: **17 better, 26 worse**. The failure is
structural, not a tuning problem. For `hve`, the signal scores `he` at +0.00447
against `have` at +0.00204 — two letters forming one very common pair beat three
pairs including the rare `av`. Mean-pair plausibility rewards short words, so
relative scoring does not rescue it.

Safe throughout — zero operation-cost overrides, zero action changes, and no
regressions on uncommon words — but safety is not usefulness. **Stays at 0.**

### `sentencePosition` — safe and inert

23 controlled cases plus 1,027 corpus corruptions.

| weight | with evidence | changes | better | worse | cost overrides |
|---:|---:|---:|---:|---:|---:|
| 0.005–0.04 | 40 | **0** | 0 | 0 | 0 |

Only 40 of 1,050 cases receive any evidence, and no winner changes at any
weight. That follows from the design: every rule is a prohibition, so the signal
stays silent unless a position genuinely rules a class out — and where it does
speak, a cheaper mechanism has usually already decided. `mis` is the clearest
example: the contraction table blocks `mi's` before position gets a say.

The first draft *did* change a winner, and changed it wrongly (`hve` → `he`,
above). Removing the two over-broad classes removed both the regression and the
only measured effect.

**Stays at 0**, and is carried in `EXPERIMENTAL_WEIGHTS` at 0.01 so shadow mode
keeps observing it on real writing, where the position distribution differs from
random corruption.

### Why these stay implemented

A signal at weight 0 costs nothing at runtime — `scoreCandidate` skips any term
whose weight is zero. What the implementations buy is the ability to re-measure
cheaply when better data arrives, and a recorded reason for the zero. The
alternative — deleting them — would mean re-deriving these results later.

## Stage 4 — correction-risk classes

One global ambiguity margin cannot be right, because the cost of being wrong is
not constant. Turning `punctuatioon` into `punctuation` wrongly is a nuisance;
turning `woks` into `works` wrongly changes what the user said.

`context/correction-policy.ts` defines nine classes:

| Class | Required margin | Maximum action |
|---|---:|---|
| `exact-personal-rule` | 0.02 | automatic |
| `invalid-word-single-edit` | 0.06 | automatic |
| `invalid-word-multi-edit` | 0.12 | automatic |
| `valid-word-replacement` | **0.35** | **suggestion** |
| `token-merge` | 0.20 | automatic |
| `token-split` | 0.20 | automatic |
| `punctuation-safe` | 0.06 | automatic |
| `punctuation-meaning-sensitive` | 0.25 | suggestion |
| `ai-only` | 0.40 | suggestion, agreement required |

The policy function runs **after** ranking and can only ever *lower* an action.
A class never promotes a correction the scorer was unwilling to make.
Currently the production call site is the generated dictionary-spelling branch
only. The merge, split, punctuation and Harper lanes still enforce their own
existing gates rather than passing through this policy; their table entries are
declared design surface, not a claim of global runtime enforcement.

The long-standing absolute rule relaxes to:

> Never *automatically* alter a valid dictionary word. A valid-word replacement
> may be offered when contextual evidence is overwhelming.

`woks` is still unchanged today because recognised words short-circuit out of
the generated spelling branch. Consequently `valid-word-replacement` is also
dormant at the current call site; the separate confusion-set context lane is
the only current path for selected real-word suggestions.

## Stage 5 — the AI slot

**No model ships.** What ships is the contract and the safety machinery.

`context/async-context.ts` provides sentence-level requests carrying request,
session and field ids plus a fingerprint and the exact target text;
`verifyResponse` with five distinct rejection causes; `AsyncRankingQueue` with
one request in flight per field and backoff after three stale answers; and
`capAsyncAction`, which forces every asynchronous result to a suggestion.

The verification order matters and is deliberate: cheapest and most decisive
first, with the **target-span check last** because it is the one that actually
protects the text. Everything above it can pass while the user has edited inside
the span and back out to the same length.

The flow a model must follow:

```
AsyncContextProvider
      ↓  ranks candidates the engine produced
ContextDecision
      ↓  verifyResponse: fingerprint AND exact target span
correction-risk policy  →  ai-only: suggestion, agreement required
      ↓
shadow mode or suggestion chip
      ↓  user accepts
applyCorrection()  →  exactly one CorrectionRecord
```

No path bypasses `applyCorrection()`. The history invariant is unchanged.

## Stage 6 — budgets and measurements

`scripts/check-bundle-size.mjs` runs in `npm run check` and fails the build past
a ceiling.

| Asset | Size | Ceiling |
|---|---:|---:|
| Content script JS | 1,746.2 kB | 1,800 |
| Service worker JS | 1,437.6 kB | 1,800 |
| Panel + popup + options + diagnostics | 1,800.9 kB | 2,100 |
| Harper WASM | **17,803.9 kB** | 20,000 |
| AI model assets | 0 | 20,000 |
| **Total unpacked** | **22,808.6 kB** | 46,000 |

Harper is about **78% of the whole unpacked extension**. Worth knowing before adding
anything else large.

Current deterministic benchmark snapshot:

| Operation | Median | p95 | p99 |
|---|---:|---:|---:|
| Dictionary `Set` lookup | 0.0003 ms | 0.0004 ms | 0.0006 ms |
| Adjacent-swap generation | 0.0055 ms | 0.0107 ms | 0.0129 ms |
| Typical full correction | 1.090 ms | 1.523 ms | 1.723 ms |
| Busy-bucket full correction | 5.504 ms | 7.140 ms | 7.935 ms |
| Full correction in a 5 MiB field | 11.198 ms | 15.316 ms | 15.937 ms |

The size and timing tables were reproduced on Windows/Node 24.17.0 on
2026-07-28 with `npm run check:bundle` and `npm run benchmark`. They are a
snapshot, not universal Chrome guarantees; the commands and enforced ceilings
are the contract. The benchmark also reports full percentiles and sample counts
for every candidate process, complete generation, context/ranking, spacing,
punctuation, history creation and revert planning; those microbenchmarks are
informational rather than fragile CI ceilings.

## Known limitations

* **The frequency dataset is corpus-derived but separately sourced.** It
  contains 50,000 input rows, of which 40,459 dictionary words are kept in
  seven bands; `corpusDerived: true`. Its checked-in provenance is complete,
  but `vendor/frequency/README.md` still calls for confirming upstream
  redistribution terms before a public release.
* **Five of eight context signals are implemented.** Frequency is active at
  `0.04`; part of speech, document reuse, character context and sentence
  position are implemented at production weight zero. Word context, personal
  history as a declared score term, and known phrase remain unimplemented.
* **`woks → works` is still not offered.** The class and the ceiling exist; the
  signal that could clear a 0.35 margin does not.
* **No AI provider exists.** The slot, the verification and the queue are real
  and tested; there is nothing to plug in.
* Shadow comparison is wired whenever shadow mode is not `off`. It compares
  production against experimental weights and records only winner/action
  differences, bounded by the shared shadow-observation caps. Persistence is
  separately opt-in.

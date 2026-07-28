# Essential punctuation engine

A deterministic, offline, rule-based lane that inserts punctuation **only when
sentence structure makes it unambiguous**. It is not a style checker: it does
not touch punctuation that merely changes tone, rhythm or emphasis.

The governing definition is not "insert punctuation whenever it might improve
the sentence" but:

> Insert punctuation automatically only when one local punctuation edit is
> overwhelmingly supported by sentence structure and competing interpretations
> are implausible.

## The three lanes

| Lane | Timing | Engine | Default |
|---|---|---|---|
| Spelling | synchronous, on each committed word | ESDB dictionary, typo table, personal rules | automatic |
| **Essential punctuation** | **on idle, synchronous, no IPC** | **this engine** | **automatic at ≥0.97 confidence** |
| Grammar | on idle, async via the service worker | Harper (WASM) | suggestions by default; guarded auto-apply is opt-in |

The punctuation lane runs **before** Harper in the same idle pass. It is
deterministic, needs no round trip, and publishes the spans it claims so the
grammar lane cannot report the same fix twice.

## When it runs

Never per keystroke. The lane is driven by the controller's existing idle work,
which fires 700 ms after the last input event, on blur, and after a paste. It
analyses the paragraph containing the caret, then re-schedules itself so
findings surface one at a time.

## Rules

| ID | Rule | Default | Example |
|---|---|---|---|
| P001 | Introductory dependent clause | automatic | `Although it was raining` **`,`** ` we continued.` |
| P002 | Introductory participial phrase | automatic | `Having completed the test` **`,`** ` she left.` |
| P003 | Direct address | automatic (tight patterns) | `Let's eat` **`,`** ` Grandma.` |
| P004 | Simple list | automatic | `bread` **`,`** ` milk` **`,`** ` and eggs` |
| P005 | Comma before a coordinator joining two independent clauses | automatic | `I was tired` **`,`** ` but I kept working.` |
| P101 | Possible non-restrictive relative clause | **suggestion only, off by default** | `My brother, who lives in London, is a doctor.` |

P101 can never be automatic. The commas change the meaning — without them the
clause identifies *which* brother; with them it is extra detail about an
already-identified one. Only the writer knows which was meant, so the rule
explains the distinction instead of asserting the original is wrong. This is
enforced three ways: `defaultAction: 'suggestion'`, an anti-pattern that vetoes
any automatic action, and a test that forces both thresholds to zero and
asserts the action is still `suggestion`.

## How a rule decides

Every rule states when it fires **and** when it must not:

```ts
export interface EssentialPunctuationRule {
  id; category; scope; priority; defaultAction; settingKey?;
  detect(context): PunctuationIssue[];
  antiPatterns?: Array<(context, issue) => boolean>;  // return true to veto
}
```

Shared guards run before any rule sees a sentence: fragments, headings, list
items, all-caps lines, and any sentence containing protected content (URLs,
e-mail addresses, file paths, code identifiers, version numbers, decimals) are
never analysed. Per-rule anti-patterns then cover the rule's specific failure
modes — a gerund subject for P002, an object rather than an addressee for P003,
a coordinated modifier for P004, and so on.

## Grammatical analysis

Not a statistical tagger — closed-class lookup, morphology, and a few ordering
heuristics, backed by the extension's existing 107,901-word ESDB dictionary for
stem confirmation. That is enough for the targeted rules, because they all
reduce to one question: *does this token span contain a subject and a finite
verb?*

The clause detector finds the **verb first, then the nearest preceding subject
candidate**. Scanning for the subject first lets a determiner buried in an
object phrase masquerade as the subject of a later verb — which produced a
comma in the wrong place during development (`After finishing |the| report I
went home`). The subject head is then extended leftwards over its determiners
and adjectives so a comma lands before `the build`, not inside it.

Every classification records whether it was a guess. Guesses lower clause
confidence, which lowers issue confidence, which demotes an automatic fix to a
suggestion. A regional spelling whose stem is not in the dictionary
(`apologised`) is still recognised as a past tense, but as a guess — so it
produces a suggestion rather than an automatic edit.

## Confidence and actions

```
confidence ≥ 0.97  ->  automatic   (and only if the rule's default allows it)
confidence ≥ 0.75  ->  suggestion
otherwise          ->  nothing
```

Both thresholds are user-configurable; the automatic threshold is clamped to
≥0.90 in the settings normaliser so it can never be lowered below the level the
corpus was validated at. Turning "apply automatically" off downgrades every
finding to a suggestion without disabling the engine.

## Reversibility

An insertion is normalised into a replacement over a **non-empty original
span** — the comma attaches to the preceding word:

```
Original:     "report"
Replacement:  "report,"
Rule:         punctuation:introductory-participle
```

That is what keeps punctuation compatible with the existing anchor, locator and
reverter, which both require non-empty text on each side. Every punctuation
change becomes an ordinary `CorrectionRecord` with `sourceRuleId:
"punctuation:…"` and `correctionType: "punctuation"`, so punctuation and
grammar remain separately filterable while the side panel,
jump-to-correction, guided review and selective revert all work unchanged.

## Learning

Punctuation is **never** learned as a word pair — `and → , and` would be
catastrophic as an exact replacement rule. Decisions are recorded per rule in
`LearningData.punctuationStats`:

```ts
{ shown, accepted, rejected, reverted, ignoredInContext }
```

Statistics may only ever *lower* an action. A rule reverted twice without an
offsetting acceptance stops applying automatically; one rejected six times with
no acceptances stops being offered at all. Promotion in the other direction
requires the (default-off) `punctuationAllowRulePromotion` setting, and P101 is
excluded from promotion by construction.

## Overlap resolution

Within the lane, overlapping findings are resolved by priority, then
confidence, then smaller span, then a deterministic id tie-break. Overlapping
edits are never merged — a combined replacement has not been verified, so the
loser is dropped rather than concatenated.

Against Harper: the punctuation lane publishes `punctuationClaims` for the
current pass, and the grammar lane skips any finding overlapping a claimed
span. One record, one panel entry. There is no current cross-provider agreement
annotation on a punctuation record.

## Measured results

From `tests/unit/punctuation-corpus.test.ts` and
`tests/unit/punctuation-performance.test.ts` (run them to reproduce):

```
corpus: TP=74  FP=0  FN=0  precision=100.0%  recall=100.0%
  introductory-clause     30 correct, 0 missed
  introductory-participle 15 correct, 0 missed
  direct-address          11 correct, 0 missed
  simple-list              5 correct, 0 missed
  independent-clause      13 correct, 0 missed

sentence:        median 0.28 ms
paragraph (405): median 1.08 ms
4000-char block: median 7.65 ms
cached re-analysis: 0.016 ms per call
```

The timing lines above are one Windows/Node 24.17.0 run on 2026-07-28. They are
hardware- and scheduler-dependent observations; the tests and their budgets are
the reproducible contract.

**What these numbers do and do not mean.** They are measured on a corpus of 74
positive and 124 negative cases written alongside the rules. 100% precision on
that corpus means the engine changed none of the 124 sentences it was supposed
to leave alone — including every negative required by the specification. It
does **not** mean 100% precision on arbitrary prose: the corpus is finite, and
it was authored by the same person who wrote the rules. Real-world text will
contain constructions it has never seen. The design response to that is the
confidence model and the anti-patterns, not the corpus number.

## Known limitations

* **English only**, and the classifier assumes SVO word order.
* **No full parser.** Appositives, coordinate-versus-cumulative adjectives, and
  restrictive/non-restrictive distinctions in general are out of reach and
  deliberately not attempted.
* **Recall is modest by design.** The engine skips anything ambiguous: comma
  splices, intro phrases without a clear clause, nested or phrase-level lists,
  and sentences containing protected content are all left alone.
* **Regional spellings** whose stem is absent from the US-English ESDB list
  degrade to suggestions rather than automatic fixes.
* **Quoted material** is never modified, so a genuine error inside a quotation
  stays uncorrected.
* **Dialogue punctuation is not covered** — no rule for `"Hello" he said`. That
  was scoped out of this task and remains the largest gap for fiction writing.
* The corpus is the arbiter of whether a rule may be automatic. A rule whose
  precision drops below the target must be demoted to `suggestion` in its
  `defaultAction`, not patched with a special case.

# Part-of-speech evaluation

| measurement | value |
|---|---:|
| Candidate sets examined | 132 |
| Sets receiving a non-zero POS contribution | 71 |
| Winners changed | 9 |

## Winner changes

| token | without POS | with POS | class of new winner |
|---|---|---|---|
| `hamas` | `haas` | `hams` | verb |
| `suckups` | `suckers` | `suckles` | noun |
| `hamas` | `haas` | `hams` | verb |
| `hilla` | `hill` | `hills` | verb |
| `froomkin's` | `franklin's` | `footprints` | verb |
| `hamas` | `haas` | `hams` | verb |
| `shaukat` | `shavuot` | `shacked` | verb |
| `benitez` | `bedizen` | `betided` | verb |
| `questionsand` | `questionings` | `questionable` | adjective |

## Known limitation, retained

POS cannot distinguish `improve` from `prove`, because both are verbs.
No weight fixes that; the signal has no information to offer when two
candidates share a word class, which is the common case among the
near-ties that matter.

## Recommendation

Leave `partOfSpeech` at weight **0**.

It fires more often than expected — a non-zero contribution on roughly
half the candidate sets — and it moves the winner in a small minority of
them. But **the quality of those changes is unmeasured**: they occur on
unmodified corpus text where there is no ground truth to compare against,
so there is no evidence that any of them is an improvement.

"It changes decisions" is not a reason to activate a signal. Frequency
was activated on 30 measured improvements against 2 regressions; POS has
no equivalent number, and until it does its weight stays at zero.

The experiment that would settle it: run these winner changes against
synthetic corruptions, where the expected answer is known, and count
better against worse the way the frequency sweep did.

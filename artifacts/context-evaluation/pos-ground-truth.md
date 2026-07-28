# Part-of-speech ground-truth evaluation

Synthetic corruptions of UD English EWT sentences, where the original
word is known, so a winner change can be judged rather than merely
counted. Same seed at every weight.

| weight | corruptions | with POS evidence | winner changes | better | worse | neutral | cost overrides | action changes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.00 | 396 | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| 0.01 | 396 | 199 | 3 | 1 | 2 | 0 | **0** | 0 |
| 0.02 | 396 | 199 | 3 | 1 | 2 | 0 | **0** | 0 |
| 0.03 | 396 | 199 | 3 | 1 | 2 | 0 | **0** | 1 |
| 0.04 | 396 | 199 | 3 | 1 | 2 | 0 | **0** | 2 |

## Sample winner changes at weight 0.02

| corrupted | without POS | with POS | expected | class | verdict |
|---|---|---|---|---|---|
| `operatin` | `operating` | `operation` | `operation` | noun | better |
| `clena` | `clean` | `lena` | `clean` | noun | worse |
| `daet` | `date` | `dat` | `date` | noun | worse |

## By word class

| weight | class | better | worse |
|---:|---|---:|---:|
| 0.01 | noun | 1 | 2 |
| 0.02 | noun | 1 | 2 |
| 0.03 | noun | 1 | 2 |
| 0.04 | noun | 1 | 2 |

## By correction process

| weight | process | better | worse |
|---:|---|---:|---:|
| 0.01 | missing-letter-insertion | 1 | 0 |
| 0.01 | extra-letter-deletion | 0 | 2 |
| 0.02 | missing-letter-insertion | 1 | 0 |
| 0.02 | extra-letter-deletion | 0 | 2 |
| 0.03 | missing-letter-insertion | 1 | 0 |
| 0.03 | extra-letter-deletion | 0 | 2 |
| 0.04 | missing-letter-insertion | 1 | 0 |
| 0.04 | extra-letter-deletion | 0 | 2 |

## Known limitation, retained

POS cannot distinguish `improve` from `prove`, because both are verbs.
No weight changes that: the signal has nothing to say when two candidates
share a word class, which is the common case among the near-ties that
actually matter.

## Verdict

Across all active weights: **4 better, 8 worse**. Not sufficient evidence to activate. POS stays at weight **0**.

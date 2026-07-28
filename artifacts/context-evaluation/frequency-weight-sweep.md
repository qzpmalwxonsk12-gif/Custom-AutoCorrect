# Frequency weight sweep

Each weight run over the same UD English EWT sample with the same seed, so
the only variable is the weight itself.

Baseline weights: `editOperation=1, frequency=0, partOfSpeech=0, wordContext=0, sentencePosition=0, documentReuse=0, personalHistory=0, knownPhrase=0, characterContext=0`

Tested frequency weights: `0.02, 0.04, 0.06, 0.08, 0.10`

Current production frequency weight: **0.04** (included in this sweep)

Seed: `20260728`. Clean-sentence sample limit: `300`.

| weight | disagree | better | worse | neutral | confirmed FP | valid-word changes | action changes | cost overrides | avg margin Δ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.02 | 24 | 8 | 0 | 6 | 0 | 0 | 0 | **0** | 0.0046 |
| 0.04 | 29 | 14 | 0 | 4 | 0 | 0 | 0 | **0** | 0.0078 |
| 0.06 | 35 | 18 | 0 | 3 | 0 | 0 | 0 | **0** | 0.0095 |
| 0.08 | 36 | 20 | 0 | 2 | 0 | 0 | 3 | **0** | 0.0149 |
| 0.10 | 55 | 22 | 0 | 3 | 0 | 0 | 3 | **0** | 0.0044 |

`cost overrides` is the safety column: the number of disagreements where the
frequency-informed winner did **not** have the lowest operation cost. It must
be zero.

## Decision

Current production weight **0.04** was measured against the explicit zero-frequency baseline: 14 better, 0 worse, 0 cost overrides. Lowest tested weight with gains and no regressions: **0.02**. This diagnostic report does not change production weights.

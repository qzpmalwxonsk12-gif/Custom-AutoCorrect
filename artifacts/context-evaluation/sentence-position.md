# Sentence-position ground-truth evaluation

Controlled cases: 23. Corpus corruptions: 1044.
Production weights are the shipped ones (`frequency = 0.04`) with only
`sentencePosition` varied, so this measures the signal in combination with
what already ships.

## Implementation notes

- Position comes from `EngineContext` and the shared sentence analysis.
  No second tokenizer, sentence detector, POS classifier or clause detector
  was written for this signal.
- Every rule is a *prohibition* (a position that rules a class out), never
  a preference. The only capitalisation rule is a penalty, and it is
  switched off at sentence start where case carries no information.
- Fixed while implementing: `isSentenceStart` treated every full stop as a
  boundary, so `Dr.`, `e.g.`, `i.e.` and `Fig.` produced false sentence
  starts. The abbreviation check now lives once in `tokenizer.ts` and is
  shared with the capitalisation lane.

## Results by weight — all cases

| weight | cases | with evidence | winner changes | better | worse | neutral | cost overrides | action changes | avg margin change |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.000 | 1050 | 0 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00000 |
| 0.005 | 1050 | 40 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00000 |
| 0.010 | 1050 | 40 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00001 |
| 0.020 | 1050 | 40 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00002 |
| 0.040 | 1050 | 40 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00004 |

## Results by weight — controlled cases only

| weight | cases | with evidence | winner changes | better | worse | neutral | cost overrides | action changes | avg margin change |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.000 | 23 | 0 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00000 |
| 0.005 | 23 | 1 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00022 |
| 0.010 | 23 | 1 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00043 |
| 0.020 | 23 | 1 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00087 |
| 0.040 | 23 | 1 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00174 |

## Results by weight — corpus corruptions only

| weight | cases | with evidence | winner changes | better | worse | neutral | cost overrides | action changes | avg margin change |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.000 | 1027 | 0 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00000 |
| 0.005 | 1027 | 39 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00001 |
| 0.010 | 1027 | 39 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00002 |
| 0.020 | 1027 | 39 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00004 |
| 0.040 | 1027 | 39 | 0 | **0** | **0** | 0 | 0 | 0 | -0.00008 |

## By sentence-position category

_No winner changes to break down by category._

## By candidate-generation process

_No winner changes to break down by process._

## Common versus uncommon expected words

| weight | common better | common worse | uncommon better | uncommon worse |
|---:|---:|---:|---:|---:|
| 0.005 | 0 | 0 | 0 | 0 |
| 0.010 | 0 | 0 | 0 | 0 |
| 0.020 | 0 | 0 | 0 | 0 |
| 0.040 | 0 | 0 | 0 | 0 |

## Regressions in full

_No regressions at any evaluated weight._

## Verdict

Across active weights: **0 better, 0 worse** (corpus: 0 better, 0 worse). The production weight stays **0**: the signal is implemented, tested and available in shadow mode, and will be reconsidered when shadow observations from real writing accumulate.

# Frequency ranking regressions

Every case where the tested frequency-informed ranking chose a *different* word
than the explicit baseline, and the baseline happened to be the one matching the
synthetic corruption's known original.

Baseline weights: `editOperation=1, frequency=0, partOfSpeech=0, wordContext=0, sentencePosition=0, documentReuse=0, personalHistory=0, knownPhrase=0, characterContext=0`

Tested weights: `editOperation=1, frequency=0.08, partOfSpeech=0, wordContext=0, sentencePosition=0, documentReuse=0, personalHistory=0, knownPhrase=0, characterContext=0`

Generated from UD English EWT. Cases: **0**.

> These are candidates for classification, not confirmed engine faults.
> A synthetic corruption has exactly one "expected" answer by construction,
> which is not the same as having exactly one *correct* answer.

---

_No regressions in this run._

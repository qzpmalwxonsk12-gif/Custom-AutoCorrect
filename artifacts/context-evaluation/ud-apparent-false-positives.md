# Apparent false positives on unmodified UD English EWT text

Cases: **13** raw, **0** confirmed
after applying the manual review file.

Candidate-score baseline: `editOperation=1, frequency=0, partOfSpeech=0, wordContext=0, sentencePosition=0, documentReuse=0, personalHistory=0, knownPhrase=0, characterContext=0`

Candidate-score test weights: `editOperation=1, frequency=0.08, partOfSpeech=0, wordContext=0, sentencePosition=0, documentReuse=0, personalHistory=0, knownPhrase=0, characterContext=0`

> "Apparent" is the operative word. UD English Web Treebank is a *web*
> treebank: it contains genuine misspellings, informal spellings, product
> names and abbreviations. An automatic correction here is not necessarily
> an engine fault — it may be the engine correctly flagging bad text.

Classifications live in `tests/evaluation/review.json`, keyed by
`sentenceId|token` so the evaluation stays reproducible. Nothing is
excluded from this report; the review only affects the *confirmed* count.

---

## Case 1 — `comme`

**Sentence id:** `weblog-blogspot.com_gettingpolitical_20030906235000_ENG_20030906_235000-0005`

> A la guerre c'est comme a la guerre!

| field | value |
|---|---|
| Target token | `comme` |
| Proposed correction | `come` |
| Provider | lexicon |
| Rule id | - |
| Correction type | duplicate-letter |
| Confidence | 0.9900 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `come` **←tested** | duplicate-letter-removal | 1 | 0.9963 | 255 | 0.0800 | 1.0763 |
| `comm` | extra-letter-deletion | 1 | 0.9140 | 160 | 0.0502 | 0.9642 |
| `commie` | missing-letter-insertion | 1 | 0.9140 | 0 | 0.0000 | 0.9140 |
| `somme` | keyboard-substitution | 1 | 0.8724 | 96 | 0.0301 | 0.9025 |
| `comma` | bucket-similarity | 2 | 0.6060 | 128 | 0.0402 | 0.6462 |
| `comte` | bucket-similarity | 2 | 0.5844 | 160 | 0.0502 | 0.6346 |
| `comes` | bucket-similarity | 3 | 0.5042 | 224 | 0.0703 | 0.5745 |
| `comer` | bucket-similarity | 3 | 0.4324 | 128 | 0.0402 | 0.4726 |
| `comet` | bucket-similarity | 3 | 0.4324 | 160 | 0.0502 | 0.4826 |
| `comas` | bucket-similarity | 3 | 0.3820 | 128 | 0.0402 | 0.4222 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 2 — `yound`

**Sentence id:** `weblog-juancole.com_juancole_20040114085100_ENG_20040114_085100-0003`

> In Fallujah, hundreds of demonstrators came out against US troops when they briefly arrested a yound newlywed bride.

| field | value |
|---|---|
| Target token | `yound` |
| Proposed correction | `hound` |
| Provider | lexicon |
| Rule id | - |
| Correction type | keyboard-proximity |
| Confidence | 0.9007 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `hound` **←tested** | keyboard-substitution | 1 | 0.9007 | 128 | 0.0402 | 0.9408 |
| `young` | bucket-similarity | 2 | 0.6659 | 255 | 0.0800 | 0.7459 |
| `you'd` | bucket-similarity | 2 | 0.5844 | 0 | 0.0000 | 0.5844 |
| `yours` | bucket-similarity | 3 | 0.4562 | 192 | 0.0602 | 0.5164 |
| `youth` | bucket-similarity | 3 | 0.3820 | 224 | 0.0703 | 0.4523 |
| `yoked` | bucket-similarity | 3 | 0.3604 | 64 | 0.0201 | 0.3805 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 3 — `miniscule`

**Sentence id:** `weblog-blogspot.com_marketview_20050210075500_ENG_20050210_075500-0001`

> Google has finally had an analyst day -- a chance to present the company's story to the (miniscule number of) people who haven't heard it.

| field | value |
|---|---|
| Target token | `miniscule` |
| Proposed correction | `minuscule` |
| Provider | builtin-typo |
| Rule id | - |
| Correction type | spelling |
| Confidence | 0.9600 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `minuscule` **←tested** | keyboard-substitution | 1 | 0.9018 | 96 | 0.0301 | 0.9319 |
| `miniature` | bucket-similarity | 4 | 0.3060 | 160 | 0.0502 | 0.3562 |
| `ministers` | bucket-similarity | 4 | 0.2780 | 192 | 0.0602 | 0.3382 |
| `minibuses` | bucket-similarity | 4 | 0.2540 | 0 | 0.0000 | 0.2540 |
| `miniskirt` | bucket-similarity | 4 | 0.2500 | 0 | 0.0000 | 0.2500 |
| `minimally` | bucket-similarity | 4 | 0.2380 | 128 | 0.0402 | 0.2782 |
| `minibikes` | bucket-similarity | 4 | 0.2260 | 0 | 0.0000 | 0.2260 |
| `minidress` | bucket-similarity | 4 | 0.2260 | 0 | 0.0000 | 0.2260 |
| `minimizes` | bucket-similarity | 4 | 0.2260 | 128 | 0.0402 | 0.2662 |
| `minefield` | bucket-similarity | 4 | 0.2140 | 0 | 0.0000 | 0.2140 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 4 — `legnth`

**Sentence id:** `weblog-blogspot.com_tacitusproject_20040712123425_ENG_20040712_123425-0001`

> Though I am loathe to quote other writers at legnth in this space, this little bit from Dan Froomkin's "White House Briefing" column in the WashPost today is just too good to pass up (read the whole column here ):

| field | value |
|---|---|
| Target token | `legnth` |
| Proposed correction | `length` |
| Provider | lexicon |
| Rule id | - |
| Correction type | adjacent-swap |
| Confidence | 0.9056 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `length` **←tested** | adjacent-swap | 1 | 0.9056 | 224 | 0.0703 | 0.9759 |
| `legate` | bucket-similarity | 3 | 0.4120 | 96 | 0.0301 | 0.4421 |
| `legato` | bucket-similarity | 3 | 0.4120 | 0 | 0.0000 | 0.4120 |
| `legend` | bucket-similarity | 4 | 0.2520 | 192 | 0.0602 | 0.3122 |
| `legion` | bucket-similarity | 4 | 0.2520 | 160 | 0.0502 | 0.3022 |
| `legman` | bucket-similarity | 4 | 0.2520 | 0 | 0.0000 | 0.2520 |
| `legmen` | bucket-similarity | 4 | 0.2520 | 0 | 0.0000 | 0.2520 |
| `ligate` | bucket-similarity | 4 | 0.2160 | 0 | 0.0000 | 0.2160 |
| `lights` | bucket-similarity | 4 | 0.2160 | 192 | 0.0602 | 0.2762 |
| `legacy` | bucket-similarity | 4 | 0.2100 | 192 | 0.0602 | 0.2702 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 5 — `annoucement`

**Sentence id:** `weblog-typepad.com_ripples_20050410122300_ENG_20050410_122300-0016`

> Following on the heels of Ben's annoucement yesterday, I thought I'd post that I have joined Google as well.

| field | value |
|---|---|
| Target token | `annoucement` |
| Proposed correction | `announcement` |
| Provider | builtin-typo |
| Rule id | - |
| Correction type | spelling |
| Confidence | 0.9600 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `announcement` **←tested** | missing-letter-insertion | 1 | 0.9140 | 192 | 0.0602 | 0.9742 |
| `adjournment` | bucket-similarity | 4 | 0.2722 | 96 | 0.0301 | 0.3023 |
| `advancement` | bucket-similarity | 4 | 0.2722 | 192 | 0.0602 | 0.3324 |
| `announcer's` | bucket-similarity | 4 | 0.2460 | 0 | 0.0000 | 0.2460 |
| `acquirement` | bucket-similarity | 4 | 0.2395 | 0 | 0.0000 | 0.2395 |
| `achievement` | bucket-similarity | 4 | 0.2165 | 224 | 0.0703 | 0.2868 |
| `appointment` | bucket-similarity | 4 | 0.2165 | 192 | 0.0602 | 0.2768 |
| `arrangement` | bucket-similarity | 4 | 0.2165 | 224 | 0.0703 | 0.2868 |
| `annoyance's` | bucket-similarity | 4 | 0.2133 | 0 | 0.0000 | 0.2133 |
| `abandonment` | bucket-similarity | 4 | 0.2067 | 160 | 0.0502 | 0.2569 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 6 — `commment`

**Sentence id:** `weblog-typepad.com_ripples_20050410122300_ENG_20050410_122300-0029`

> Just one small commment - it's not possible, as far as I know, for Google to "Aquire" Firefox.

| field | value |
|---|---|
| Target token | `commment` |
| Proposed correction | `comment` |
| Provider | lexicon |
| Rule id | - |
| Correction type | duplicate-letter |
| Confidence | 0.9212 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `comment` **←tested** | duplicate-letter-removal | 1 | 0.9212 | 224 | 0.0703 | 0.9915 |
| `comments` | bucket-similarity | 4 | 0.3045 | 224 | 0.0703 | 0.3748 |
| `commie's` | bucket-similarity | 4 | 0.2865 | 0 | 0.0000 | 0.2865 |
| `comfiest` | bucket-similarity | 4 | 0.2730 | 0 | 0.0000 | 0.2730 |
| `commence` | bucket-similarity | 4 | 0.2730 | 160 | 0.0502 | 0.3232 |
| `commends` | bucket-similarity | 4 | 0.2730 | 64 | 0.0201 | 0.2931 |
| `commoner` | bucket-similarity | 4 | 0.2730 | 128 | 0.0402 | 0.3132 |
| `communed` | bucket-similarity | 4 | 0.2730 | 128 | 0.0402 | 0.3132 |
| `communes` | bucket-similarity | 4 | 0.2730 | 128 | 0.0402 | 0.3132 |
| `commuted` | bucket-similarity | 4 | 0.2730 | 96 | 0.0301 | 0.3031 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 7 — `Aquire`

**Sentence id:** `weblog-typepad.com_ripples_20050410122300_ENG_20050410_122300-0029`

> Just one small commment - it's not possible, as far as I know, for Google to "Aquire" Firefox.

| field | value |
|---|---|
| Target token | `Aquire` |
| Proposed correction | `Acquire` |
| Provider | builtin-typo |
| Rule id | - |
| Correction type | spelling |
| Confidence | 0.9600 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `acquire` **←tested** | missing-letter-insertion | 1 | 0.9140 | 192 | 0.0602 | 0.9742 |
| `quire` | extra-letter-deletion | 1 | 0.9140 | 0 | 0.0000 | 0.9140 |
| `squire` | keyboard-substitution | 1 | 0.9018 | 160 | 0.0502 | 0.9520 |
| `aquila` | bucket-similarity | 3 | 0.4300 | 64 | 0.0201 | 0.4501 |
| `aquino` | bucket-similarity | 3 | 0.4300 | 96 | 0.0301 | 0.4601 |
| `admire` | bucket-similarity | 3 | 0.3760 | 160 | 0.0502 | 0.4262 |
| `aspire` | bucket-similarity | 3 | 0.3760 | 128 | 0.0402 | 0.4162 |
| `attire` | bucket-similarity | 3 | 0.3760 | 128 | 0.0402 | 0.4162 |
| `abjure` | bucket-similarity | 4 | 0.2160 | 0 | 0.0000 | 0.2160 |
| `adjure` | bucket-similarity | 4 | 0.2160 | 0 | 0.0000 | 0.2160 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 8 — `auhtority`

**Sentence id:** `email-enronsent05_01-0004`

> It is my understanding, from good sources in the Govs office that the Gov will order Loretta Lynch to expeditiously implement the provision to suspend all parties auhtority to enter into direct access contracts.

| field | value |
|---|---|
| Target token | `auhtority` |
| Proposed correction | `authority` |
| Provider | lexicon |
| Rule id | - |
| Correction type | adjacent-swap |
| Confidence | 0.9056 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `authority` **←tested** | adjacent-swap | 1 | 0.9056 | 255 | 0.0800 | 0.9856 |
| `austerity` | bucket-similarity | 3 | 0.4500 | 128 | 0.0402 | 0.4902 |
| `authorial` | bucket-similarity | 4 | 0.2700 | 128 | 0.0402 | 0.3102 |
| `authoring` | bucket-similarity | 4 | 0.2700 | 96 | 0.0301 | 0.3001 |
| `authorize` | bucket-similarity | 4 | 0.2700 | 160 | 0.0502 | 0.3202 |
| `anchorite` | bucket-similarity | 4 | 0.2300 | 0 | 0.0000 | 0.2300 |
| `aphrodite` | bucket-similarity | 4 | 0.2300 | 128 | 0.0402 | 0.2702 |
| `airworthy` | bucket-similarity | 4 | 0.2180 | 0 | 0.0000 | 0.2180 |
| `austerely` | bucket-similarity | 4 | 0.2140 | 96 | 0.0301 | 0.2441 |
| `animosity` | bucket-similarity | 4 | 0.2020 | 128 | 0.0402 | 0.2422 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 9 — `administartion`

**Sentence id:** `email-enronsent05_01-0005`

> The premise with which the administartion is acting is that if they expeditiously suspend everyone's right to bilateral contracts quickly, it sets up a barrier which the direct access coalition must break through.

| field | value |
|---|---|
| Target token | `administartion` |
| Proposed correction | `administration` |
| Provider | lexicon |
| Rule id | - |
| Correction type | adjacent-swap |
| Confidence | 0.9056 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `administration` **←tested** | adjacent-swap | 1 | 0.9056 | 224 | 0.0703 | 0.9759 |
| `administrating` | bucket-similarity | 4 | 0.4029 | 0 | 0.0000 | 0.4029 |
| `administrative` | bucket-similarity | 4 | 0.3849 | 224 | 0.0703 | 0.4551 |
| `administrators` | bucket-similarity | 4 | 0.3591 | 192 | 0.0602 | 0.4194 |
| `antihistamines` | bucket-similarity | 4 | 0.2100 | 96 | 0.0301 | 0.2401 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 10 — `woodrows`

**Sentence id:** `email-enronsent23_14-0007`

> you guys want to watch the game at woodrows tomorrow?

| field | value |
|---|---|
| Target token | `woodrows` |
| Proposed correction | `woodrow's` |
| Provider | lexicon |
| Rule id | - |
| Correction type | missing-apostrophe |
| Confidence | 0.9900 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `woodrow's` **←tested** | apostrophe-insertion | 0.5 | 1.1028 | 0 | 0.0000 | 1.1028 |
| `woodrow` | extra-letter-deletion | 1 | 0.9140 | 128 | 0.0402 | 0.9542 |
| `woodlots` | bucket-similarity | 3 | 0.4630 | 0 | 0.0000 | 0.4630 |
| `wondrous` | bucket-similarity | 3 | 0.4360 | 128 | 0.0402 | 0.4762 |
| `windrows` | bucket-similarity | 3 | 0.4225 | 0 | 0.0000 | 0.4225 |
| `woodwork` | bucket-similarity | 4 | 0.3495 | 96 | 0.0301 | 0.3796 |
| `woodworm` | bucket-similarity | 4 | 0.3495 | 0 | 0.0000 | 0.3495 |
| `woodcock` | bucket-similarity | 4 | 0.2865 | 96 | 0.0301 | 0.3166 |
| `woodcuts` | bucket-similarity | 4 | 0.2865 | 64 | 0.0201 | 0.3066 |
| `woodshop` | bucket-similarity | 4 | 0.2730 | 0 | 0.0000 | 0.2730 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 11 — `appetitie`

**Sentence id:** `email-enronsent23_14-0018`

> i satisfy your appetitie for lovin.

| field | value |
|---|---|
| Target token | `appetitie` |
| Proposed correction | `appetite` |
| Provider | lexicon |
| Rule id | - |
| Correction type | extra-letter |
| Confidence | 0.9140 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `appetite` **←tested** | extra-letter-deletion | 1 | 0.9140 | 160 | 0.0502 | 0.9642 |
| `appetites` | bucket-similarity | 3 | 0.5380 | 128 | 0.0402 | 0.5782 |
| `appetizer` | bucket-similarity | 4 | 0.3580 | 0 | 0.0000 | 0.3580 |
| `appointee` | bucket-similarity | 4 | 0.2820 | 64 | 0.0201 | 0.3021 |
| `appellate` | bucket-similarity | 4 | 0.2660 | 160 | 0.0502 | 0.3162 |
| `appertain` | bucket-similarity | 4 | 0.2660 | 0 | 0.0000 | 0.2660 |
| `appearing` | bucket-similarity | 4 | 0.2440 | 192 | 0.0602 | 0.3042 |
| `apoptotic` | bucket-similarity | 4 | 0.2420 | 64 | 0.0201 | 0.2621 |
| `appendage` | bucket-similarity | 4 | 0.2380 | 96 | 0.0301 | 0.2681 |
| `appointed` | bucket-similarity | 4 | 0.2140 | 224 | 0.0703 | 0.2843 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 12 — `counterparty`

**Sentence id:** `email-enronsent28_03-0005`

> These agreements were forwarded to the counterparty, CCNG, Inc..

| field | value |
|---|---|
| Target token | `counterparty` |
| Proposed correction | `counterpart` |
| Provider | lexicon |
| Rule id | - |
| Correction type | extra-letter |
| Confidence | 0.9140 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `counterpart` **←tested** | extra-letter-deletion | 1 | 0.9140 | 160 | 0.0502 | 0.9642 |
| `counterparts` | bucket-similarity | 2 | 0.6900 | 192 | 0.0602 | 0.7502 |
| `counterpanes` | bucket-similarity | 4 | 0.3900 | 0 | 0.0000 | 0.3900 |
| `counterpoint` | bucket-similarity | 4 | 0.3510 | 128 | 0.0402 | 0.3912 |
| `counterpoise` | bucket-similarity | 4 | 0.3300 | 0 | 0.0000 | 0.3300 |
| `counterfeits` | bucket-similarity | 4 | 0.3210 | 96 | 0.0301 | 0.3511 |
| `counterman's` | bucket-similarity | 4 | 0.3210 | 0 | 0.0000 | 0.3210 |
| `countermands` | bucket-similarity | 4 | 0.3210 | 0 | 0.0000 | 0.3210 |
| `countervails` | bucket-similarity | 4 | 0.3210 | 0 | 0.0000 | 0.3210 |
| `counteracted` | bucket-similarity | 4 | 0.3120 | 96 | 0.0301 | 0.3421 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.

---

## Case 13 — `fisrt`

**Sentence id:** `email-enronsent30_02-0017`

> Raw data is on the fisrt tab of the file to the right.

| field | value |
|---|---|
| Target token | `fisrt` |
| Proposed correction | `first` |
| Provider | lexicon |
| Rule id | - |
| Correction type | adjacent-swap |
| Confidence | 0.9784 |
| Action | autocorrect |
| Correction-risk class | `invalid-word-single-edit` |
| Token in ESDB | **no** |

### Candidate scores

| candidate | operation | cost | baseline score | freq rank | freq contribution | tested score |
|---|---|---:|---:|---:|---:|---:|
| `first` **←tested** | adjacent-swap | 1 | 0.9784 | 255 | 0.0800 | 1.0584 |
| `fist` | extra-letter-deletion | 1 | 0.9140 | 160 | 0.0502 | 0.9642 |
| `fists` | bucket-similarity | 3 | 0.4324 | 160 | 0.0502 | 0.4826 |
| `flirt` | bucket-similarity | 3 | 0.3892 | 96 | 0.0301 | 0.4193 |
| `fishy` | bucket-similarity | 3 | 0.3820 | 64 | 0.0201 | 0.4021 |
| `fiery` | bucket-similarity | 3 | 0.3604 | 160 | 0.0502 | 0.4106 |
| `fight` | bucket-similarity | 3 | 0.3604 | 224 | 0.0703 | 0.4307 |
| `filet` | bucket-similarity | 3 | 0.3604 | 0 | 0.0000 | 0.3604 |
| `fiats` | bucket-similarity | 4 | 0.2388 | 96 | 0.0301 | 0.2689 |
| `fir's` | bucket-similarity | 4 | 0.2388 | 0 | 0.0000 | 0.2388 |

**Why the evaluator counted it:** the engine returned an `autocorrect`
action on text taken unmodified from the corpus, and the evaluator treats
any automatic change to unmodified text as an apparent false positive.


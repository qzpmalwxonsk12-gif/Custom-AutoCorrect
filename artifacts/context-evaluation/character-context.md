# Character-context ground-truth evaluation

Corpus: UD English EWT dev. Cases: 1043. Seed fixed across weights,
so every weight sees an identical corruption set. Production weights are the
shipped ones (`frequency = 0.04`), with only `characterContext` varied, so this
measures the signal in combination with what already ships rather than alone.

## Implementation properties verified

| property | result |
|---|---|
| All 676 letter pairs represented | yes (676/676) |
| Generated reproducibly | yes — `npm run check:chardata` regenerates and compares |
| Runtime decoding lazy | yes — decoded on first score, then cached |
| Score relative to typed token | yes — `plausibility(candidate) - plausibility(typed)` |
| Generates or removes candidates | no |
| Prunes rare candidates | no |
| Can override a cheaper edit | no — operation cost outranks it in the comparator |
| Weight 0 reproduces shipped ranking | yes |
| Appears in ranking diagnostics | yes — non-zero terms are emitted as evidence |
| Appears in shadow observations | yes — listed in `responsibleTerms` |

## Results by weight

| weight | cases | with evidence | winner changes | better | worse | neutral | cost overrides | action changes | avg margin change |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.000 | 1030 | 0 | 0 | **0** | **0** | 0 | 0 | 0 | +0.00000 |
| 0.005 | 1030 | 1030 | 9 | **2** | **4** | 3 | 0 | 0 | +0.00013 |
| 0.010 | 1030 | 1030 | 9 | **2** | **4** | 3 | 0 | 0 | +0.00026 |
| 0.020 | 1030 | 1030 | 14 | **4** | **6** | 4 | 0 | 0 | +0.00048 |
| 0.040 | 1030 | 1030 | 29 | **9** | **12** | 8 | 0 | 0 | +0.00088 |

## By candidate-generation process

| weight | process | better | worse |
|---:|---|---:|---:|
| 0.005 | missing-letter-insertion | 2 | 0 |
| 0.005 | extra-letter-deletion | 0 | 4 |
| 0.010 | missing-letter-insertion | 2 | 0 |
| 0.010 | extra-letter-deletion | 0 | 4 |
| 0.020 | missing-letter-insertion | 2 | 1 |
| 0.020 | extra-letter-deletion | 0 | 5 |
| 0.020 | keyboard-substitution | 1 | 0 |
| 0.020 | adjacent-swap | 1 | 0 |
| 0.040 | extra-letter-deletion | 1 | 11 |
| 0.040 | missing-letter-insertion | 2 | 0 |
| 0.040 | keyboard-substitution | 3 | 1 |
| 0.040 | adjacent-swap | 3 | 0 |

## By corruption kind

| weight | category | better | worse |
|---:|---|---:|---:|
| 0.005 | drop | 2 | 4 |
| 0.010 | drop | 2 | 4 |
| 0.020 | drop | 2 | 5 |
| 0.020 | transpose | 1 | 1 |
| 0.020 | neighbour | 1 | 0 |
| 0.040 | neighbour | 3 | 4 |
| 0.040 | drop | 2 | 6 |
| 0.040 | transpose | 3 | 2 |
| 0.040 | insert | 1 | 0 |

## Common versus uncommon expected words

Common = frequency band ≥ 128. Uncommon valid words are the population most
at risk from a signal that rewards typical letter sequences.

| weight | common better | common worse | uncommon better | uncommon worse |
|---:|---:|---:|---:|---:|
| 0.005 | 2 | 4 | 0 | 0 |
| 0.010 | 2 | 4 | 0 | 0 |
| 0.020 | 4 | 6 | 0 | 0 |
| 0.040 | 9 | 12 | 0 | 0 |

## Regressions in full

### Regressions at weight 0.005

#### 1. `hae` — expected `have`

- Original sentence: `The games will hae to take place on Fri, Sat, or Sun.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00104
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00204 | 1.04445 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00447 | 1.04550 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00224 | 1.01189 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.00294 | 1.00476 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00290 | 0.94702 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.00314 | 0.94725 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00285 | 0.94195 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00324 | 0.94234 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00065 | 0.93342 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00128 | 0.91528 |

#### 2. `hae` — expected `have`

- Original sentence: `Now I hae wife and son.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00104
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00204 | 1.04445 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00447 | 1.04550 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00224 | 1.01189 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.00294 | 1.00476 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00290 | 0.94702 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.00314 | 0.94725 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00285 | 0.94195 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00324 | 0.94234 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00065 | 0.93342 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00128 | 0.91528 |

#### 3. `hve` — expected `have`

- Original sentence: `i want a small indoor pet that my mother will let me hve please help`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00032
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00329 | 1.04571 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00500 | 1.04603 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00322 | 0.93729 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.00293 | 0.93199 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00067 | 0.49976 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.00314 | 0.49722 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00165 | 0.49573 |

#### 4. `hve` — expected `have`

- Original sentence: `Natasha is the BEST photographer we hve ever worked with.`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00032
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00329 | 1.04571 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00500 | 1.04603 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00322 | 0.93729 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.00293 | 0.93199 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00067 | 0.49976 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.00314 | 0.49722 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00165 | 0.49573 |

### Regressions at weight 0.01

#### 1. `hae` — expected `have`

- Original sentence: `The games will hae to take place on Fri, Sat, or Sun.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00348
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00408 | 1.04649 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00894 | 1.04997 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00447 | 1.01413 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.00588 | 1.00770 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00580 | 0.94992 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.00627 | 0.95039 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00570 | 0.94480 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00648 | 0.94558 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00131 | 0.93277 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00256 | 0.91656 |

#### 2. `hae` — expected `have`

- Original sentence: `Now I hae wife and son.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00348
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00408 | 1.04649 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.00894 | 1.04997 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00447 | 1.01413 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.00588 | 1.00770 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00580 | 0.94992 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.00627 | 0.95039 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00570 | 0.94480 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.00648 | 0.94558 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00131 | 0.93277 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00256 | 0.91656 |

#### 3. `hve` — expected `have`

- Original sentence: `i want a small indoor pet that my mother will let me hve please help`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00202
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00659 | 1.04900 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.01000 | 1.05103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00643 | 0.94051 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.00586 | 0.93492 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00133 | 0.50043 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.00627 | 0.50035 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00329 | 0.49737 |

#### 4. `hve` — expected `have`

- Original sentence: `Natasha is the BEST photographer we hve ever worked with.`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00202
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00659 | 1.04900 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.01000 | 1.05103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00643 | 0.94051 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.00586 | 0.93492 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00133 | 0.50043 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.00627 | 0.50035 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00329 | 0.49737 |

### Regressions at weight 0.02

#### 1. `hae` — expected `have`

- Original sentence: `The games will hae to take place on Fri, Sat, or Sun.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00834
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00816 | 1.05057 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.01788 | 1.05891 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00894 | 1.01860 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.01176 | 1.01358 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.01161 | 0.95573 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.01255 | 0.95667 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.01140 | 0.95050 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.01297 | 0.95207 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00261 | 0.93146 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00512 | 0.91912 |

#### 2. `hae` — expected `have`

- Original sentence: `Now I hae wife and son.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00834
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.00816 | 1.05057 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.01788 | 1.05891 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.00894 | 1.01860 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.01176 | 1.01358 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.01161 | 0.95573 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.01255 | 0.95667 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.01140 | 0.95050 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.01297 | 0.95207 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00261 | 0.93146 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00512 | 0.91912 |

#### 3. `hve` — expected `have`

- Original sentence: `i want a small indoor pet that my mother will let me hve please help`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00544
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.01318 | 1.05559 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.02000 | 1.06103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.01286 | 0.94694 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.01171 | 0.94077 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00267 | 0.50176 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.01255 | 0.50663 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00659 | 0.50067 |

#### 4. `hve` — expected `have`

- Original sentence: `Natasha is the BEST photographer we hve ever worked with.`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.00544
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.01318 | 1.05559 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.02000 | 1.06103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.01286 | 0.94694 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.01171 | 0.94077 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00267 | 0.50176 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.01255 | 0.50663 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.00659 | 0.50067 |

#### 5. `baot` — expected `boat`

- Original sentence: `A way I could get there by baot instead of taking another plane ride`
- Corrupted token: `baot`
- Expected word: `boat`
- Production winner: `boat`
- Experimental winner: `bat`
- Production margin: 0.00164
- Experimental margin: 0.00087
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `boat` | 2 | adjacent-swap | 1 | 0.94074 | +0.00617 | 0.94691 |
| `bat` | 6 | extra-letter-deletion | 1 | 0.93910 | +0.00868 | 0.94778 |
| `bot` | 6 | extra-letter-deletion | 1 | 0.93408 | +0.00570 | 0.93978 |
| `bait` | 3 | keyboard-substitution | 1 | 0.92690 | +0.00732 | 0.93422 |
| `bart` | 1 | bucket-similarity | 2 | 0.56308 | +0.00847 | 0.57155 |
| `baht` | 1 | bucket-similarity | 2 | 0.55304 | +0.00042 | 0.55346 |
| `bast` | 1 | bucket-similarity | 2 | 0.55304 | +0.01014 | 0.56318 |
| `boot` | 1 | bucket-similarity | 2 | 0.54110 | +0.00523 | 0.54633 |
| `blot` | 1 | bucket-similarity | 2 | 0.53608 | +0.00575 | 0.54183 |
| `back` | 1 | bucket-similarity | 3 | 0.42414 | +0.00439 | 0.42853 |

#### 6. `ary` — expected `army`

- Original sentence: `The ary is unlikely to forgive or forget; but who provoked it and why?`
- Corrupted token: `ary`
- Expected word: `army`
- Production winner: `army`
- Experimental winner: `mary`
- Production margin: 0.00486
- Experimental margin: 0.00037
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `army` | 5 | missing-letter-insertion | 1 | 0.95400 | -0.00497 | 0.94903 |
| `mary` | 5 | missing-letter-insertion | 1 | 0.94914 | +0.00026 | 0.94940 |
| `ar` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00486 | 0.94898 |
| `gary` | 5 | missing-letter-insertion | 1 | 0.94412 | -0.00110 | 0.94302 |
| `airy` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00329 | 0.93078 |
| `cary` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00005 | 0.93413 |
| `awry` | 5 | missing-letter-insertion | 1 | 0.92906 | -0.01051 | 0.91855 |
| `aery` | 5 | missing-letter-insertion | 1 | 0.91400 | -0.00518 | 0.90882 |
| `arty` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00005 | 0.91405 |
| `nary` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00047 | 0.91447 |

### Regressions at weight 0.04

#### 1. `hae` — expected `have`

- Original sentence: `The games will hae to take place on Fri, Sat, or Sun.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.01806
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.01631 | 1.05873 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.03576 | 1.07679 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.01788 | 1.02754 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.02353 | 1.02535 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.02322 | 0.96733 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.02510 | 0.96922 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.02280 | 0.96190 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.02593 | 0.96503 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00523 | 0.92885 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.01025 | 0.92425 |

#### 2. `hae` — expected `have`

- Original sentence: `Now I hae wife and son.`
- Corrupted token: `hae`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.01806
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.01631 | 1.05873 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.03576 | 1.07679 |
| `had` | 3 | keyboard-substitution | 1 | 1.00966 | +0.01788 | 1.02754 |
| `has` | 3 | keyboard-substitution | 1 | 1.00182 | +0.02353 | 1.02535 |
| `ha` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.02322 | 0.96733 |
| `hate` | 5 | missing-letter-insertion | 1 | 0.94412 | +0.02510 | 0.96922 |
| `hale` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.02280 | 0.96190 |
| `hare` | 5 | missing-letter-insertion | 1 | 0.93910 | +0.02593 | 0.96503 |
| `haze` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00523 | 0.92885 |
| `hake` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.01025 | 0.92425 |

#### 3. `hve` — expected `have`

- Original sentence: `i want a small indoor pet that my mother will let me hve please help`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.01226
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.02635 | 1.06877 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.04000 | 1.08103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.02573 | 0.95980 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.02342 | 0.95248 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00533 | 0.50443 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.02510 | 0.51918 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.01318 | 0.50725 |

#### 4. `hve` — expected `have`

- Original sentence: `Natasha is the BEST photographer we hve ever worked with.`
- Corrupted token: `hve`
- Expected word: `have`
- Production winner: `have`
- Experimental winner: `he`
- Production margin: 0.00139
- Experimental margin: 0.01226
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `have` | 5 | missing-letter-insertion | 1 | 1.04241 | +0.02635 | 1.06877 |
| `he` | 6 | extra-letter-deletion | 1 | 1.04103 | +0.04000 | 1.08103 |
| `hive` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.02573 | 0.95980 |
| `hove` | 5 | missing-letter-insertion | 1 | 0.92906 | +0.02342 | 0.95248 |
| `hue` | 1 | bucket-similarity | 2 | 0.49910 | +0.00533 | 0.50443 |
| `hie` | 1 | bucket-similarity | 2 | 0.49408 | +0.02510 | 0.51918 |
| `hoe` | 1 | bucket-similarity | 2 | 0.49408 | +0.01318 | 0.50725 |

#### 5. `ary` — expected `army`

- Original sentence: `The ary is unlikely to forgive or forget; but who provoked it and why?`
- Corrupted token: `ary`
- Expected word: `army`
- Production winner: `army`
- Experimental winner: `ar`
- Production margin: 0.00486
- Experimental margin: 0.00418
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `army` | 5 | missing-letter-insertion | 1 | 0.95400 | -0.00993 | 0.94407 |
| `mary` | 5 | missing-letter-insertion | 1 | 0.94914 | +0.00052 | 0.94966 |
| `ar` | 6 | extra-letter-deletion | 1 | 0.94412 | +0.00973 | 0.95384 |
| `gary` | 5 | missing-letter-insertion | 1 | 0.94412 | -0.00220 | 0.94192 |
| `airy` | 5 | missing-letter-insertion | 1 | 0.93408 | -0.00659 | 0.92749 |
| `cary` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00010 | 0.93418 |
| `awry` | 5 | missing-letter-insertion | 1 | 0.92906 | -0.02102 | 0.90804 |
| `aery` | 5 | missing-letter-insertion | 1 | 0.91400 | -0.01035 | 0.90365 |
| `arty` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00010 | 0.91410 |
| `nary` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00094 | 0.91494 |

#### 6. `inage` — expected `image`

- Original sentence: `Attached is an inage of the GISB.`
- Corrupted token: `inage`
- Expected word: `image`
- Production winner: `image`
- Experimental winner: `inge`
- Production margin: 0.00788
- Experimental margin: 0.00467
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `image` | 3 | keyboard-substitution | 1 | 0.93694 | -0.00675 | 0.93019 |
| `inge` | 6 | extra-letter-deletion | 1 | 0.92906 | +0.00580 | 0.93486 |
| `linage` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00003 | 0.91403 |
| `inane` | 3 | keyboard-substitution | 1 | 0.88240 | +0.00831 | 0.89072 |
| `ina's` | 1 | bucket-similarity | 3 | 0.38200 | +0.00790 | 0.38990 |
| `inapt` | 1 | bucket-similarity | 3 | 0.38200 | -0.00408 | 0.37792 |
| `indie` | 1 | bucket-similarity | 3 | 0.37044 | +0.00439 | 0.37483 |
| `inure` | 1 | bucket-similarity | 3 | 0.36040 | +0.00078 | 0.36118 |
| `imago` | 1 | bucket-similarity | 3 | 0.35386 | -0.00847 | 0.34539 |
| `irate` | 1 | bucket-similarity | 3 | 0.35386 | +0.00298 | 0.35684 |

#### 7. `baot` — expected `boat`

- Original sentence: `A way I could get there by baot instead of taking another plane ride`
- Corrupted token: `baot`
- Expected word: `boat`
- Production winner: `boat`
- Experimental winner: `bat`
- Production margin: 0.00164
- Experimental margin: 0.00338
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `boat` | 2 | adjacent-swap | 1 | 0.94074 | +0.01234 | 0.95308 |
| `bat` | 6 | extra-letter-deletion | 1 | 0.93910 | +0.01736 | 0.95646 |
| `bot` | 6 | extra-letter-deletion | 1 | 0.93408 | +0.01140 | 0.94548 |
| `bait` | 3 | keyboard-substitution | 1 | 0.92690 | +0.01464 | 0.94154 |
| `bart` | 1 | bucket-similarity | 2 | 0.56308 | +0.01694 | 0.58002 |
| `baht` | 1 | bucket-similarity | 2 | 0.55304 | +0.00084 | 0.55388 |
| `bast` | 1 | bucket-similarity | 2 | 0.55304 | +0.02029 | 0.57333 |
| `boot` | 1 | bucket-similarity | 2 | 0.54110 | +0.01046 | 0.55156 |
| `blot` | 1 | bucket-similarity | 2 | 0.53608 | +0.01150 | 0.54758 |
| `back` | 1 | bucket-similarity | 3 | 0.42414 | +0.00878 | 0.43293 |

#### 8. `tild` — expected `told`

- Original sentence: `Shojai tild the opening ceremony of the month-long fair in Tehran's Palestine Contemporary Art Museum.`
- Corrupted token: `tild`
- Expected word: `told`
- Production winner: `told`
- Experimental winner: `til`
- Production margin: 0.00270
- Experimental margin: 0.00200
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `told` | 3 | keyboard-substitution | 1 | 0.94180 | -0.00063 | 0.94117 |
| `til` | 6 | extra-letter-deletion | 1 | 0.93910 | +0.00408 | 0.94318 |
| `tiled` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00612 | 0.94020 |
| `tile` | 3 | keyboard-substitution | 1 | 0.92577 | +0.00460 | 0.93037 |
| `tilde` | 5 | missing-letter-insertion | 1 | 0.91400 | +0.00094 | 0.91494 |
| `gild` | 3 | keyboard-substitution | 1 | 0.90067 | -0.00732 | 0.89335 |
| `till` | 1 | bucket-similarity | 2 | 0.60514 | +0.00356 | 0.60869 |
| `tilt` | 1 | bucket-similarity | 2 | 0.59510 | -0.00167 | 0.59342 |
| `tied` | 1 | bucket-similarity | 2 | 0.57312 | +0.00481 | 0.57793 |
| `time` | 1 | bucket-similarity | 3 | 0.42930 | +0.00188 | 0.43118 |

#### 9. `biok` — expected `book`

- Original sentence: `"The biok -- I guess one way, one thing to think about it is -- one of the themes would be, I was given a charge to keep.`
- Corrupted token: `biok`
- Expected word: `book`
- Production winner: `book`
- Experimental winner: `bio`
- Production margin: 0.00270
- Experimental margin: 0.00159
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `book` | 3 | keyboard-substitution | 1 | 0.94180 | -0.00021 | 0.94159 |
| `bio` | 6 | extra-letter-deletion | 1 | 0.93910 | +0.00408 | 0.94318 |
| `biol` | 3 | keyboard-substitution | 1 | 0.93192 | +0.00565 | 0.93756 |
| `bioko` | 5 | missing-letter-insertion | 1 | 0.91400 | -0.00408 | 0.90992 |
| `biko` | 2 | adjacent-swap | 1 | 0.90560 | -0.01129 | 0.89431 |
| `bilk` | 3 | keyboard-substitution | 1 | 0.90067 | -0.00502 | 0.89565 |
| `bios` | 1 | bucket-similarity | 2 | 0.58506 | +0.00565 | 0.59071 |
| `biog` | 1 | bucket-similarity | 2 | 0.57000 | +0.00084 | 0.57084 |
| `bike` | 1 | bucket-similarity | 3 | 0.39810 | -0.00397 | 0.39412 |
| `biro` | 1 | bucket-similarity | 3 | 0.37300 | +0.00648 | 0.37948 |

#### 10. `sote` — expected `site`

- Original sentence: `I heard the libido band play live and they are out of sote!!`
- Corrupted token: `sote`
- Expected word: `site`
- Production winner: `site`
- Experimental winner: `ste`
- Production margin: 0.00286
- Experimental margin: 0.00122
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `site` | 3 | keyboard-substitution | 1 | 0.93694 | +0.00293 | 0.93987 |
| `ste` | 6 | extra-letter-deletion | 1 | 0.93408 | +0.00701 | 0.94108 |
| `sore` | 3 | keyboard-substitution | 1 | 0.92690 | +0.00502 | 0.93192 |
| `smote` | 5 | missing-letter-insertion | 1 | 0.92404 | -0.00680 | 0.91724 |
| `sot` | 6 | extra-letter-deletion | 1 | 0.92404 | -0.00272 | 0.92132 |
| `dote` | 3 | keyboard-substitution | 1 | 0.90180 | -0.00251 | 0.89929 |
| `sots` | 3 | keyboard-substitution | 1 | 0.89765 | -0.00335 | 0.89431 |
| `cote` | 3 | keyboard-substitution | 1 | 0.89244 | +0.00042 | 0.89286 |
| `some` | 1 | bucket-similarity | 2 | 0.66011 | -0.00167 | 0.65844 |
| `soto` | 1 | bucket-similarity | 2 | 0.59008 | +0.00042 | 0.59050 |

#### 11. `opear` — expected `opera`

- Original sentence: `I like Hayes Street Grill....another plus, it's right by Civic Center, so you can take a romantic walk around the opear House, City Hall, Symphony Auditorium...all very beautiful.`
- Corrupted token: `opear`
- Expected word: `opera`
- Production winner: `opera`
- Experimental winner: `pear`
- Production margin: 0.00164
- Experimental margin: 0.00113
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `opera` | 2 | adjacent-swap | 1 | 0.93572 | +0.00047 | 0.93619 |
| `pear` | 6 | extra-letter-deletion | 1 | 0.93408 | +0.00324 | 0.93732 |
| `opens` | 1 | bucket-similarity | 3 | 0.45947 | -0.00173 | 0.45774 |
| `oprah` | 1 | bucket-similarity | 3 | 0.42084 | -0.01098 | 0.40986 |
| `ocean` | 1 | bucket-similarity | 3 | 0.37394 | +0.00125 | 0.37519 |
| `oscar` | 1 | bucket-similarity | 3 | 0.36390 | -0.00282 | 0.36107 |
| `oneal` | 1 | bucket-similarity | 3 | 0.33880 | +0.00659 | 0.34539 |

#### 12. `alo` — expected `also`

- Original sentence: `He alo had bright blue eyes like Frank Sinatra did :)`
- Corrupted token: `alo`
- Expected word: `also`
- Production winner: `also`
- Experimental winner: `all`
- Production margin: 0.00461
- Experimental margin: 0.00052
- Risk class: `invalid-word-single-edit`
- Action: `suggest` → `suggest`

| candidate | process | operation | op cost | base score | characterContext | final score |
|---|---:|---|---:|---:|---:|---:|
| `also` | 5 | missing-letter-insertion | 1 | 1.02834 | -0.00230 | 1.02604 |
| `all` | 3 | keyboard-substitution | 1 | 1.02373 | +0.00282 | 1.02656 |
| `al` | 6 | extra-letter-deletion | 1 | 0.95400 | +0.00565 | 0.95965 |
| `lo` | 6 | extra-letter-deletion | 1 | 0.94412 | -0.00565 | 0.93847 |
| `alto` | 5 | missing-letter-insertion | 1 | 0.93910 | -0.00063 | 0.93847 |
| `halo` | 5 | missing-letter-insertion | 1 | 0.93408 | +0.00167 | 0.93575 |
| `aldo` | 5 | missing-letter-insertion | 1 | 0.92906 | -0.00418 | 0.92488 |
| `aloe` | 5 | missing-letter-insertion | 1 | 0.92404 | -0.00920 | 0.91484 |
| `aol` | 2 | adjacent-swap | 1 | 0.92066 | -0.02478 | 0.89587 |
| `alpo` | 5 | missing-letter-insertion | 1 | 0.91400 | -0.01025 | 0.90375 |


## Verdict

Across active weights: **17 better, 26 worse**. This is not a clearly favourable ratio, so the production weight stays **0**. The signal remains implemented, tested and available in shadow mode; it is switched off because the measurement did not support it, not because it is unfinished.

# Word-frequency source

## What this is

`en_common.txt` is a ranked list of English words, most frequent first, one word
per line. `scripts/generate-frequency.mjs` turns it into the compact banded
table the engine loads.

## Provenance

| Field | Value |
|---|---|
| Name | `top_english_words_lower_50000.txt` |
| Repository | https://github.com/david47k/top-english-wordlists |
| Compiler | david47k |
| Underlying corpus | Google Books English Ngram corpus |
| Corpus-derived | **Yes** |
| Entries | 50,000 |
| Source SHA-256 | `F9920C664B06B1CE3E94F2A355E11729774329F5838C623CC68E73EBAA374E1B` |

The ranking is measured, not estimated. `FREQUENCY_METADATA.corpusDerived` is
`true` and a test asserts it, along with the exact source hash above — so a
silent substitution of the dataset fails the build rather than quietly changing
how the engine ranks words.

### Two hashes, deliberately distinct

| Field | Covers |
|---|---|
| `sourceSha256` | the source list exactly as downloaded |
| `generatedSha256` | this generator's emitted `frequency-data.ts` |

They answer different questions — "is this the dataset that was reviewed?" and
"is the committed output actually built from it?" — so they are never collapsed
into one ambiguous `sha256`.

## Complete accounting

Every one of the 50,000 source lines lands in exactly one bucket, and the
generator fails if they do not sum:

| Bucket | Count |
|---|---:|
| Accepted (present in ESDB) | 40,459 |
| Absent from ESDB | 8,736 |
| Duplicates | 0 |
| Normalisation collisions | 0 |
| Invalid or filtered | 805 |
| **Total** | **50,000** |

The 805 filtered entries are all abbreviations carrying a trailing full stop —
`p.`, `j.`, `a.`, `m.`, `pp.`, `c.` — which the word-format rule
(`^[a-z]+(?:'[a-z]+)*$`) rejects. They are genuinely not words for a spelling
engine's purposes, so filtering is correct; what was wrong was doing it silently.

The 8,736 absent from ESDB are mostly proper nouns, inflections outside the
size-60 inclusion level, and non-US spellings. They are dropped because a
frequency rank for a word the dictionary cannot produce as a candidate has
nothing to rank.

## Banding

Rank is quantised to one byte across seven bands, sized by share of the ranked
list. Corpus rank is Zipf-distributed: the gap between rank 30,000 and 31,000 is
meaningless, while the gap between rank 10 and rank 1,000 is enormous. Banding
puts the resolution where the information is, and makes a corpus update move
scores in visible steps rather than by amounts too small to evaluate.

## Replacing the dataset

1. Replace `en_common.txt` with the new ranked list, most frequent first.
   A `word<TAB>count` form is accepted without editing.
2. Update the provenance table above, including the new SHA-256.
3. Update the hash assertion in `tests/unit/context-ranking.test.ts`.
4. Run `npm run generate:frequency`, then `npm run check`.

`npm run check` runs the generator in `--check` mode, so a stale generated file
fails the build.

## Licence

The upstream repository states its terms at
https://github.com/david47k/top-english-wordlists. The underlying Google Books
Ngram data is published by Google under Creative Commons Attribution 3.0.

**Before shipping publicly**, confirm the upstream licence permits
redistribution in a browser extension and record the outcome here. The data is
currently bundled for development on that basis and this note exists so the
question is not forgotten.

# ESDB dictionary

Personal Autocorrect bundles the American English `en_US.txt` word list from
the English Speller Database (ESDB), release **2026.02.25**. The default
`en_US` list is generated from SCOWL at **size 60**. “Size 60” is the SCOWL
inclusion level; it is not a claim that the file contains exactly 60,000 words.
The exact generated count and source digest live in
`src/engine/data/dictionary-metadata.ts`.

For the checked-in release input, the generator reads 109,902 entries and emits
107,901 unique lower-case words (2,001 duplicates removed), including 18,761
apostrophe forms. These are metadata values, not estimates.

Sources:

* [ESDB 2026.02.25 release](https://sourceforge.net/projects/wordlist/files/speller/2026.02.25/wordlist-en_US-2026.02.25.zip/download)
* [SCOWL/ESDB dictionary creator](https://app.aspell.net/create)
* [Release word-list diff](https://github.com/en-wl/wordlist-diff/blob/rel-2026.02.25/en_US.txt)

Only `en_US.txt` is used. The `en_US-large`/SCOWL size-70 list is not included,
and the extension never downloads dictionary data at runtime.

## Build-time processing

The checked-in source list is an input, not a runtime asset. Before bundling,
the generator:

1. decodes the source as UTF-8 and normalises line endings;
2. trims lines and removes empty entries;
3. normalises words to lowercase and canonicalises Unicode apostrophes;
4. keeps valid internal apostrophes so contractions remain dictionary words;
5. removes duplicates;
6. sorts the result deterministically; and
7. writes `dictionary-data.ts` and `dictionary-metadata.ts`.

Generation fails on a missing, empty or malformed source. Sorting makes the
output deterministic, and the check command rejects missing or stale generated
files. There is no small-dictionary fallback: a broken dictionary is a build
error.

At runtime the generated data is used to construct one dictionary singleton per
JavaScript realm:

```ts
dictionary.words.has(word)
dictionary.byLengthAndFirstLetter.get(length)?.get(firstLetter)
```

The `Set` and the length/first-letter buckets are built once when the module is
evaluated, not once per word or keystroke. Chrome frames and an MV3 worker do
not share a heap, so each active realm pays that one-time construction cost.

## What the source does not contain

`en_US.txt` is a spelling list, not a frequency corpus. Its alphabetical order
is never treated as popularity. The engine keeps the legacy compact common-word
prior inside its base score, and unified ranking also uses a separately bundled
corpus-derived source (`top_english_words_lower_50000.txt`) filtered to 40,459
dictionary words and quantised into seven bands. That term is active at weight
`0.04`; personal pair/context evidence may then make a bounded local
adjustment. Its source counts and hashes live in
`src/engine/data/frequency-metadata.ts`.

The frequency source is not part of ESDB and does not inherit the SCOWL notice
below. Its checked-in provenance and the upstream redistribution question are
recorded in [`vendor/frequency/README.md`](../vendor/frequency/README.md).
That file explicitly says the upstream licence still needs confirmation before
public distribution; this document does not claim otherwise.

The plain text list also does not carry Hunspell flags such as `NOSUGGEST`.
Candidate limits, ambiguity margins and conservative thresholds remain
important even with a much larger vocabulary. Product names, new terminology
and other proper nouns can still be absent; users can add them to the personal
dictionary.

## Benchmark methodology

Run:

```bash
npm run benchmark
```

The benchmark uses deterministic input sets and reports dictionary membership,
adjacent-swap generation and complete `analyze()` latency after a warm-up,
including busy dictionary buckets and a 5 MiB single-field workload. Cold
module import plus `Set`/bucket-index construction is reported separately and
is excluded from hot-path percentiles. `--enforce` checks lookup, swap and
typical targets at p95, and the `<30 ms` busy/long-field target at p99. The raw
maximum remains visible but is not a stable gate because OS scheduling and
garbage collection can pause the process. Timings describe that machine and
Node/V8 runtime, not every Chrome device.

## Copyright and permission notice

The word list is derived from SCOWL and retains its source notice:

> Copyright 2000-2026 by Kevin Atkinson
>
> Permission to use, copy, modify, distribute, and sell any part of SCOWLv2, or
> word lists created from it, is hereby granted without fee, provided that the
> above copyright notice appears in all copies and that both the above copyright
> notice and this notice appear in supporting documentation. Kevin Atkinson
> makes no representations about the suitability of this database for any
> purpose. It is provided “as is” without express or implied warranty.

The extension source itself remains MIT-licensed. That project licence does not
replace the attribution above for the bundled word data. Production builds copy
the upstream notice to `dist/licenses/ESDB-README.txt`, so the attribution
travels with the unpacked extension as well as the source repository.

# Performance evidence

Review date: 2026-07-28  
Environment: Windows x64, Node v24.17.0  
Measurement point: current workspace after the review changes

All measurements below are local. No network service or model is involved.
Times are observations from this machine, not universal Chrome guarantees.

## 1. Commands and outcomes

| Command | Outcome |
|---|---|
| `npm.cmd run benchmark:enforce` | Passed all five enforced runtime budgets |
| `npm.cmd run test:harper` | Passed 6/6 real-WASM conformance tests |
| `npm.cmd run build` | Passed |
| `npm.cmd run check:bundle` | Passed all bundle ceilings |

The benchmark and Harper commands could not traverse the repository from the
restricted filesystem sandbox, so their successful runs were repeated with
filesystem approval. Neither command used the network.

## 2. Enforced deterministic benchmark

The benchmark uses fixed inputs, warms each operation before sampling, and
reports milliseconds per operation. Sub-millisecond operations are timed in
batches. The enforcement statistic is p95 for the common operations and p99 for
the two adverse workloads.

| Workload | Samples × ops/sample | Median | p95 | p99 | Maximum | Enforced limit | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Dictionary `Set.has` | 240 × 1,000 | 0.0003 ms | 0.0004 | 0.0006 | 0.0013 | p95 `< 1 ms` | Pass |
| Process 2 adjacent swap | 220 × 200 | 0.0055 ms | 0.0107 | 0.0129 | 0.0165 | p95 `< 1 ms` | Pass |
| Full correction, typical words | 180 × 10 | 1.090 ms | 1.523 | 1.723 | 1.910 | p95 `< 15 ms` | Pass |
| Full correction, busiest buckets | 240 × 1 | 5.504 ms | 7.140 | 7.935 | 8.045 | p99 `< 30 ms` | Pass |
| Full correction, 5 MiB field | 120 × 1 | 11.198 ms | 15.316 | 15.937 | 16.858 | p99 `< 30 ms` | Pass |

The enforced values consume approximately 0.04%, 1.07%, 10.15%, 26.45%, and
53.12% of their respective ceilings. The 5 MiB case is the closest to its
ceiling, but still has 14.063 ms of p99 headroom in this run.

The deliberately busy buckets were:

| Length / first letter | Bucket words | Synthetic unknown input |
|---|---:|---|
| 8 / s | 2,150 | `smirkinq` |
| 7 / s | 1,852 | `sluggeq` |
| 9 / s | 1,848 | `snookereq` |
| 9 / c | 1,566 | `cockinesq` |
| 7 / c | 1,408 | `clockeq` |
| 10 / s | 1,392 | `sobriquetq` |

## 3. Expanded stress microbenchmarks

The same deterministic harness now measures the remaining requested hot paths.
These are informational observations rather than CI timing gates: fixed
percentile ceilings on every sub-millisecond operation would be unnecessarily
flaky. Each row still uses warm-up, independent timed samples, and reports
milliseconds per operation.

| Workload | Samples × ops/sample | Median | p95 | p99 | Maximum |
|---|---:|---:|---:|---:|---:|
| Process 1 same-length bucket (largest bucket) | 160 × 1 | 5.868 | 6.768 | 7.263 | 8.831 |
| Process 3 keyboard neighbour | 180 × 50 | 0.0150 | 0.0254 | 0.0336 | 0.0533 |
| Process 4 duplicate letter | 180 × 100 | 0.0038 | 0.0067 | 0.0101 | 0.0127 |
| Process 5 missing-letter insertion | 160 × 20 | 0.0926 | 0.1195 | 0.1362 | 0.1563 |
| Process 6 extra-letter deletion | 180 × 100 | 0.0056 | 0.0086 | 0.0110 | 0.0122 |
| Process 7 apostrophe insertion | 180 × 100 | 0.0050 | 0.0074 | 0.0114 | 0.0206 |
| Complete candidate generation | 160 × 1 | 0.9218 | 2.752 | 3.395 | 3.398 |
| Single-token split | 180 × 100 | 0.0133 | 0.0184 | 0.0244 | 0.0298 |
| Two-token merge | 180 × 100 | 0.0068 | 0.0090 | 0.0124 | 0.0128 |
| Frequency lookup | 220 × 1,000 | 0.0003 | 0.0006 | 0.0009 | 0.0010 |
| Context construction | 180 × 50 | 0.0483 | 0.0665 | 0.0847 | 0.1203 |
| Candidate ranking | 180 × 100 | 0.0073 | 0.0127 | 0.0167 | 0.0191 |
| Shadow ranking comparison | 180 × 100 | 0.0503 | 0.0695 | 0.0784 | 0.0848 |
| Sentence punctuation | 100 × 1 | 0.1217 | 0.2927 | 0.5354 | 0.5694 |
| Paragraph punctuation | 80 × 1 | 0.4352 | 0.9567 | 1.337 | 1.337 |
| 4,000-character punctuation | 40 × 1 | 4.424 | 6.112 | 6.671 | 6.671 |
| Cached punctuation | 200 × 100 | 0.0052 | 0.0085 | 0.0109 | 0.0154 |
| Anchor plus history-record creation | 180 × 100 | 0.0066 | 0.0099 | 0.0148 | 0.0160 |
| Verified revert planning | 180 × 100 | 0.0034 | 0.0054 | 0.0097 | 0.0103 |

Process 1 deliberately uses the largest indexed bucket (`8/s`, 2,150 words);
it is not a typical token. The punctuation timings include a fresh provider for
each uncached operation. The cached row primes one provider first. History
creation includes anchor construction and record allocation; revert planning
includes locator verification but not a DOM mutation.

## 4. Baseline-to-current comparison

The baseline is the earlier same-day, same-runtime measurement recorded in
`artifacts/codex-review/CODEBASE-MAP.md`. Small timing changes, especially in
sub-millisecond cases, are subject to normal process and machine noise; this
table does not attribute causality to a code change.

| Enforced statistic | Baseline | Current | Absolute change |
|---|---:|---:|---:|
| Dictionary lookup p95 | 0.0004 ms | 0.0004 ms | 0.0000 ms |
| Adjacent swap p95 | 0.0068 ms | 0.0107 ms | +0.0039 ms |
| Typical correction p95 | 1.135 ms | 1.523 ms | +0.388 ms |
| Busiest-bucket correction p99 | 5.878 ms | 7.935 ms | +2.057 ms |
| 5 MiB field correction p99 | 6.772 ms | 15.937 ms | +9.165 ms |

All baseline and current values are below the same enforced ceilings.

## 5. Dictionary and index costs

The generated ESDB size-60 dictionary is unchanged and reproducible:

| Property | Current value |
|---|---:|
| Input entries | 109,902 |
| Unique normalized words | 107,901 |
| Duplicates removed | 2,001 |
| Apostrophe-bearing words | 18,761 |
| Length range | 1-23 |
| Length/first-letter buckets | 476 |
| Generated TypeScript data | 1,559,068 bytes (1,522.5 KiB) |
| Content hash | `d2541bde8309b85c1b2821ed23e1c74ab5c63699542994bd64eb64818c0049c2` |

`dictionary.ts` builds the normalized `Set` and the
`Map<number, Map<string, string[]>>` bucket index once at module evaluation. It
does not rebuild either structure per keystroke. The benchmark measured:

| One-time operation | Current time |
|---|---:|
| Benchmark-only bundle preparation | 280.035 ms |
| Cold dictionary import plus `Set`/bucket initialization | 174.995 ms |
| Full engine module import and initialization | 178.845 ms |

Bundle preparation is explicitly excluded from every hot-path result. The two
module-import figures come from different imports/process conditions and should
not be subtracted from or ranked against each other.

The serialized bundle contains the word array, not a second serialized bucket
index. The bucket arrays and `Set` are runtime allocations. This harness records
their combined initialization time but does not measure their retained heap
size, so no memory number is claimed here.

The frequency table contains 40,459 words in seven packed bands. Its generated
source is 353,404 bytes (345.1 KiB), and it is converted lazily into a
`Map<string, number>`. Benchmark warm-up absorbs that first-use conversion; the
current benchmark does not report cold first-correction latency for the
frequency map.

## 6. Harper WASM observations

The opt-in Harper suite uses the real bundled WASM build through Harper's
inlined Node loader. The extension uses the URL loader, so this is engine
evidence rather than an exact service-worker startup measurement.

| Measurement | Earlier same-day run | Current run |
|---|---:|---:|
| WASM/linter setup | about 2.5 s | 2.791 s |
| First representative lint | about 65 ms | 60 ms |
| One lint of a paragraph repeated 3x | about 17 ms | 16 ms |
| Conformance result | 6/6 passed | 6/6 passed |

The test contains generous sanity ceilings of 60 seconds for setup and 10
seconds for the repeated-paragraph lint. These are not product latency targets.
The measured setup cost supports the existing lazy background initialization:
Harper is not part of the synchronous typing benchmark.

## 7. What this evidence does and does not cover

Covered:

- deterministic dictionary lookup;
- all seven candidate processes and complete candidate generation;
- token merge/split, frequency lookup, context construction, ranking, and
  shadow comparison;
- typical end-to-end word decisions;
- the largest same-length/first-letter buckets;
- a decision at the end of a 5 MiB field;
- uncached/cached punctuation, history-record creation, and revert planning;
- real local Harper setup and linting.

Not covered by `benchmark:enforce`:

- DOM projection and mutation in a real Chrome contenteditable;
- controller-driven whole-document/deep-scan throughput;
- storage and extension-message latency;
- service-worker eviction and URL-based Harper startup;
- retained heap for the dictionary, bucket arrays, or frequency map;
- cold first-use construction of the frequency map.

The defensible conclusion is narrow: every currently enforced word-engine
runtime threshold passes with substantial headroom on this machine. The cold
dictionary/index initialization is visible but one-time, while Harper setup is
the dominant measured cold-start operation and is intentionally lazy.

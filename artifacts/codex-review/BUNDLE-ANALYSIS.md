# Bundle analysis

Review date: 2026-07-28  
Build: production minification, Chrome 116 target, no source maps  
Measurement point: fresh `npm.cmd run build` followed by
`npm.cmd run check:bundle`

The bundle checker divides bytes by 1,024 but labels the result `kB`. This
report calls those values KiB so the arithmetic is explicit. All size numbers
are unpacked/raw sizes, not gzip or CRX download sizes.

## 1. Enforced budgets

| Budget group | Baseline | Current | Ceiling | Current use | Headroom | Result |
|---|---:|---:|---:|---:|---:|---|
| Content script JS | 1,742.8 KiB | 1,746.2 KiB | 1,800 KiB | 97% | 53.8 KiB | Pass |
| Service worker JS | 1,437.6 KiB | 1,437.6 KiB | 1,800 KiB | 80% | 362.4 KiB | Pass |
| Panel, popup, options, diagnostics | 1,800.8 KiB | 1,800.9 KiB | 2,100 KiB | 86% | 299.1 KiB | Pass |
| Harper WASM | 17,803.9 KiB | 17,803.9 KiB | 20,000 KiB | 89% | 2,196.1 KiB | Pass |
| AI model assets | 0.0 KiB | 0.0 KiB | 20,000 KiB | 0% | 20,000 KiB | Pass |
| Total unpacked | 22,805.1 KiB | 22,808.6 KiB | 46,000 KiB | 50% | 23,191.4 KiB | Pass |

The baseline is the pre-review measurement in `CODEBASE-MAP.md`. The changes
are content +3.4 KiB, grouped UI +0.1 KiB, and total +3.5 KiB at the displayed
precision. The dictionary hash is unchanged, so these are code/build-output
differences rather than dictionary drift.

The content script is the tightest budget even though the total package is only
half of its ceiling: it has 53.8 KiB of local headroom because it is parsed in
the page/content-script environment.

## 2. Exact unpacked composition

The fresh `dist/` contains 23,356,023 bytes:

| Asset class | Bytes | KiB | Share of total |
|---|---:|---:|---:|
| Harper WASM | 18,231,217 | 17,803.9 | 78.06% |
| JavaScript | 5,050,193 | 4,931.8 | 21.62% |
| HTML, CSS, icons, manifest, licences | 74,613 | 72.9 | 0.32% |
| **Total** | **23,356,023** | **22,808.6** | **100%** |

Directory/output composition:

| Output group | Bytes | KiB | Share |
|---|---:|---:|---:|
| `vendor/` | 18,231,217 | 17,803.9 | 78.06% |
| `content/` | 1,788,071 | 1,746.2 | 7.66% |
| `diagnostics/` | 1,717,897 | 1,677.6 | 7.36% |
| `background/` | 1,472,084 | 1,437.6 | 6.30% |
| `options/` | 58,022 | 56.7 | 0.25% |
| `side-panel/` | 45,270 | 44.2 | 0.19% |
| `popup/` | 22,938 | 22.4 | 0.10% |
| licences, icons, manifest | 20,524 | 20.0 | 0.09% |

Largest JavaScript outputs:

| Output | Bytes | KiB |
|---|---:|---:|
| `content/content-script.js` | 1,788,071 | 1,746.2 |
| `diagnostics/self-test.js` | 1,697,858 | 1,658.1 |
| `background/service-worker.js` | 1,472,084 | 1,437.6 |
| `side-panel/side-panel.js` | 32,573 | 31.8 |
| `options/options.js` | 31,244 | 30.5 |
| `popup/popup.js` | 16,059 | 15.7 |
| `diagnostics/diagnostics.js` | 12,304 | 12.0 |

The grouped UI budget is dominated by `diagnostics/self-test.js`: that one file
is 92.1% of the grouped UI bytes. It intentionally runs the real correction
engine and is linked from advanced options, so its payload is functional rather
than an orphaned build artifact.

## 3. Source contribution by output

A read-only esbuild metafile run used the same target, format, minification,
defines, and per-entry bundling as `scripts/build.mjs`. The large generated
payloads account for nearly all JavaScript:

| Entry output | Output bytes in attribution run | Dictionary data | Frequency data | Other leading contribution |
|---|---:|---:|---:|---|
| Content script | 1,788,071 | 1,235,202 (69.1%) | 352,754 (19.7%) | `editable-controller.ts`: 48,733 |
| Diagnostics self-test | 1,697,858 | 1,235,202 (72.7%) | 352,754 (20.8%) | correction engine: 7,208 |
| Service worker | 1,472,084 | 1,235,202 (83.9%) | 0 | Harper JS glue: 155,124 (10.5%) |
| Side panel | 32,573 | 0 | 0 | side-panel modules: 23,936 |
| Options | 31,244 | 0 | 0 | options modules: 20,920 |
| Popup | 16,059 | 0 | 0 | popup module: 5,762 |
| Diagnostics page | 12,304 | 0 | 0 | diagnostics module: 3,659 |

The attribution run exactly matched all seven production JavaScript output
sizes. A post-build timestamp check also found no source file newer than the
content bundle, so the composition and budget tables describe the same source
snapshot.

The service worker includes the full dictionary through a concrete import
chain: `message-router.ts` imports `personal-learning.ts`,
`personal-learning.ts` imports `data/lexicon.ts`, and `lexicon.ts` imports
`dictionary.ts`. This is why the service worker is dictionary-sized even though
its direct diagnostics import only requests dictionary metadata.

## 4. Duplication and shared payloads

The build invokes esbuild separately for every entry point and emits no shared
chunks. That produces these measured repetitions:

### Dictionary data

`dictionary-data.ts` contributes exactly 1,235,202 minified bytes to each of:

- the content script;
- diagnostics self-test;
- service worker.

The three emitted copies total 3,705,606 bytes (3,618.8 KiB), or about 73.4% of
all shipped JavaScript and 15.9% of the whole unpacked extension. Two copies
beyond a single canonical copy account for 2,470,404 bytes (2,412.5 KiB).
Those bytes are a measured duplication count, not an immediately claimable
saving: content-script isolation, MV3 background loading, and the standalone
self-test entry impose different runtime boundaries.

### Frequency data

`frequency-data.ts` contributes 352,754 bytes to both the content script and
self-test, for 705,508 emitted bytes. The table contains 40,459 words that are
also members of the 107,901-word dictionary, so there are two forms of
duplication:

1. the frequency payload is emitted in two entry bundles;
2. its packed word strings repeat dictionary spellings inside each bundle.

Encoding frequency bands by stable dictionary position is already identified
in `scripts/check-bundle-size.mjs` as a possible redesign. No saving is claimed
without implementing and measuring the required word-to-index/runtime changes.

The current production frequency weight is `0.04` in
`src/engine/context/score-weights.ts`. Comments in `frequency.ts` and
`check-bundle-size.mjs` that still describe the weight as zero are stale and
should not be used as evidence of current runtime behavior.

### Smaller shared modules

`shared/rules.ts`, profiles, settings types, and message helpers are repeated
across the independently built UI entries. Their measured contributions are
tens of kilobytes in aggregate, not megabytes. UI code splitting could only
address those ESM entries; it would not by itself share code with the IIFE
content script.

## 5. Load boundaries and practical pressure points

- The content script contains dictionary and frequency data and is the output
  nearest its ceiling: 97%.
- The service worker contains a third dictionary copy plus Harper's JavaScript
  glue. The 17.8 MiB WASM remains a separate asset loaded by the Harper host.
- The self-test contains a second full word engine and accounts for nearly the
  entire grouped UI budget.
- Harper WASM alone is 78.06% of the extension. It is also at 89% of its
  dedicated ceiling, while the total package is at 50% of its much larger
  ceiling.
- No AI/model asset is present.

The evidence supports three concrete review priorities, without asserting an
unmeasured saving:

1. Treat any content-script data addition above roughly 54 KiB as a budget
   change requiring an explicit trade-off.
2. If package size becomes a product constraint, investigate the three
   dictionary-bearing runtime boundaries first; they dominate shipped JS.
3. If the UI ceiling becomes tight, measure whether the full self-test engine
   must ship in the production package or can be distributed separately. Its
   exact current cost is 1,697,858 bytes.

All existing bundle ceilings pass. No production bundle or data-layout change
was made as part of this report.

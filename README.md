# Personal Autocorrect

## Repository guide

This is one application family with two platform integrations: the Chrome extension at the repository root and the Android app under [`android/`](android/README.md). Both implement local correction and review/history workflows; the Android integration uses an AccessibilityService instead of browser content scripts.

| Platform | Start here | Build entry |
|---|---|---|
| Chrome | This guide and `manifest.json` | `npm ci` then `npm run build` |
| Android | [Android guide](android/README.md) | `cd android` then `gradlew.bat assembleDebug` with a configured Android SDK/JDK |

For Chrome, load the generated `dist/` directory as an unpacked extension and explicitly enable the sites you want. For Android, build/install locally, review accessibility permissions and select the apps the service may access. A working in-app engine demonstration does not establish that a particular external editor accepts text changes.

The Android source was combined into the existing repository because the shared Chrome application files matched. Existing Chrome history was retained. Local training experiments and their additional package commands were not imported. `android/tools/generate-assets.mjs` reads the shared engine's language-data source when Android assets need regeneration.

Use the detailed privacy, rejection, dictionary and compatibility explanations below before relying on automatic changes. Installed binaries, device data, signing keys and provider/account credentials are not distributed here.

## Chrome and Android in one repository

The Chrome extension remains at the repository root. The Android application lives in [`android/`](android/README.md) and shares the correction engine language data through `android/tools/generate-assets.mjs`. Android has its own Gradle build and AccessibilityService integration. See its README for build and setup instructions.

This consolidation adds the application source only. Local model-training experiments, research datasets, signing keys, device-local settings, and generated builds are not included.

A fast, offline autocorrect for Chrome that keeps a **reviewable history of
every change it makes**. Instead of relying on you catching a mistake in the
moment, it records each correction, lets you jump back to it, and lets you
revert exactly the ones you did not want — days later if you like.

No cloud, no account, no AI service, no telemetry. It cannot even read a website
until you enable it there.

```
Waht → What
"…I think waht happened was…"
Spelling · 96% confidence · Pending review
```

## What it does

* Corrects recurring typos as you type (`waht`→`what`, `teh`→`the`,
  `becuase`→`because`, `oir`→`or`), on space, punctuation, Enter and Tab —
  never while you are still inside the word.
* Uses the bundled ESDB American-English size-60 word list and seven bounded
  candidate generators: the three core Idea Version 1 searches plus four
  supplemental single-edit searches. It never downloads a dictionary or scans
  the whole word list for each keystroke.
* Records every automatic change with its position, context, type and
  confidence.
* Gives you a side panel with the full history: filter it, search it, click an
  entry to scroll to it and see `original → replacement` in place.
* Runs a guided review: *Review 15 corrections*, `4 of 15`, keep / revert /
  skip, with keyboard shortcuts.
* Learns. Accepting reinforces a rule; rejecting does one of five different
  things depending on *why* you rejected it (see below).
* Inserts **essential punctuation** — commas after introductory clauses, before
  joined clauses, in direct address and in simple lists — but only when
  sentence structure makes the comma unambiguous. Deterministic, offline and
  rule-based. Its current authored regression corpus contains 74 positive and
  124 negative cases and passes without a false positive; that is a finite
  regression result, not a real-world precision claim.
  See [docs/PUNCTUATION.md](docs/PUNCTUATION.md).
* Optionally runs the bundled [Harper](https://writewithharper.com) grammar
  engine (~18 MB WASM, fully offline, **off by default**) for real grammar,
  punctuation and confusable-word fixes. Findings appear as chips when you
  pause typing, or apply themselves if you turn on automatic mode — with a
  fading before/after badge and Undo.
  See [docs/HARPER-INTEGRATION.md](docs/HARPER-INTEGRATION.md).
* Teaches itself from a right-click: select a word and choose **Always correct
  "…" to…** to create a permanent replacement, or **Never correct "…"** to add
  it to your dictionary.
* Excludes password and unsupported input types, and conservatively skips fields
  whose metadata looks like payment, one-time-code or other sensitive input.
  Those checks are heuristic, so the site denylist remains the backstop.
  Token guards also avoid URLs, e-mail addresses, code and identifiers.

## Install (unpacked)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist/` folder.
4. Open any page with a text box, click the extension icon, and choose
   **Enable on this site**. *(The extension ships with no site access at all —
   this is the moment you grant it, per site.)*
5. Type `I think waht ` into a text box. It becomes `I think what `.
6. Click the icon again → **Open correction panel** to review, revert and teach.

Requires Chrome 116+ (Side Panel API).

## Development

```bash
npm run dev        # esbuild watch -> dist/
npm run typecheck  # tsc --noEmit, strict
npm test           # vitest: unit + jsdom integration
npm run check      # generated-data/encoding checks + typecheck + tests + build + bundle limits
npm run benchmark  # repeatable local engine timings
npm run benchmark:enforce # enforce the documented percentile latency targets
npm run evaluate   # separate corpus/context evaluation suite
npm run test:harper # opt-in: real Harper WASM conformance + timing (slow)
```

After `npm run dev`, reload the extension in `chrome://extensions` to pick up
background/content changes; the panel and options pages just need a refresh.

The production build first regenerates the dictionary modules from the bundled
`en_US.txt` source. Missing or malformed dictionary input fails the build; there
is no runtime download and no fallback to the old small lexicon.

## How rejection is interpreted

Rejecting a correction can mean five different things, so the panel asks which:

| You choose | The text | What it learns |
|------------|----------|----------------|
| **Reject & revert** | original restored | confidence drops a little |
| **Revert & lower confidence** | original restored | rule becomes suggestion-only |
| **Never this replacement** | original restored | that exact pair is blocked for good |
| **Add “waht” to dictionary** | original restored | that word is never corrected again |
| **Not in this context** | original restored | blocked after/before these words only |
| **Keep, don’t learn** | replacement stays | nothing is reinforced |

It also learns from you: fix the same word by hand three times and it offers a
personal rule — as a suggestion first, promoted to automatic only after you
accept it three times.

## Project layout

```
src/
  engine/     pure correction logic + generated offline dictionary
  history/    anchors, locator, reverter, records, review queue (pure)
  content/    field guards, adapters, highlighter, per-field controller
  background/ message router, single writer for learned data, site permissions
  storage/    chrome.storage.local wrapper, migrations, session store
  side-panel/ history list, filters, search, guided review
  popup/      site access and quick toggles
  options/    settings, dictionary, rules, data export/import
vendor/esdb/   pinned ESDB en_US source and upstream notices
scripts/       dictionary generator, extension build, benchmark, demo server
tests/
  unit/         pure engine, history, storage and message-routing tests
  integration/  jsdom: adapters, field guards, full type→review→revert loop
docs/
  ARCHITECTURE.md  DICTIONARY.md  SPEC.md  THREAT-MODEL.md
  PRIVACY.md  LIMITATIONS.md  ROADMAP.md
  PUNCTUATION.md  PUNCTUATION_PROVENANCE.md  HARPER-INTEGRATION.md
```

## Design in one paragraph

The engine preserves the fixed safety ladder—blocked rules, personal
dictionary, user/learned rules and the common typo table—before entering the
ESDB candidate pipeline. Process 1 ranks only words in the same-length,
same-first-letter bucket; Process 2 checks the `n - 1` adjacent swaps directly;
Process 3 checks one-character substitutions from an explicit, inspectable
QWERTY neighbour map. Coordinate distance may rank those candidates but never
decides which substitutions are generated. Four supplemental processes check
one duplicate-letter removal, one missing-letter insertion, one extra-letter
deletion and one apostrophe insertion. All seven run, merge and return at most
ten candidates. Ranking combines the operation/similarity score, a small
corpus-derived frequency term (`0.04`), and any applicable learned
pair/context adjustment. The raw winner-to-runner-up lead is measured before
confidence is clamped. A generated spelling correction is automatic only when
its display confidence clears the configured threshold and its raw lead is at
least `0.06`; the spelling-risk policy may lower it again. Other lanes
(spacing, punctuation, contextual rules and Harper) keep their own conservative
gates.
Each correction carries multiple location hints. With context enabled these
include bounded text before and after, offset, occurrence index,
paragraph/sentence fingerprints and case;
setting context to 0 removes the contextual hints. Finding it again is a scoring
problem that is allowed to answer *"I am not sure"*. Nothing is ever reverted
from a stale offset: the locator must positively identify the target and the
text there must still be what we wrote, or the record is marked unresolved and
the user is told why.

## Honest limitations

The dictionary has much broader recall than the original MVP lexicon, but
`en_US.txt` is an alphabetical spelling list, not a frequency corpus. Its order
is never treated as frequency. Ranking uses a separately bundled,
corpus-derived 50,000-entry source table filtered to 40,459 ESDB words, plus a
legacy compact common-word prior. The supplemental generators cover one-letter
insertion/deletion and apostrophe insertion, but the deliberately bounded
pipeline still does not brute-force arbitrary multi-edit permutations, so some
misspellings remain unchanged unless the typo table or a personal rule covers
them.
Rich editors that rebuild their DOM (Notion, Google Docs, CodeMirror) are not
verified. Review keyboard shortcuts work in the panel only, so they cannot
collide with a website's own. The full list, with reasoning, is in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Dictionary provenance

The bundled list is ESDB `en_US`, release **2026.02.25**, generated from SCOWL
at **size 60**. Size 60 is an inclusion level, not a word-count claim.
`en_US-large` (size 70) is not used. The source, deterministic transformation,
exact generated metadata, limitations and required SCOWL notice are documented
in [docs/DICTIONARY.md](docs/DICTIONARY.md).

The letter-level processes (duplicate removal, missing-letter insertion, extra-letter
deletion), the operation-cost ranking that decides `iprove → improve` rather than
`iphone`, the two word-boundary corrections (`impro vement → improvement`,
`improvementability → improvement ability`) and the single-write-path guarantee
behind correction history are documented in
[docs/SPELLING-AND-HISTORY.md](docs/SPELLING-AND-HISTORY.md).

The toolbar status and pause controls, per-rule modes, writing profiles, personal
vocabulary, shadow mode, the "show every correction at once" overlay, and the
diagnostics and self-test pages are documented in
[docs/CONTROLS.md](docs/CONTROLS.md).

## Performance

Dictionary membership is a `Set` lookup; adjacent swaps are exactly `n - 1`
membership checks; candidate and context scoring never scan the full document
or dictionary. The code-fence safeguard uses an allocation-free native marker
search over preceding text so fenced blocks remain protected without copying a
large field. `npm run benchmark` warms the engine, then reports sample counts,
median, p95, p99 and max timings for all seven candidate processes, complete
generation and decisions, frequency/context/ranking, merge/split, punctuation,
history record creation, revert planning, deliberately busy dictionary buckets
and a 5 MiB field. Cold dictionary/index construction is reported separately.
Five stable budgets remain enforced: the `<1 ms` lookup/Process 2 and `<15 ms`
typical targets at p95, and the `<30 ms` busy/long-field targets at p99. The
additional microbenchmarks are informational to avoid fragile sub-millisecond
CI gates. Results vary by CPU, Node/V8 and Chrome, so release testing should run
on representative hardware.

## Privacy

Summarised in [docs/PRIVACY.md](docs/PRIVACY.md); the adversarial view is in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Short version: everything is
local, persisted correction history contains the corrected word pair plus a
bounded context window (context can be set to 0), and password inputs are
excluded before their value is read. Detection of other sensitive fields is
metadata-based and cannot be perfect. The options page provides export and
deletion controls; the privacy document explains their exact scope, live-tab
state and permission revocation.

## Licence

The extension source is MIT. The bundled SCOWL-derived word data carries its
own permissive copyright and attribution notice; see
[docs/DICTIONARY.md](docs/DICTIONARY.md#copyright-and-permission-notice).


## Source snapshot and validation

Build generated binaries locally using the instructions above; a source checkout is not an installed application. Earlier validation figures in this guide describe their original development runs. This documentation update checks source references and instructions; it does not claim a fresh application, device or gameplay test.

### Development tool security update

Use Node.js 22.12+ on the 22.x line, 24.x, or 26+. The test/build toolchain has been updated to patched versions, and the default test configuration separates Node and DOM suites using Vitest projects. Run `npm ci` after pulling the updated lockfile.

Revert and rollback now recheck field eligibility after synchronous host input handlers before reading text. The audit includes a regression for a host changing a text field into a password field during revert.

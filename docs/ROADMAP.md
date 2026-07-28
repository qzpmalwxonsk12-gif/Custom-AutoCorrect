# Roadmap

## Where the build stands

Phase 1 (specification and architecture) and Phase 2 (minimal working
extension) are complete. Because "jump to a correction and revert it safely" is
worthless without real anchoring, the parts of Phases 3-6 that Phase 2 depended
on were built too:

| Phase | Item | State |
|-------|------|-------|
| 3 | Robust anchors, jump-to-correction, comparison card, review-all, accept/reject/revert/skip, progress, filters, search, statuses, unresolved handling | done |
| 3 | Current-paragraph / current-field filters | not started |
| 4 | Edit distance, transposition detection, keyboard proximity, candidate ranking, thresholds, capitalisation, never-correct list, suggestion-only rules | done |
| 4 | ESDB `en_US` size-60 dictionary, deterministic generator and three-process candidate pipeline | done |
| 5 | Accept/reject/revert tracking, confidence adjustment, manual-edit observation, repeated-pattern learning, context-sensitive rejection, learned-rule UI, import/export | done |
| 6 | Confusion-set context scoring, conservative confidence, suggestion-only ambiguity, rejection-informed scoring | done |
| 6 | Bigram/trigram frequency tables | not started |
| 7 | Compatibility and hardening | partially - see `LIMITATIONS.md` |

## Next steps, in order

### 1. Evidence-based frequency data
ESDB `en_US.txt` intentionally supplies spelling membership rather than corpus
frequency. If ranking quality needs a frequency term beyond the compact local
common-word prior, add a separately licensed, generated and measured local
frequency table. Never infer frequency from the alphabetical ESDB order.

### 2. Bigram evidence (Phase 6 completion)
Ship a compact bigram frequency table (top ~50k pairs, quantised counts) so
contextual scoring stops depending on hand-written cue lists. Keep the
confusion-set rules as a high-precision override.

### 3. Editor compatibility (Phase 7)
Verified support matrix for Gmail, Outlook Web, Notion, Slack, Linear, GitHub
comments, Google Keep and ProseMirror/Slate/Quill/Lexical demos. Where an editor
rejects `execCommand`, add a per-editor adapter behind the existing
`EditableAdapter` interface - nothing above the adapter changes.

### 4. Panel refinements
Current-paragraph filter, virtualised list for 1,000+ records, an "unresolved"
triage view, and inline disambiguation UI for ambiguous reverts (the backend
command `resolve-ambiguous` already exists).

### 5. Hardening
Manual-edit learning only from user-initiated input events; per-origin rule
scoping in the UI; storage quota monitoring; a `chrome.storage.session` path for
memory-only origins so history survives a worker restart without touching disk.

## Android

The design constraint from day one is that `src/engine/` and `src/history/`
import nothing platform-specific. That is what makes an Android keyboard
practical rather than a rewrite.

### Reusable as-is (port or share)
* the whole engine: tokenizer, distances, candidate generation, scoring,
  capitalisation, grammar rules, confusion sets, personal learning;
* the correction-record and rule schemas, so an export from Chrome imports into
  Android;
* anchoring, locating and revert planning - they are pure string functions.

### Two viable routes
1. **Kotlin port.** Mechanical: the engine is ~1,500 lines of straightforward
   logic with no framework use. Fastest input path, no bridge cost. The schemas
   become `@Serializable` data classes with the same JSON shape.
2. **Shared JS core.** Run the existing engine in a JS runtime (QuickJS/J2V8)
   behind a thin Kotlin facade. Less duplication, but a per-keystroke bridge
   cost that a keyboard cannot really afford. Recommended only for the learning
   and history layers, with the hot path ported.

Recommendation: **port the engine to Kotlin, share the schema**, and keep a
conformance test suite (the same fixtures run against both implementations).

### What must differ on Android
An IME sees only the current input connection, not the host app's document. So:

* **No jump-to-correction across a document.** `InputConnection` can read
  limited text around the cursor, not scroll an arbitrary app to a position.
* **Review becomes a keyboard-surface flow**: a strip above the keys listing
  recent corrections in this input session, with keep/revert per item, plus a
  full-screen review inside the keyboard's own app for the current field.
* **Sessions are per input connection**, and end when the field loses focus;
  history for a finished field is browsable but no longer editable in place.
* **Reverting** uses `InputConnection.setComposingRegion`/`commitText` and must
  re-verify the surrounding text through `getTextBeforeCursor` /
  `getTextAfterCursor` - the same "verify before you write" discipline, with a
  smaller window.

None of these limits should be allowed to weaken the Chrome design: the anchor
model already degrades gracefully when only a small window of text is available
(that is exactly the `contextRadius: 0` path).

## Optional AI (explicitly deferred)

Not in this build, and not required by anything. If added:

```ts
interface RewriteProvider {
  readonly id: string;
  readonly requiresNetwork: boolean;
  rewrite(input: { text: string; instruction: string }): Promise<string>;
}
```

Constraints that must hold: manually triggered on a selection, disabled by
default, an explicit disclosure that text leaves the device before the first
call, never on the typing path, never blocking local autocorrection, and every
accepted change recorded as a normal `CorrectionRecord` so it can be reviewed
and reverted like any other.

## Accuracy without losing speed

Ordered by value per millisecond:

1. **Corpus-backed frequency prior** - the ESDB upgrade supplies membership but
   no frequency data; a compact, separately sourced prior would improve ties.
2. **Bigram context** - converts confident-but-wrong single-word guesses into
   correct ones; a hash lookup per candidate.
3. **Per-user frequency prior** - count the words the user actually types
   (locally, capped, no text stored) and blend into `frequencyScore`. Cheap and
   highly personal.
4. **Bucket-score calibration** - tune similarity and ambiguity thresholds
   against labelled spelling fixtures while preserving the same three bounded
   processes; do not add brute-force multi-edit generation.
5. **Keyboard-layout awareness** - detect AZERTY/QWERTZ from typing patterns and
   swap the proximity table.
6. **Confidence calibration from real decisions** - the accept/revert counters
   already collected are exactly the data needed to fit the thresholds per user
   instead of shipping constants.
7. **Deliberately not doing**: any neural model on the typing path. It buys
   accuracy the local layers can mostly reach, at a latency and battery cost the
   product cannot pay.

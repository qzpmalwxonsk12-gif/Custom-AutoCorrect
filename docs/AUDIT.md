# Implementation audit

This audit compared the implementation with the original product brief and
then exercised the engine, history, storage, contenteditable and UI paths with
targeted regressions. The project already had a sound shape: a platform-neutral
engine/history core, no runtime dependencies or network calls, optional host
permissions, and a usable review model. The changes below address concrete
failures rather than redesigning working parts.

## Fixed in this pass

### Correction correctness

* Quoted multiword typo values such as `alot -> a lot` are parsed intact.
* Mixed letter/digit tokens are protected through the real analysis path.
* Stored grammar/context statistics can no longer escape into the exact-rule
  layer and rewrite unrelated text.
* Grammar obeys blocks, site controls, context rejection and stored rule mode.
* Manual-edit learning accepts only typo-shaped edits with known targets; it no
  longer learns arbitrary semantic rewrites as autocorrect rules.
* User-created rules reliably upgrade/unblock an older learned rule.
* Clearly valid or regional entries (`fro`, `lightening`, `judgement`, etc.)
  were removed from the unconditional typo table, and duplicate rows were
  removed.

### Browser and history behavior

* Contenteditable projections invalidate synchronously and map element-boundary
  carets correctly.
* Every read/write rechecks dynamic sensitive-field, denylist and enabled-state
  guards; missing initial configuration fails closed and retries.
* Session identity includes tab/frame and path scope, persistence is debounced
  per field, and an asynchronous restore merges rather than overwrites newer
  local records.
* Panel routing retains state per frame and chooses the most recently focused
  frame instead of whichever frame happened to report last.
* Review decisions are atomic, status-aware and idempotent. Failed reverts do
  not advance review or claim learning occurred.
* Choosing an ambiguous occurrence only focuses, highlights and refreshes its
  anchor. It never treats a “Go to” action as permission to revert text.
* Locator candidate retention considers the strongest matches across the whole
  document rather than only the first 400 occurrences.

### Privacy and persistence

* Storage reads cannot masquerade as an empty fresh profile. Settings, learning
  and imports share one ordered durable-write queue, and failed writes do not
  become the in-memory truth.
* MV3 session writes are acknowledged only after persistence; clear/delete also
  removes orphan keys and clears live controllers without allowing an in-flight
  write to resurrect old history.
* A zero context radius now removes preview text, neighbouring words,
  before/after text and paragraph/sentence fingerprints in both live and stored
  records. Unused raw DOM paths are no longer created and legacy paths are
  stripped before persistence.
* Origins newly marked memory-only have existing indexed and orphaned sessions
  removed immediately.
* Imports are size-bounded, strictly normalised, validate and strip session
  objects, obey current context/memory-only settings, and restore history as a
  replacement rather than a silent partial merge.
* Raw local storage is limited to trusted extension contexts. Permission
  revocation unregisters future injection and tells already-loaded matching
  content scripts to stop.
* In-page controls live in a closed shadow root and ignore synthetic clicks.

### UI and documentation

* Bulk selection is offered only for records whose replacement can still be
  reverted; partial failures remain visible.
* Ambiguous locations have an explicit, keyboard-focusable picker.
* Popup/options/panel status regions, labels, focus states, dark mode and narrow
  layouts received an accessibility pass.
* Privacy, threat-model and architecture claims now distinguish heuristic
  safeguards from guarantees and describe FNV fingerprints as
  non-cryptographic.

## Recommended next work

These are real remaining limitations, but they require product decisions or
browser-level validation rather than a speculative patch.

1. **Run real-Chrome end-to-end tests before store release.** Exercise Gmail,
   Google Docs-style rich editors, simple `contenteditable`, inputs/textareas,
   same- and cross-origin iframes, permission add/remove, worker eviction,
   reload restore, IME composition and native undo. The current jsdom suite
   cannot prove browser/editor integration.
2. **Define a rich-editor compatibility policy.** The `execCommand` path is
   deprecated and the direct-DOM fallback can disagree with framework-owned
   models. Maintain an editor matrix and disable automatic writes where a
   verified adapter is not available.
3. **Chunk very large history maintenance.** Candidate location scanning is
   bounded in memory, but idle relocation currently processes only the first
   200 records in a session. Continue in idle slices so older records do not
   remain stale.
4. **Decide what “same document” means across tabs and SPAs.** Including tab and
   frame identity prevents collisions, but deliberately gives up automatic
   restore when the same document is opened in a new tab. A document key from a
   supported editor would be stronger when available.
5. **Make context learning paired and temporal.** A blocked previous word and a
   blocked next word currently act as independent vetoes; that can over-block a
   rule. Also, the next word often does not exist when the current word is
   committed. Store paired contexts and optionally rescore after the following
   token.
6. **Harden manual-learning provenance.** Shape checks prevent semantic
   rewrites, but a hostile page can still synthesize plausible field mutations.
   Correlating evidence with trusted `beforeinput`/keyboard activity would
   reduce poisoning.
7. **Curate language data as a product, not a one-off import.** The ESDB
   size-60 list greatly expands spelling membership, but is American English,
   alphabetical and carries neither frequency data nor Hunspell suggestion
   flags. Dialect/domain policy and corpus-based ranking need separate,
   explicitly licensed data and calibration before expanding automatic
   coverage further.
8. **Resolve dormant model surface.** `rejected` is currently an effectively
   unreachable record status, `planReapply` is tested but not exposed, and the
   sentence fingerprint is stored but not scored. Either wire these into a
   defined feature or remove them in the next schema revision.

# Known limitations

Stated honestly, because the alternative is a user discovering them at a bad
moment.

## 1. Vocabulary

The shipped vocabulary is ESDB `en_US` release 2026.02.25, generated from SCOWL
at size 60. That is a broad American-English spelling list, but it has important
limits:

* “size 60” is a SCOWL inclusion level, not exactly 60,000 words;
* `en_US.txt` is alphabetical and contains no frequency counts of its own;
  ranking instead uses a separately bundled corpus table covering 40,459 ESDB
  words plus a legacy compact prior, while entries absent from the corpus table
  remain unranked;
* the plain text file does not carry Hunspell metadata such as `NOSUGGEST`;
* new terminology, product names and proper nouns can still be absent;
* only American English is bundled; there is no locale or dialect detection.

The common typo table still handles curated frequent misspellings ahead of the
dictionary pipeline. The user dictionary remains the final authority for words
that should never be corrected.

The candidate search is deliberately incomplete. It covers same-length
same-first-letter similarity, one adjacent swap, one QWERTY-neighbour
substitution, one duplicated letter removed, one missing letter inserted and one
extra letter deleted, plus one apostrophe inserted. It does not brute-force multi-character replacements,
two-edit combinations or permutations, so a word needing two independent fixes
stays unchanged unless a curated or personal rule covers it. This is a precision
and latency trade-off rather than a claim that every dictionary misspelling is
detectable.

Two consequences are worth calling out:

* **A valid dictionary word is never rewritten by the spelling layer.** `woks`
  is a real word, so it is not corrected to `works`; likewise `book`, `coffee`,
  `address` and `committee` survive duplicate-letter analysis untouched. This
  invariant outranks any individual correction.
* **Structurally tied candidates become suggestions, not edits.** `iprove` is
  one insertion away from `improve` and one deletion away from `prove`; with
  equal edit cost and no decisive frequency gap, the engine offers rather than
  chooses. `thnks` is similarly tied between `thanks` and `thinks`, and is
  resolved by the curated typo table rather than by structure.

The full ranking model, the operation-cost hierarchy and measured timings are in
[SPELLING-AND-HISTORY.md](SPELLING-AND-HISTORY.md).

See `docs/DICTIONARY.md` for provenance, generation and the word-data licence.

### Runtime footprint

The generated dictionary materially increases both the content and
service-worker bundles; `npm run check:bundle` reports the current sizes and
enforces their ceilings. Chrome isolates frames and workers, so every injected frame
constructs its own `Set` and bucket index, and an evicted MV3 worker constructs
its own copy again when restarted. Pages with many frames therefore multiply
the one-time initialization and memory cost even though correction lookups are
fast afterward. A lightweight frame bootstrap with deferred engine loading is
a worthwhile future optimization; it is not implemented in this build.

## 2. Editors

| Host | Status | Notes |
|------|--------|-------|
| `<input type="text\|search">`, `<textarea>` | fully supported | including caret preservation, mirror-measured highlights and scrolling |
| Plain `contenteditable` | supported | flat text projection, `Range`-based edits and highlights |
| Same-origin iframes | supported | each frame runs its own controller; grant the frame's origin too |
| Editors that rebuild the DOM on every keystroke (Draft.js, Slate, ProseMirror, Quill, CodeMirror 6, Monaco) | **not verified** | edits go through `execCommand('insertText')`, which most of them accept, but their internal models may re-render and invalidate positions. Treat as experimental |
| Google Docs canvas editor | **not supported** | the document is painted on a canvas; there is no DOM text to read |
| Cross-origin iframes | conditional | the frame's own origin must be enabled separately; otherwise the extension does not run inside it |
| Shadow DOM editors | partial | fields inside an open shadow root are discovered from the composed focus path; closed shadow roots are invisible |
| Virtualised editors (rows unmounted while scrolled away) | partial | a correction scrolled out of the DOM is reported *unresolved* until it mounts again |

Code editors are deliberately skipped when they set `spellcheck="false"`, which
most of them do.

## 3. Anchoring and reversion

* Two identical words in an unchanged neighbourhood are told apart reliably. Two
  identical words whose *surroundings were both rewritten* are reported as
  ambiguous; the panel asks you to choose an occurrence before any revert.
* `contextRadius: 0` strips surrounding text, the panel preview, neighbouring
  words and per-correction fingerprints from live and persisted records.
  Relocation then relies mainly on position and occurrence
  order and is measurably weaker (see `docs/PRIVACY.md`).
* A record whose text was deleted is `unresolved`; if it later returns, the next
  idle pass restores it to `pending`.
* Reverting restores the word, not the whole edit history: if you changed the
  surrounding sentence after the correction, reverting only puts the original
  word back.

## 4. Corrections the engine will not make

* Anything inside a URL, e-mail address, file path, `@handle`, `#hashtag`, code
  fence, inline code, identifier (`camelCase`, `snake_case`), all-caps token,
  or any token containing a digit.
* Words of one character, or longer than 24.
* Capitalised words mid-sentence (assumed to be names) in the generative layer.
* `a`/`an` before *h-* and most *u-* words, where usage is genuinely split.
* Plain-text code in a normal textarea: `const waht = 1` **will** be corrected,
  because there is no fence or backtick to signal code. Use the site denylist or
  the `data-personal-autocorrect="off"` attribute.

### Word-boundary corrections are the most conservative of all

Joining or splitting words changes meaning in ways a letter swap cannot — “a
part” and “apart”, “in to” and “into”, “ice cream” and “icecream” are different
statements, not different spellings. Both boundary corrections are therefore
throttled well below what the dictionary alone would allow:

* A space is **never** removed when both sides are already valid words, unless
  the joined compound is measurably more frequent than the pair, and even then
  it is only offered. `ice cream`, `peanut butter`, `web browser`, `credit
  card`, `New York`, `high school` and `data base` all stay as typed.
* A word is **never** split if the dictionary knows it (`another`, `software`,
  `football`, `without`, `something`, `database`, `inside`, `outside`), and
  splitting requires at least 8 characters with fragments of at least 3. Without
  those floors a 107k-word list decomposes ordinary typos into nonsense — `waht`
  becomes `wa ht`. Short or narrowly-decided compounds remain suggestions.
* Identifiers, URLs, e-mail addresses, paths and digit-bearing tokens are
  excluded from both, as everywhere else.

Each boundary fix produces exactly one history entry spanning both words, so
reverting restores the original spacing in a single step.

## 5. Contextual corrections

The confusion sets cover `from/form`, `their/there/they're`, `your/you're`,
`then/than`, `its/it's`, `to/too` and `lose/loose`. Evidence is a few hundred
hand-written bigram cues, so coverage is narrow and intentionally timid:
contextual proposals are **suggestions**, not automatic edits, unless you both
enable automatic contextual correction and the rule has been accepted three
times. Sentences with unusual word order will simply produce no suggestion.

## 6. Review shortcuts

Keyboard shortcuts work **inside the side panel only**. This is a deliberate
trade-off: capturing arrow keys on the page would break the host site's own
editing. In-page you get the floating card's buttons, plus `Escape` to leave
review mode.

## 7. Undo

Corrections are applied with `document.execCommand('insertText')` where the host
allows it, which keeps them on the browser's native undo stack (`Ctrl+Z` usually
undoes the correction). Where that path is refused, the fallback writes the
value directly and dispatches an `input` event; native undo may then skip the
correction. `execCommand` is deprecated - if it is removed, the fallback still
works.

## 8. Service-worker lifetime

The MV3 background worker is evicted aggressively. Session state lives in the
content script, so eviction does not lose the active page's records. If the
content script cannot load configuration after a cold start, it now fails
closed: it does not attach or learn, and retries with bounded backoff. Typing
continues normally, but autocorrect remains unavailable until configuration
loads successfully.

## 9. Privacy controls and hostile pages

* `input[type=password]` is excluded structurally. Payment, OTP, PIN and similar
  ordinary text fields are detected from metadata such as `autocomplete`,
  labels, names and placeholders. A poorly labelled field can evade those
  heuristics; use the site denylist or remove access as the backstop.
* Removing host access unregisters future injection and broadcasts teardown to
  matching open tabs. Chrome does not physically unload evaluated code, so
  reload or close a discarded/unresponsive tab if it could not receive the
  teardown message.
* Disabling persisted sessions prevents future writes; it does not erase
  sessions already on disk. Use **Delete all correction history** for those.
* Export includes stored sessions only while persistence is enabled. Import is
  a validated replacement of settings, learned data and correction history, not
  a merge.
* The in-page card is isolated in a closed shadow root, so page code cannot
  traverse or synthetically click its controls through normal DOM APIs. Its host
  element is still in the page DOM, so a hostile site can hide or remove it.
* Paragraph, sentence and field fingerprints are 32-bit FNV values, not
  encryption. They reveal equality and predictable short text may be guessed.

## 10. Harper grammar engine (optional)

* Off by default; enabling it costs ~18 MB of disk (bundled WASM) and roughly
  2.5-3 s of engine setup per service-worker lifetime, paid lazily on the
  first paragraph checked. Per-paragraph linting measured at ~15-55 ms.
* Findings are chips on the idle path by default and never run per keystroke.
  One chip at a time, in reading order; accepting or dismissing a chip
  surfaces the next finding. **Automatic application** is opt-in
  (`harperAutoApply`); even then, subjective kinds (Style, Readability), rules
  measured as unreliable, and any rule reverted twice without an offsetting
  keep stay suggestion-only. Each automatic fix shows a fading before/after
  badge with Undo and is recorded in the panel.
  Pasted or restored documents are swept paragraph by paragraph across
  self-chained idle passes (bounded), caret paragraph first.
* Harper's rules are literal pattern matchers: `could of` is flagged, but the
  near-miss `could off` is not - neither engine can catch it, because "off"
  and "of" are both valid words and no rule covers that pair.
* Async results pass bounded-queue/current-controller checks and
  fingerprint-first paragraph/span re-validation before anything is shown or
  applied. A version mismatch alone does not invalidate a byte-identical linted
  slice; an edit elsewhere in the field is safe to race.
* Harper's own spelling checks are suppressed; the built-in engine owns
  spelling. Harper's default rule set decides what grammar is flagged - some
  constructions (e.g. many agreement errors) are not in its default config.
* If the service worker is evicted often, setup cost recurs; the options page
  shows the initialisation count. The host class is transport-independent so
  it can move to an offscreen document if that number climbs (see
  `docs/HARPER-INTEGRATION.md`).

## 11. Essential punctuation engine

* Deliberately narrow. It inserts a comma only when both clauses (or both list
  items, or the vocative pattern) are unambiguous, and skips anything else:
  comma splices, appositives, coordinate adjectives, phrase-level lists and
  restrictive/non-restrictive distinctions are not attempted.
* **No dialogue punctuation** — `"Hello" he said` is untouched. That is the
  largest gap for fiction writing.
* English only; the classifier assumes SVO word order.
* Regional spellings whose stem is not in the bundled US-English ESDB list
  (for example `apologised`) are still recognised but degrade to a suggestion.
* Quoted material is never modified, so a real error inside a quotation is not
  corrected.
* Precision is measured against a 198-case corpus written alongside the rules
  (74 positive, 124 negative). That is a regression guarantee, not a claim
  about arbitrary prose - see `docs/PUNCTUATION.md`.

## 12. Not yet built

Panel filters for "current paragraph" / "current field"; per-site rule
management UI; merge semantics for a full backup import (the current full
import replaces, while vocabulary-only import already merges); Chrome sync
storage; anything AI.

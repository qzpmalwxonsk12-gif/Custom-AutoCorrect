# Threat model

An autocorrect extension sees everything the user types. That makes it a
high-value target and an easy accident. This document states what it is trusted
with, what it refuses, and what it cannot defend against.

## 1. Assets

| Asset | Where it lives | Sensitivity |
|-------|----------------|-------------|
| Typed text (transient snapshots) | content-script memory, for fields attached on an enabled page | very high |
| Correction records (word pair, anchors, fingerprints and bounded context) | memory, optionally `chrome.storage.local` | high |
| Shadow observations (bounded original/replacement text and origin) | service-worker memory, optionally `chrome.storage.local` | high |
| Learned rules and personal dictionary | `chrome.storage.local` | medium - reveals habits and vocabulary |
| Site list (granted origins) | Chrome's permission store | medium - reveals browsing |
| Settings | `chrome.storage.local` | low |

## 2. Trust boundaries

```
 web page (untrusted) │ content script (isolated world) │ background │ storage
                      │                                  │           │
   DOM, page scripts  │  our code, page cannot call it   │  no page  │  local
```

* The content script runs in Chrome's **isolated world**: page scripts cannot
  read its variables or call its functions.
* Extension UI (panel, popup, options) runs in extension pages, unreachable from
  the web.
* The in-page highlight/card uses an extension host element with a **closed**
  shadow root. The host element is visible in the DOM, so a page can remove,
  cover or move it, but cannot traverse its controls through `shadowRoot`.
* There is no `externally_connectable` declaration, so ordinary web pages cannot
  initiate runtime messages to the extension. Content and extension pages still
  treat messages as untrusted input and route only supported operations.

## 3. What the extension deliberately never does

| Rule | Enforcement |
|------|-------------|
| Never process a password field | `field-guard.ts`: only `input[type=text\|search]`, textarea and contenteditable are ever considered |
| Attempt to exclude payment or authentication text fields | `autocomplete="cc-*"`, `one-time-code`, `current/new-password`, plus a name/id/label/placeholder heuristic for card, CVV, OTP, PIN, IBAN, SSN, … |
| Never process a field the site marked private | `data-personal-autocorrect="off"`, `spellcheck="false"`, `<code>`/`<pre>` ancestors |
| Never persist a full raw document | live field snapshots remain in content-script memory; storage receives only the word pair and bounded anchor data, with per-correction context and fingerprints user-settable to 0 |
| Never transmit anything | production code invokes no network API and loads no remote script |
| Never run where it was not invited | no host permissions at install; scheme + hostname match-pattern opt-in from the popup |
| Never persist history on configured memory-only sites | the storage boundary refuses those sessions and removes existing stored sessions when a site is newly added |

The guard evaluates field type and metadata before the adapter reads its value.
That is definitive for password/unsupported input types, but metadata-based
sensitive detection can miss an ordinary text field with a vague label.

## 4. Threats and mitigations

### T1 - A malicious page tries to read the correction history
*Mitigation:* isolated world; the panel is an extension page; the content script
exposes no globals other than a boolean load flag. Records live in content-script
memory and extension storage, neither of which a page can reach. In-page
controls are inside a closed shadow root. A page can still detect and remove the
host element, which is an availability risk rather than a history disclosure.

### T2 - A malicious page forges panel commands
*Mitigation:* a page cannot send `chrome.runtime` messages to an extension that
does not declare `externally_connectable` - this one does not. Extension-side
routers distinguish content and UI message namespaces. Text-mutating buttons in
the in-page card additionally require a trusted user-generated click, so a
synthetic DOM event does not invoke their action callback.

### T3 - Typed secrets leak into stored history
*Mitigation:* the field guard (§3), persisted-context radius (settable to 0),
memory-only sites, retention expiry, and "Delete all correction history" in the
options page. At radius 0, the content controller and persistence boundary strip
surrounding text, the preview, neighbouring words and per-correction
fingerprints from live and persisted records. The corrected word pair
remains, and session metadata still has a field-text fingerprint. If a secret is
typed into an ordinary text field and happens to be corrected, the pair and, at
a non-zero radius, context could still enter history; §6 covers this residual
risk.

### T4 - The extension corrupts a document
*Mitigation:* every write is a bounded range replacement that is verified
against the expected whole-field result. A mismatch triggers rollback. If a
host both mangles the edit and refuses rollback, the controller logs an
`unrecorded` error outcome but still creates a correction record so the
remaining change is visible and reversible. Reverts additionally require
positive relocation. Highlights and comparison cards are drawn in a closed
shadow root on a small host appended outside the editor. No markup is inserted
into the editable content, although the host element itself is part of the page
DOM.

### T5 - The extension reverts the wrong occurrence
*Mitigation:* `locate()` scores multiple independent hints and returns `ambiguous`
rather than guessing; single-occurrence matches still have to clear a context
floor. This is covered by tests including "revert one of two identical words"
and "1,000-word document, fifteen corrections".

### T6 - Learned data is poisoned by a hostile page
A page could programmatically rewrite a field to make it look as though the user
repeatedly fixed `x` to `y`.
*Mitigation:* manual-edit evidence requires a single-word change passing all
token guards, and produces a **suggestion-only** rule that has to be accepted
three times before it can apply automatically. Impact is capped at "an unwanted
suggestion chip". Full mitigation (ignoring edits not preceded by keystrokes) is
listed in the roadmap.

### T7 - Storage exhaustion / denial of service
*Mitigation:* content-side session batching, serial durable background writes,
one key per session, retention expiry, pending-pattern pruning at 30 days, and
relocation capped at 200 records per pass. Storage failures are surfaced to the
requesting UI and never block typing.

### T8 - Extension compromise via dependencies
*Mitigation:* the only production package dependency is `harper.js`; its glue,
licence and WASM are bundled locally and the engine is off by default.
`devDependencies` are esbuild, TypeScript, vitest and jsdom and do not ship as
packages in the artefact. The bundle is built from source in this repository.

### T9 - A user unknowingly enables it on a sensitive site
*Mitigation:* enabling is an explicit per-site action with Chrome's own
permission prompt; the options page lists every granted origin with a one-click
revoke; the panel shows a "History kept in memory only" badge when applicable.
On revocation, the background unregisters future injection and broadcasts a
teardown message so matching open tabs stop controllers, listeners and UI.
Chrome does not physically unload evaluated script code; reload/close is the
backstop if a discarded or unresponsive tab misses the message.

## 5. Out of scope

* A compromised browser profile or OS-level keylogger.
* Other extensions with `<all_urls>` access reading the same page.
* Chrome's own storage encryption at rest (there is none; the profile directory
  is readable by the OS user).
* Cross-origin iframes: the extension simply does not run there unless the user
  granted that origin too.

## 6. Residual risks (stated plainly)

1. **Correction records contain words the user typed.** That is inherent to a
   reviewable history. Bounded persisted context, `contextRadius: 0`,
   memory-only sites, retention expiry and deletion are the controls.
2. **The sensitive-field heuristics are heuristics.** A site that labels a
   security question as an ordinary text input with no identifying attributes
   would not be detected. The denylist is the backstop.
3. **FNV fingerprints are not secret.** They leak equality, and low-entropy
   text may be recovered by guessing candidate strings.
4. **The in-page UI host is page-visible.** Closed shadow DOM prevents direct
   traversal, but a hostile page can hide or remove the overlay.
5. **Permission revocation teardown depends on message delivery.** Matching live
   tabs stop immediately, but reload or close a discarded/unresponsive tab as a
   definitive backstop.
6. **`document.execCommand` is deprecated.** If Chrome removes it, the fallback
   path still works but loses native undo integration in some editors.
7. **Manual-edit learning can be gamed** by a page, to the extent described in
   T6.
8. **Shadow observations contain bounded text.** They are capped at 500 and
   memory-only by default, but enabling shadow persistence writes the
   original/replacement snippets and origin to local storage independently of
   correction-history persistence and `contextRadius`.

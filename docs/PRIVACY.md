# Privacy

## The short version

Everything happens on your computer. There is no server, no account, no
telemetry, and no AI service. The extension does not run on any website until
you explicitly enable it there.

You can verify this in the production source: it does not invoke
`XMLHttpRequest`, `WebSocket` or `navigator.sendBeacon`, does not load remote
scripts, and its only `fetch` target is the extension's own bundled files
(`chrome-extension://` URLs — the Harper WebAssembly binary described below).
Normal URL parsing and Chrome match patterns still contain strings such as
`https://`; searching for the substring `http` alone is not a meaningful
network-code audit.

### The optional Harper grammar engine

The extension bundles the [Harper](https://writewithharper.com) grammar
checker (~18 MB of WebAssembly, Apache-2.0). It is **off by default**, loads
nothing until enabled, and runs entirely inside the extension's own service
worker — the text of the paragraph being checked never leaves the browser
process. When you reject a Harper suggestion, a **non-reversible numeric
context hash** of that finding (Harper's own privacy-respecting ignore format)
is stored locally so the same finding is not offered again; per-rule
accept/reject counters are stored alongside it. Both are visible in the
options page and are deleted by **Reset learned data**.

## What is stored, exactly

| Data | Contents | Where | Default lifetime |
|------|----------|-------|------------------|
| Correction records | the typed word, replacement, status, type, confidence, time, optional keyboard-change position/letters, bounded before/after text, optional preview and neighbouring words, offsets, occurrence index, and non-cryptographic paragraph/sentence fingerprints | `chrome.storage.local` when history persistence is enabled | 7 days |
| Session metadata | a hashed field id, site, field kind, update times and a non-cryptographic field-text fingerprint | `chrome.storage.local` when history persistence is enabled | 7 days |
| Learned rules | word pairs, counters, mode, per-site blocks, and up to 12 entries in each neighbouring-word context list | `chrome.storage.local` | until you delete them |
| Personal dictionary | words you asked never to correct | `chrome.storage.local` | until you delete them |
| Grammar/punctuation feedback | per-rule counters, disabled Harper rules and Harper's numeric ignored-lint hashes | `chrome.storage.local` | until you reset learned data or re-enable a rule |
| Shadow observations | original/replacement text (each truncated to 120 characters), origin, provider/rule, confidence and agreement metadata; capped at 500 | service-worker memory by default; `chrome.storage.local` only when shadow persistence is explicitly enabled | until worker restart by default, or until cleared when persisted |
| Settings | your preferences | `chrome.storage.local` | until you delete them |
| Page URL and title | **only if you turn it on** (off by default) | `chrome.storage.local` | with the session |

Fingerprints are 32-bit FNV-1a values. They help distinguish "same paragraph"
from "different paragraph", but they are **not encryption** and are not suitable
for protecting secrets. They reveal when normalised text is equal, and short or
predictable text can be guessed by hashing candidates. The extension does not
persist the corresponding full raw document.

## What is not persisted or collected

* A full raw copy of a field or document. The content script necessarily keeps a
  live text snapshot while an attached field is being edited, but it writes only
  the bounded record data described above to extension storage.
* Values from `input[type=password]`; password inputs are rejected before their
  value is read.
* Anything from a site you have not enabled.
* Keystroke timings, IP addresses, account/device/advertising identifiers, or
  usage statistics.

Payment, one-time-code and similar **text** fields are detected from
`autocomplete`, name, id, label and placeholder metadata. That is a conservative
heuristic, not a guarantee: an ordinary text box with vague metadata can be
missed, and a corrected word plus nearby context could then enter history. Use
the denylist or remove site access for sites where that risk is unacceptable.

## Controls

| Control | Where | Effect |
|---------|-------|--------|
| Enable on this site | popup | requests the optional site match-pattern permission from Chrome |
| Turn off for this site | popup / panel | keeps access but stops correcting |
| Remove access | options → Site access | revokes the host permission, unregisters future injection and tells controllers in open matching tabs to stop |
| Context stored per correction | options → Privacy | 0 strips surrounding text, preview, neighbouring words and per-correction fingerprints from live and persisted records |
| Keep sessions across reloads | options → Privacy | off prevents future session writes; previously stored sessions remain until you delete correction history |
| Memory-only origins | options → Privacy | removes stored sessions for newly added sites and prevents future disk writes; the active tab can still hold history in memory |
| Delete sessions after N days | options → Privacy | automatic expiry, default 7 |
| Delete all correction history | options → Your data | deletes persisted sessions and notifies open tabs to clear live records; reload a tab if it was suspended or could not receive that notification |
| Reset learned data | options → Your data | deletes rules, dictionary and blocks |
| Keep shadow observations after restart | options → Shadow mode | off by default; when enabled, persists the bounded observation log locally |
| Clear observations | options → Shadow mode | clears the in-memory and persisted shadow log |
| Export / import | options → Your data | a plain, unencrypted JSON file you own; store it accordingly |

Export includes settings and learned data. Stored sessions are included while
**Keep correction sessions across page reloads** is enabled. Import validates
the backup, then replaces current settings, learned data and correction history;
it is not a merge. Use **Delete all correction history** to remove any older
sessions that were excluded from an export because persistence was off.
The full-backup export does not include the separate shadow log; use the Shadow
mode viewer and clear control to manage it.

### What `contextRadius: 0` costs you

The surrounding text is what lets a correction be found again after you edit the
document. At 0, the content controller and persistence boundary strip the
before/after text, panel preview, neighbouring-word cues and paragraph/sentence
fingerprints. The correction record still contains the
word pair, approximate position and occurrence order. Session metadata retains
the separate field-text fingerprint listed above.

Without stored context, corrections in text you have not touched often still
resolve, while corrections in heavily rewritten paragraphs are more likely to
be reported as *unresolved*. The locator refuses to edit when it is not
confident.

## Permissions, and why each exists

| Permission | Purpose | Granted when |
|------------|---------|--------------|
| `storage` | your settings, rules and history | install |
| `sidePanel` | the review panel | install |
| `scripting` | register the content script for sites you allow | install |
| `activeTab` | read the current tab's address when you open the popup | on click |
| host access to a site pattern | run on that scheme + hostname (the match pattern covers paths and ports) | only when you click "Enable on this site" |

The extension requests **no host permissions at install time**. A freshly
installed copy cannot read any page.

Chrome does not physically unload already-evaluated content-script code when a
dynamic registration or host permission is removed. The extension therefore
broadcasts a teardown message: matching open tabs remove listeners,
controllers, timers and in-page UI, while new navigations do not receive the
script. Reloading or closing a tab remains a definitive backstop if Chrome could
not deliver that message (for example, to a discarded tab).

## If you enable an optional AI feature later

There is none in this build. If one is ever added it will be off by default,
manually triggered per sentence, will state clearly that the selected text
leaves the device, and every AI-produced change will appear in the same
correction history with the same revert controls.

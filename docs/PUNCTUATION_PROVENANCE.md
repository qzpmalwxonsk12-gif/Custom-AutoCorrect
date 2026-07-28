# Punctuation engine — provenance and licensing

This file records the origin of everything in `src/engine/punctuation/`, so a
future maintainer (or a licence audit) can establish exactly what was written
here and what, if anything, was derived from another project.

## Summary

**No third-party code or rule data was copied.** Every file under
`src/engine/punctuation/` is an original TypeScript implementation written for
this repository.

## LanguageTool

A copy of the LanguageTool repository (`languagetool-master.zip`, 5,250 entries)
was supplied with the task brief and **was inspected during this task**. An
earlier revision of this file recorded it as absent; that was correct at the
time and is now superseded.

**Nothing was copied.** Inspection was read-only and confined to establishing
what exists, under what licence, and whether any of it could be used. No
LanguageTool file was copied, adapted, translated, or used as the basis for any
code or data in this repository.

### Licence position

| Item | Finding |
|---|---|
| Repository licence (`COPYING.txt`) | GNU Lesser General Public License **v2.1**, February 1999 |
| Java source headers (e.g. `CompoundAwareHunspellRule.java`) | LGPL 2.1 *or later*, © 2012 Daniel Naber |
| `resource/en/confusion_sets.txt` | LGPL 2.1+, but **derived from After the Deadline's `homophonedb.txt`** — a second upstream with its own attribution chain |
| `resource/en/compounds.txt`, `common_words.txt`, `added.txt` | ship inside the LGPL module; treated as LGPL rule data |
| `12dicts-readme.html`, `agid-readme.txt` | further bundled corpora carrying their own separate notices |

LGPL 2.1 is a *weak copyleft* licence. Its obligations attach to the library and
to derivative works of it: source availability for the LGPL portion, preserved
copyright and licence notices, and — critically for a compiled, bundled browser
extension — a mechanism for the user to relink or replace the LGPL component.
That last requirement (§6) is awkward for a minified single-file content script,
where an LGPL module cannot practically be swapped out by the end user.

This extension is therefore kept **free of LGPL material entirely**, which
avoids the question rather than answering it. Verbatim rule data is the highest-
risk category: a file such as `confusion_sets.txt` is a curated, creative
compilation, and copying it would import both LanguageTool's licence and After
the Deadline's attribution chain into a codebase that currently has neither.

### What may be taken, and what may not

* **Not copyrightable, safe to reuse:** the *facts* of English grammar and the
  *ideas* behind an approach — that a compound speller should try splitting an
  unknown word at dictionary boundaries, or that homophone pairs need context to
  disambiguate. Ideas and methods are not protected expression.
* **Copyrightable, must not be copied:** source files, XML rule definitions,
  word lists, confusion sets, compound lists, and any substantial selection or
  arrangement of them.

Accordingly, `src/engine/token-spacing.ts` was written from scratch. Its
concept — attempt a split of an unknown word into known fragments — is the same
general idea that `CompoundAwareHunspellRule` implements, but no LanguageTool
code was read while writing it, and its thresholds, ranking, confidence model
and refusal conditions were derived from this project's own dictionary and
tests. Independent implementation of an unprotected idea creates no LGPL
obligation.

If any rule or datum is derived from LanguageTool in future, it must be entered
in the register at the bottom of this file — with the exact source file, its
licence, and every notice that licence requires — *before* the derived code is
committed.

## What the rules are actually based on

The rules encode general, uncopyrightable facts about English grammar — the
same facts found in any style guide or grammar reference:

| Component | Basis |
|---|---|
| Closed word lists (determiners, prepositions, pronouns, auxiliaries, coordinators, subordinators) | Closed classes of English. Finite, well known, and not the creative expression of any project. |
| P001 introductory dependent clause | Standard rule: a dependent clause preceding a main clause is set off by a comma. |
| P002 introductory participial phrase | Standard rule: an introductory verbal/descriptive phrase is set off by a comma. |
| P003 direct address | Standard rule: a vocative is set off by commas. |
| P004 simple list | Standard rule: items in a series of three or more take commas; the serial comma is a documented style option, exposed as a setting. |
| P005 comma before a coordinator joining independent clauses | Standard rule. |
| P101 non-restrictive relative clause | Standard restrictive/non-restrictive distinction, implemented as suggestion-only because it changes meaning. |
| Irregular verb / participle lists | Common English irregular verbs, enumerated by hand for this project. |
| Address terms, imperative verbs, greeting terms | Written by hand for this project. |

The *implementation* — the token classifier, the verb-first clause detector,
the anti-pattern framework, the confidence model, the overlap resolver and the
insertion-normalisation scheme — is original to this repository and was shaped
by this extension's existing architecture (see `docs/ARCHITECTURE.md`).

## Test corpus

`tests/fixtures/punctuation-corpus.ts` was written for this project. The
sentences are original, with the exception of the specific examples quoted in
the task brief itself (for instance `Let's eat Grandma.` and
`I bought apples oranges bananas and grapes.`), which are commonplace
teaching examples of the rules concerned.

## Dependencies

The punctuation engine adds **no runtime dependency**. It imports only:

* `src/engine/data/dictionary.ts` — the existing bundled ESDB word list, used
  for stem confirmation (see `vendor/esdb/README_en_US.txt` for that data's own
  licence and required notices);
* `src/shared/util.ts` — this repository's own helpers.

It does not import `harper.js`, and it makes no network request.

## Derived-rule register

Nothing is currently derived from another project. LanguageTool was inspected
(see above) but nothing was taken from it, so the register stays empty.

| Rule ID | Source project | Source file | Licence | Notice preserved |
|---------|----------------|-------------|---------|------------------|
| _(none)_ | — | — | — | — |

# Personal Autocorrect — Android

An offline autocorrect that works in **any app, with any keyboard**, driven by
an Android AccessibilityService. It is a faithful port of the seven-process
correction engine in this repository's Chrome extension, with the browser
content-script layer replaced by node-based text editing.

Private build. Sideload only.

## Build

```bash
node tools/generate-assets.mjs   # only after changing the TypeScript engine data
./gradlew assembleDebug          # -> app/build/outputs/apk/debug/app-AutoCorrect-debug.apk
./gradlew testDebugUnitTest      # 65 engine tests against the real dictionary
```

`local.properties` must point at your SDK (it is generated on first Android
Studio open, and is already present here).

## Install and enable

1. Install the APK.
2. Open **Personal Autocorrect** → *Open Accessibility settings* → enable the
   service.
3. Back in the app, **Choose apps** and tick the apps it may correct in.
4. Type `I think waht ` anywhere in one of those apps.

The service starts with access to **nothing**. An app that is not ticked is
never read.

## When it isn't correcting

The app has a **Diagnostics** section that shows what the service is actually
doing. Type in the problem app, come back, and read it top to bottom.

| Reading | Meaning |
|---|---|
| `events seen 0` | The service is receiving nothing. Re-enable it in Accessibility settings. |
| App listed as `[off]` | It is sending events but is not allowlisted. Tick it in *Choose apps*. |
| `APP_NOT_ALLOWED` | Same as above, or the master switch is off. |
| `FIELD_REJECTED PASSWORD` / `SENSITIVE_*` | Working as intended — that field is excluded. |
| `NO_NODE` | The app exposes no editable node. Nothing accessibility-based can correct it. |
| `WAITING_FOR_COMMIT` | Normal mid-word. A correction fires on space/punctuation, never before. |
| `NO_PROPOSAL` | The engine saw the word and decided it was fine. |
| `SUGGESTION_ONLY` | Below the autocorrect threshold. Lower the slider to act on it. |
| `WRITE_FAILED` | The field refused `ACTION_SET_TEXT`, or rewrote it and we rolled back. |

**"Try it" runs the engine in-process, not through the service.** That split is
deliberate: if Try it corrects but a real app does not, the engine is fine and
the problem is the service, the allowlist or that app's node tree. If Try it
does not correct either, the problem is the engine or its assets.

## The seven processes

All seven run on every unknown word, are merged, deduplicated, ranked
deterministically and capped at ten candidates. Each is bounded by word length
or one prebuilt index bucket — none scans the 107,901-word list.

| # | Process | Method | Example |
|---|---------|--------|---------|
| 1 | Same length + first letter | score one prebuilt bucket | `wark` → `work` |
| 2 | Adjacent swap | exactly `n-1` lookups | `waht` → `what` |
| 3 | Keyboard proximity | one QWERTY-neighbour substitution | `wprk` → `work` |
| 4 | Duplicate letter | remove one half of a repeated run | `punctuatioon` → `punctuation` |
| 5 | Missing letter | insert one letter at each position | `iprove` → `improve` |
| 6 | Extra letter | delete one non-repeated letter | `worlkd` → `world` |
| 7 | Apostrophe | insert one interior apostrophe | `didnt` → `didn't` |

Ranking is `0.72 × similarity + 0.18 × legacy prior + process prior −
operation-cost penalty`, plus a corpus-frequency term at weight `0.04` and any
learned adjustment. **Operation cost dominates**: that is what makes `iprove`
resolve to `improve` (one insertion) rather than `iphone` (several
substitutions in the same-length bucket).

Around the pipeline sits the same eight-layer ladder as the extension: guards →
personal dictionary → user rules → learned rules → typo table → the seven
processes → real-word context → a/an grammar.

## Why it works with any keyboard

A soft keyboard owns a **composing region** while you are mid-word. Rewriting
the field during that window desynchronises the keyboard's internal buffer from
the field, and the next keystroke produces duplicated or mangled text. That
region is invisible from outside the IME.

So the service never corrects mid-word. It acts only on the keystroke that
*commits* a word — space, newline, tab or terminal punctuation — by which point
every mainstream keyboard has released its region. In the browser build the
same rule was merely tidy; here it is load-bearing.

## The write path

`ACTION_SET_TEXT` replaces the **entire** field — the accessibility API has no
ranged edit. So every correction is:

1. verify the field still holds exactly the text that was analysed;
2. compute the full expected result and write it;
3. re-read the node and compare;
4. on mismatch, restore the original — and if *that* fails, log loudly rather
   than silently leaving mangled text;
5. map the caret across the edit and restore it.

All of this lives in `NodeEditor.replaceRange`, the single point at which any
engine may modify text. The invariant: text changes **if and only if** exactly
one history record exists.

## What is excluded, always

Decided from node metadata *before* any text is read:

- password fields (`isPassword`, and the password input-type variations);
- number, phone and datetime fields;
- email and URI fields;
- anything whose view id, hint or content description looks like a passcode,
  OTP, card, CVV, IBAN, SSN, seed phrase or API key;
- fields over 20,000 characters.

Plus the engine's own token guards: URLs, e-mail addresses, paths, code fences,
inline code, JSON/CSS/SQL context, camelCase identifiers, ALL-CAPS tickers,
anything containing a digit, and short hyphen fragments.

## Layout

```
app/src/main/
  assets/          generated from the TypeScript engine (see tools/)
  java/com/arjun/autocorrect/
    engine/        pure Kotlin - no Android imports, fully unit tested
    data/          asset loading, settings, the single-writer learning store
    history/       reviewable correction records
    service/       AccessibilityService, field guards, the single write path
    ui/            setup, per-app allowlist, history
app/src/test/      65 tests, run against the real shipped dictionary
tools/             regenerates assets from ../src/engine/data/*.ts
```

`engine/` imports nothing from Android — the same discipline that made this port
possible in the first place. Do not break it.

## Known limits

- **Suggestions are not shown.** Only automatic corrections are applied; there
  is no floating UI, which would need an overlay permission and would draw over
  other apps. Everything below the autocorrect threshold is simply declined.
- **Reverting needs the field still focused.** Once focus moves, the record
  stays browsable but can no longer be undone in place — it is never reverted
  from a stale offset.
- **App coverage varies.** Native `EditText` and Compose `BasicTextField`
  expose editable nodes properly. Flutter, many games and some custom views do
  not, and cannot be corrected by any accessibility-based tool.
- **Whole-field rewrites lose rich spans.** Fields with inline formatting may
  flatten. Verified rollback limits the damage but cannot prevent it.

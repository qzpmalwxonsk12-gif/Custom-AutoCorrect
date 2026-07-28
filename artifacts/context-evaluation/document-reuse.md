# Document-reuse evaluation

| document | term | in ESDB | occurrences | capitalised | boost |
|---|---|---|---:|---:|---:|
| fiction with a character name | `Kael` | **no** | 0 | 0 | 0.000 |
| technical writing | `TypeScript` | yes | 2 | 2 | 0.667 |
| technical writing | `contenteditable` | **no** | 0 | 0 | 0.000 |
| product names | `Harper` | yes | 3 | 2 | 1.000 |
| product names | `ChatGPT` | yes | 1 | 1 | 0.333 |
| product names | `Wattpad` | **no** | 0 | 0 | 0.000 |
| genre jargon | `LitRPG` | **no** | 0 | 0 | 0.000 |
| repeated uncommon dictionary word | `committee` | yes | 3 | 0 | 1.000 |
| repeated misspelling | `recieve` | **no** | 0 | 0 | 0.000 |

## Finding

The split is sharper than expected, and it is entirely about ESDB
membership rather than about the signal.

**Boosted** (in ESDB, so evidence accumulates): `TypeScript` (0.667),
`Harper` (1.000), `ChatGPT` (0.333), `committee` (1.000). The 2026 ESDB
release is broader than assumed — `harper`, `typescript` and `chatgpt`
are all in it.

**Not boosted** (absent from ESDB): `Kael`, `LitRPG`, `contenteditable`,
`Wattpad`. These are the invented names and compounds the signal was
primarily meant to help, and it cannot reach them.

The repeated misspelling `recieve` correctly gets zero, which is the
safety rule working: allowing unknown words to accumulate evidence is
exactly what would let a repeated typo justify itself.

So the signal is real but narrower than its motivation. It helps a term
the dictionary already knows and the writer is leaning on; it does
nothing for genuinely novel vocabulary.

## Recommendation

Leave `documentReuse` at weight **0** for now — not because the mechanism
is wrong, but because no *ranking* benefit has been measured. A boost of
1.0 on `committee` only matters if `committee` is competing with another
candidate, and the UD run produced no such case. Activating a signal on
the strength of "it fires" rather than "it decides something correctly"
is the mistake the frequency rollout deliberately avoided.

The experiment that would justify it: corrupt a repeated in-dictionary
term and check whether reuse restores it where frequency alone does not.

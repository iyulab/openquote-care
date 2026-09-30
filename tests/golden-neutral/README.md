# Neutral golden vault

A synthetic vault on the neutral English track: the `care` and `en` packs and nothing of a field or a
region. Every name, number and note in it is made up; no real counselling record was used to build
it. It pins what the core counts and lists when no school or Korean pack is present.

## What it exercises

The scenario covers March–May 2026 for two practitioners on two devices (`pc01`, `pc02`), six
clients and one group:

- sessions with a concern, a mode and notes, and sessions with no notes
- a session with no concern (April): counted in the total, in no row of the monthly report (the
  engine counts it unmapped and lists it as blank), and an empty concern cell — not a gap — in the session list
- a session with no mode (April)
- a group session with two attendees (April): one record, two people
- a client seen twice in a month (March), a session at 23:30 on the last day of a month and one at
  00:10 on the first day of the next
- a concern the core keeps out of suggestions (`safety`, May)

## Layout

```
scenario/            the hand-written source
  *.csv              practitioners, clients (subjects), groups, sessions
  expected-totals.json  hand-computed report counts and session-list rows
generate.cs          turns scenario/ and the app's packs into steps/ and expected/
steps/1/             the vault: the two packs as the app copies them, then the change files
expected/            report runs (r1–r3: March, April, May), the April session list, and keys.json
```

`expected/keys.json` maps every id back to its row in `scenario/`.

## Regenerating

```
dotnet run generate.cs
```

Requires the .NET 10 SDK. Output is deterministic. The pack files are copied from `packs/care` and
`packs/en`, so regenerate after changing either pack. The expected runs and rows are laid out from
`sessions.csv` and checked against the hand-computed counts in `expected-totals.json` before
anything is written; when you change the scenario, update the counts by hand.

## Tests

`tests/OpenquoteCare.Tests/NeutralGoldenVaultTests.cs` runs the engine over this vault and compares
every run and the session list with `expected/`. It also checks that the vault holds only the `care`
and `en` packs and no Korean text, and that a session list form asking for the notes gets an empty,
named column.

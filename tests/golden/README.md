# Golden vault

A synthetic vault used to verify monthly statistics across a classification revision. Every name,
number and school in it is made up; no real counselling record was used to build it.

## What it exercises

The scenario covers March–May 2026 for two counsellors on two devices (`pc01`, `pc02`), and a
revision of the `topic` classification from version 1 to version 2 in late May:

| v1 → v2 | Kind | Outcome for a v1 record |
|---|---|---|
| `depression`, `anxiety` → `emotion` | N:1 | assigned automatically |
| `learning` → `academic` | 1:1, new code | assigned automatically |
| `emotional-behavioral` (label changed) | 1:1, same code | unchanged |
| `relation` → `relation-peer`, `relation-teacher` | 1:N | waits for reclassification |
| `conduct` → `behavior`; `anger` → `behavior`, `anger-mgmt` | N:M | `conduct` is assigned (one link); `anger` waits (two links) |
| `other` → *(no link)* | missing link | reported as unmapped, never placed in a v2 row |

A record is assigned automatically only when its old code has exactly one link.

It also includes:

- a session entered on 20 May for 24 April (a late entry that the April report run on 4 May did not include)
- sessions at 23:30 on the last day of a month and at 00:10 on the first day of the next
- two sessions on the same day, a session with no method, and subjects with empty optional fields
- a month with no records (February)
- two devices editing the same field of one session without seeing each other's change (both
  changes name only the session's creation as their base)
- a second case for the same subject
- a group session (three subjects in one session, kept in the group's folder): one record, three people

## Layout

```
scenario/            the hand-written source
  *.csv              counsellors, subjects, groups, cases, sessions, concurrent edits
  static/<step>/     hand-written schemes, crosswalk and report definitions
  expected-totals.json  hand-computed report counts and diffs
generate.cs          turns scenario/ into steps/ and expected/
steps/<step>/        vault files, one folder per step
expected/            report runs and diffs the engine should produce
invalid/             unreadable change files, overlaid on step 1 for read-validation tests
```

To reproduce the vault state at a step, copy `steps/1` through `steps/<n>` into one folder. Every
file in a later step is new, so the copies never overwrite each other. The steps end where the
report runs happen:

| Run | Report | Period | Vault | Expected result |
|---|---|---|---|---|
| r0 | monthly topic v1 | February | steps 1 | no records |
| r1 | monthly topic v1 | April | steps 1 | 24 records, 13 people |
| r2 | monthly topic v2 | April | steps 1–2 | 25 records (14 people): 17 in rows, 6 pending, 2 unmapped |
| r3 | monthly topic v2 | April | steps 1–3 | 4 pending records reclassified: 21 in rows, 2 pending, 2 unmapped |

`invalid/` holds two files that a reader must report as unreadable while still reading everything
else: a change file cut off halfway through, and a complete change file whose name says `pc02` while
its content says `pc01`.

`expected/diff-r1-r2.json` separates the one late entry from the records that moved because of the
revision (`revised`); `expected/diff-r2-r3.json` holds the records a person reclassified (`moved`). `expected/keys.json` maps every id back to its row in `scenario/`.

## Regenerating

```
dotnet run generate.cs
```

Requires the .NET 10 SDK. Output is deterministic: ids are UUIDv7 values built from each change's
timestamp and its scenario key, so running it again on an unchanged scenario rewrites identical
files.

The expected reports are grouped from `sessions.csv`, where the v2 outcome of every session is
written by hand in the `expect_v2` and `reclassify_to` columns. The generator does not apply the
crosswalk itself. Before writing anything it compares its grouping with the hand-computed counts in
`expected-totals.json` and stops if they disagree. When you change the scenario, update the counts by
hand.

## Tests

`tests/OpenquoteCare.Tests` runs the engine over this vault and compares every run and diff with
`expected/`:

```
dotnet test --solution OpenquoteCare.slnx
```

The tests reference the `Openquote` engine package, restored from nuget.org at the version
`Directory.Packages.props` names. To try an engine change before it is published, pack it from the
[openquote](https://github.com/iyulab/openquote) repository into a local NuGet source.

# Format 1 test pack

A data pack that only tests apply: report forms in format 1 (`openquote.report/1`), a coded
field that takes several values and fields that start from a fixed value (`openquote.fields/1`). No pack the app ships holds either yet, so
this is what the report screen and the window scenarios lay out and enter format 1 with.

| File | What it exercises |
|---|---|
| `reports/test.format1.year-grade-class` | three dimensions — two read from the subject (`grade`, `class`), one classified (`topic`) — over a school year from March, with every measure (`records`, `people`, `visits`) |
| `reports/test.format1.month-girls` | two dimensions, a filter on a subject field (`gender` in `F`), a month, records and visits only |
| `reports/test.format1.range-concerns` | a field holding several values counted by every value (`values: all`), over any stretch of days |
| `fields/test.format1/session` | `concerns`, a coded field (`topic`) taking several values — the vault must be raised to format 1 before it is applied; `counterpart` (`client-type`, starting from `parent`) and `period_minutes` (a number starting from 45), fields that start from a fixed value |
| `labels/test.format1/v1.ko.json` | the fields' Korean labels |

The forms read the fields of the golden vault's students (`tests/golden`), whose step 1 they are
run over in `Format1PackTests`; the expected numbers there were counted from the step's change files
without the engine. The window scenarios apply the pack to a school vault they make.

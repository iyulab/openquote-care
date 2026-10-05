# Openquote Care Constitution

> The philosophy, scope, quality bar and improvement protocol shared by everyone who looks after this project.
> Not a task list — the reference point to come back to when a judgment call could go either way.

---

## 1. Identity and philosophy

**Openquote Care is a free, local desktop app that helps counselors keep the people and cases they follow on record, report on them without counting again, and see each case more clearly — how it is progressing, which past cases resemble it, and what established practice and published measures say about it — with every insight traceable to the records and the standard it rests on.**

Recording once and reporting without recounting are the floor. Better-grounded professional judgment, drawn from records already kept, is what the app builds on that floor.

It is the first product built on the [Openquote engine](https://github.com/iyulab/openquote). The engine knows the record format and nothing about any field of work; this app knows counseling and nothing about any one country or institution. What is specific to a field or a region lives in data packs.

### Layers and tracks

Packs stack in layers, and each builds only on the layers below it: the core profile (`care`), a field of work (`care.school`), a region (`kr`, `en`), a track holding what only a field and a region together need (`care.school.kr`), an institution, and the person's own additions. A pack adds codes, fields, forms and labels; it never changes what a lower layer counts. An item an institution or a person adds is anchored to a code of a lower layer, so reports stay comparable across them.

Counseling approaches and measures are a third axis, independent of field and region. An approach pack (`care.approach.<id>`) holds what one approach records — its techniques and elements as classifications, its own kinds of record, its forms. A measure pack (`care.measure.<id>`) holds a published measure — its items, response options, scoring rules, change and cut-off coefficients with their sources, and the licence under which it may be used, with the date that permission was confirmed. Both build only on the core profile, take their labels from the region, and several may be in use at once, added while a vault is in use. Theories and measures are data, never code: the app renders them and computes from them, it does not hard-code any one school of practice.

One installation serves two tracks. A regional track is built for day-to-day use in one country. A neutral track (`care` with English labels) proves that the core stands without any field or regional pack. A feature enters the core only if it works in the neutral track; what one track alone needs goes into that track's packs.

### The non-negotiable principle

**Counseling records never leave the counselor's control.**

- The records live only on the counselor's own device or in storage the counselor chose (a network share or a sync folder included).
- They open without the app and after any license ends — the files are standard [age](https://age-encryption.org)-encrypted JSON with a published [format](https://github.com/iyulab/openquote/blob/main/docs/format.md).
- Record content, file paths and identifying information never leave the device without the person's permission.

Nothing in this document outranks this principle, and no feature is worth weakening it.

### General principles

| Principle | Meaning |
|---|---|
| **Record once** | What is recorded is not typed again — not to count it, not to move it, not to rebuild its history. |
| **People decide** | The app offers candidates and shows where they came from; a person confirms. An unconfirmed value takes no part in records or statistics. |
| **Classifications change; records stay** | A classification is editable data with versions. A revision is absorbed by a crosswalk from the old version; past records keep their original values and past reports keep their numbers. |
| **Complete on the device** | Every core function works on an ordinary office PC with no GPU and no internet connection, including installing and updating. Analysis and AI that support judgment run on the device by default; a stronger model elsewhere is an addition the person asks for each time, with explicit permission for what is sent, and no core function depends on it. |

### What quality means here

**Every number and every insight goes back to its evidence.** Any count, trend, change judgment or suggestion the app shows opens to the records that make it up, to the classification mapping or scoring rule applied to them, and to the published standard that rule comes from. A number or an insight that cannot be traced is a defect, however convenient it would be.

### When values conflict

**Protecting records > accuracy and traceability of numbers > simplicity > development speed > compatibility of public APIs > performance.**

Reading record files written by an earlier version is record protection, not compatibility: it is never traded away.

---

## 2. Scope boundaries

### The overreach test

A proposed feature must pass one of two tests:

1. **Record once** — does it help a record be written once and be done? It reduces retyping, recounting or rebuilding history.
2. **Better-grounded judgment** — does it help the counselor judge a case better from records already kept, on the basis of a published standard (a measure, an approach, a guideline), with every insight traceable to those records and that standard?

A feature that passes neither is overreach, however attractive. The second test does not admit asking for more input in order to produce more output: making better use of what is already recorded comes before adding to what must be recorded. The app supports judgment and shows its grounds; it does not assess or decide in the counselor's place.

Where a feature belongs:

- It cannot be reinterpreted outside one country → the regional pack, not the core.
- It is specific to one field of counseling → the field pack, not the core.
- A third, unrelated consumer would build it again → upstream (the engine or a shared library), not this app.

**Field and region are independent axes.** With every pack removed, the app must still serve other counseling and care work.

### The app and institutional systems

The app is a personal work tool that stands in front of an institution's own systems: it helps write, count, hand over and prepare input. It exports — rows laid out in a form, tables to copy, files in a required layout — and never integrates directly or fills in another system automatically. Where a field has no institutional system, the field pack takes on duties such as retention rules.

### The app and a hosted service

The dividing question is **"does it finish with the user's own device resources?"** If it does, it belongs in this app. Only what needs a server belongs to a separate hosted service. Such a service:

- never holds the records or the vault key — it relays and stores encrypted files at most;
- talks to the app only over a documented wire protocol;
- never changes the record format or the core design. Requirements flow from the app to a service, not back.

### Non-goals

- No account, no login, no multi-user model inside the app. Several devices sharing a folder is supported; people are not modelled.
- No field for national identification numbers or similar unique identifiers, in the core or in official packs. The app assigns its own management numbers.
- No automatic decision on a split category, a conflicting edit or a crisis-related classification.
- No calls to third-party servers in the default state. The one allowed exception is content-free error diagnostics — built so that they cannot carry record values, paths or messages — kept in a file on the device the person can read (exactly what would be sent) and sent only to a collector the publisher owns, later if it cannot be reached now.
- No model distributed with the app is trained on real counseling records. If synthetic and public data are not enough, the answer is adaptation on the device, never collecting records.

### Licensing and contributions

- This app: GNU AGPL-3.0, with a separate commercial license offered by iyulab. Contributions require the [Contributor License Agreement](../CLA.md).
- The engine: MIT. Code the app shares with any non-AGPL product lives only in permissive upstream packages such as the engine.
- A contribution that reaches into hosted-service features is accepted up to the app's side of the wire protocol.

### Library limits are improvement opportunities

When a library this app builds on cannot do its own job, the fix goes upstream first. A temporary workaround in the app is marked `TODO(upstream: …)` and removed when the fixed release is adopted. **A workaround that would leave a trace in the record format is not made at all** — the app waits for the upstream fix instead.

---

## 3. Quality standards

- **Records are files, and files are not rewritten.** Every change is a new file created with create-new semantics; a record file, once written, is never edited. The only file the app replaces is the wrapped vault key, atomically, when the passphrase changes. The only path that deletes records is destruction a person explicitly asks for.
- **Concurrent edits never win silently.** Both values stay in the records, the conflict is shown, and a person picks.
- **Nothing unreadable disappears.** A file the app cannot read is listed with its reason; everything else is still read.
- **Tests use synthetic data only.** The golden vault and every fixture are made up; no real case or classification source appears in tests, examples or documents.
- **The build is clean.** Type checks, unit tests, the shell's tests and the real-window end-to-end scenarios pass, and `cargo clippy` reports no warnings, before a change is considered done. See [architecture.md](architecture.md) for how to run them.
- **User-facing strings live in one table per language, `src/locales/{ko,en}.ts`** (with `src/native-strings.json` for the shell's messages before a window exists, per language); the app speaks the system's display language, English when it has no table. Code, comments, tests, commit messages and `docs/` are English.
- **Public text describes behaviour.** Commit messages, documents and comments describe what the software does and under which conditions — not where or how an issue was found. Product surfaces name categories, never competing products.

---

## 4. Improvement protocol

Changes fall into three tiers. The dividing line is the record format: **anything that would leave a trace in the records is in the top tier, whatever its size.**

| Tier | What it covers | How it is reported |
|---|---|---|
| **Autonomous** | Bug fixes that do not touch the record format · tests · keeping technical documents in step · following patch and minor releases of dependencies · polishing the UI within established patterns · performance work that leaves the record format unchanged | The commit and its log |
| **Propose, then implement on approval** | New features within scope · data-pack content (default classifications, report forms) · new dependencies · changes to the engine's public API (breaking changes during 0.x included) · replacing a local AI model or how suggestions are made · extending the report-form model | A proposal: what, why, alternatives, and the cost of undoing it |
| **Discuss first** | The record format (change files, encryption, the vault key) · any path by which record content leaves the device · destruction and retention behaviour · rules that assign classifications automatically · allowing suggestions for crisis-related classifications · the boundary with a hosted service · licensing · the non-negotiable principle and the order of values above | An agenda item with options, trade-offs and a recommendation. Work does not start before the decision |

A discussed decision that grants an exception names it narrowly and records why. For example, the passphrase change replaces the wrapped key file — the one exception to "files are not rewritten" — because keeping the old wrapping beside a new one would leave the old passphrase working.

---

## 5. Amending this document

This document changes only through the "discuss first" tier. An amendment states the clause it changes, the reason, and what it gives up. Sections 1 and 2 describe what the product is; they change rarely and on purpose.

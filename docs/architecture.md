# Architecture

This document describes how Openquote Care is put together today: the parts of the app, how they talk to each other, where each kind of state lives, and how records are stored and protected. It is written for contributors and for anyone who wants to know what the app does with their records.

## Overview

Openquote Care has three parts:

| Part | Where | Language | Job |
|---|---|---|---|
| Shell | `src-tauri/`, `crates/vault`, `crates/engine` | Rust (Tauri 2) | Owns the window, the vault folder and the vault key. Encrypts, decrypts and writes files. Starts and stops the engine. |
| Engine sidecar | `sidecar/OpenquoteCare.Sidecar` | .NET | Hosts the [Openquote engine](https://github.com/iyulab/openquote) package: merges change files into current records, classifies, runs reports and exports, and produces new change files. |
| Screens | `src/` | TypeScript, Lit | Everything a person sees. Built on iyulab's `@iyulab/desktop-compact` and `@iyulab/desktop-patterns` component libraries. |

How they talk:

```
 screens (web view)
     │  Tauri commands (invoke) ─────────────┐
     │  "vault-changed" event  ◄──────────┐  │
     ▼                                    │  ▼
 shell (Rust) ── reads/writes .age files in the vault folder
     │
     │  HTTP on 127.0.0.1, bearer token
     ▼
 engine sidecar (.NET) — plaintext in memory only, never touches the disk
```

- **Screens → shell.** The screens call a fixed set of Tauri commands (`src/shell.ts` types them; `src-tauri/src/lib.rs` registers them): create, open and close a vault, confirm the recovery kit, record a change, read entities and schemes, apply a data pack, list the records a report run leaves waiting for a choice, run reports and exports, list and compare report runs, refresh, keep a backup and restore from it, list the changes entities were built from, and write a plain copy. The only other permission the window has is the native folder picker (`src-tauri/capabilities/default.json`).
- **Shell ↔ sidecar.** When a vault opens, the shell starts the sidecar process (through the `loopback` feature of the `tauri-kit-sidecar` crate from [tauri-kit](https://github.com/iyulab/tauri-kit), whose .NET side is the `TauriKit.Sidecar.Loopback` package the sidecar is hosted with) with two environment variables: a fresh 32-byte random token and this computer's device id. The sidecar listens on the loopback address only, on a port the system picks, and announces it as its first line of output (`openquote-sidecar ready port=<n>`). Every request must carry the token as a bearer token; the sidecar compares it in constant time and answers anything else with 401. The shell's HTTP client has proxies turned off.
- **Files, not database calls.** The shell decrypts every record file and posts them to the sidecar (`/vault/load`). To record something, the shell asks the sidecar for a change (`/changes/…`); the sidecar answers with a new file in plaintext; the shell encrypts it and creates it in the vault, and only once it is on disk hands it back to the sidecar (`/vault/add`). A file the vault refused to create never reaches the engine.
- **One vault, one window.** The shell holds at most one open vault. A second start of the app brings the running window forward instead of opening another one, so two windows never write under the same device id.

Closing or locking the vault drops the shell's open-vault state, which stops the sidecar process.

## Records and the source of truth

A vault is an ordinary folder. Its layout and file formats are specified by the engine: see the [vault format](https://github.com/iyulab/openquote/blob/main/docs/format.md).

- **Every change is a new file.** Adding a subject, recording a session, correcting a field, reclassifying a value or running a report each creates one new file. Files are written with create-new semantics (an atomic write that fails rather than replace an existing file). The app never edits or deletes a record file it wrote; the one file it replaces is the wrapped key, when the passphrase changes (below).
- **Current state is derived.** The engine merges all change files into the current records each time the vault is loaded. Nothing derived is written back to the vault or anywhere else.
- **File names carry the device.** Each change file is named `<id>.<device>.json`, with a time-ordered id, so two computers writing into the same folder never pick the same name.
- **A subject is a folder.** Everything recorded about one subject alone lives under `subjects/<subject-id>/`, so handing a subject over means copying that folder.
- **Unreadable files are reported, not fatal.** A file that cannot be decrypted, or that the engine cannot use, is listed in the vault summary; the rest of the vault still opens.

### Shared and synced folders

Because writers never touch the same file, a vault can live in a network share or a folder kept in step by a sync client, and several computers can write to it.

While a vault is open, the shell watches its folder (`Vault::watch` in `crates/vault`, built on `tauri-kit-watch`). Files this app wrote are ignored; when an encrypted record file appears, changes or disappears by any other hand — one by one, or in a folder a sync client moves in or takes away whole — the shell emits a `vault-changed` event. The screens then read the vault again, waiting if the person is in the middle of an action. Some network folders cannot be watched; the vault still opens, and the screens also re-read it when the window regains focus and when the person presses refresh.

Only files ending in `.age` are read as records, so a sync client's temporary files are ignored.

## State boundaries

| Where | What | Shared with others using the vault |
|---|---|---|
| The vault folder | `vault.json` (the declaration), `keys/vault-key.age` (the wrapped vault key), change files for subjects, groups, practitioners and device names, classification schemes and crosswalks, report and export forms, report run records | Yes |
| This computer | The device id (a `device-id` file in the app's local data folder, created on first start); the idle lock setting (the web view's local storage) | No |
| Memory, while the vault is open | The unwrapped vault key (shell); the decrypted files and the merged records (sidecar) | No |

Nothing needed to read a vault is kept outside it. The device id is only used to name new files and to tell this computer's writes apart; the names people give their devices are recorded in the vault as ordinary change files. Report exports (`/exports/run`) lay a month out as rows for the screen and are not kept.

## Encryption and recovery

Encryption is done by the shell (`crates/vault`) with [age](https://age-encryption.org), an open, published file format.

- **The vault key.** Each vault has one age X25519 key. Every record file is encrypted on its own to that key and stored as `<name>.age`. Plaintext is encrypted in memory before it is written; it never touches the disk.
- **Paths inside the vault.** A record path names a file inside the vault folder and nothing else: no `.` or `..`, nothing absolute, no `\` or `:`, not the declaration or anything under `keys/` — and a symbolic link or junction inside the folder that leads out of it is refused too, so a record is never written outside the folder that holds it.
- **The passphrase.** The vault key is stored in the vault as `keys/vault-key.age`, wrapped with the passphrase using age's scrypt mode at a fixed cost (work factor 18), so a vault made on a fast computer still opens in reasonable time on a slow one. A key file demanding more than work factor 20 is refused as damaged. New passphrases must be at least 8 characters.
- **The recovery kit.** When a vault is created, the app shows the unwrapped vault key (`AGE-SECRET-KEY-1…`) in groups for copying by hand, with instructions for opening files without the app. Nothing is written to the folder until the person types back the last 6 characters of the key. Until then the new vault exists only in memory: every other command is refused, and abandoning the screen leaves the folder untouched.
- **Opening with the recovery key.** When the passphrase is forgotten, the open screen takes the recovery key instead, typed as the kit shows it (groups and letter case do not matter). The key is checked against a record file before the vault opens; the passphrase itself stays as it was until the person sets a new one, which the window offers right after opening this way.
- **Opening without the app.** With the recovery key saved to a file, the standard `age` tool decrypts any record file (`age -d -i key.txt <file>.age`) into the JSON the format document describes. `vault.json` is plaintext, since it has to be read before the vault is unlocked.
- **Changing the passphrase.** In an open vault, the person can set a new passphrase (the same rules as a new vault's). The shell wraps the same vault key with it and replaces `keys/vault-key.age` in one atomic step, so the old passphrase stops opening the vault on every computer sharing the folder. Record files and the recovery kit are untouched. Keeping the old key file beside a new one would leave the old passphrase working, which is why this is the one file the app replaces. The key file is replaced only while it still holds what this computer read when it opened the vault: if another computer sharing the folder set a passphrase meanwhile, the change here is refused and says so, and that passphrase stays in force (opening the vault again with it, then changing it, works). The recovery kit opens the vault either way. A vault opened with the recovery key after its key file was lost gets a key file again this way.
- **Idle lock and lock now.** The person can lock the vault at any moment, and the window locks it on its own after a chosen period with no keyboard or mouse use in the window (off, 5, 10, 15, 30 or 60 minutes; 10 by default). This is a setting of the computer, not of the vault. Locking closes the vault exactly as closing does: the shell drops the vault key and stops the sidecar, which discards its copy of every record. The window then asks for the passphrase again for the same folder. Input that was not yet recorded is lost.

- **Backup.** A computer can keep a second copy of the open vault in a folder apart from it (not inside the vault folder, not a folder holding it; empty, or already this vault's backup). The copy holds the vault's files as they are on disk — encrypted — and opens with the same passphrase or recovery key. Record files never change, so keeping it up to date after each write is copying what it lacks; the key file is replaced when the passphrase changes. The folder is a setting of the computer, kept per vault; a backup that fails (a drive unplugged) is reported and never fails the write it follows. The copy also carries a mark at its root, `openquote-care-backup.json` (outside the vault layout, so the engine ignores it): opened in place of the original — when the original cannot be used — the window says for as long as it is open that this folder is a backup copy and that what is written there does not reach the original.
- **What the backup tells.** Because a record file never changes or goes away, a backup of the whole vault (on opening and after reading the folder again) also notices what the vault lost: a record file only the backup holds, or one the two copies hold differently. Then the two copies are compared, decrypting those that differ: a file only the backup holds that decrypts went missing from the vault and can be restored — copied back as a new file, byte for byte; a file the vault cannot decrypt while the backup's copy decrypts is damaged in the vault (it is named and left as it is until the person chooses, after a confirmation, to put the backup's copy in its place: the damaged bytes are first kept, not deleted, in `damaged/<time>/<its path>.damaged` — outside the vault layout and without the encrypted extension, so neither the shell nor the engine reads it as a record — and then the file is replaced in one crash-safe step with the backup's copy, the bytes once written there, only while it still holds the damaged bytes; a file that reads by then, or changed in the meantime, is left alone); a file damaged only in the backup is named; a damaged or missing key file never replaces the backup's, which may be the one sound copy left; when neither or both copies decrypt, which one is sound cannot be told and both are to be kept.
- **A copy that reads without the app.** On request the window writes the vault's merged records — what the engine makes of the change files — as plain files: a self-contained HTML page, two UTF-8 CSV tables and a note. The window decides what goes in (written content only when asked for); the shell decides only where, refusing the vault folder or a folder holding it, refusing any name that is not a plain file name, and replacing nothing. This is the one place the app writes plaintext, so the window says the copy has no passphrase before it is made.

Every vault the app creates is encrypted. A vault whose declaration says it is not encrypted is refused when opening; the app has no unencrypted mode. A folder that lost its declaration but still holds its key file is named as such, and the declaration — the same in every vault of a format — can be written back as a new file.

## Data packs

Classification schemes, crosswalks between scheme versions, report forms, export forms, field definitions and labels are data, not code. They come as data packs: folders with the vault's own layout (schemes under `schemes/`, report forms under `reports/`, export forms under `exports/`, a pack's manifest under `packs/`, labels under `labels/` and field definitions under `fields/`). Only these six folders enter a vault; anything else in a pack folder stays out.

The app bundles packs in layers, each building on the ones below it: `care` (the neutral core: session and subject fields, a short neutral list of concerns, how a session was held, one monthly report and one session list), `en` and `kr` (labels per region), `care.school` (fields of counseling with students) and `care.school.kr` (Korean school counseling: its schemes and forms, and its topic and method fields in place of the core's). `packs/tracks.json` lists the tracks a vault can be made on — the packs it starts from, which bring what they build on — and the app never names a pack in its code.

- **A new vault starts from its track's packs.** Their files are copied into the vault as ordinary encrypted files when the vault is created, each pack after those it builds on. From then on the vault holds its own copy; neither the pack nor the app is needed to interpret it.
- **A vault made before packs named themselves is taken onto a track.** When a vault holds no pack manifest, opening it looks for the track whose bundled files it already holds unchanged — the one it shares the most with, and none that it holds in a different form — and adds that track's files it lacks. No file it holds is changed; when no track fits, nothing is added and the vault still opens. The app says which track it was taken onto. Two devices doing this at once both succeed: adding a file that is already there with the same content is not an error.
- **A vault takes on the newer version of its packs this app carries.** When a vault holds an earlier version of a bundled pack, opening it adds the files of the bundled version (and of the packs it builds on) that the vault lacks, manifests last, and the app says so. No file the vault holds is changed; when it holds one of those files with other content, nothing is added. A pack's later version only adds files, so the vault's records and classifications stay as they were.
- **Fields, forms and labels come from the vault.** The engine sidecar lists the fields a vault's packs declare for each entity type, with their labels and aliases in the vault's locale; forms and scheme items are named the same way. A report or export form that reads a field the packs hide is not offered.
- **Suggestions are learned from settled records, in memory, and never filled in.** While a new session is entered, an empty classification offers the codes the vault's settled sessions suggest for what is filled in so far (the engine's `Openquote.Gil` package, built on [Gil](https://www.nuget.org/packages/Gil); no model). Only items that may be suggested are offered — as a scheme marks them, or as the vault's packs say over it — in the version in force on the session's date; an item a pack marks to confirm (the school pack's crisis-related topics, the core's safety concern) is offered set apart, with a mark asking for care. A settled session is one not destroyed and not changed on two devices at once; who a session is about is never used to compare sessions, what was said in it is. The sidecar builds what it learns from the vault's files on the first request after they change and keeps it in memory only. Each suggested code says how many similar sessions hold it and, on request, which ones — by date and who they are about, never by what they say. Nothing is filled in until a person takes a suggestion; the session's change file then records the field's `source` as `suggestion`, and a person changing the value afterwards makes it the person's own again.
- **Applying a pack adds, never changes.** A person can apply another pack folder to an open vault. Only files the vault lacks are added. A file the vault already holds with the same content is skipped; one with different content stops the whole pack and nothing is added, since definitions are never rewritten.
- **A pack with a manifest is named as a pack.** After applying it, the app names the pack and its version rather than listing its files, and says when the vault's packs do not fit together (a missing dependency or file, a cycle).
- **Lagging forms are flagged.** When the newest version of a report or export form still classifies by an older version of a scheme than the latest one in the vault, the app warns after a pack is applied and again when that form is chosen. Older form versions lag by design, since they serve the months before a revision, so only a form's newest version is checked.
- **Unlinked versions are flagged.** Values reach a new scheme version only through a crosswalk. When a scheme version has no crosswalk from an earlier version of the same scheme — even one that only relabels its items — the app names it after a pack is applied, since every value recorded earlier would be unmapped in forms of that version.

User-facing strings live in one table per language, `src/locales/ko.ts` and `src/locales/en.ts`, held to the same keys by a test; `src/strings.ts` exports the one in use. The app speaks the system's display language — the shell reads it (`ui_locale`) and the window picks the table before its modules load — and English when there is no table for it; `OPENQUOTE_UI_LOCALE` fixes the language (the window tests use `ko`). The few strings the shell shows before any window exists — the notice that the WebView2 runtime is missing — sit in `src/native-strings.json`, per language, which the tables re-export and the shell compiles in. What a data pack names — scheme items, fields, forms — follows the vault's own labels, not the app's language.

## Offline

Everything works without a network. Apart from error diagnostics (below), the only HTTP traffic is between the shell and its own sidecar on the loopback address. The web view's content security policy allows loading only the app's own resources (`default-src 'self'`). There is no account, no usage tracking and no update check.

**Error diagnostics** are content-free by construction, built with `tauri-kit-diagnostics`. When the shell panics, or a command fails through the app's own fault (the engine not starting or answering with an error, a file operation failing — not a wrong passphrase or a folder that is not a vault), or the window meets an error its own code did not handle (handed to the shell as a type name and stack), the shell writes a report: the layer that failed (`shell`, `webview`, or `host` when the engine said what went wrong inside it), a plain type or failure name (`Panic`, `CommandFailed`, `WebviewMissing`, or the engine's exception type), the app's own frames (a place in the workspace's source, or the engine's own methods from its fault answer — never a message), the shell's failure code and the engine's HTTP status as details, and the app version, operating system, architecture and time. Reports are built from that allowlist only; anything that is not a plain identifier is dropped whole, so there is nothing to scrub. They are appended to `diagnostics/reports.jsonl` in the app's local data folder (outside every vault), once per failure per run and at most fifty per run, and the file is trimmed past 1 MB. Sending is off unless a connection string is configured (`OPENQUOTE_DIAGNOSTICS_CONNECTION` at run time, or embedded at build time under the same name); when it is on, what the file gained since the last send goes to an Application Insights collector the publisher owns, in the background at launch and after each new report, and what cannot go out stays for a later send. TLS uses the operating system's certificate store. When sending is on, the first screen says so and shows the file's lines on request; turning reporting off there (remembered beside the file) stops both writing and sending. What is sent, in full: [privacy.md](privacy.md).

## Building and testing

`npm run verify` runs these in order and stops at the first failure (`-- --e2e` adds the window scenarios, `-- --installed` the installer check); `CLAUDE.md` at the root of this repository lists them:

```sh
npm run typecheck && npm test               # screens (vitest)
dotnet test --solution OpenquoteCare.slnx   # sidecar and golden-vault tests
npm run build                               # the shell embeds dist/, so build it before cargo
cargo test --release --workspace            # shell and vault (release: the scrypt unwrap is slow unoptimized)
cargo clippy --workspace --all-targets      # kept at zero warnings
npm run build:sidecar && npm run build:e2e && npm run test:e2e
```

- The shell finds the sidecar through `OPENQUOTE_SIDECAR_EXE` during development; an installed app uses the copy bundled with it. Rust tests that need the sidecar use the variable, else the one `npm run build:sidecar` built, and fail when there is neither — `OPENQUOTE_SKIP_SIDECAR_TESTS=1` leaves them out on purpose, each saying so.
- `npm run test:e2e` drives the real app window over the Chrome DevTools Protocol (WebView2's debugging port) against a fresh temporary folder and checks the files it leaves on disk. The native folder picker is the one step the scenarios set directly.
- `npm run bundle` builds the installer, with the sidecar published ahead-of-time as a single native executable; `npm run test:installed` installs it for the current user (no administrator rights), starts the installed app, runs the shell's command-layer tests against the sidecar the installer bundled, and uninstalls it. `npm run test:upgrade` installs the latest published version, starts it, then installs this build into the same folder and checks the update keeps the app's data and starts. `npm run test:sandbox` installs the latest published offline installer in Windows Sandbox with networking turned off, starts the app, starts the bundled engine and loads an empty vault through it; it reports whether a WebView2 runtime was already there, since the sandbox is a copy of the host's Windows; `-- --without-webview2` removes the runtime inside the sandbox first, so the installer has to bring its own (`-- --prepare` only lays out the folder and the `.wsb` file).
- Releases are built by the `Release` workflow, run by hand after `npm run verify -- --e2e --installed` passes. It builds the engine package from the tag matching the version `Directory.Packages.props` names, signs the engine sidecar, the app and the installer (Authenticode), checks every signature, and attaches the installer to a draft release. Only this build embeds the error-diagnostics connection string.

## Not yet built

The following are not implemented in the current code:

- deleting records on request, and retention reminders
- automatic updates

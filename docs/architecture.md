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

- **Screens → shell.** The screens call a fixed set of Tauri commands (`src/shell.ts` types them; `src-tauri/src/lib.rs` registers them): create, open and close a vault, confirm the recovery kit, record a change, read entities and schemes, apply a data pack, resolve classifications, run reports and exports, list and compare report runs, refresh. The only other permission the window has is the native folder picker (`src-tauri/capabilities/default.json`).
- **Shell ↔ sidecar.** When a vault opens, the shell starts the sidecar process (through the `tauri-kit-sidecar` crate from [tauri-kit](https://github.com/iyulab/tauri-kit)) with two environment variables: a fresh 32-byte random token and this computer's device id. The sidecar listens on the loopback address only, on a port the system picks, and announces it as its first line of output (`openquote-sidecar ready port=<n>`). Every request must carry the token as a bearer token; the sidecar compares it in constant time and answers anything else with 401. The shell's HTTP client has proxies turned off.
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

While a vault is open, the shell watches its folder (`Vault::watch` in `crates/vault`, built on `tauri-kit-watch`). Files this app wrote are ignored; when an encrypted record file appears, changes or disappears by any other hand, the shell emits a `vault-changed` event. The screens then read the vault again, waiting if the person is in the middle of an action. Some network folders cannot be watched; the vault still opens, and the screens also re-read it when the window regains focus and when the person presses refresh.

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
- **The passphrase.** The vault key is stored in the vault as `keys/vault-key.age`, wrapped with the passphrase using age's scrypt mode at a fixed cost (work factor 18), so a vault made on a fast computer still opens in reasonable time on a slow one. A key file demanding more than work factor 20 is refused as damaged. New passphrases must be at least 8 characters.
- **The recovery kit.** When a vault is created, the app shows the unwrapped vault key (`AGE-SECRET-KEY-1…`) in groups for copying by hand, with instructions for opening files without the app. Nothing is written to the folder until the person types back the last 6 characters of the key. Until then the new vault exists only in memory: every other command is refused, and abandoning the screen leaves the folder untouched.
- **Opening with the recovery key.** When the passphrase is forgotten, the open screen takes the recovery key instead, typed as the kit shows it (groups and letter case do not matter). The key is checked against a record file before the vault opens; the passphrase itself stays as it was until the person sets a new one, which the window offers right after opening this way.
- **Opening without the app.** With the recovery key saved to a file, the standard `age` tool decrypts any record file (`age -d -i key.txt <file>.age`) into the JSON the format document describes. `vault.json` is plaintext, since it has to be read before the vault is unlocked.
- **Changing the passphrase.** In an open vault, the person can set a new passphrase (the same rules as a new vault's). The shell wraps the same vault key with it and replaces `keys/vault-key.age` in one atomic step, so the old passphrase stops opening the vault on every computer sharing the folder. Record files and the recovery kit are untouched. Keeping the old key file beside a new one would leave the old passphrase working, which is why this is the one file the app replaces. If two computers change the passphrase at nearly the same time, the last replacement wins; the recovery kit still opens the vault either way. A vault opened with the recovery key after its key file was lost gets a key file again this way.
- **Idle lock and lock now.** The person can lock the vault at any moment, and the window locks it on its own after a chosen period with no keyboard or mouse use in the window (off, 5, 10, 15, 30 or 60 minutes; 10 by default). This is a setting of the computer, not of the vault. Locking closes the vault exactly as closing does: the shell drops the vault key and stops the sidecar, which discards its copy of every record. The window then asks for the passphrase again for the same folder. Input that was not yet recorded is lost.

Every vault the app creates is encrypted. A vault whose declaration says it is not encrypted is refused when opening; the app has no unencrypted mode.

## Data packs

Classification schemes, crosswalks between scheme versions, report forms and export forms are data, not code. They come as a data pack: a folder with the vault's own layout, such as the Korean pack in `packs/care-kr/` (schemes under `schemes/`, report forms under `reports/`, export forms under `exports/`).

- **A new vault starts from the bundled pack.** Its files are copied into the vault as ordinary encrypted files when the vault is created. From then on the vault holds its own copy; neither the pack nor the app is needed to interpret it.
- **Applying a pack adds, never changes.** A person can apply another pack folder to an open vault. Only files the vault lacks are added. A file the vault already holds with the same content is skipped; one with different content stops the whole pack and nothing is added, since definitions are never rewritten.
- **Lagging forms are flagged.** When the newest version of a report or export form still classifies by an older version of a scheme than the latest one in the vault, the app warns after a pack is applied and again when that form is chosen. Older form versions lag by design, since they serve the months before a revision, so only a form's newest version is checked.
- **Unlinked versions are flagged.** Values reach a new scheme version only through a crosswalk. When a scheme version has no crosswalk from an earlier version of the same scheme — even one that only relabels its items — the app names it after a pack is applied, since every value recorded earlier would be unmapped in forms of that version.

User-facing strings in the app are Korean and live in one file, `src/strings.ts`. Pack contents carry their own labels.

## Offline

Everything works without a network. Apart from error diagnostics (below), the only HTTP traffic is between the shell and its own sidecar on the loopback address. The web view's content security policy allows loading only the app's own resources (`default-src 'self'`). There is no account, no usage tracking and no update check.

**Error diagnostics** are content-free by construction. When the shell panics, or a command fails through the app's own fault (the engine not starting or answering with an error, a file operation failing — not a wrong passphrase or a folder that is not a vault), the shell can report that it happened. A report holds only an event name (`app.panic` or `command.failed`), the shell's failure code, the place in the app's own source (`file:line`; a place inside a dependency is reported as `dependency`), the engine's HTTP status if it answered, the type and engine method of an unexpected engine failure (never its message), and the app version, operating system and architecture. The report types have no field for record values, file paths, vault names or error messages, so there is nothing to scrub. Reports go to an Application Insights collector the publisher owns, in the background, at most ten per run; one that cannot be delivered is dropped, never stored or retried. Reporting is off unless a connection string is configured (`OPENQUOTE_DIAGNOSTICS_CONNECTION` at run time, or embedded at build time under the same name); development and test builds send nothing. TLS uses the operating system's certificate store. When reporting is on, the first screen says so. What is sent, in full: [privacy.md](privacy.md).

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

- The shell finds the sidecar through `OPENQUOTE_SIDECAR_EXE` during development; an installed app uses the copy bundled with it. Rust tests that need the sidecar are skipped when the variable is not set.
- `npm run test:e2e` drives the real app window over the Chrome DevTools Protocol (WebView2's debugging port) against a fresh temporary folder and checks the files it leaves on disk. The native folder picker is the one step the scenarios set directly.
- `npm run bundle` builds the installer, with the sidecar published ahead-of-time as a single native executable; `npm run test:installed` installs it for the current user (no administrator rights), starts the installed app, runs the shell's command-layer tests against the sidecar the installer bundled, and uninstalls it. `npm run test:upgrade` installs the latest published version, starts it, then installs this build into the same folder and checks the update keeps the app's data and starts.
- Releases are built by the `Release` workflow, run by hand after `npm run verify -- --e2e --installed` passes. It builds the engine package from the tag matching the version `Directory.Packages.props` names, signs the engine sidecar, the app and the installer (Authenticode), checks every signature, and attaches the installer to a draft release. Only this build embeds the error-diagnostics connection string.

## Not yet built

The following are not implemented in the current code:

- recording which pack version a vault was filled from
- deleting records on request, and retention reminders
- classification suggestions
- automatic updates

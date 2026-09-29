# Openquote Care

**Records for ongoing counseling work that you keep, and reports you never have to count again.**

Openquote Care is a free desktop app for counselors who keep continuing relationships with the people they support. You record subjects, groups and sessions once; the monthly statistics your organisation asks for come out of those records — and when the classification behind those statistics is revised, past records are carried to the new version instead of being recounted by hand.

- **Your records, in your folder.** Records are encrypted files in a folder you choose — on this computer, or a shared network or sync folder several devices use. No account, no server: everything works offline, and the files open with standard [age](https://age-encryption.org) tools even without the app. Released installers report only the app's own failures — never record content — as described in [docs/privacy.md](docs/privacy.md).
- **Record once.** Every edit is a new file and nothing is overwritten, so edits made on different devices are kept side by side until a person picks one.
- **Numbers that trace back.** Every count in a report opens to the records behind it, with the number of different people beside it. Two runs of the same report can be compared record by record.
- **Classifications change; records stay.** A revised classification is linked to the old one. Values that map one way are carried over automatically; a category that was split waits for a person to choose — nothing is guessed.
- **People decide.** The app never settles a conflict, a split category or anything else on its own.

> Status: early development. Windows installers are on the [Releases](https://github.com/iyulab/openquote-care/releases) page.

## What it does today

- Subjects, groups (with their members) and sessions, including group sessions counted once per session and once per person
- Monthly reports from report forms, each run kept in the vault with its evidence; comparison with an earlier run
- Record lists laid out in an export form and copied as a table for a spreadsheet or another system
- Adding and updating subjects from rows pasted out of a spreadsheet
- Applying a data pack: classification schemes, crosswalks between their versions, report and export forms. A Korean school counseling pack is included
- Several devices sharing one vault folder, each named so people can tell whose edit is whose
- Locking the vault on request or after a set idle time
- Opening the vault with the recovery kit when the passphrase is forgotten, and changing the passphrase — the old one then stops opening the vault on every device
- Files the app cannot read (a sync client's conflict copy, a file cut off mid-sync) listed by the record they hold and why, never silently skipped
- Two Windows installers per release, both for the current user without administrator rights: the regular one, and an offline one that also carries the WebView2 runtime installer for a computer that has neither the runtime nor an internet connection

How it is built: [docs/architecture.md](docs/architecture.md). What it will and will not become, and how changes are decided: [docs/CONSTITUTION.md](docs/CONSTITUTION.md). The record format belongs to the [Openquote engine](https://github.com/iyulab/openquote).

## Building

You need Node.js 22, Rust (on Windows the MSVC toolchain), the .NET 10 SDK and, on Windows, the WebView2 runtime. The engine sidecar restores the [Openquote engine](https://github.com/iyulab/openquote) package from nuget.org.

```sh
npm ci
npm run verify          # UI, engine sidecar, shell and vault tests, lints — see docs/architecture.md
npm run tauri dev       # the app, with OPENQUOTE_SIDECAR_EXE set to the sidecar npm run build:sidecar built
```

## License

Openquote Care is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Openquote Care under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.

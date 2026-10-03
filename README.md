# Openquote Care

**Records for ongoing counseling work that you keep, and reports you never have to count again.**

Openquote Care is a free desktop app for counselors who keep continuing relationships with the people they support. You record subjects, groups and sessions once; the monthly statistics your organisation asks for come out of those records — and when the classification behind those statistics is revised, past records are carried to the new version instead of being recounted by hand.

- **Your records, in your folder.** Records are encrypted files in a folder you choose — on this computer, or a shared network or sync folder several devices use. No account, no server: everything works offline, and the files open with standard [age](https://age-encryption.org) tools even without the app. Released installers send the publisher only content-free reports of the app's own failures and a request for the newest version's description — both can be turned off — as described in [docs/privacy.md](docs/privacy.md).
- **Record once.** Every edit is a new file and nothing is overwritten, so edits made on different devices are kept side by side until a person picks one.
- **Numbers that trace back.** Every count in a report opens to the records behind it, with the number of different people beside it. Two runs of the same report can be compared record by record.
- **Classifications change; records stay.** A revised classification is linked to the old one. Values that map one way are carried over automatically; a category that was split waits for a person to choose — nothing is guessed.
- **People decide.** The app never settles a conflict, a split category or anything else on its own.

> Status: early development. Windows installers are on the [Releases](https://github.com/iyulab/openquote-care/releases) page.

## What it does today

- A vault made on a track: counseling in general (in English), or Korean school counseling. The fields a session and a subject have, their classifications and forms come from the vault's data packs, not from the app
- Subjects, groups (with their members) and sessions, including group sessions counted once per session and once per person; what was said in a session kept as written content, which never enters a count or a list
- Statistics from report forms — by day, month, school year or any range of days, split by up to three dimensions (a subject's fields among them) and narrowed by conditions — each run kept in the vault with its evidence; comparison with an earlier run
- Record lists laid out in an export form and copied as a table for a spreadsheet or another system — on the Korean school track, also in the columns and order of the NEIS counseling upload, each session filed under its NEIS category
- Suggested classifications while a session is entered, learned on this computer from the vault's own settled sessions: each with the similar sessions behind it (by date and who they are about), crisis-related ones set apart for a person to confirm, never filled in until a person takes one, and the session keeps that its value came from a suggestion
- A subject's or a practitioner's page shows what their record holds — every field the packs declare for it that has a value — beside their sessions
- Correcting a saved session or what a subject's or a practitioner's record holds (every field the packs declare for it): only the fields changed are written, as an edit of their own, and a corrected session says so
- Adding and updating subjects from rows pasted out of a spreadsheet
- Applying a data pack: classification schemes, crosswalks between their versions, report and export forms, field definitions and labels per language. A pack that needs a newer vault format is applied only once a person chooses to raise it, told which devices use the vault
- A coded field may take several values: a primary one and others that apply; a field may start from a value its pack gives, such as who a session is usually with
- The app in Korean or English, following the system's display language
- Several devices sharing one vault folder, each named so people can tell whose edit is whose
- Locking the vault on request or after a set idle time
- An automatic backup: a second copy of the vault, still encrypted, kept up to date in a folder of your choosing on this computer — another drive or a USB stick. When a record file goes missing from the vault, the backup notices and offers to bring it back
- A copy that reads without the app, written on request into a folder apart from the vault: one page per vault for a browser (what it holds on its first page, a numbered list of subjects, then each subject's fields, sessions and later edits — ready to print, a subject to a page), two tables for a spreadsheet and a note on what the copy is. It holds every record, or a period's sessions and the subjects they are about — a year of records to print and keep. It has no passphrase, so the app says so; session content goes in only when asked for. The screen says when this computer last made a copy of every record, and whether records changed after it
- Every screen laid out the same way: the menu, a list to pick from (subjects, groups, practitioners, forms, settings), and the document of the one picked. The menu folds to its icons; in a narrow window the list and the document take turns
- Opening the vault with the recovery kit when the passphrase is forgotten, and changing the passphrase — the old one then stops opening the vault on every device
- Files the app cannot read (a sync client's conflict copy, a file cut off mid-sync) listed by the record they hold and why, never silently skipped
- Two Windows installers per release, both for the current user without administrator rights: the regular one, and an offline one that also carries the WebView2 runtime installer for a computer that has neither the runtime nor an internet connection
- Updating itself: a released installer looks for a newer version when it opens and every twelve hours, says when there is one and, when you choose to, downloads it, checks it against the publisher's key, closes the vault and starts again as the new version. The check can be turned off on the first screen ([what it asks](docs/privacy.md#new-versions))

How it is built: [docs/architecture.md](docs/architecture.md). What it will and will not become, and how changes are decided: [docs/CONSTITUTION.md](docs/CONSTITUTION.md). The record format belongs to the [Openquote engine](https://github.com/iyulab/openquote).

## Building

You need Node.js 22, Rust (on Windows the MSVC toolchain), the .NET 10 SDK and, on Windows, the WebView2 runtime. The engine sidecar restores the [Openquote engine](https://github.com/iyulab/openquote) package from nuget.org.

```sh
npm ci
npm run verify          # UI, engine sidecar, shell and vault tests, lints — see docs/architecture.md
npm run tauri dev       # the app, with OPENQUOTE_SIDECAR_EXE set to the sidecar npm run build:sidecar built
                        # (OPENQUOTE_UI_LOCALE=en or ko fixes the app's language; it follows the system otherwise)
```

## License

Openquote Care is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Openquote Care under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.

The app includes third-party software under its own licenses; their notices and license texts ship with it, in `licenses/THIRD-PARTY-NOTICES.txt` next to the installed app ([the same file here](LICENSES/THIRD-PARTY-NOTICES.txt)).

# Openquote Care

**Records for ongoing counseling work that you keep, and reports you never have to count again.**

Openquote Care is a free desktop app for counselors who keep continuing relationships with the people they support. You record subjects, groups and sessions once; the monthly statistics your organisation asks for come out of those records — and when the classification behind those statistics is revised, past records are carried to the new version instead of being recounted by hand.

- **Your records, in your folder.** Records are encrypted files in a folder you choose — on this computer, or a shared network or sync folder several devices use. No account, no server: everything works offline, and the files open with standard [age](https://age-encryption.org) tools even without the app.
- **Record once.** Every edit is a new file and nothing is overwritten, so edits made on different devices are kept side by side until a person picks one.
- **Numbers that trace back.** Every count in a report opens to the records behind it, with the number of different people beside it. Two runs of the same report can be compared record by record.
- **Classifications change; records stay.** A revised classification is linked to the old one. Values that map one way are carried over automatically; a category that was split waits for a person to choose — nothing is guessed.
- **People decide.** The app never settles a conflict, a split category or anything else on its own.

> Status: early development. Nothing is released yet. The first release targets Windows.

## What it does today

- Subjects, groups (with their members) and sessions, including group sessions counted once per session and once per person
- Monthly reports from report forms, each run kept in the vault with its evidence; comparison with an earlier run
- Record lists laid out in an export form and copied as a table for a spreadsheet or another system
- Adding and updating subjects from rows pasted out of a spreadsheet
- Applying a data pack: classification schemes, crosswalks between their versions, report and export forms. A Korean school counseling pack is included
- Several devices sharing one vault folder, each named so people can tell whose edit is whose
- Locking the vault on request or after a set idle time

How it is built: [docs/architecture.md](docs/architecture.md). The record format belongs to the [Openquote engine](https://github.com/iyulab/openquote).

## License

Openquote Care is licensed under the [GNU Affero General Public License v3.0](LICENSE). iyulab holds the copyright and also offers Openquote Care under a separate commercial license for organizations that cannot adopt AGPL-3.0 terms.

Contributions require agreeing to the [Contributor License Agreement](CLA.md) — see its Signing section.

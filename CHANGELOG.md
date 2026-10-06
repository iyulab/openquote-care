# Changelog

What changes for the people who use Openquote Care, version by version. Each release's notes are its section here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Versions before 0.11.1 are described in their [release notes](https://github.com/iyulab/openquote-care/releases).

## [Unreleased]

### Fixed
- The choice that hides names in the list of records now says on each option that it is about names ("Names as written", "First letters only", "Numbers for names"). Before, the options read without saying what they changed.

## [0.13.0] - 2026-10-06

### Added
- The list of records can hide names in what it shows, prints and copies: as written, the first letter only, or a number for each person (the same number wherever the same name appears). The records themselves are unchanged, and the copy that reads without the app keeps the names.
- On a person's page, each list of records — sessions, intakes, referrals, closings — goes case by case, the latest case first, each under a line with its days and whether it is open or ended. Records with no date come last, apart.
- The copy that reads without the app lists each person's cases under their name, newest first, with what each holds. A copy over a period lists the cases that reach into it.

### Changed
- Sending feedback now says, before you send, what the message is used for, how long it is kept, that not sending limits nothing, and where to read the full notice and have it deleted.

## [0.12.0] - 2026-10-06

### Added
- Closings are counted by how they ended as well as by their reason: ended as planned (completed as planned, or moved to another service), ended early (lost contact, or declined by the person or by the family), or ended for another reason (request withdrawn, moved away, or other). A new monthly form, "Closings by how they ended", counts them by practitioner. A records folder made before this version asks once to raise its format before it takes the new form.
- A person's page shows their cases: from an intake to the closing that ends it, each with its days, whether it is open or ended, and what it holds by kind of record. Records written after a closing — a follow-up, say — stay with that case, and a second intake starts a new one. The list of people says whether each person's latest case is open or ended. Nothing new is written to the records folder: the cases are read from the records each time.

### Changed
- A person's kinds of record are always in the order the work takes — intake, sessions, referrals, closing — even before any is written. Before, a new person's showed in another order until records came in.

## [0.11.1] - 2026-10-06

### Fixed
- What you type while correcting a session, an intake, a person or a practitioner now stays when the app reads the records folder again — on returning to the window, or when a change from another computer sharing the folder arrives. Before, the form could go back to what was saved.
- The copy that reads without the app now counts every kind of record. Its first page gives the number of intakes, sessions, referrals and closings; a person with only an intake no longer reads "no sessions"; each person's records appear kind by kind in the order the work took (intake, sessions, referrals, closing); and the note in the copy names every table in it.
- Intakes, referrals and closings now start on the practitioner when the records folder has only one, as sessions do.
- Finding records now says what it looks through: every kind of record, not sessions only.
- In the NEIS upload list, a group session's names are listed in the order of the names. Before, two people added at almost the same moment could appear in either order.

### Changed
- In an English copy, each kind's table is named in the plural: intakes.csv, referrals.csv, closings.csv (sessions.csv as before).

[Unreleased]: https://github.com/iyulab/openquote-care/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/iyulab/openquote-care/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/iyulab/openquote-care/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/iyulab/openquote-care/compare/v0.11.0...v0.11.1

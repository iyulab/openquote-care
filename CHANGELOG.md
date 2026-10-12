# Changelog

What changes for the people who use Openquote Care, version by version. Each release's notes are its section here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Versions before 0.11.1 are described in their [release notes](https://github.com/iyulab/openquote-care/releases).

## [Unreleased]

### Added
- Above the list of people, "Meeting today" (오늘 만날 사람) counts the people whose next session is today — the day their latest session names under "Next session", so a later session takes the place of what an earlier one planned. Pressing it keeps those people in view, and the list says "meeting today" beside each. The app counts dates only and sends no reminders.
- Each line of a case's timeline says who did it — the practitioner its record names — so a case several people work on shows each one's part. The lines share their columns: day, kind, what, who.

### Changed
- "Apply a classification revision…" is in the records folder's menu, beside "Reload", in place of a button over the lists of statistics and record list forms. Wherever it is chosen, the app shows the statistics screen, where it says what the revision brought and picks the form it updates.

### Fixed
- Numbers in the lists of records read as numbers do — an amount of 120000 shows as 120,000 — and their columns line up on the right.
- The two choices above the list of people — which cases to keep in view and the order — stand one under the other when the list is narrow, so a long name such as "Waiting for an answer" is no longer cut short.

## [0.19.0] - 2026-10-12

### Changed
- The app is now published as `me.openquote.care`, the name of its own website, in place of an identifier under the company that started it. Updating changes nothing a person sees: the update installs into the same folder, and on its first start the app moves its own data — the computer's name among the devices sharing a records folder, the installation's number, the recent records folders and settings — to the folder the new name gives it. Records folders are not touched.

### Fixed
- A form adding up numbers of a kind of record other than sessions — sessions and amounts of provisions — names each sum by the field's label in the vault's language; since 0.18.0 it showed the field's internal name.
- Record lists opens on the list of sessions again, as Statistics opens on a form counting sessions; since 0.18.0 it opened on the provision list.

## [0.18.0] - 2026-10-12

### Added
- Provisions (제공 기록): a new kind of record under a person or a group for what an outside practitioner or service provided and what it cost — the day, the referral it follows (picked from the person's own referrals, named by its day and where to), the programme (counselling by an outside practitioner, treatment funding, other), the provider, the number of sessions and the amount. Statistics lists "Provision by programme" — a month's provisions, the people they reached, and their sessions and amounts added up — and Record lists has "Provision list". The app keeps no accounts: budgets and payments stay in the systems that hold them.
- Above the list of people, "Waiting for an answer" (답을 기다리는 기록) counts the people with a referral whose outcome has not come back — none entered yet, or still "referred, not started yet". Pressing it keeps those people in view, each with the day the oldest such referral was made and how many days ago. The list can be narrowed the same way. The app counts dates only and sends no reminders.

### Changed
- Each line of a case's timeline opens its record: pressing it brings the record's row into view in its list, its written content shown.

## [0.17.0] - 2026-10-10

### Added
- Scales: "Main problem severity" — the practitioner's own rating of the person's main problem, from 0 (none) to 4 (most severe), kept as a scale score. Rated when a case opens and again when it closes, the case shows the first and last rating and the difference between them, as for any scale. The app does not rate or judge anything itself.
- "Scale scores of closed cases" counts, for each scale, the closed cases whose last score is the same as the first, above it or below it.
- A record that opens or closes a case can carry a scale score: pick the scale and enter the score in the same form, and it is kept as a scale score of the same day. A closing starts from the scale its case was rated on when it opened, so the two pair.
- Statistics lists "Closings by who brought them and how they ended" (유입 경로별 종결 유형): a month's closings counted by the intake of the case each one closed — who brought the person — against whether the case ended as planned, early or for another reason. A case with no intake is counted apart.
- A person's page shows each case's timeline — every record of the case by date, its kind and its first values, those after it ended marked — open for the latest case. A scale with more than two scores in a case lists every score by date beside a small line over the scale's whole range; nothing is coloured or banded, and nothing says better or worse. The copy that reads without the app gives each case's first and last score of every scale.
- The list of people says what asks for something: follow-ups past their day and open cases with no session yet are counted above the list, each a button that keeps those people in view. The list can be narrowed to open cases with no session yet, and ordered by the longest since a session — then each open case says when its last session was and how many days ago, or since when it has had none. The app counts dates only; it judges nothing and sends no reminders.
- Goals: a new kind of record under a person — the day a goal was set, the goal in a few words, whether it was agreed with the person, and notes. A goal written again later is kept beside the earlier one, so a case shows how its goals changed; goals appear in the case's timeline.
- A session can say when the next session is; in school vaults it also says the next step — go on or close the case — as the session form of the Wee guidance asks. Both are columns of the session list, after the classifications.

### Changed
- A record written on the day a case closed — a score or a note taken that day — now stays in that case, and a follow-up is the person's first record on a later day. A new intake on the closing day still starts the next case.

## [0.16.0] - 2026-10-08

### Added
- School vaults: a session can be with an agency worker ("타기관" — someone from another service, about a student), counted apart from parents, teachers and others; and statistics lists "월별 NEIS 분류별 상담" — sessions, people, visits and minutes by NEIS category for each month.
- The notice of a new version shows the app's quote mark too: the open quote when it is found, dots while it downloads, the two quotes facing each other once it is ready to install.
- After a closing, a school vault expects a follow-up within 28 days. A case shows the date the follow-up is due, whether it is overdue, or that it took place. The list of subjects can be narrowed to "Follow-up overdue". Any later record of the student counts as the follow-up. The app makes no judgement about the student and sends no reminders.
- Scale scores: a new kind of record under a person — the day, the scale (PHQ-9 or GAD-7), the total score and notes. On the person's page each case shows, for each scale, its first score and its last up to the closing, and the difference between them when they fall on two different days; a score outside the scale's range is not read, and the case says how many. The app does not say whether a score or a change is good or bad, and asks nothing by the score.
- Statistics lists "Scale scores of closed cases": for a period, each scale's closed cases with a score and with scores on two days, each case's first and last score with the difference, and how many closed cases have no score at all. It counts and subtracts only.

## [0.15.0] - 2026-10-08

### Added
- The toolbar of an open vault says "Saving" and, for a moment, "Saved" for every record written, with the app's quote mark: dots while it saves, the two quotes facing each other once saved. Opening a vault says it is opening, and sent feedback shows the same "done" mark.

### Changed
- A case's heading names the day it ended once, in its days, and a case that began and ended on one day shows that day once.
- Released installers now also tell the publisher when the app starts and ends and how long each screen was used, under a random number for the installation — never what a screen showed. "See what is sent" on the first screen shows these lines beside the error reports, exactly as sent.
- A new version is downloaded in the background and installed when you close the app, without starting it again; "Update now" still installs it at once.
- Error reports and this usage information can no longer be turned off ("Stop sending" is gone) while the app is young; an option to turn them off is planned once it is stable.

## [0.14.1] - 2026-10-06

### Fixed
- A category a person has to confirm (such as a crisis) is offered whenever the most similar saved record holds it. A category saved rarely could be left out of the few suggestions, behind the categories chosen often.

## [0.14.0] - 2026-10-06

### Added
- The list of subjects can be searched by name or by what their record holds, kept to open or ended cases, and ordered by name or by the latest record. Each row says the subject's latest record day.
- In a report, rows that count nothing can be hidden on screen ("Hide empty rows"); a printed report keeps every row of the form.
- A record listed under a count opens where it is kept: its date takes you to the subject's or group's records with it in view.
- When the page is wide enough (the list folded, the menu at its icons), the records a count is made of stay beside the table instead of under it.
- Every list can be folded away for a wide page ("Hide the list"), and brought back from the top of the page.
- Keyboard shortcuts: Ctrl+K finds a subject, Ctrl+N starts a new session for the subject on screen, Ctrl+Enter saves the record being written, ← and → step the month in statistics and record lists, and ? lists them.
- A wide record list keeps its first columns — through the column naming who a row is about — in view while it scrolls across, and shades the edge that has more beyond it. Long tables keep their header row in view.

### Changed
- The menu has one set of drawn icons, and its group names read as small headings over their places.
- "Reload" and "Close vault" moved into the "Vault" menu at the top; "Lock now" stays one press away.
- A session's form is in three parts — basics, categories, written — each under its name.
- Report forms are listed under the span they count: monthly, yearly, by school year, one day, over a period.
- Fields to type and pick in sit on white, like the cards around them, instead of the page's paper color.
- Statistics and the list of records pick a month on one line: a step back, the year, the month, a step on. A year is now picked from a list instead of typed.
- "Apply classification revision" moved from beside "Run" to the top of the list of forms: it changes the folder's forms and categories, not one report.
- In a report, a count of nought reads in quieter text, so the counts that lead to records stand out. The count whose records are listed is marked in the table, and the list comes right under the table.
- Figures that ask for attention — awaiting reclassification, outside the crosswalk — step back to a plain outline while they are nought.
- A form's version shows in its name only when the folder holds more than one version of that form.
- A page no longer repeats where you are above its heading; the bar at the top already says it.
- A person's details read on one line under their name instead of a row each.
- A suggested category shows the category first and why it is suggested after it, smaller. "Why these are suggested" opens and closes under the same name, and lists each similar record on its own.
- The selected entry in the menu and in a list sits on a ground that stands apart from the menu and the page.

## [0.13.1] - 2026-10-06

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

[Unreleased]: https://github.com/iyulab/openquote-care/compare/v0.19.0...HEAD
[0.19.0]: https://github.com/iyulab/openquote-care/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/iyulab/openquote-care/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/iyulab/openquote-care/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/iyulab/openquote-care/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/iyulab/openquote-care/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/iyulab/openquote-care/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/iyulab/openquote-care/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/iyulab/openquote-care/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/iyulab/openquote-care/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/iyulab/openquote-care/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/iyulab/openquote-care/compare/v0.11.0...v0.11.1

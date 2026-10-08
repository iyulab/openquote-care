# Privacy

Openquote Care keeps counseling records on the devices and folders you choose. This page lists everything the app sends or asks anywhere else.

## Records

The app writes records, encrypted, only to the vault folder you choose — which may be a shared network or sync folder you set up. It sends record content, file paths, vault names and anything that identifies a person nowhere else. Nor does it keep them anywhere else on the device: the window does not remember what is typed into it (form autofill is off, and entries an earlier version kept are cleared when the app starts). The app has no account and needs no server; every feature works offline.

## Error diagnostics

Released installers report the app's own failures to the publisher, so that defects can be found and fixed while the app is young. Builds made from source send nothing unless a collector is configured for them.

**When.** A report is written when the app crashes, when it cannot start because the system's web view runtime (Microsoft Edge WebView2) is missing, when the window meets an error its own code did not handle, or when an action fails through the app's own fault — the engine not starting or answering with an error, a file operation failing, or the feedback service refusing a message (which means the app's own key or address is wrong). A wrong passphrase, a folder that is not a vault and other situations a person can resolve are not reported.

**What.** A report holds only:

| Field | Example |
| --- | --- |
| The part of the app that failed | `shell` (the app's own process), `webview` (its window) or `host` (its engine) |
| What failed: the error's type, or the app's own name for the failure | `Panic`, `WebviewMissing`, `CommandFailed`, `TypeError`, `System.FormatException` |
| Places in the app's own code: a source file and position in the app or its window's scripts, or the engine's own methods | `src/lib.rs:42:9`, `save index-a1.js:3:120`, `Openquote.Vault.VaultReader.Read` |
| The app's failure code | `engine-start`, `engine`, `io` or `feedback-refused` |
| The engine's HTTP status, when it answered | `500` |
| App version, operating system, architecture, time (UTC) | `0.1.3`, `windows`, `x86_64`, `2026-10-02T09:00:00Z` |

A report is built only from what is listed here, never by removing what looks private: a name that is not a plain identifier is replaced whole by `Unrecognized`, a place outside the app's own code (a dependency, a path on the machine that built it) is left out whole, and there is no field for record values, file paths, vault names or error messages, so none can be included by accident.

**Kept on the device first.** Each report is written as one line to `diagnostics/reports.jsonl` in the app's own data folder on this computer (on Windows, `%LOCALAPPDATA%\com.iyulab.openquote-care`), outside every vault — exactly what would be sent, readable with any text editor. The same failure is written once per run, at most fifty reports per run, and the file is cut back to its newest reports once it passes 1 MB.

**Seeing it.** The first screen says what a released installer sends and offers *See what is sent*, which shows the lines of both files — these reports and the usage information below — exactly as written. Reporting is not something to turn off in this version; an option to turn it off, with a way to send recent failures by hand, is planned once the app is stable.

**Where.** What the file gained since the last send goes, in the background when the app opens, after each new report and when the app ends, to an Azure Application Insights resource the publisher owns (Korea Central), over TLS using the operating system's certificate store, and is kept there for 30 days. A report that cannot go out — offline, on a network that blocks it, or while the service is busy — stays in the file and goes the next time; the app works the same either way.

## New versions

Released installers look for a newer version of the app, so that fixes reach the people using it. Builds made from source never look.

**What goes out.** When the app opens, and every twelve hours while it stays open, it asks one fixed address for the description of the newest released version: `https://github.com/iyulab/openquote-care/releases/latest/download/latest.json`, a file on GitHub, where the app is published. The request carries nothing the app adds — no version number, no identifier, nothing about your records or this computer; GitHub sees what any download shows it, such as the network address it comes from.

**What happens then.** When the description names a newer version, the app says so and offers to update. Nothing is downloaded until you choose to. Then the new installer is downloaded from the same place, checked against the publisher's key the app carries (an installer that does not verify is not run), the open vault is closed, and the installer replaces the app and starts it again. Your vaults and settings are not touched.

**Stopping it.** The first screen says that the app looks for new versions and offers *Stop looking for new versions*; turned off, it asks nothing until turned on again. New versions can always be downloaded from the website instead. No network, or one that blocks the address, is not an error: the app works the same.

## Feedback

Released installers let you send a message to the publisher — something in the way, a feature you want — once the publisher's records service takes messages from the app; until then, and in builds made from source, the screen does not offer it. Nothing is sent unless you write a message and press *Send*.

**What goes out.** The message as you wrote it, the email address you gave for a reply (only if you gave one), the app version, the operating system and architecture, and the app's display language. The screen lists these before you send. The app adds nothing about your records, your vault or this computer, and it does not read or change what you wrote — so do not write counseling content or the names of clients, students or schools in it; the screen says so too.

**Where.** To the publisher's own records service (`api.iyulab.com`, run by iyulab, hosted on Microsoft Azure in Korea Central), over TLS using the operating system's certificate store. The service keeps the time of the message and the network address it came from with it. A message that cannot be sent — offline, or the service busy — is not kept or retried by the app: it stays on the screen for you to send again.

**Use, keeping and deletion.** A message is used only to improve the app and its website and to reply to you, and kept until you ask for it to be deleted. The publisher's notice on personal details ([openquote.me/en/privacy](https://openquote.me/en/privacy), in Korean at [openquote.me/privacy](https://openquote.me/privacy)) covers it, with a form to have everything under an email address deleted and how to ask for anything else. Not sending a message limits nothing in the app.

## Usage information

Released installers tell the publisher when the app starts and ends and how long each of its screens was used, so that the screens people rely on can be improved first.

**What.** One line when the app starts, one when it ends as it should, and — at the next start — one for a run that did not end (the app crashed, or the system ended it). Each line holds only:

| Field | Example |
| --- | --- |
| A random number for this installation, made on this computer the first time the app runs | `f52197a2812feee97bb900f4257ef395` |
| A random number for this run of the app | `6c0ad7d91f91a74f784a1232eb302dc2` |
| App version, operating system, architecture, time (UTC) | `0.15.0`, `windows`, `x86_64`, `2026-10-08T05:05:29Z` |
| At the start: the language of the app's screens, and what the app is set up for (the kind of vault it offers first) | `ko`, `school-kr` |
| At the end: how long the run lasted, and for each screen how often it was opened and for how long | `welcome`: opened 1 time, 7 seconds |

The installation's number is not made from anything about the computer, the account or the person: it is random, and deleting the file that keeps it makes a new one. Screens are counted under a fixed list of the app's own names (`welcome`, `vault:report`, …), never by what a screen showed — no record, name, search or value a person typed or opened is in any line, and there is no field for one.

**Kept on the device first, and seen.** The lines are written to `diagnostics/sessions.jsonl` beside the error reports, in the same folder outside every vault, and *See what is sent* on the first screen shows them exactly as written. They go to the same place as the error reports, the same way.

**Turning it off.** Not in this version: like error reports, usage information is part of how the app is kept working while it is young. An option to turn both off is planned once the app is stable.

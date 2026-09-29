# Privacy

Openquote Care keeps counseling records on the devices and folders you choose. This page lists everything the app sends anywhere else.

## Records

The app writes records, encrypted, only to the vault folder you choose — which may be a shared network or sync folder you set up. It sends record content, file paths, vault names and anything that identifies a person nowhere else. The app has no account and needs no server; every feature works offline.

## Error diagnostics

Released installers report the app's own failures to the publisher, so that defects can be found and fixed while the app is young. Builds made from source send nothing unless a collector is configured for them.

**When.** A report is sent when the app crashes, or when an action fails through the app's own fault — the engine not starting or answering with an error, or a file operation failing. A wrong passphrase, a folder that is not a vault and other situations a person can resolve are not reported.

**What.** A report holds only:

| Field | Example |
| --- | --- |
| Event | `app.panic` or `command.failed` |
| Failure code | `engine-start`, `engine` or `io` |
| Place in the app's source | `src-tauri/src/lib.rs:42` (a place inside a dependency is reported as `dependency`) |
| The engine's HTTP status, when it answered | `500` |
| When the engine failed unexpectedly: the error's type and the method in the engine where it happened | `System.FormatException`, `Openquote.Vault.VaultReader.Read` |
| App version, operating system, architecture | `0.1.0`, `windows`, `x86_64` |

The report types have no field for record values, file paths, vault names or error messages, so none can be included by accident; the engine's two names are kept only when they are plain identifiers.

**Where.** Reports go to an Azure Application Insights resource the publisher owns (Korea Central), over TLS using the operating system's certificate store, and are kept for 30 days.

**How much.** At most ten reports per run, sent in the background. A report that cannot be delivered — offline, or on a network that blocks it — is dropped; nothing is stored or retried, and the app works the same.

## Usage information

The app sends no usage information. If it ever does, it will be off until you turn it on.

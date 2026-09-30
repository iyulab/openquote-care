# openquote-care

A desktop app (Tauri 2 shell in Rust, a .NET engine sidecar, a Lit UI) built on the `Openquote` engine. See [README.md](README.md).

## Language

- Code, comments, tests, commit messages and `docs/` are English.
- Strings people see in the app live in one table per language: `src/locales/ko.ts` and `src/locales/en.ts`, with the same keys (a test holds them to it). The few the shell shows before a window exists sit in `src/native-strings.json`, per language. The app speaks the system's display language (English when there is no table); `OPENQUOTE_UI_LOCALE` fixes it.
- The Korean data pack (`packs/care-kr/`) carries Korean labels; its structure keys stay English.

## Rules

- A record file, once written, is never modified (the wrapped key file is the one exception, replaced atomically when the passphrase changes); the shell encrypts every record file (age) and the engine sees plaintext only.
- Record content, file paths and identifying information never leave the device without the person's permission.
- Public text describes observable behaviour and the conditions that trigger it — never where or how an issue was found.

## Build and test

```sh
npm run verify                  # every check below, in order, stopping at the first failure
npm run verify -- --e2e         # and the real window over CDP
npm run verify -- --installed   # and the installer: bundle, install, run, uninstall, update over the published version
```

The checks it runs:

```sh
npm run typecheck && npm test            # UI
dotnet test --solution OpenquoteCare.slnx
npm run build                            # the shell embeds dist/
cargo test --release --workspace
cargo clippy --workspace --all-targets   # no warnings
npm run build:sidecar && npm run build:e2e && npm run test:e2e   # the real window over CDP
```

Before the checks, `verify` checks the machine: Rust on the MSVC toolchain, a `dotnet` on PATH, and — when `DOTNET_ROOT` is unset and .NET is a per-user install — it points `DOTNET_ROOT` at that `dotnet` for the sidecar. The first check is that every file naming the app version names the same one (`node scripts/check-versions.mjs`).

A window scenario that fails only sometimes: `npm run test:e2e -- --through <part of its name> --repeat <n>` runs the scenarios up to it n times, each in a fresh folder and window.

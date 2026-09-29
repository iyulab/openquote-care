# openquote-care

A desktop app (Tauri 2 shell in Rust, a .NET engine sidecar, a Lit UI) built on the `Openquote` engine. See [README.md](README.md).

## Language

- Code, comments, tests, commit messages and `docs/` are English.
- Strings people see in the app are Korean and live in one place: `src/strings.ts`.
- The Korean data pack (`packs/care-kr/`) carries Korean labels; its structure keys stay English.

## Rules

- A record file, once written, is never modified (the wrapped key file is the one exception, replaced atomically when the passphrase changes); the shell encrypts every record file (age) and the engine sees plaintext only.
- Record content, file paths and identifying information never leave the device without the person's permission.
- Public text describes observable behaviour and the conditions that trigger it — never where or how an issue was found.

## Build and test

```sh
npm run verify                  # every check below, in order, stopping at the first failure
npm run verify -- --e2e         # and the real window over CDP
npm run verify -- --installed   # and the installer: bundle, install, run, uninstall
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

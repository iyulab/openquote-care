//! Finds the engine sidecar for the tests that run it.
//!
//! A test that needs the sidecar and cannot find it fails rather than passing without having run:
//! a green `cargo test` means the engine was exercised. To leave those tests out on purpose (no
//! .NET SDK at hand), set `OPENQUOTE_SKIP_SIDECAR_TESTS=1`; each one then says it was skipped.

use std::path::{Path, PathBuf};

/// Set to leave the tests that need the sidecar out, instead of failing them.
pub const SKIP_VAR: &str = "OPENQUOTE_SKIP_SIDECAR_TESTS";

/// The sidecar executable to test against: `OPENQUOTE_SIDECAR_EXE` if set, otherwise the one
/// `npm run build:sidecar` builds in this workspace. `None` only when [`SKIP_VAR`] is set and no
/// sidecar is found — the caller returns early. Panics when there is no sidecar and no opt-out.
pub fn sidecar() -> Option<PathBuf> {
    if let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") {
        let exe = PathBuf::from(exe);
        assert!(
            exe.is_file(),
            "OPENQUOTE_SIDECAR_EXE names no file: {}",
            exe.display()
        );
        return Some(exe);
    }
    let built = built_sidecar();
    if built.is_file() {
        return Some(built);
    }
    if std::env::var_os(SKIP_VAR).is_some_and(|v| !v.is_empty()) {
        eprintln!("skipped: no engine sidecar ({SKIP_VAR} is set)");
        return None;
    }
    panic!(
        "no engine sidecar at {} — run `npm run build:sidecar`, set OPENQUOTE_SIDECAR_EXE to one, \
         or set {SKIP_VAR}=1 to skip the tests that need it",
        built.display()
    )
}

/// Where `npm run build:sidecar` puts the sidecar.
fn built_sidecar() -> PathBuf {
    let name = if cfg!(windows) {
        "openquote-care-sidecar.exe"
    } else {
        "openquote-care-sidecar"
    };
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/test-support sits two levels down");
    workspace
        .join("sidecar")
        .join("OpenquoteCare.Sidecar")
        .join("bin")
        .join("Release")
        .join("net10.0")
        .join(name)
}

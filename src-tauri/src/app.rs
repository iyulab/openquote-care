//! What the window can ask the shell to do, without the window. Each operation here backs one
//! command in `lib.rs`; keeping them apart lets the flows be tested without a Tauri runtime.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use age::secrecy::SecretString;
use openquote_care_engine::{Engine, EngineError, OpenVault, PlainFile};
use openquote_care_vault::{Vault, VaultError};
use serde_json::Value;

/// How many trailing characters of the recovery key a person types back to show they kept it.
const KIT_CONFIRMATION_LENGTH: usize = 6;

/// Why a command failed, in words the window can show.
#[derive(Debug)]
pub enum AppError {
    NoVault,
    RecoveryKitNotConfirmed,
    RecoveryKitMismatch,
    Engine(EngineError),
    Io(io::Error),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoVault => f.write_str("no vault is open"),
            Self::RecoveryKitNotConfirmed => f.write_str("confirm the recovery kit before using the new vault"),
            Self::RecoveryKitMismatch => f.write_str("that does not match the end of the recovery key"),
            Self::Engine(e) => write!(f, "{e}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<EngineError> for AppError {
    fn from(e: EngineError) -> Self {
        Self::Engine(e)
    }
}

impl From<VaultError> for AppError {
    fn from(e: VaultError) -> Self {
        Self::Engine(EngineError::Vault(e))
    }
}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

enum Stage {
    Closed,
    /// A new vault whose recovery kit has been shown but not yet confirmed. Nothing can be
    /// recorded until it is: skipping the kit is not an option.
    AwaitingKit { open: OpenVault, tail: String },
    Open(OpenVault),
}

/// The shell's state: at most one open vault, and how to start the engine.
pub struct App {
    sidecar: PathBuf,
    device: String,
    stage: Mutex<Stage>,
}

impl App {
    pub fn new(sidecar: PathBuf, device: String) -> App {
        App { sidecar, device, stage: Mutex::new(Stage::Closed) }
    }

    /// Creates a vault in `folder`, copies the data pack in `pack` into it, and returns the
    /// recovery key to show the person. The vault stays locked for use until
    /// [`App::confirm_recovery_kit`] succeeds.
    pub fn create_vault(&self, folder: &Path, passphrase: String, pack: &Path) -> Result<String, AppError> {
        let (vault, kit) = Vault::create(folder, SecretString::from(passphrase))?;
        let mut open = OpenVault::open(vault, Engine::start(&self.sidecar, &self.device)?)?;
        for file in pack_files(pack)? {
            open.keep(file)?;
        }
        let key = kit.secret_key().to_owned();
        let tail = key[key.len() - KIT_CONFIRMATION_LENGTH..].to_owned();
        *self.stage.lock().unwrap() = Stage::AwaitingKit { open, tail };
        Ok(key)
    }

    /// Unlocks the new vault once the person types back the end of its recovery key.
    pub fn confirm_recovery_kit(&self, typed: &str) -> Result<(), AppError> {
        let mut stage = self.stage.lock().unwrap();
        match std::mem::replace(&mut *stage, Stage::Closed) {
            Stage::AwaitingKit { open, tail } if typed.trim().eq_ignore_ascii_case(&tail) => {
                *stage = Stage::Open(open);
                Ok(())
            }
            Stage::AwaitingKit { open, tail } => {
                *stage = Stage::AwaitingKit { open, tail };
                Err(AppError::RecoveryKitMismatch)
            }
            other => {
                *stage = other;
                Err(AppError::NoVault)
            }
        }
    }

    /// Opens the vault in `folder` with its passphrase. Returns the engine's summary, which lists
    /// any file it could not read.
    pub fn open_vault(&self, folder: &Path, passphrase: String) -> Result<Value, AppError> {
        let vault = Vault::unlock(folder, SecretString::from(passphrase))?;
        let open = OpenVault::open(vault, Engine::start(&self.sidecar, &self.device)?)?;
        let summary = open.summary.clone();
        *self.stage.lock().unwrap() = Stage::Open(open);
        Ok(summary)
    }

    /// Closes the vault and stops the engine.
    pub fn close_vault(&self) {
        *self.stage.lock().unwrap() = Stage::Closed;
    }

    /// Asks the engine for a change (`route` is one of its `/changes/…` routes) and keeps it in
    /// the vault. Returns the file's path.
    pub fn record(&self, route: &str, request: Value) -> Result<String, AppError> {
        self.with_open(|open| {
            let file = open.engine.change(route, request)?;
            let path = file.path.clone();
            open.keep(file)?;
            Ok(path)
        })
    }

    /// The merged entities of one type.
    pub fn entities(&self, entity_type: &str) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.entities(entity_type)?))
    }

    /// Runs a monthly report and keeps its run record in the vault.
    pub fn run_report(&self, report: &str, version: u32, year: i32, month: u32) -> Result<Value, AppError> {
        self.with_open(|open| {
            let (record, file) = open.engine.run_report(report, version, year, month)?;
            open.keep(file)?;
            Ok(record)
        })
    }

    fn with_open<T>(&self, f: impl FnOnce(&mut OpenVault) -> Result<T, AppError>) -> Result<T, AppError> {
        match &mut *self.stage.lock().unwrap() {
            Stage::Open(open) => f(open),
            Stage::AwaitingKit { .. } => Err(AppError::RecoveryKitNotConfirmed),
            Stage::Closed => Err(AppError::NoVault),
        }
    }
}

/// This computer's device id, kept in the app's own data folder (never in a vault). Created on
/// first use as eight random lowercase letters and digits.
pub fn device_id(config_dir: &Path) -> io::Result<String> {
    let path = config_dir.join("device-id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim().to_owned();
        if existing.len() >= 4 && existing.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
            return Ok(existing);
        }
    }
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    let id: String = bytes.iter().map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char).collect();
    fs::create_dir_all(config_dir)?;
    fs::write(&path, &id)?;
    Ok(id)
}

/// The files of a data pack, with their paths inside the pack as vault paths.
fn pack_files(pack: &Path) -> io::Result<Vec<PlainFile>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PlainFile>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                walk(root, &path, out)?;
            } else if path.extension().is_some_and(|e| e == "json") {
                let relative = path.strip_prefix(root).unwrap().components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                out.push(PlainFile { path: relative, content: fs::read(&path)? });
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(pack, pack, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn app() -> Option<App> {
        let Ok(exe) = std::env::var("OPENQUOTE_SIDECAR_EXE") else {
            eprintln!("skipped: set OPENQUOTE_SIDECAR_EXE to a built openquote-care-sidecar executable");
            return None;
        };
        Some(App::new(PathBuf::from(exe), "pc01".to_owned()))
    }

    fn pack() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs/care-kr")
    }

    #[test]
    fn a_new_vault_cannot_be_used_until_its_recovery_kit_is_confirmed() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();

        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        assert!(key.starts_with("AGE-SECRET-KEY-1"));

        assert!(matches!(app.entities("session"), Err(AppError::RecoveryKitNotConfirmed)));
        assert!(matches!(app.confirm_recovery_kit("WRONG1"), Err(AppError::RecoveryKitMismatch)));
        assert!(matches!(app.entities("session"), Err(AppError::RecoveryKitNotConfirmed)));

        app.confirm_recovery_kit(&key[key.len() - 6..].to_lowercase()).unwrap();
        assert_eq!(app.entities("session").unwrap(), json!([]));
    }

    #[test]
    fn records_and_reports_survive_closing_and_reopening() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();

        let subject = app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        let subject_id = subject.split('/').nth(1).unwrap();
        app.record(
            "/changes/in-subject",
            json!({ "subjectId": subject_id, "type": "session",
                    "fields": { "date": "2026-04-02", "topic": { "scheme": "topic", "version": 1, "code": "family" } } }),
        )
        .unwrap();
        let first = app.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(first["total"]["count"], 1);
        app.close_vault();
        assert!(matches!(app.entities("session"), Err(AppError::NoVault)));

        let summary = app.open_vault(dir.path(), "pass".to_owned()).unwrap();
        assert_eq!(summary["unreadable"], json!([]));
        let again = app.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(again["cells"], first["cells"]);
        assert!(matches!(app.open_vault(dir.path(), "nope".to_owned()), Err(AppError::Engine(EngineError::Vault(VaultError::WrongPassphrase)))));
    }

    #[test]
    fn the_device_id_is_made_once_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let first = device_id(dir.path()).unwrap();
        assert_eq!(first.len(), 8);
        assert_eq!(device_id(dir.path()).unwrap(), first);
    }

    #[test]
    fn the_care_kr_pack_holds_the_schemes_and_the_monthly_form() {
        let paths: Vec<String> = pack_files(&pack()).unwrap().into_iter().map(|f| f.path).collect();
        assert!(paths.contains(&"schemes/topic/v1.json".to_owned()));
        assert!(paths.contains(&"reports/monthly-topic/v1.json".to_owned()));
    }
}

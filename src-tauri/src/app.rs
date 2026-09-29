//! What the window can ask the shell to do, without the window. Each operation here backs one
//! command in `lib.rs`; keeping them apart lets the flows be tested without a Tauri runtime.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use age::secrecy::SecretString;
use openquote_care_engine::{Engine, EngineError, OpenVault, PlainFile};
use openquote_care_vault::{NewVault, Vault, VaultError, Watcher};
use serde_json::Value;

/// How many trailing characters of the recovery key a person types back to show they kept it.
const KIT_CONFIRMATION_LENGTH: usize = 6;

/// Why a command failed, in words the window can show.
#[derive(Debug)]
pub enum AppError {
    NoVault,
    RecoveryKitNotConfirmed,
    RecoveryKitMismatch,
    /// The folder holds no scheme or report form to apply.
    NotAPack,
    /// The pack has a file the vault already holds with other content; nothing was applied.
    PackConflict(Vec<String>),
    Engine(EngineError),
    Io(io::Error),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoVault => f.write_str("no vault is open"),
            Self::RecoveryKitNotConfirmed => f.write_str("confirm the recovery kit before using the new vault"),
            Self::RecoveryKitMismatch => f.write_str("that does not match the end of the recovery key"),
            Self::NotAPack => f.write_str("the folder holds no scheme or report form"),
            Self::PackConflict(paths) => write!(f, "the vault already has different content at {}", paths.join(", ")),
            Self::Engine(e) => write!(f, "{e}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AppError {}

impl AppError {
    /// A stable identifier for the window to choose its own wording by. The `Display` text is
    /// for logs; a person reads the window's translation of this code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoVault => "no-vault",
            Self::RecoveryKitNotConfirmed => "kit-not-confirmed",
            Self::RecoveryKitMismatch => "kit-mismatch",
            Self::NotAPack => "not-a-pack",
            Self::PackConflict(_) => "pack-conflict",
            Self::Engine(EngineError::Vault(e)) => match e {
                VaultError::AlreadyExists => "already-exists",
                VaultError::NotAVault => "not-a-vault",
                VaultError::NewerFormat => "newer-format",
                VaultError::NotEncrypted => "not-encrypted",
                VaultError::WrongPassphrase => "wrong-passphrase",
                VaultError::DamagedKeyFile => "damaged-key-file",
                VaultError::InvalidRecoveryKey | VaultError::RecoveryKeyMismatch => "recovery-key",
                VaultError::InvalidPath(_) => "invalid-path",
                VaultError::Io(_) => "io",
            },
            Self::Engine(EngineError::Start(_)) => "engine-start",
            Self::Engine(_) => "engine",
            Self::Io(_) => "io",
        }
    }
}

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
    /// A new vault whose recovery kit has been shown but not yet confirmed. It exists only in
    /// memory until it is: skipping the kit is not an option, and a vault abandoned at this
    /// point leaves nothing behind that could be opened without it.
    AwaitingKit { new: NewVault, pack: PathBuf, tail: String },
    /// An open vault, and the watch that hears other devices' writes to its folder — none when
    /// the folder cannot be watched (some network shares), which still refreshes on request.
    Open { open: Box<OpenVault>, _watch: Option<Watcher> },
}

/// The shell's state: at most one open vault, and how to start the engine.
pub struct App {
    sidecar: PathBuf,
    device: String,
    stage: Mutex<Stage>,
    outside_change: Arc<dyn Fn() + Send + Sync>,
}

impl App {
    pub fn new(sidecar: PathBuf, device: String) -> App {
        App { sidecar, device, stage: Mutex::new(Stage::Closed), outside_change: Arc::new(|| {}) }
    }

    /// Calls `f`, on a watcher thread, whenever something other than this app changes the open
    /// vault's record files — another device sharing the folder, or a sync client. [`App::refresh`]
    /// takes the change in.
    pub fn on_outside_change(mut self, f: impl Fn() + Send + Sync + 'static) -> App {
        self.outside_change = Arc::new(f);
        self
    }

    fn opened(&self, open: OpenVault) -> Stage {
        let notify = Arc::clone(&self.outside_change);
        let watch = open.vault.watch(move || notify()).ok();
        Stage::Open { open: Box::new(open), _watch: watch }
    }

    /// Prepares a vault for `folder` and returns the recovery key to show the person. Nothing is
    /// written until [`App::confirm_recovery_kit`] succeeds; then the vault is created and the
    /// data pack in `pack` copied into it.
    pub fn create_vault(&self, folder: &Path, passphrase: String, pack: &Path) -> Result<String, AppError> {
        let new = Vault::prepare(folder, SecretString::from(passphrase))?;
        let key = new.recovery_kit().secret_key().to_owned();
        let tail = key[key.len() - KIT_CONFIRMATION_LENGTH..].to_owned();
        *self.stage.lock().unwrap() = Stage::AwaitingKit { new, pack: pack.to_owned(), tail };
        Ok(key)
    }

    /// Once the person types back the end of the recovery key, writes the new vault, fills it
    /// from the data pack, and opens it.
    pub fn confirm_recovery_kit(&self, typed: &str) -> Result<(), AppError> {
        let mut stage = self.stage.lock().unwrap();
        match std::mem::replace(&mut *stage, Stage::Closed) {
            Stage::AwaitingKit { new, pack, tail } if typed.trim().eq_ignore_ascii_case(&tail) => {
                // Start the engine before writing, so a failure to start leaves nothing on disk
                // and the kit screen can simply be confirmed again.
                let engine = match Engine::start(&self.sidecar, &self.device) {
                    Ok(engine) => engine,
                    Err(e) => {
                        *stage = Stage::AwaitingKit { new, pack, tail };
                        return Err(e.into());
                    }
                };
                let mut open = OpenVault::open(new.write()?, engine)?;
                for file in pack_files(&pack)? {
                    open.keep(file)?;
                }
                *stage = self.opened(open);
                Ok(())
            }
            Stage::AwaitingKit { new, pack, tail } => {
                *stage = Stage::AwaitingKit { new, pack, tail };
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
        self.open_unlocked(Vault::unlock(folder, SecretString::from(passphrase))?)
    }

    /// Opens the vault in `folder` with its recovery key, for when the passphrase is forgotten.
    /// The key may be typed as the kit shows it: in groups, in either case.
    pub fn open_vault_with_key(&self, folder: &Path, recovery_key: &str) -> Result<Value, AppError> {
        let key: String = recovery_key.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
        self.open_unlocked(Vault::recover(folder, &key)?)
    }

    fn open_unlocked(&self, vault: Vault) -> Result<Value, AppError> {
        let open = OpenVault::open(vault, Engine::start(&self.sidecar, &self.device)?)?;
        let summary = open.summary.clone();
        *self.stage.lock().unwrap() = self.opened(open);
        Ok(summary)
    }

    /// Sets a new passphrase for the open vault. The old one stops opening it on every device
    /// sharing the folder; the recovery kit and the records stay as they are.
    pub fn change_passphrase(&self, passphrase: String) -> Result<(), AppError> {
        self.with_open(|open| Ok(open.vault.change_passphrase(SecretString::from(passphrase))?))
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

    /// Adds a data pack's schemes, crosswalks, report forms and export forms to the open vault: the files it
    /// does not have yet. A file it already has with the same content is left alone; one with
    /// other content stops the whole pack, since definitions are never rewritten. Returns the
    /// paths added.
    pub fn apply_pack(&self, pack: &Path) -> Result<Vec<String>, AppError> {
        let definitions: Vec<PlainFile> =
            pack_files(pack)?.into_iter().filter(|f| ["schemes/", "reports/", "exports/"].iter().any(|d| f.path.starts_with(d))).collect();
        if definitions.is_empty() {
            return Err(AppError::NotAPack);
        }
        self.with_open(|open| {
            let mut new = Vec::new();
            let mut conflicts = Vec::new();
            for file in definitions {
                match open.vault.read(&file.path)? {
                    None => new.push(file),
                    Some(existing) if existing == file.content => {}
                    Some(_) => conflicts.push(file.path),
                }
            }
            if !conflicts.is_empty() {
                return Err(AppError::PackConflict(conflicts));
            }
            let added = new.iter().map(|f| f.path.clone()).collect();
            if !new.is_empty() {
                open.keep_all(new)?;
            }
            Ok(added)
        })
    }

    /// Where each classification value lands in `target_version`, through the vault's crosswalks.
    pub fn resolve(&self, target_version: u32, values: Value) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.resolve(target_version, values)?))
    }

    /// The run records the vault keeps.
    pub fn runs(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.runs()?))
    }

    /// Why two kept runs differ.
    pub fn compare_runs(&self, earlier: &str, later: &str) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.compare_runs(earlier, later)?))
    }

    /// Reads the open vault again, taking in what other devices sharing its folder wrote.
    pub fn refresh(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.reload()?))
    }

    /// The open vault's summary, as [`App::open_vault`] returns it.
    pub fn summary(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.current_summary()?))
    }

    /// Every classification scheme version in the vault.
    pub fn schemes(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.schemes()?))
    }

    /// Runs a monthly report and keeps its run record in the vault.
    pub fn run_report(&self, report: &str, version: u32, year: i32, month: u32) -> Result<Value, AppError> {
        self.with_open(|open| {
            let (record, file) = open.engine.run_report(report, version, year, month)?;
            open.keep(file)?;
            Ok(record)
        })
    }

    /// Lays one month's records out as an export form's rows.
    pub fn run_export(&self, export: &str, version: u32, year: i32, month: u32) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.run_export(export, version, year, month)?))
    }

    fn with_open<T>(&self, f: impl FnOnce(&mut OpenVault) -> Result<T, AppError>) -> Result<T, AppError> {
        match &mut *self.stage.lock().unwrap() {
            Stage::Open { open, .. } => f(open),
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

    /// A folder for the tests where two devices share a vault. `OPENQUOTE_SHARED_TEST_ROOT` puts it
    /// under a network share (for example `\\localhost\share`) so they run over SMB, not only a local disk.
    fn shared_folder() -> tempfile::TempDir {
        match std::env::var_os("OPENQUOTE_SHARED_TEST_ROOT") {
            Some(root) => tempfile::tempdir_in(root).unwrap(),
            None => tempfile::tempdir().unwrap(),
        }
    }

    #[test]
    fn a_new_vault_cannot_be_used_until_its_recovery_kit_is_confirmed() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();

        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        assert!(key.starts_with("AGE-SECRET-KEY-1"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0, "nothing written before the kit is confirmed");

        assert!(matches!(app.entities("session"), Err(AppError::RecoveryKitNotConfirmed)));
        assert!(matches!(app.confirm_recovery_kit("WRONG1"), Err(AppError::RecoveryKitMismatch)));
        assert!(matches!(app.entities("session"), Err(AppError::RecoveryKitNotConfirmed)));

        app.confirm_recovery_kit(&key[key.len() - 6..].to_lowercase()).unwrap();
        assert_eq!(app.entities("session").unwrap(), json!([]));
        assert!(Vault::recover(dir.path(), &key).is_ok(), "the kit opens the written vault");
    }

    #[test]
    fn a_vault_abandoned_before_its_kit_is_confirmed_leaves_nothing() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        app.close_vault();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert_eq!(app.open_vault(dir.path(), "pass".to_owned()).unwrap_err().code(), "not-a-vault");
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
        assert!(app.summary().unwrap()["reports"].as_array().unwrap().iter().any(|r| r["name"] == "monthly-topic"));
        let list = app.run_export("session-list", 1, 2026, 4).unwrap();
        assert_eq!(list["rows"].as_array().unwrap().len(), 1, "the pack's export form lists the session");
        assert_eq!(list["rows"][0]["cells"][2], "synthetic");
        let schemes = app.schemes().unwrap();
        assert!(schemes.as_array().unwrap().iter().any(|s| s["scheme"] == "topic" && s["version"] == 1));
        assert_eq!(app.entities("session").unwrap()[0]["subject"], subject_id);
        let first = app.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(first["total"]["count"], 1);
        app.close_vault();
        assert!(matches!(app.entities("session"), Err(AppError::NoVault)));

        let summary = app.open_vault(dir.path(), "pass".to_owned()).unwrap();
        assert_eq!(summary["unreadable"], json!([]));
        let again = app.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(again["cells"], first["cells"]);
        let runs = app.runs().unwrap();
        assert_eq!(runs.as_array().unwrap().len(), 2, "both runs are kept and read back");
        let compared = app.compare_runs(runs[0]["id"].as_str().unwrap(), runs[1]["id"].as_str().unwrap()).unwrap();
        assert_eq!(compared["revised"], serde_json::json!([]));
        assert_eq!(compared["moved"], serde_json::json!([]));
        assert_eq!(compared["unchanged"].as_array().unwrap().len(), 1);
        assert!(matches!(app.open_vault(dir.path(), "nope".to_owned()), Err(AppError::Engine(EngineError::Vault(VaultError::WrongPassphrase)))));
    }

    #[test]
    fn the_recovery_key_opens_the_vault_as_the_kit_shows_it() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        app.close_vault();

        let grouped = key.as_bytes().chunks(6).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join(" ").to_lowercase();
        let summary = app.open_vault_with_key(dir.path(), &format!("  {grouped}
")).unwrap();
        assert_eq!(summary["unreadable"], json!([]));
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);
        app.close_vault();

        let other = Vault::prepare(tempfile::tempdir().unwrap().path(), SecretString::from("x".to_owned())).unwrap();
        let wrong = app.open_vault_with_key(dir.path(), other.recovery_kit().secret_key()).unwrap_err();
        assert_eq!(wrong.code(), "recovery-key");
        assert_eq!(app.open_vault_with_key(dir.path(), "not a key").unwrap_err().code(), "recovery-key");
    }

    #[test]
    fn a_damaged_key_file_is_named_and_the_recovery_key_restores_it() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        app.close_vault();
        let key_file = dir.path().join(openquote_care_vault::KEY_FILE);
        std::fs::write(&key_file, b"-----BEGIN AGE ENCRYPTED FILE-----
cut off").unwrap();

        assert_eq!(app.open_vault(dir.path(), "pass".to_owned()).unwrap_err().code(), "damaged-key-file");
        app.open_vault_with_key(dir.path(), &key).unwrap();
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);
        app.change_passphrase("pass again".to_owned()).unwrap();
        app.close_vault();

        app.open_vault(dir.path(), "pass again".to_owned()).unwrap();
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_vault_opened_with_its_recovery_key_takes_a_new_passphrase() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "forgotten".to_owned(), &pack()).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        app.close_vault();

        app.open_vault_with_key(dir.path(), &key).unwrap();
        app.change_passphrase("remembered".to_owned()).unwrap();
        app.close_vault();

        assert_eq!(app.open_vault(dir.path(), "forgotten".to_owned()).unwrap_err().code(), "wrong-passphrase");
        app.open_vault(dir.path(), "remembered".to_owned()).unwrap();
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);
        app.close_vault();
        assert_eq!(app.change_passphrase("x".to_owned()).unwrap_err().code(), "no-vault");
    }

    #[test]
    fn failures_carry_a_code_the_window_can_word() {
        let dir = tempfile::tempdir().unwrap();
        let not_a_vault = AppError::from(Vault::unlock(dir.path(), SecretString::from("pass".to_owned())).err().unwrap());
        assert_eq!(not_a_vault.code(), "not-a-vault");

        Vault::create(dir.path(), SecretString::from("pass".to_owned())).unwrap();
        let wrong = AppError::from(Vault::unlock(dir.path(), SecretString::from("nope".to_owned())).err().unwrap());
        assert_eq!(wrong.code(), "wrong-passphrase");
        let again = AppError::from(Vault::create(dir.path(), SecretString::from("pass".to_owned())).err().unwrap());
        assert_eq!(again.code(), "already-exists");

        let app = App::new(PathBuf::from("unused"), "pc01".to_owned());
        assert_eq!(app.entities("session").unwrap_err().code(), "no-vault");
        assert_eq!(app.confirm_recovery_kit("abcdef").unwrap_err().code(), "no-vault");
    }

    #[test]
    fn two_devices_sharing_a_folder_see_each_others_records() {
        let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") else { return };
        let dir = shared_folder();
        let one = App::new(PathBuf::from(&exe), "pc01".to_owned());
        let two = App::new(PathBuf::from(&exe), "pc02".to_owned());
        let key = one.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        one.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let subject = one.record("/changes/subject", json!({ "fields": { "name": "shared" } })).unwrap();
        let subject_id = subject.split('/').nth(1).unwrap().to_owned();
        let session = |app: &App, date: &str| {
            app.record(
                "/changes/in-subject",
                json!({ "subjectId": subject_id, "type": "session",
                        "fields": { "date": date, "topic": { "scheme": "topic", "version": 1, "code": "family" } } }),
            )
            .unwrap()
        };
        let first = session(&one, "2026-04-02");

        // The second device opens the same folder while the first still has it open.
        two.open_vault(dir.path(), "pass".to_owned()).unwrap();
        assert_eq!(two.entities("session").unwrap().as_array().unwrap().len(), 1);
        let second = session(&two, "2026-04-03");
        assert!(first.ends_with(".pc01.json") && second.ends_with(".pc02.json"), "each device names its own files");

        assert_eq!(one.entities("session").unwrap().as_array().unwrap().len(), 1, "not seen until read again");
        one.refresh().unwrap();
        assert_eq!(one.entities("session").unwrap().as_array().unwrap().len(), 2);
        let from_one = one.run_report("monthly-topic", 1, 2026, 4).unwrap();
        two.refresh().unwrap();
        let from_two = two.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(from_one["total"]["count"], 2);
        assert_eq!(from_one["cells"], from_two["cells"], "both devices count the same");
    }

    #[test]
    fn a_field_two_devices_changed_unseen_shows_both_values_until_a_person_picks_one() {
        let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") else { return };
        let dir = shared_folder();
        let one = App::new(PathBuf::from(&exe), "pc01".to_owned());
        let two = App::new(PathBuf::from(&exe), "pc02".to_owned());
        let key = one.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        one.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let subject = one.record("/changes/subject", json!({ "fields": { "name": "shared" } })).unwrap();
        let topic = |code: &str| json!({ "scheme": "topic", "version": 1, "code": code });
        let session = one
            .record(
                "/changes/in-subject",
                json!({ "subjectId": subject.split('/').nth(1).unwrap(), "type": "session",
                        "fields": { "date": "2026-04-02", "topic": topic("family") } }),
            )
            .unwrap();
        let id = session.split('/').nth(2).unwrap().split('.').next().unwrap().to_owned();
        two.open_vault(dir.path(), "pass".to_owned()).unwrap();

        // Each device changes the topic without having seen the other's change.
        let update = |app: &App, code: &str| {
            app.record("/changes/update", json!({ "type": "session", "id": id, "fields": { "topic": topic(code) } })).unwrap()
        };
        update(&one, "anxiety");
        update(&two, "learning");
        one.refresh().unwrap();
        let conflicted = one.entities("session").unwrap()[0].clone();
        let heads = conflicted["conflicts"]["topic"].as_array().unwrap();
        assert_eq!(heads.len(), 2, "both values are kept");
        let mut devices: Vec<&str> = heads.iter().map(|h| h["device"].as_str().unwrap()).collect();
        devices.sort();
        assert_eq!(devices, ["pc01", "pc02"]);

        // A device's name is kept in the vault, so the other device reads it too; naming again
        // renames rather than adding a second name.
        one.record("/changes/device-name", json!({ "name": "counselling room" })).unwrap();
        one.record("/changes/device-name", json!({ "name": "front desk" })).unwrap();
        two.refresh().unwrap();
        let summary = two.summary().unwrap();
        assert_eq!(summary["device"], "pc02");
        assert_eq!(summary["devices"], json!({ "pc01": "front desk" }));
        assert_eq!(two.entities("device").unwrap().as_array().unwrap().len(), 1);

        // A person picks one: a change that has seen both settles it, on every device.
        update(&one, "learning");
        two.refresh().unwrap();
        let settled = two.entities("session").unwrap()[0].clone();
        assert_eq!(settled["conflicts"], json!({}));
        assert_eq!(settled["fields"]["topic"]["code"], "learning");
    }

    #[test]
    fn two_devices_writing_at_the_same_time_lose_nothing() {
        let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") else { return };
        let dir = shared_folder();
        let one = App::new(PathBuf::from(&exe), "pc01".to_owned());
        let two = App::new(PathBuf::from(&exe), "pc02".to_owned());
        let key = one.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        one.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        two.open_vault(dir.path(), "pass".to_owned()).unwrap();
        let subject = one.record("/changes/subject", json!({ "fields": { "name": "shared" } })).unwrap();
        let subject_id = subject.split('/').nth(1).unwrap().to_owned();
        two.refresh().unwrap();

        const EACH: usize = 20;
        let write = |app: &App, day: u32| {
            (0..EACH)
                .map(|_| {
                    app.record(
                        "/changes/in-subject",
                        json!({ "subjectId": subject_id, "type": "session",
                                "fields": { "date": format!("2026-04-{day:02}"), "topic": { "scheme": "topic", "version": 1, "code": "family" } } }),
                    )
                    .unwrap()
                })
                .collect::<Vec<_>>()
        };
        let (a, b) = std::thread::scope(|s| {
            let a = s.spawn(|| write(&one, 2));
            let b = s.spawn(|| write(&two, 3));
            (a.join().unwrap(), b.join().unwrap())
        });
        let mut names: Vec<_> = a.iter().chain(&b).cloned().collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 2 * EACH, "every write made its own file");

        for app in [&one, &two] {
            app.refresh().unwrap();
            assert_eq!(app.entities("session").unwrap().as_array().unwrap().len(), 2 * EACH);
            assert_eq!(app.run_report("monthly-topic", 1, 2026, 4).unwrap()["total"]["count"], 2 * EACH);
        }
    }

    #[test]
    fn the_app_hears_when_another_device_writes_to_its_vault() {
        let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") else { return };
        let dir = shared_folder();
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = Mutex::new(tx);
        let one = App::new(PathBuf::from(&exe), "pc01".to_owned()).on_outside_change(move || {
            let _ = tx.lock().unwrap().send(());
        });
        let two = App::new(PathBuf::from(&exe), "pc02".to_owned());
        let key = one.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        one.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        two.open_vault(dir.path(), "pass".to_owned()).unwrap();

        one.record("/changes/subject", json!({ "fields": { "name": "mine" } })).unwrap();
        assert!(rx.recv_timeout(std::time::Duration::from_millis(1500)).is_err(), "its own record is not news");

        two.record("/changes/subject", json!({ "fields": { "name": "theirs" } })).unwrap();
        rx.recv_timeout(std::time::Duration::from_secs(10)).expect("the other device's record is");
        one.refresh().unwrap();
        assert_eq!(one.entities("subject").unwrap().as_array().unwrap().len(), 2);

        one.close_vault();
        while rx.try_recv().is_ok() {}
        two.record("/changes/subject", json!({ "fields": { "name": "later" } })).unwrap();
        assert!(rx.recv_timeout(std::time::Duration::from_millis(1500)).is_err(), "a closed vault is no longer watched");
    }

    /// Not a check but a measurement: writes `OPENQUOTE_MEASURE_RECORDS` sessions (default 2000, about a
    /// year of one counselor's work), then times opening the vault in a fresh engine process, which
    /// is the first build of its cache. Run with `cargo test --release -- --ignored --nocapture measure`.
    #[test]
    #[ignore = "measurement"]
    fn measure_opening_a_vault_of_a_years_records() {
        let Some(exe) = std::env::var_os("OPENQUOTE_SIDECAR_EXE") else { return };
        let records: usize = std::env::var("OPENQUOTE_MEASURE_RECORDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
        let dir = shared_folder();
        let writer = App::new(PathBuf::from(&exe), "pc01".to_owned());
        let key = writer.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        writer.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let subject = writer.record("/changes/subject", json!({ "fields": { "name": "measured" } })).unwrap();
        let subject_id = subject.split('/').nth(1).unwrap().to_owned();
        let started = std::time::Instant::now();
        for i in 0..records {
            writer
                .record(
                    "/changes/in-subject",
                    json!({ "subjectId": subject_id, "type": "session",
                            "fields": { "date": format!("2026-{:02}-{:02}", i % 12 + 1, i % 28 + 1), "topic": { "scheme": "topic", "version": 1, "code": "family" } } }),
                )
                .unwrap();
        }
        let writing = started.elapsed();
        writer.close_vault();

        let reader = App::new(PathBuf::from(&exe), "pc02".to_owned());
        let started = std::time::Instant::now();
        reader.open_vault(dir.path(), "pass".to_owned()).unwrap();
        let opening = started.elapsed();
        assert_eq!(reader.entities("session").unwrap().as_array().unwrap().len(), records);
        let started = std::time::Instant::now();
        reader.run_report("monthly-topic", 1, 2026, 4).unwrap();
        let report = started.elapsed();
        eprintln!("measure: {records} sessions · writing {writing:.2?} ({:.1?}/record) · opening with first cache build {opening:.2?} · one monthly report {report:.2?}", writing / records as u32);
    }

    fn golden_step(step: u32) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../tests/golden/steps/{step}"))
    }

    #[test]
    fn a_pack_adds_only_the_definitions_the_vault_lacks() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), &pack()).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();

        let mut added = app.apply_pack(&golden_step(2)).unwrap();
        added.sort();
        assert_eq!(added, ["reports/monthly-topic/v2.json", "schemes/topic/v1-v2.json", "schemes/topic/v2.json"]);
        assert!(app.summary().unwrap()["reports"].as_array().unwrap().iter().any(|r| r["version"] == 2));
        assert!(app.apply_pack(&golden_step(2)).unwrap().is_empty(), "applying it again adds nothing");
        let split = app.resolve(2, serde_json::json!([{ "scheme": "topic", "version": 1, "code": "relation" }])).unwrap();
        assert_eq!(split[0]["candidates"], serde_json::json!(["relation-peer", "relation-teacher"]));
        assert!(app.apply_pack(&pack()).unwrap().is_empty(), "the pack the vault started from is already in it");

        let other = tempfile::tempdir().unwrap();
        fs::create_dir_all(other.path().join("schemes/topic")).unwrap();
        fs::write(other.path().join("schemes/topic/v2.json"), b"{}").unwrap();
        assert_eq!(app.apply_pack(other.path()).unwrap_err().code(), "pack-conflict");
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(app.apply_pack(empty.path()).unwrap_err().code(), "not-a-pack");
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

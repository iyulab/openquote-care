//! What the window can ask the shell to do, without the window. Each operation here backs one
//! command in `lib.rs`; keeping them apart lets the flows be tested without a Tauri runtime.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use age::secrecy::SecretString;
use openquote_care_engine::{Engine, EngineError, OpenVault, PlainFile};
use openquote_care_vault::{BackupComparison, BackupError, BackupReport, NewVault, PlainCopyError, Vault, VaultError, Watcher};
use serde_json::Value;

use crate::bundle::{Bundle, BundleError, Track};

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
    /// The packs bundled with the app cannot be read, or lack what a track needs.
    Bundle(BundleError),
    /// The folder chosen for the backup cannot hold it.
    Backup(BackupError),
    /// The plain copy could not be written where it was asked for.
    PlainCopy(PlainCopyError),
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
            Self::Bundle(e) => write!(f, "{e}"),
            Self::Backup(e) => write!(f, "{e}"),
            Self::PlainCopy(e) => write!(f, "{e}"),
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
            Self::Bundle(_) => "bundle",
            Self::Backup(e) => backup_code(e),
            Self::PlainCopy(PlainCopyError::Overlaps) => "plain-copy-overlaps",
            Self::PlainCopy(PlainCopyError::Exists) => "plain-copy-exists",
            Self::PlainCopy(PlainCopyError::BadName(_)) => "plain-copy-name",
            Self::PlainCopy(PlainCopyError::Io(_)) => "io",
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
            // The engine refused a choice the record is not waiting for (another device chose first).
            Self::Engine(EngineError::Status(422, _)) => "not-a-choice",
            Self::Engine(_) => "engine",
            Self::Io(_) => "io",
        }
    }
}

fn backup_code(e: &BackupError) -> &'static str {
    match e {
        BackupError::Overlaps => "backup-overlaps",
        BackupError::HoldsOther => "backup-holds-other",
        BackupError::Io(_) => "io",
    }
}

impl From<PlainCopyError> for AppError {
    fn from(e: PlainCopyError) -> Self {
        Self::PlainCopy(e)
    }
}

impl From<BackupError> for AppError {
    fn from(e: BackupError) -> Self {
        Self::Backup(e)
    }
}

impl From<BundleError> for AppError {
    fn from(e: BundleError) -> Self {
        Self::Bundle(e)
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
    AwaitingKit { new: NewVault, tail: String, packs: Vec<PathBuf> },
    /// An open vault, and the watch that hears other devices' writes to its folder — none when
    /// the folder cannot be watched (some network shares), which still refreshes on request.
    Open { open: Box<OpenVault>, _watch: Option<Watcher> },
}

/// The shell's state: at most one open vault, how to start the engine, and the data packs a vault
/// starts with.
pub struct App {
    sidecar: PathBuf,
    device: String,
    bundle: Bundle,
    stage: Mutex<Stage>,
    /// Where this device keeps a backup of the open vault, and how the last backup went.
    backup: Mutex<Backup>,
    outside_change: Arc<dyn Fn() + Send + Sync>,
}

/// A backup of the open vault into a second folder this device chose (see [`App::set_backup`]).
#[derive(Default)]
struct Backup {
    folder: Option<PathBuf>,
    /// When the last backup ran (milliseconds since 1970) and what came of it.
    last: Option<(u128, Result<BackupReport, String>)>,
    /// What the vault lost or holds damaged, by its backup: compared when a backup found record
    /// files only the backup holds or holds differently, and kept until a backup of the whole vault
    /// finds none.
    comparison: Option<BackupComparison>,
}

impl Backup {
    /// Notes how a backup of `vault` went — of the whole vault when `whole` — and compares the two
    /// copies when it found a sign that the vault lost a file or holds one damaged.
    fn note(&mut self, vault: &Vault, result: Result<BackupReport, BackupError>, whole: bool) {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default();
        if let (Ok(report), Some(folder)) = (&result, &self.folder) {
            if !report.only_in_backup.is_empty() || !report.differs.is_empty() {
                self.comparison = vault.compare_backup(folder).ok().filter(|c| !c.is_empty());
            } else if whole {
                self.comparison = None;
            }
        }
        self.last = Some((at, result.map_err(|e| backup_code(&e).to_owned())));
    }

    fn status(&self) -> Value {
        let Some(folder) = &self.folder else {
            return serde_json::json!({ "folder": null });
        };
        let mut status = serde_json::json!({ "folder": folder.to_string_lossy() });
        if let Some((at, result)) = &self.last {
            status["at"] = serde_json::json!(*at as u64);
            match result {
                Ok(report) => {
                    status["copied"] = serde_json::json!(report.copied);
                    status["keyReplaced"] = serde_json::json!(report.key_replaced);
                    status["differs"] = serde_json::json!(report.differs);
                }
                Err(code) => status["error"] = serde_json::json!(code),
            }
        }
        if let Some(c) = &self.comparison {
            status["missing"] = serde_json::json!(c.missing);
            status["damaged"] = serde_json::json!(c.damaged);
            status["damagedInBackup"] = serde_json::json!(c.damaged_in_backup);
            status["unresolved"] = serde_json::json!(c.unresolved);
        }
        status
    }
}

impl App {
    pub fn new(sidecar: PathBuf, device: String) -> App {
        App {
            sidecar,
            device,
            bundle: Bundle::default(),
            stage: Mutex::new(Stage::Closed),
            backup: Mutex::new(Backup::default()),
            outside_change: Arc::new(|| {}),
        }
    }

    /// The bundled data packs: the tracks a new vault is made on, and what a vault made before packs
    /// named themselves takes on when it is opened (see [`App::open_vault`]).
    pub fn with_bundle(mut self, bundle: Bundle) -> App {
        self.bundle = bundle;
        self
    }

    /// The tracks a vault can be made on.
    pub fn tracks(&self) -> &[Track] {
        self.bundle.tracks()
    }

    /// The track to offer first to a window speaking `tag`.
    pub fn default_track(&self, tag: &str) -> Option<&Track> {
        self.bundle.default_track(tag)
    }

    /// Calls `f`, on a watcher thread, whenever something other than this app changes the open
    /// vault's record files — another device sharing the folder, or a sync client. [`App::refresh`]
    /// takes the change in.
    pub fn on_outside_change(mut self, f: impl Fn() + Send + Sync + 'static) -> App {
        self.outside_change = Arc::new(f);
        self
    }

    fn opened(&self, open: OpenVault) -> Stage {
        // A backup belongs to one vault: the window names this vault's again once it is open.
        *self.backup.lock().unwrap() = Backup::default();
        let notify = Arc::clone(&self.outside_change);
        let watch = open.vault.watch(move || notify()).ok();
        Stage::Open { open: Box::new(open), _watch: watch }
    }

    /// Prepares a vault on `track` for `folder` and returns the recovery key to show the person.
    /// Nothing is written until [`App::confirm_recovery_kit`] succeeds; then the vault is created and
    /// the track's data packs copied into it, each after the packs it builds on.
    pub fn create_vault(&self, folder: &Path, passphrase: String, track: &str) -> Result<String, AppError> {
        let packs = self.bundle.track_packs(track)?;
        let new = Vault::prepare(folder, SecretString::from(passphrase))?;
        let key = new.recovery_kit().secret_key().to_owned();
        let tail = key[key.len() - KIT_CONFIRMATION_LENGTH..].to_owned();
        *self.stage.lock().unwrap() = Stage::AwaitingKit { new, tail, packs };
        Ok(key)
    }

    /// Once the person types back the end of the recovery key, writes the new vault, fills it
    /// from the data pack, and opens it.
    pub fn confirm_recovery_kit(&self, typed: &str) -> Result<(), AppError> {
        let mut stage = self.stage.lock().unwrap();
        match std::mem::replace(&mut *stage, Stage::Closed) {
            Stage::AwaitingKit { new, tail, packs } if typed.trim().eq_ignore_ascii_case(&tail) => {
                // Start the engine before writing, so a failure to start leaves nothing on disk
                // and the kit screen can simply be confirmed again.
                let engine = match Engine::start(&self.sidecar, &self.device) {
                    Ok(engine) => engine,
                    Err(e) => {
                        *stage = Stage::AwaitingKit { new, tail, packs };
                        return Err(e.into());
                    }
                };
                let mut open = OpenVault::open(new.write()?, engine)?;
                for pack in &packs {
                    for file in pack_files(pack)? {
                        open.keep(file)?;
                    }
                }
                *stage = self.opened(open);
                Ok(())
            }
            Stage::AwaitingKit { new, tail, packs } => {
                *stage = Stage::AwaitingKit { new, tail, packs };
                Err(AppError::RecoveryKitMismatch)
            }
            other => {
                *stage = other;
                Err(AppError::NoVault)
            }
        }
    }

    /// Opens the vault in `folder` with its passphrase. Returns the engine's summary, which lists
    /// any file it could not read — and, under `adopted`, the track a vault made before packs named
    /// themselves was taken onto (its id and its names; see [`App::with_bundle`]).
    pub fn open_vault(&self, folder: &Path, passphrase: String) -> Result<Value, AppError> {
        self.open_unlocked(Vault::unlock(folder, SecretString::from(passphrase))?)
    }

    /// Opens the vault in `folder` with its recovery key, for when the passphrase is forgotten or the
    /// key file is lost. The key may be typed as the kit shows it: in groups, in either case. The
    /// summary says `keyFileLost` when the key file is missing or damaged.
    pub fn open_vault_with_key(&self, folder: &Path, recovery_key: &str) -> Result<Value, AppError> {
        let key: String = recovery_key.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
        let vault = Vault::recover(folder, &key)?;
        let key_file_lost = !vault.key_file_sound();
        let mut summary = self.open_unlocked(vault)?;
        // Until a new passphrase is set, only the recovery key opens this vault: `keyFileLost` says so.
        if key_file_lost {
            summary["keyFileLost"] = serde_json::json!(true);
        }
        Ok(summary)
    }

    fn open_unlocked(&self, vault: Vault) -> Result<Value, AppError> {
        let mut open = OpenVault::open(vault, Engine::start(&self.sidecar, &self.device)?)?;
        // Taking packs on adds to a vault that reads without them: a failed write (a read-only share,
        // another device adding the same file first) never keeps the vault from opening. What was not
        // added is tried again the next time, since the manifests go last.
        let adopted = self.adopt(&mut open).unwrap_or_default();
        let mut summary = open.summary.clone();
        if let Some(track) = adopted {
            summary["adopted"] = serde_json::json!({ "track": track.id, "label": track.label });
        }
        *self.stage.lock().unwrap() = self.opened(open);
        Ok(summary)
    }

    /// A vault whose packs do not name themselves — every vault made before they did — is taken onto
    /// the track whose bundled files it holds unchanged (see [`Bundle::adoption`]): the files of that
    /// track it lacks are added, and no file it holds is changed. The manifests are written last, so a
    /// vault left part-way still names no pack and is taken on the rest of the way when next opened.
    /// Returns the track, or None when the vault names its packs or fits no track.
    fn adopt(&self, open: &mut OpenVault) -> Result<Option<Track>, AppError> {
        if open.summary["packs"].as_array().is_some_and(|p| !p.is_empty()) {
            return Ok(None);
        }
        let vault = &open.vault;
        let Some(track) = self.bundle.adoption(&|path: &str| vault.read(path).ok().flatten())?.cloned() else {
            return Ok(None);
        };
        let mut new = Vec::new();
        for pack in self.bundle.track_packs(&track.id)? {
            for file in pack_files(&pack)? {
                if open.vault.read(&file.path)?.is_none() {
                    new.push(file);
                }
            }
        }
        new.sort_by_key(|f| f.path.starts_with("packs/"));
        if !new.is_empty() {
            open.keep_all(new)?;
        }
        Ok(Some(track))
    }

    /// Sets a new passphrase for the open vault. The old one stops opening it on every device
    /// sharing the folder; the recovery kit and the records stay as they are.
    pub fn change_passphrase(&self, passphrase: String) -> Result<(), AppError> {
        self.with_open(|open| {
            open.vault.change_passphrase(SecretString::from(passphrase))?;
            // The backup's key file follows, or the old passphrase would still open the backup.
            self.back_up(&open.vault, Some(&[]));
            Ok(())
        })
    }

    /// Closes the vault and stops the engine.
    pub fn close_vault(&self) {
        *self.stage.lock().unwrap() = Stage::Closed;
        *self.backup.lock().unwrap() = Backup::default();
    }

    /// Keeps a backup of the open vault in `folder` on this device from now on, or stops keeping
    /// one (`None`). The folder must be apart from the vault and empty or already this vault's
    /// backup; it is brought up to date at once. Returns what [`App::backup_status`] returns.
    pub fn set_backup(&self, folder: Option<&Path>) -> Result<Value, AppError> {
        self.with_open(|open| {
            // A folder that cannot hold the backup leaves the backup there is as it was.
            if let Some(folder) = folder {
                open.vault.check_backup(folder)?;
            }
            let mut backup = self.backup.lock().unwrap();
            *backup = Backup::default();
            if let Some(folder) = folder {
                backup.folder = Some(folder.to_path_buf());
                let result = open.vault.back_up(folder);
                backup.note(&open.vault, result, true);
            }
            Ok(backup.status())
        })
    }

    /// Writes a copy of the open vault's records that reads without the app — `files`, as the
    /// window made them — into a new folder `name` inside `folder`, apart from the vault. Returns
    /// the new folder.
    pub fn write_plain_copy(&self, folder: &Path, name: &str, files: &[(String, Vec<u8>)]) -> Result<String, AppError> {
        self.with_open(|open| Ok(open.vault.write_plain_copy(folder, name, files)?.to_string_lossy().into_owned()))
    }

    /// Where this device keeps the open vault's backup, when the last backup ran and what came of
    /// it: how many files it copied, whether the key file followed a new passphrase, the record
    /// files the backup holds with other content, or the error that stopped it.
    pub fn backup_status(&self) -> Value {
        self.backup.lock().unwrap().status()
    }

    /// Brings the backup up to date after a write of `written` (None: after reading the whole
    /// vault again). A backup that fails — the folder unplugged, a share gone — is noted in its
    /// status and never fails the write it follows.
    fn back_up(&self, vault: &Vault, written: Option<&[String]>) {
        let mut backup = self.backup.lock().unwrap();
        let Some(folder) = backup.folder.clone() else {
            return;
        };
        let result = match written {
            Some(paths) => vault.back_up_written(&folder, &paths.iter().map(String::as_str).collect::<Vec<_>>()),
            None => vault.back_up(&folder),
        };
        backup.note(vault, result, written.is_none());
    }

    /// Copies the record files the open vault lost back from its backup, reads the vault again
    /// with them, and returns how many it copied with what [`App::backup_status`] returns. A
    /// damaged record file stays as it is: the vault never replaces one.
    pub fn restore_from_backup(&self) -> Result<Value, AppError> {
        self.with_open(|open| {
            let Some(folder) = self.backup.lock().unwrap().folder.clone() else {
                return Err(AppError::Backup(BackupError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "no backup is kept"))));
            };
            let restored = open.vault.restore_from_backup(&folder)?;
            let summary = open.reload()?;
            self.back_up(&open.vault, None);
            Ok(serde_json::json!({ "restored": restored, "summary": summary, "backup": self.backup_status() }))
        })
    }

    /// Asks the engine for a change (`route` is one of its `/changes/…` routes) and keeps it in
    /// the vault. Returns the file's path.
    pub fn record(&self, route: &str, request: Value) -> Result<String, AppError> {
        self.with_open(|open| {
            let file = open.engine.change(route, request)?;
            let path = file.path.clone();
            open.keep(file)?;
            self.back_up(&open.vault, Some(std::slice::from_ref(&path)));
            Ok(path)
        })
    }

    /// The merged entities of one type.
    pub fn entities(&self, entity_type: &str) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.entities(entity_type)?))
    }

    /// Every change each entity of a type was built from, oldest first: who wrote it, when, what
    /// it did and the fields it set.
    pub fn history(&self, entity_type: &str) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.history(entity_type)?))
    }

    /// Adds a data pack's definitions (see [`DEFINITION_FOLDERS`]) to the open vault: the files it
    /// does not have yet. A file it already has with the same content is left alone; one with
    /// other content stops the whole pack, since definitions are never rewritten. Returns the
    /// paths added.
    pub fn apply_pack(&self, pack: &Path) -> Result<Vec<String>, AppError> {
        let definitions = pack_files(pack)?;
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
            let added: Vec<String> = new.iter().map(|f| f.path.clone()).collect();
            if !new.is_empty() {
                open.keep_all(new)?;
                self.back_up(&open.vault, Some(&added));
            }
            Ok(added)
        })
    }

    /// The pending records of a report form's run, with the codes each may take.
    pub fn pending(&self, report: &str, version: u32, records: Value) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.pending(report, version, records)?))
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
        self.with_open(|open| {
            let summary = open.reload()?;
            // What other devices wrote came in with the reading: the backup takes it too.
            self.back_up(&open.vault, None);
            Ok(summary)
        })
    }

    /// The open vault's summary, as [`App::open_vault`] returns it.
    pub fn summary(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.current_summary()?))
    }

    /// Every classification scheme version in the vault.
    pub fn schemes(&self) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.schemes()?))
    }

    /// The fields the vault's packs declare for an entity type.
    pub fn fields(&self, entity_type: &str) -> Result<Value, AppError> {
        self.with_open(|open| Ok(open.engine.fields(entity_type)?))
    }

    /// The version of a scheme to offer for a value entered on a date.
    pub fn in_force(&self, scheme: &str, date: &str) -> Result<Option<u32>, AppError> {
        self.with_open(|open| Ok(open.engine.in_force(scheme, date)?))
    }

    /// Runs a monthly report and keeps its run record in the vault.
    pub fn run_report(&self, report: &str, version: u32, year: i32, month: u32) -> Result<Value, AppError> {
        self.with_open(|open| {
            let (record, file) = open.engine.run_report(report, version, year, month)?;
            let path = file.path.clone();
            open.keep(file)?;
            self.back_up(&open.vault, Some(&[path]));
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

/// The vault folders a data pack adds to: classification schemes and crosswalks, report and export
/// forms, and the pack's manifest, labels and field definitions. Anything else in a pack folder
/// stays out of the vault.
const DEFINITION_FOLDERS: [&str; 6] = ["schemes/", "reports/", "exports/", "packs/", "labels/", "fields/"];

/// The definition files of a data pack, with their paths inside the pack as vault paths.
pub(crate) fn pack_files(pack: &Path) -> io::Result<Vec<PlainFile>> {
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
    files.retain(|f| DEFINITION_FOLDERS.iter().any(|d| f.path.starts_with(d)));
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn app() -> Option<App> {
        Some(App::new(openquote_care_test_support::sidecar()?, "pc01".to_owned()).with_bundle(bundle()))
    }

    /// The track the tests make vaults on: the one whose schemes and forms the golden vault holds.
    const TRACK: &str = "school-kr";

    /// The packs as the app bundles them.
    fn bundle() -> Bundle {
        Bundle::read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs")).unwrap()
    }

    /// The pack of the Korean school counseling schemes and forms.
    fn pack() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs/care.school.kr")
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

        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.close_vault();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert_eq!(app.open_vault(dir.path(), "pass".to_owned()).unwrap_err().code(), "not-a-vault");
    }

    #[test]
    fn records_and_reports_survive_closing_and_reopening() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        assert_eq!(app.in_force("topic", "2026-04-02").unwrap(), Some(1));
        assert_eq!(app.in_force("no-such-scheme", "2026-04-02").unwrap(), None);
        assert!(app.fields("session").unwrap().is_array());
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
    fn a_backup_follows_every_write_and_a_lost_backup_folder_fails_no_write() {
        let Some(app) = app() else { return };
        let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        assert_eq!(app.backup_status(), json!({ "folder": null }));

        let status = app.set_backup(Some(backup.path())).unwrap();
        assert!(status["copied"].as_u64().unwrap() > 2, "the declaration, the key file and the track's packs: {status}");
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        assert_eq!(app.backup_status()["copied"], 1, "the new record");
        app.run_report("monthly-topic", 1, 2026, 4).unwrap();
        assert_eq!(app.backup_status()["copied"], 1, "the run record");
        assert_eq!(vault_files(backup.path()), vault_files(dir.path()));

        app.change_passphrase("new pass".to_owned()).unwrap();
        assert_eq!(app.backup_status()["keyReplaced"], true);
        assert!(Vault::unlock(backup.path(), SecretString::from("new pass".to_owned())).is_ok());
        assert!(Vault::unlock(backup.path(), SecretString::from("pass".to_owned())).is_err(), "the old passphrase opens no copy");

        // The backup folder goes away, as an unplugged drive does: writing goes on, and the status says why.
        drop(backup);
        app.record("/changes/subject", json!({ "fields": { "name": "second" } })).unwrap();
        assert_eq!(app.backup_status()["error"], "io");
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 2);

        let kept = tempfile::tempdir().unwrap();
        app.set_backup(Some(kept.path())).unwrap();
        assert_eq!(app.set_backup(Some(dir.path())).unwrap_err().code(), "backup-overlaps");
        let papers = tempfile::tempdir().unwrap();
        fs::write(papers.path().join("notes.txt"), b"someone else's").unwrap();
        assert_eq!(app.set_backup(Some(papers.path())).unwrap_err().code(), "backup-holds-other");
        assert_eq!(app.backup_status()["folder"], kept.path().to_string_lossy().as_ref(), "a refused folder leaves the backup as it was");
        assert_eq!(app.set_backup(None).unwrap(), json!({ "folder": null }));

        // A backup belongs to the vault it was set for: another opening starts without one.
        let again = tempfile::tempdir().unwrap();
        app.set_backup(Some(again.path())).unwrap();
        app.close_vault();
        app.open_vault(dir.path(), "new pass".to_owned()).unwrap();
        assert_eq!(app.backup_status(), json!({ "folder": null }));
    }

    #[test]
    fn a_record_file_the_vault_lost_is_named_by_its_backup_and_restored_from_it() {
        let Some(app) = app() else { return };
        let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.set_backup(Some(backup.path())).unwrap();
        for name in ["one", "two", "three"] {
            app.record("/changes/subject", json!({ "fields": { "name": name } })).unwrap();
        }
        let subjects: Vec<String> = vault_files(dir.path()).into_keys().filter(|p| p.starts_with("subjects/")).collect();
        assert_eq!(subjects.len(), 3);
        app.close_vault();

        // A sync client takes one record file away and cuts another short.
        fs::remove_file(dir.path().join(&subjects[0])).unwrap();
        let cut = fs::read(dir.path().join(&subjects[1])).unwrap();
        fs::write(dir.path().join(&subjects[1]), &cut[..cut.len() / 2]).unwrap();

        app.open_vault(dir.path(), "pass".to_owned()).unwrap();
        let status = app.set_backup(Some(backup.path())).unwrap();
        assert_eq!(status["missing"], json!([subjects[0]]), "{status}");
        assert_eq!(status["damaged"], json!([subjects[1]]), "{status}");
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);

        let restored = app.restore_from_backup().unwrap();
        assert_eq!(restored["restored"], 1);
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 2, "the lost record is back");
        assert_eq!(restored["backup"]["missing"], json!([]));
        assert_eq!(restored["backup"]["damaged"], json!([subjects[1]]), "a damaged record file is left as it is");
        assert_eq!(fs::read(dir.path().join(&subjects[1])).unwrap(), &cut[..cut.len() / 2]);

        // A write after it keeps what the comparison found; the next whole backup compares again.
        app.record("/changes/subject", json!({ "fields": { "name": "four" } })).unwrap();
        assert_eq!(app.backup_status()["damaged"], json!([subjects[1]]));
    }

    #[test]
    fn a_plain_copy_is_written_apart_from_the_vault_and_says_why_when_it_cannot_be() {
        let Some(app) = app() else { return };
        let (dir, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let files = vec![("records.html".to_owned(), b"<p>records</p>".to_vec())];
        assert_eq!(app.write_plain_copy(out.path(), "copy", &files).unwrap_err().code(), "no-vault");

        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let folder = app.write_plain_copy(out.path(), "copy", &files).unwrap();
        assert_eq!(fs::read(Path::new(&folder).join("records.html")).unwrap(), b"<p>records</p>");
        assert_eq!(app.write_plain_copy(out.path(), "copy", &files).unwrap_err().code(), "plain-copy-exists");
        assert_eq!(app.write_plain_copy(dir.path(), "copy", &files).unwrap_err().code(), "plain-copy-overlaps");
        assert_eq!(app.write_plain_copy(out.path(), "../copy", &files).unwrap_err().code(), "plain-copy-name");
    }

    #[test]
    fn the_recovery_key_opens_the_vault_as_the_kit_shows_it() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        app.close_vault();
        let key_file = dir.path().join(openquote_care_vault::KEY_FILE);
        std::fs::write(&key_file, b"-----BEGIN AGE ENCRYPTED FILE-----
cut off").unwrap();

        assert_eq!(app.open_vault(dir.path(), "pass".to_owned()).unwrap_err().code(), "damaged-key-file");
        assert_eq!(app.open_vault_with_key(dir.path(), &key).unwrap()["keyFileLost"], true);
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);
        app.change_passphrase("pass again".to_owned()).unwrap();
        app.close_vault();

        app.open_vault(dir.path(), "pass again".to_owned()).unwrap();
        assert_eq!(app.entities("subject").unwrap().as_array().unwrap().len(), 1);

        // A key file gone altogether is the same: only the recovery key opens, and says so.
        app.close_vault();
        std::fs::remove_file(&key_file).unwrap();
        assert_eq!(app.open_vault(dir.path(), "pass again".to_owned()).unwrap_err().code(), "damaged-key-file");
        assert_eq!(app.open_vault_with_key(dir.path(), &key).unwrap()["keyFileLost"], true);
    }

    #[test]
    fn a_vault_opened_with_its_recovery_key_takes_a_new_passphrase() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "forgotten".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        app.close_vault();

        let summary = app.open_vault_with_key(dir.path(), &key).unwrap();
        assert!(summary.get("keyFileLost").is_none(), "a sound key file only waits for a passphrase");
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
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = shared_folder();
        let one = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        let two = App::new(exe.clone(), "pc02".to_owned()).with_bundle(bundle());
        let key = one.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = shared_folder();
        let one = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        let two = App::new(exe.clone(), "pc02".to_owned()).with_bundle(bundle());
        let key = one.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = shared_folder();
        let one = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        let two = App::new(exe.clone(), "pc02".to_owned()).with_bundle(bundle());
        let key = one.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = shared_folder();
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = Mutex::new(tx);
        let one = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle()).on_outside_change(move || {
            let _ = tx.lock().unwrap().send(());
        });
        let two = App::new(exe.clone(), "pc02".to_owned()).with_bundle(bundle());
        let key = one.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
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
    ///
    /// `OPENQUOTE_MEASURE_VAULT=<folder>` keeps the vault there (passphrase `pass`): a folder without
    /// one gets it written and kept; a folder with one is only opened — to time a vault after its
    /// files changed state in between (a sync client's online-only files, a network share).
    #[test]
    #[ignore = "measurement"]
    fn measure_opening_a_vault_of_a_years_records() {
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let records: usize = std::env::var("OPENQUOTE_MEASURE_RECORDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
        let kept = std::env::var_os("OPENQUOTE_MEASURE_VAULT").map(PathBuf::from);
        let temp = if kept.is_none() { Some(shared_folder()) } else { None };
        let folder = kept.clone().unwrap_or_else(|| temp.as_ref().unwrap().path().to_path_buf());
        if kept.as_ref().is_some_and(|k| k.join("vault.json").exists()) {
            let reader = App::new(exe.clone(), "pc03".to_owned()).with_bundle(bundle());
            let started = std::time::Instant::now();
            reader.open_vault(&folder, "pass".to_owned()).unwrap();
            let opening = started.elapsed();
            let sessions = reader.entities("session").unwrap().as_array().unwrap().len();
            eprintln!("measure: opened a kept vault of {sessions} sessions with first cache build {opening:.2?}");
            return;
        }
        std::fs::create_dir_all(&folder).unwrap();
        let writer = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        let key = writer.create_vault(&folder, "pass".to_owned(), TRACK).unwrap();
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

        let reader = App::new(exe.clone(), "pc02".to_owned()).with_bundle(bundle());
        let started = std::time::Instant::now();
        reader.open_vault(&folder, "pass".to_owned()).unwrap();
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
    fn a_fresh_engine_rebuilds_the_same_state_from_the_files_alone() {
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = tempfile::tempdir().unwrap();
        let first = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        let key = first.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        first.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let subject = first.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        let subject_id = subject.split('/').nth(1).unwrap().to_owned();
        let session = first
            .record("/changes/in-subject", json!({ "subjectId": subject_id, "type": "session",
                     "fields": { "date": "2026-04-02", "topic": { "scheme": "topic", "version": 1, "code": "relation" } } }))
            .unwrap();
        let id = session.split('/').nth(2).unwrap().split('.').next().unwrap().to_owned();
        first.record("/changes/update", json!({ "type": "session", "id": id, "fields": { "date": "2026-04-03" } })).unwrap();
        first.record("/changes/group", json!({ "fields": { "name": "peers", "members": [subject_id] } })).unwrap();
        first.apply_pack(&golden_step(2)).unwrap();
        first.run_report("monthly-topic", 2, 2026, 4).unwrap();
        let state = |app: &App| {
            json!({
                "subjects": app.entities("subject").unwrap(),
                "sessions": app.entities("session").unwrap(),
                "groups": app.entities("group").unwrap(),
                "summary": app.summary().unwrap(),
                "runs": app.runs().unwrap(),
            })
        };
        let before = state(&first);
        first.close_vault();

        let fresh = App::new(exe.clone(), "pc01".to_owned()).with_bundle(bundle());
        fresh.open_vault(dir.path(), "pass".to_owned()).unwrap();
        assert_eq!(state(&fresh), before);
    }

    /// Every file in the vault but the wrapped key (the one file a vault replaces), by its path.
    fn vault_files(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        fn walk(root: &Path, dir: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                if path.is_dir() {
                    walk(root, &path, out);
                } else if !relative.starts_with("keys/") {
                    out.insert(relative, fs::read(&path).unwrap());
                }
            }
        }
        let mut out = std::collections::BTreeMap::new();
        walk(root, root, &mut out);
        out
    }

    #[test]
    fn no_file_once_written_changes_through_editing_revising_and_reporting() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let subject = app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        let topic = |version: u32, code: &str| json!({ "scheme": "topic", "version": version, "code": code });
        let session = app
            .record(
                "/changes/in-subject",
                json!({ "subjectId": subject.split('/').nth(1).unwrap(), "type": "session",
                        "fields": { "date": "2026-04-02", "topic": topic(1, "relation") } }),
            )
            .unwrap();
        let id = session.split('/').nth(2).unwrap().split('.').next().unwrap().to_owned();
        app.run_report("monthly-topic", 1, 2026, 4).unwrap();

        let mut kept = vault_files(dir.path());
        let mut step = |what: &str, act: &dyn Fn()| {
            act();
            let now = vault_files(dir.path());
            for (path, bytes) in &kept {
                assert_eq!(now.get(path), Some(bytes), "{what}: {path} was changed or removed");
            }
            assert!(now.len() > kept.len(), "{what} added its own file");
            kept = now;
        };
        step("editing a session", &|| {
            app.record("/changes/update", json!({ "type": "session", "id": id, "fields": { "date": "2026-04-03" } })).unwrap();
        });
        step("applying a revised classification", &|| {
            app.apply_pack(&golden_step(2)).unwrap();
        });
        step("reclassifying a split category", &|| {
            app.record("/changes/reclassify", json!({ "type": "session", "id": id, "field": "topic", "value": topic(2, "relation-peer") })).unwrap();
        });
        step("running the revised report", &|| {
            app.run_report("monthly-topic", 2, 2026, 4).unwrap();
        });
        step("changing the passphrase and naming the device", &|| {
            app.change_passphrase("pass again".to_owned()).unwrap();
            app.record("/changes/device-name", json!({ "name": "counseling room" })).unwrap();
        });
    }

    #[test]
    fn a_pack_adds_only_the_definitions_the_vault_lacks() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();

        let mut added = app.apply_pack(&golden_step(2)).unwrap();
        added.sort();
        assert_eq!(added, ["reports/monthly-topic/v2.json", "schemes/topic/v1-v2.json", "schemes/topic/v2.json"]);
        assert!(app.summary().unwrap()["reports"].as_array().unwrap().iter().any(|r| r["version"] == 2));
        assert!(app.apply_pack(&golden_step(2)).unwrap().is_empty(), "applying it again adds nothing");
        let subject = app.record("/changes/subject", json!({ "fields": { "name": "synthetic" } })).unwrap();
        let session = app
            .record(
                "/changes/in-subject",
                json!({ "subjectId": subject.split('/').nth(1).unwrap(), "type": "session",
                        "fields": { "date": "2026-04-02", "topic": { "scheme": "topic", "version": 1, "code": "relation" } } }),
            )
            .unwrap();
        let id = session.split('/').nth(2).unwrap().split('.').next().unwrap().to_owned();
        let split = app.pending("monthly-topic", 2, json!([id])).unwrap();
        assert_eq!(split[0]["candidates"], json!(["relation-peer", "relation-teacher"]));
        assert!(app.apply_pack(&pack()).unwrap().is_empty(), "the pack the vault started from is already in it");

        let other = tempfile::tempdir().unwrap();
        fs::create_dir_all(other.path().join("schemes/topic")).unwrap();
        fs::write(other.path().join("schemes/topic/v2.json"), b"{}").unwrap();
        assert_eq!(app.apply_pack(other.path()).unwrap_err().code(), "pack-conflict");
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(app.apply_pack(empty.path()).unwrap_err().code(), "not-a-pack");
    }

    #[test]
    fn a_pack_with_a_manifest_adds_its_manifest_labels_and_fields() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();
        let extra = tempfile::tempdir().unwrap();
        let put = |path: &str, json: &str| {
            let file = extra.path().join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, json).unwrap();
        };
        put("packs/x/v1.json", r#"{"format":"openquote.pack/0","pack":"x","version":1,"label":"X","provides":["labels/x/v1.en.json","fields/x/session/v1.json"]}"#);
        put("labels/x/v1.en.json", r#"{"format":"openquote.labels/0","pack":"x","version":1,"locale":"en","fields":{"session":{"date":"Date"}}}"#);
        put("fields/x/session/v1.json", r#"{"format":"openquote.fields/0","pack":"x","type":"session","version":1,"fields":[{"name":"date","kind":"date"}]}"#);
        put("tracks.json", r#"{"not":"a definition"}"#);

        let mut added = app.apply_pack(extra.path()).unwrap();
        added.sort();
        assert_eq!(added, ["fields/x/session/v1.json", "labels/x/v1.en.json", "packs/x/v1.json"]);
        assert!(app.summary().unwrap()["unreadable"].as_array().unwrap().is_empty(), "every file it added reads");
    }

    /// Every file under `root`, with its bytes, by path relative to it.
    fn files_under(root: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        fn walk(root: &Path, dir: &Path, out: &mut std::collections::BTreeMap<PathBuf, Vec<u8>>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else {
                    out.insert(path.strip_prefix(root).unwrap().to_owned(), fs::read(&path).unwrap());
                }
            }
        }
        let mut out = std::collections::BTreeMap::new();
        walk(root, root, &mut out);
        out
    }

    #[test]
    fn a_new_vault_holds_only_its_tracks_packs() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        let key = app.create_vault(dir.path(), "pass".to_owned(), TRACK).unwrap();
        app.confirm_recovery_kit(&key[key.len() - 6..]).unwrap();

        let mut packs: Vec<String> = fs::read_dir(dir.path().join("packs")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        packs.sort();
        assert_eq!(packs, ["care", "care.school", "care.school.kr", "kr"]);
        let summary = app.summary().unwrap();
        assert_eq!(summary["locales"], json!(["ko"]));
        for clean in ["unreadable", "packIssues", "fieldIssues", "labelConflicts"] {
            assert_eq!(summary[clean], json!([]), "{clean}");
        }
        let fields = app.fields("session").unwrap();
        let shown: Vec<&str> = fields.as_array().unwrap().iter().filter(|f| f["hidden"] == false).map(|f| f["name"].as_str().unwrap()).collect();
        assert!(shown.contains(&"topic") && shown.contains(&"method") && !shown.contains(&"concern"), "{shown:?}");
        let topic = fields.as_array().unwrap().iter().find(|f| f["name"] == "topic").unwrap();
        assert_eq!((&topic["label"], &topic["required"]), (&json!("주제"), &json!(true)));
        let name = app.fields("subject").unwrap().as_array().unwrap().iter().find(|f| f["name"] == "name").unwrap().clone();
        assert!(name["aliases"].as_array().unwrap().contains(&json!("성명")));
        // The core's forms stand on the fields the school track hides: they are not offered.
        let offered: Vec<&str> = summary["reports"].as_array().unwrap().iter().filter(|r| r["offered"] == true).map(|r| r["name"].as_str().unwrap()).collect();
        assert_eq!(offered, ["monthly-topic"]);
    }

    /// A vault as a version before packs named themselves left it: the golden vault's files through
    /// `step`, encrypted, and no manifest.
    fn earlier_vault(dir: &Path, step: u32) {
        let vault = Vault::prepare(dir, SecretString::from("pass".to_owned())).unwrap().write().unwrap();
        let golden = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/golden/steps");
        for s in 1..=step {
            for file in pack_files_all(&golden.join(s.to_string())) {
                vault.write_new(&file.path, &file.content).unwrap();
            }
        }
    }

    // Every JSON file under `root` by its path there, whatever folder it is in.
    fn pack_files_all(root: &Path) -> Vec<PlainFile> {
        files_under(root)
            .into_iter()
            .filter(|(p, _)| p.extension().is_some_and(|e| e == "json") && p != Path::new("vault.json"))
            .map(|(p, content)| PlainFile { path: p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"), content })
            .collect()
    }

    #[test]
    fn the_golden_vault_is_adopted_into_the_school_track_and_counts_the_same() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        earlier_vault(dir.path(), 3);
        let held = files_under(dir.path());

        let summary = app.open_vault(dir.path(), "pass".to_owned()).unwrap();

        assert_eq!(summary["adopted"]["track"], TRACK);
        assert_eq!(summary["unreadable"], json!([]));
        let now = files_under(dir.path());
        for (path, bytes) in &held {
            assert_eq!(now.get(path), Some(bytes), "{} is unchanged", path.display());
        }
        let run = app.run_report("monthly-topic", 2, 2026, 4).unwrap();
        let expected: Value =
            serde_json::from_slice(&fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/golden/expected/r3.json")).unwrap()).unwrap();
        for key in ["cells", "pending", "unmapped", "total"] {
            assert_eq!(run[key], expected[key], "{key} counts the same after adoption");
        }
    }

    #[test]
    fn opening_it_again_adds_nothing() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        earlier_vault(dir.path(), 1);
        app.open_vault(dir.path(), "pass".to_owned()).unwrap();
        app.close_vault();
        let held = files_under(dir.path());

        let summary = app.open_vault(dir.path(), "pass".to_owned()).unwrap();

        assert!(summary.get("adopted").is_none(), "a vault whose packs name themselves takes nothing on");
        assert_eq!(files_under(dir.path()), held);
    }

    #[test]
    fn a_vault_holding_a_different_version_of_a_bundled_file_is_not_adopted() {
        let Some(app) = app() else { return };
        let dir = tempfile::tempdir().unwrap();
        earlier_vault(dir.path(), 1);
        let vault = Vault::unlock(dir.path(), SecretString::from("pass".to_owned())).unwrap();
        vault.write_new("exports/session-list/v1.json", br#"{"format":"openquote.export/0","export":"session-list","version":1}"#).unwrap();
        drop(vault);
        let held = files_under(dir.path());

        let summary = app.open_vault(dir.path(), "pass".to_owned()).unwrap();

        assert!(summary.get("adopted").is_none());
        assert_eq!(files_under(dir.path()), held);
    }

    #[test]
    fn two_devices_adopting_at_once_both_succeed() {
        let Some(exe) = openquote_care_test_support::sidecar() else { return };
        let dir = shared_folder();
        earlier_vault(dir.path(), 1);
        let path = dir.path().to_owned();
        let opens: Vec<_> = ["pc01", "pc02"]
            .into_iter()
            .map(|device| {
                let (exe, path) = (exe.clone(), path.clone());
                std::thread::spawn(move || {
                    let app = App::new(exe, device.to_owned()).with_bundle(bundle());
                    let summary = app.open_vault(&path, "pass".to_owned()).unwrap();
                    app.close_vault();
                    summary
                })
            })
            .collect();
        for open in opens {
            let summary = open.join().unwrap();
            assert_eq!(summary["unreadable"], json!([]));
        }
        let app = App::new(exe, "pc03".to_owned()).with_bundle(bundle());
        let summary = app.open_vault(&path, "pass".to_owned()).unwrap();
        assert!(summary["packs"].as_array().unwrap().iter().any(|p| p["id"] == "care.school.kr"), "the vault now names its packs");
        assert_eq!(summary["packIssues"], json!([]));
    }

    #[test]
    fn the_device_id_is_made_once_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let first = device_id(dir.path()).unwrap();
        assert_eq!(first.len(), 8);
        assert_eq!(device_id(dir.path()).unwrap(), first);
    }

    #[test]
    fn the_school_pack_holds_the_schemes_and_the_monthly_form() {
        let paths: Vec<String> = pack_files(&pack()).unwrap().into_iter().map(|f| f.path).collect();
        assert!(paths.contains(&"schemes/topic/v1.json".to_owned()));
        assert!(paths.contains(&"reports/monthly-topic/v1.json".to_owned()));
    }
}

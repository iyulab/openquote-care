//! A second copy of a vault, kept up to date by the device that has it open.
//!
//! The backup is a folder that holds the vault's files as they are on disk — encrypted, so no
//! plaintext is written anywhere — and is itself a vault that opens with the same passphrase or
//! recovery key. Record files never change once written, so bringing a backup up to date is
//! copying the files it lacks; the key file is the one file that is replaced, so a changed
//! passphrase changes it in the backup too and the old passphrase stops opening either copy.
//!
//! Because a record file never changes or goes away, a backup also tells what the vault lost: a
//! record file only the backup holds was taken from the vault, and one the two copies hold
//! differently is damaged in one of them. [`Vault::compare_backup`] says which, and
//! [`Vault::restore_from_backup`] copies the lost files back.

use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{collect_files, encrypted_files, key_file_sound, key_opens, relative_path, Vault, ENCRYPTED_EXTENSION, KEY_FILE, VAULT_FILE};

/// Why a folder cannot hold a vault's backup, or a backup could not be brought up to date.
#[derive(Debug)]
pub enum BackupError {
    /// The folder is the vault itself, is inside it, or holds it.
    Overlaps,
    /// The folder holds files that are not this vault's backup.
    HoldsOther,
    /// The folder is missing, or the file system refused.
    Io(io::Error),
}

impl fmt::Display for BackupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Overlaps => f.write_str("the backup folder and the vault folder overlap"),
            Self::HoldsOther => f.write_str("the backup folder holds files that are not this vault's backup"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for BackupError {}

impl From<io::Error> for BackupError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// What bringing a backup up to date did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BackupReport {
    /// Files the backup lacked, now copied into it.
    pub copied: usize,
    /// Whether the key file was replaced: the passphrase changed since the last backup.
    pub key_replaced: bool,
    /// Record files the backup holds with other content than the vault has, by path. Left as they
    /// are — a record file is never replaced — and named so a person can look.
    pub differs: Vec<String>,
    /// Record files only the backup holds, by path — files the vault lost. Listed by a backup of
    /// the whole vault ([`Vault::back_up`]) only; see [`Vault::compare_backup`] for what they hold.
    pub only_in_backup: Vec<String>,
}

/// What comparing a vault with its backup found, by record file path.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BackupComparison {
    /// Files only the backup holds, sound: lost from the vault, and what
    /// [`Vault::restore_from_backup`] copies back.
    pub missing: Vec<String>,
    /// Files the vault holds but cannot decrypt while the backup's copy decrypts: damaged in the
    /// vault, with a sound copy in the backup.
    pub damaged: Vec<String>,
    /// Files the backup holds but cannot decrypt while the vault's copy decrypts.
    pub damaged_in_backup: Vec<String>,
    /// Files the two copies hold differently where neither or both decrypt, and files only the
    /// backup holds that do not decrypt: which copy is the file once written cannot be told.
    pub unresolved: Vec<String>,
}

impl BackupComparison {
    /// Whether the two copies hold the same record files, as far as the backup goes.
    pub fn is_empty(&self) -> bool {
        self.missing.is_empty() && self.damaged.is_empty() && self.damaged_in_backup.is_empty() && self.unresolved.is_empty()
    }
}

impl Vault {
    /// Checks that `target` can hold this vault's backup: an existing folder apart from the vault
    /// that is empty, or holds this vault's backup already (a vault declaration and only record
    /// files encrypted to this vault's key).
    pub fn check_backup(&self, target: &Path) -> Result<(), BackupError> {
        let target = self.backup_folder(target)?;
        let mut paths = Vec::new();
        collect_files(&target, &mut paths)?;
        if paths.is_empty() {
            return Ok(());
        }
        if !target.join(VAULT_FILE).is_file() {
            return Err(BackupError::HoldsOther);
        }
        for path in paths {
            let relative = relative_path(&target, &path);
            if relative == VAULT_FILE || relative == KEY_FILE {
                continue;
            }
            if !relative.ends_with(ENCRYPTED_EXTENSION) || key_opens(&self.identity, &fs::read(&path)?) != Some(true) {
                return Err(BackupError::HoldsOther);
            }
        }
        Ok(())
    }

    /// Brings the backup in `target` up to date with the whole vault: copies every file it lacks
    /// and replaces its key file when the vault's differs. Check the folder with
    /// [`Vault::check_backup`] before the first backup into it.
    pub fn back_up(&self, target: &Path) -> Result<BackupReport, BackupError> {
        let target = self.backup_folder(target)?;
        let mut paths = Vec::new();
        collect_files(self.root.path(), &mut paths)?;
        let relatives: Vec<String> = paths
            .iter()
            .map(|p| relative_path(self.root.path(), p))
            .filter(|r| r == VAULT_FILE || r == KEY_FILE || r.ends_with(ENCRYPTED_EXTENSION))
            .collect();
        let mut report = self.copy_into(&target, relatives)?;
        let in_vault = record_files(self.root.path())?;
        report.only_in_backup = record_files(&target)?.into_iter().filter(|r| !in_vault.contains(r)).collect();
        Ok(report)
    }

    /// Compares every record file of the vault with its backup in `target`, decrypting the copies
    /// that differ to tell which is sound. Reads both folders whole: run it when a backup reported
    /// files only it holds, or files it holds differently, not after every write.
    pub fn compare_backup(&self, target: &Path) -> Result<BackupComparison, BackupError> {
        let target = self.backup_folder(target)?;
        let in_vault = record_files(self.root.path())?;
        let opens = |bytes: &[u8]| age::decrypt(&self.identity, bytes).is_ok();
        let mut comparison = BackupComparison::default();
        for relative in record_files(&target)? {
            let backup = fs::read(target.join(&relative))?;
            let vault = if in_vault.contains(&relative) { read_if_present(&self.root.path().join(&relative))? } else { None };
            let Some(vault) = vault else {
                if opens(&backup) { comparison.missing.push(relative) } else { comparison.unresolved.push(relative) }
                continue;
            };
            if vault == backup {
                continue;
            }
            match (opens(&vault), opens(&backup)) {
                (false, true) => comparison.damaged.push(relative),
                (true, false) => comparison.damaged_in_backup.push(relative),
                _ => comparison.unresolved.push(relative),
            }
        }
        Ok(comparison)
    }

    /// Copies the record files the vault lost back from its backup in `target` — the files
    /// [`Vault::compare_backup`] finds missing — as new files, byte for byte, so each is the file
    /// that was once written. A damaged file is left as it is: the vault never replaces a record
    /// file. Returns how many files it copied.
    pub fn restore_from_backup(&self, target: &Path) -> Result<usize, BackupError> {
        let missing = self.compare_backup(target)?.missing;
        let target = self.backup_folder(target)?;
        let mut restored = 0;
        for relative in missing {
            let content = fs::read(target.join(&relative))?;
            let path = self.root.path().join(&relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            self.own.record(&path, &content);
            match tauri_kit_fs::write_atomic_new(&path, &content) {
                Ok(()) => restored += 1,
                Err(e) => {
                    self.own.forget(&path);
                    if e.kind() != io::ErrorKind::AlreadyExists {
                        return Err(e.into()); // AlreadyExists: another device restored it first
                    }
                }
            }
        }
        Ok(restored)
    }

    /// Brings the backup in `target` up to date with the record files at `written` (their paths
    /// as [`Vault::write_new`] takes them) and the key file — what a write or a new passphrase
    /// changed, without walking the whole vault.
    pub fn back_up_written(&self, target: &Path, written: &[&str]) -> Result<BackupReport, BackupError> {
        let target = self.backup_folder(target)?;
        let mut relatives = vec![VAULT_FILE.to_owned(), KEY_FILE.to_owned()];
        for relative in written {
            let path = self.record_path(relative).map_err(|e| BackupError::Io(io::Error::other(e.to_string())))?;
            relatives.push(relative_path(self.root.path(), &path));
        }
        self.copy_into(&target, relatives)
    }

    fn copy_into(&self, target: &Path, relatives: Vec<String>) -> Result<BackupReport, BackupError> {
        let mut report = BackupReport::default();
        for relative in relatives {
            let from = self.root.path().join(&relative);
            let to = target.join(&relative);
            let content = match fs::read(&from) {
                Ok(content) => content,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue, // gone since it was listed
                Err(e) => return Err(e.into()),
            };
            match fs::metadata(&to) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    if let Some(parent) = to.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    match tauri_kit_fs::write_atomic_new(&to, &content) {
                        Ok(()) => report.copied += 1,
                        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {} // another copy got there first
                        Err(e) => return Err(e.into()),
                    }
                }
                Err(e) => return Err(e.into()),
                // The key file follows the vault's, or the old passphrase would still open the backup —
                // but never a damaged one over the backup's: that may be the one sound copy left.
                Ok(_) if relative == KEY_FILE => {
                    let backed_up = fs::read(&to)?;
                    if backed_up != content && key_file_sound(self.root.path()) {
                        // Compared and replaced in one step: a copy another backup run put there
                        // meanwhile is left for the next run to judge.
                        match tauri_kit_fs::replace_if(&to, tauri_kit_fs::Expect::Holds(&backed_up), &content) {
                            Ok(()) => report.key_replaced = true,
                            Err(e) if tauri_kit_fs::is_changed(&e) => {}
                            Err(e) => return Err(e.into()),
                        }
                    }
                }
                // A record file never changes, so one of the same size is the same file; reading every
                // file back on every write would cost more than a backup should.
                Ok(meta) if meta.len() != content.len() as u64 && relative != VAULT_FILE => report.differs.push(relative),
                Ok(_) => {}
            }
        }
        Ok(report)
    }

    /// `target` when it is an existing folder apart from the vault. The two are compared resolved
    /// (links followed, one spelling); the folder is then used as given.
    fn backup_folder(&self, target: &Path) -> Result<PathBuf, BackupError> {
        let resolved = fs::canonicalize(target)?;
        if !resolved.is_dir() {
            return Err(BackupError::Io(io::Error::new(io::ErrorKind::NotADirectory, "the backup folder is not a folder")));
        }
        let root = fs::canonicalize(self.root.path())?;
        if resolved.starts_with(&root) || root.starts_with(&resolved) {
            return Err(BackupError::Overlaps);
        }
        Ok(target.to_path_buf())
    }
}

/// The record files in the vault folder `root` (not the declaration, not the key file), as paths
/// relative to it.
fn record_files(root: &Path) -> io::Result<BTreeSet<String>> {
    Ok(encrypted_files(root)?.iter().map(|p| relative_path(root, p)).collect())
}

fn read_if_present(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

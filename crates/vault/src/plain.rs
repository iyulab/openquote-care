//! A copy of a vault's records that reads without the app: plain files, written apart from the vault.
//!
//! What goes in the copy is the window's to say; this module decides only where it may be written.
//! The copy is plaintext, so it never lands inside the vault folder (which may be shared or synced
//! to other devices) or in a folder that holds the vault, and it never replaces anything: it is a
//! new folder, holding only files named by a plain file name.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::Vault;

/// Why a plain copy could not be written.
#[derive(Debug)]
pub enum PlainCopyError {
    /// The folder chosen is the vault itself, is inside it, or holds it.
    Overlaps,
    /// The folder chosen already holds something by the copy's name.
    Exists,
    /// A name for the copy or one of its files is not a plain file name.
    BadName(String),
    /// The folder is missing, or the file system refused.
    Io(io::Error),
}

impl fmt::Display for PlainCopyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Overlaps => f.write_str("the folder for the plain copy and the vault folder overlap"),
            Self::Exists => f.write_str("the folder already holds something by the copy's name"),
            Self::BadName(name) => write!(f, "not a plain file name: {name:?}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PlainCopyError {}

impl From<io::Error> for PlainCopyError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// A name that names one entry in a folder on every platform: no separators, no parent or current
/// folder, none of the characters or trailing dots and spaces Windows refuses.
fn plain_name(name: &str) -> Result<&str, PlainCopyError> {
    let refused = name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
    if refused { Err(PlainCopyError::BadName(name.to_owned())) } else { Ok(name) }
}

impl Vault {
    /// Writes `files` (name and bytes) into a new folder `name` inside `target`, an existing folder
    /// apart from this vault, and returns the new folder. Nothing is written when any name is not a
    /// plain file name, when the folders overlap, or when `target` already holds `name`.
    pub fn write_plain_copy(&self, target: &Path, name: &str, files: &[(String, Vec<u8>)]) -> Result<PathBuf, PlainCopyError> {
        let name = plain_name(name)?;
        for (file, _) in files {
            plain_name(file)?;
        }
        let resolved = fs::canonicalize(target)?;
        if !resolved.is_dir() {
            return Err(PlainCopyError::Io(io::Error::new(io::ErrorKind::NotADirectory, "the folder for the plain copy is not a folder")));
        }
        let root = fs::canonicalize(self.root.path())?;
        if resolved.starts_with(&root) || root.starts_with(&resolved) {
            return Err(PlainCopyError::Overlaps);
        }
        let folder = target.join(name);
        fs::create_dir(&folder).map_err(|e| if e.kind() == io::ErrorKind::AlreadyExists { PlainCopyError::Exists } else { e.into() })?;
        for (file, content) in files {
            fs::write(folder.join(file), content)?;
        }
        Ok(folder)
    }
}

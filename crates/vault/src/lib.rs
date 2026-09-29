//! Vault storage for Openquote Care.
//!
//! A vault is a folder. Every record file in it is encrypted on its own with [age] to the vault's
//! key, so the files can sit in a shared or synced folder and still be opened years later with any
//! age implementation — no Openquote needed. The vault key itself is kept in the vault, wrapped
//! with a passphrase; the recovery kit is the unwrapped key, shown once when the vault is created.
//!
//! Plaintext never touches the disk: files are encrypted in memory and then written with
//! create-new semantics, so an existing file is never replaced. The one exception is the key
//! file, which [`Vault::change_passphrase`] replaces atomically.
//!
//! [age]: https://age-encryption.org/v1

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use age::secrecy::{ExposeSecret, SecretString};
use age::{scrypt, x25519};
use tauri_kit_watch::{OwnWrites, Watch};

pub use tauri_kit_watch::Watcher;

/// The vault declaration, readable before the vault is unlocked.
pub const VAULT_FILE: &str = "vault.json";
/// The vault key, wrapped with the passphrase.
pub const KEY_FILE: &str = "keys/vault-key.age";
/// The extension an encrypted record file carries after its plaintext name.
pub const ENCRYPTED_EXTENSION: &str = ".age";

const VAULT_DECLARATION: &str = "{\n  \"format\": \"openquote.vault/0\",\n  \"encryption\": \"age\"\n}\n";

/// scrypt cost (log2 N) for wrapping the vault key: the age default. Fixed rather than calibrated
/// on the creating machine, so a vault made on a fast computer still opens in reasonable time on
/// a slow one.
const WORK_FACTOR: u8 = 18;
/// The highest cost a key file may demand before it is refused as suspicious.
const MAX_WORK_FACTOR: u8 = 20;

/// Why a vault operation failed.
#[derive(Debug)]
pub enum VaultError {
    /// The folder already holds a vault (or a file the new vault would need).
    AlreadyExists,
    /// The folder has no vault declaration, or one this version does not understand.
    NotAVault,
    /// The folder holds a vault in a newer format than this version reads. Opening it anyway
    /// could miscount what this version does not know about, so it is refused.
    NewerFormat,
    /// The vault is declared unencrypted; it has no key to unlock.
    NotEncrypted,
    /// The passphrase does not unwrap the vault key.
    WrongPassphrase,
    /// The key file is damaged or demands an unreasonable cost.
    DamagedKeyFile,
    /// The recovery key is not a valid age secret key.
    InvalidRecoveryKey,
    /// The recovery key is valid but belongs to another vault.
    RecoveryKeyMismatch,
    /// A relative path would leave the vault or name a reserved file.
    InvalidPath(String),
    /// The file system refused.
    Io(io::Error),
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyExists => f.write_str("the folder already holds a vault"),
            Self::NotAVault => f.write_str("the folder holds no vault this version can open"),
            Self::NewerFormat => f.write_str("the vault is in a newer format than this version reads"),
            Self::NotEncrypted => f.write_str("the vault is not encrypted"),
            Self::WrongPassphrase => f.write_str("the passphrase does not open this vault"),
            Self::DamagedKeyFile => f.write_str("the vault key file is damaged"),
            Self::InvalidRecoveryKey => f.write_str("the recovery key is not valid"),
            Self::RecoveryKeyMismatch => f.write_str("the recovery key belongs to another vault"),
            Self::InvalidPath(p) => write!(f, "not a path inside the vault: {p}"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<io::Error> for VaultError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// The unwrapped vault key, to print or store away from the computer. With it, any age tool opens
/// every file in the vault even if the passphrase is forgotten or the key file is lost.
pub struct RecoveryKit {
    secret_key: SecretString,
}

impl RecoveryKit {
    /// The vault key as an age secret key (`AGE-SECRET-KEY-1…`).
    pub fn secret_key(&self) -> &str {
        self.secret_key.expose_secret()
    }
}

/// A vault whose key exists only in memory. See [`Vault::prepare`].
pub struct NewVault {
    root: PathBuf,
    identity: x25519::Identity,
    key_file: String,
}

impl NewVault {
    /// The recovery kit for the vault this will become.
    pub fn recovery_kit(&self) -> RecoveryKit {
        RecoveryKit { secret_key: self.identity.to_string() }
    }

    /// Writes the vault to disk and returns it unlocked. Fails with
    /// [`VaultError::AlreadyExists`] if a vault appeared in the folder meanwhile.
    pub fn write(self) -> Result<Vault, VaultError> {
        // The declaration goes last: a folder with a declaration always has its key.
        write_new(&self.root.join(KEY_FILE), self.key_file.as_bytes())?;
        write_new(&self.root.join(VAULT_FILE), VAULT_DECLARATION.as_bytes())?;
        Ok(Vault::with_identity(&self.root, self.identity))
    }
}

/// A file the vault could not decrypt. The rest of the vault is still read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndecryptableFile {
    /// Path relative to the vault root, with `/` separators.
    pub path: String,
    /// The vault path it would hold once decrypted (`path` without the encrypted extension).
    pub plain_path: String,
    /// What went wrong.
    pub reason: String,
}

/// Every record file of a vault, decrypted.
#[derive(Debug, Default)]
pub struct VaultContents {
    /// `(plaintext path, plaintext bytes)`, paths relative to the vault root with `/` separators
    /// and without the encrypted extension, sorted by path.
    pub files: Vec<(String, Vec<u8>)>,
    /// Files that are present but could not be decrypted.
    pub undecryptable: Vec<UndecryptableFile>,
}

/// An unlocked vault.
pub struct Vault {
    root: PathBuf,
    identity: x25519::Identity,
    recipient: x25519::Recipient,
    /// What this vault wrote, so a watch of its folder reports only what others wrote.
    own: OwnWrites,
}

impl Vault {
    /// Creates a vault in `root` (which may already exist, but must not hold a vault) and returns
    /// it unlocked, together with its recovery kit. The kit is the only copy of the unwrapped key:
    /// the caller must make the person keep it before going on. To show the kit before anything
    /// is written, use [`Vault::prepare`].
    pub fn create(root: &Path, passphrase: SecretString) -> Result<(Vault, RecoveryKit), VaultError> {
        let new = Vault::prepare(root, passphrase)?;
        let kit = new.recovery_kit();
        Ok((new.write()?, kit))
    }

    /// Makes a vault key for `root` and wraps it with the passphrase, without touching the disk.
    /// Nothing exists until [`NewVault::write`]: a vault abandoned before then leaves no trace.
    pub fn prepare(root: &Path, passphrase: SecretString) -> Result<NewVault, VaultError> {
        if root.join(VAULT_FILE).exists() || root.join(KEY_FILE).exists() {
            return Err(VaultError::AlreadyExists);
        }
        let identity = x25519::Identity::generate();
        let key_file = wrap_key(&identity, passphrase)?;
        Ok(NewVault { root: root.to_path_buf(), identity, key_file })
    }

    /// Unlocks the vault in `root` with its passphrase.
    pub fn unlock(root: &Path, passphrase: SecretString) -> Result<Vault, VaultError> {
        check_declaration(root)?;
        let key_file = fs::read(root.join(KEY_FILE)).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => VaultError::DamagedKeyFile,
            _ => VaultError::Io(e),
        })?;

        let mut unwrap = scrypt::Identity::new(passphrase);
        unwrap.set_max_work_factor(MAX_WORK_FACTOR);
        let secret = age::decrypt(&unwrap, &key_file).map_err(|e| match e {
            age::DecryptError::DecryptionFailed | age::DecryptError::KeyDecryptionFailed => VaultError::WrongPassphrase,
            _ => VaultError::DamagedKeyFile,
        })?;
        let secret = SecretString::from(String::from_utf8(secret).map_err(|_| VaultError::DamagedKeyFile)?);
        let identity = x25519::Identity::from_str(secret.expose_secret()).map_err(|_| VaultError::DamagedKeyFile)?;
        Ok(Vault::with_identity(root, identity))
    }

    /// Unlocks the vault in `root` with its recovery key, for when the passphrase is forgotten or
    /// the key file is lost. The key is checked against an existing record file when there is one.
    pub fn recover(root: &Path, secret_key: &str) -> Result<Vault, VaultError> {
        check_declaration(root)?;
        let identity = x25519::Identity::from_str(secret_key.trim()).map_err(|_| VaultError::InvalidRecoveryKey)?;
        let vault = Vault::with_identity(root, identity);
        if let Some(sample) = first_encrypted_file(root)?
            && age::decrypt(&vault.identity, &fs::read(&sample)?).is_err()
        {
            return Err(VaultError::RecoveryKeyMismatch);
        }
        Ok(vault)
    }

    /// Wraps the vault key with a new passphrase and replaces the key file with it, so the old
    /// passphrase stops opening the vault on every device sharing the folder. The key itself does
    /// not change: record files stay as they are and the recovery kit stays valid. Also restores a
    /// lost key file for a vault unlocked with its recovery key.
    ///
    /// The key file is the one file a vault replaces: keeping the old wrapping beside a new one
    /// would leave the old passphrase working. The replacement is atomic — a crash leaves either
    /// the old or the new key file.
    pub fn change_passphrase(&self, passphrase: SecretString) -> Result<(), VaultError> {
        let key_file = wrap_key(&self.identity, passphrase)?;
        tauri_kit_fs::write_atomic(&self.root.join(KEY_FILE), key_file.as_bytes())?;
        Ok(())
    }

    /// The vault key's public half, to which every record file is encrypted.
    pub fn recipient(&self) -> String {
        self.recipient.to_string()
    }

    /// Encrypts `plaintext` and writes it as a new file at `relative` (plus the encrypted
    /// extension). Fails rather than replace an existing file.
    pub fn write_new(&self, relative: &str, plaintext: &[u8]) -> Result<(), VaultError> {
        let path = self.record_path(relative)?;
        let ciphertext = age::encrypt(&self.recipient, plaintext).map_err(|e| VaultError::Io(io::Error::other(e)))?;
        self.own.record(&path, &ciphertext);
        let written = write_new(&path, &ciphertext);
        if written.is_err() {
            self.own.forget(&path);
        }
        written
    }

    /// Watches the vault folder and calls `on_change` when record files appear, change or go away
    /// by any hand but this vault's own — another device sharing the folder, a sync client. Also
    /// called when the platform lost track of changes. Watching stops when the returned watcher is
    /// dropped.
    pub fn watch(&self, mut on_change: impl FnMut() + Send + 'static) -> io::Result<Watcher> {
        Watch::new(&self.root).ignore(|path| !is_record_file(path)).own_writes(&self.own).start(move |_| on_change())
    }

    /// Decrypts one record file, or returns `None` if the vault has no file at `relative`.
    pub fn read(&self, relative: &str) -> Result<Option<Vec<u8>>, VaultError> {
        let path = self.record_path(relative)?;
        let ciphertext = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        age::decrypt(&self.identity, &ciphertext).map(Some).map_err(|e| VaultError::Io(io::Error::other(e)))
    }

    /// Decrypts every record file in the vault. A file that fails to decrypt is reported and the
    /// rest are still returned.
    pub fn read_all(&self) -> Result<VaultContents, VaultError> {
        let mut contents = VaultContents::default();
        let mut paths = Vec::new();
        collect_files(&self.root, &mut paths)?;
        for path in paths {
            let relative = relative_path(&self.root, &path);
            if relative == VAULT_FILE || relative.starts_with("keys/") {
                continue;
            }
            let Some(plain_name) = relative.strip_suffix(ENCRYPTED_EXTENSION) else {
                continue; // not a record file of an encrypted vault (sync temp files and the like)
            };
            match age::decrypt(&self.identity, &fs::read(&path)?) {
                Ok(bytes) => contents.files.push((plain_name.to_owned(), bytes)),
                Err(e) => contents.undecryptable.push(UndecryptableFile { path: relative.clone(), plain_path: plain_name.to_owned(), reason: e.to_string() }),
            }
        }
        contents.files.sort_by(|a, b| a.0.cmp(&b.0));
        contents.undecryptable.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(contents)
    }

    fn with_identity(root: &Path, identity: x25519::Identity) -> Vault {
        let recipient = identity.to_public();
        Vault { root: root.to_path_buf(), identity, recipient, own: OwnWrites::new() }
    }

    fn record_path(&self, relative: &str) -> Result<PathBuf, VaultError> {
        let invalid = || VaultError::InvalidPath(relative.to_owned());
        if relative.is_empty() || relative.starts_with('/') || relative.contains('\\') || relative.contains(':') {
            return Err(invalid());
        }
        let parts: Vec<&str> = relative.split('/').collect();
        if parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
            return Err(invalid());
        }
        if relative == VAULT_FILE || parts[0] == "keys" {
            return Err(invalid());
        }
        let mut path = self.root.clone();
        for part in &parts[..parts.len() - 1] {
            path.push(part);
        }
        path.push(format!("{}{ENCRYPTED_EXTENSION}", parts[parts.len() - 1]));
        Ok(path)
    }
}

/// Whether `relative` (a path inside the vault) names an encrypted record file: not the
/// declaration, not the key, and not a sync client's or editor's stray file.
fn is_record_file(relative: &Path) -> bool {
    relative.extension().is_some_and(|e| e == "age") && !relative.starts_with("keys")
}

/// The key file's content: the vault key wrapped with `passphrase`, ASCII-armored.
fn wrap_key(identity: &x25519::Identity, passphrase: SecretString) -> Result<String, VaultError> {
    let mut wrap = scrypt::Recipient::new(passphrase);
    wrap.set_work_factor(WORK_FACTOR);
    age::encrypt_and_armor(&wrap, identity.to_string().expose_secret().as_bytes()).map_err(|e| VaultError::Io(io::Error::other(e)))
}

fn check_declaration(root: &Path) -> Result<(), VaultError> {
    let text = fs::read_to_string(root.join(VAULT_FILE)).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => VaultError::NotAVault,
        _ => VaultError::Io(e),
    })?;
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    match declared_version(&compact) {
        Some(FORMAT_VERSION) => {}
        Some(v) if v > FORMAT_VERSION => return Err(VaultError::NewerFormat),
        _ => return Err(VaultError::NotAVault),
    }
    if !compact.contains("\"encryption\":\"age\"") {
        return Err(VaultError::NotEncrypted);
    }
    Ok(())
}

/// The vault format version this build reads and writes.
const FORMAT_VERSION: u32 = 0;

/// The `N` of `"format":"openquote.vault/N"` in a declaration with whitespace removed.
fn declared_version(compact: &str) -> Option<u32> {
    let rest = &compact[compact.find("\"format\":\"openquote.vault/")? + "\"format\":\"openquote.vault/".len()..];
    rest[..rest.find('"')?].parse().ok()
}

fn write_new(path: &Path, content: &[u8]) -> Result<(), VaultError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    tauri_kit_fs::write_atomic_new(path, content).map_err(|e| match e.kind() {
        io::ErrorKind::AlreadyExists => VaultError::AlreadyExists,
        _ => VaultError::Io(e),
    })
}

fn collect_files(dir: &Path, into: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect_files(&entry.path(), into)?;
        } else if kind.is_file() {
            into.push(entry.path());
        }
    }
    Ok(())
}

fn first_encrypted_file(root: &Path) -> io::Result<Option<PathBuf>> {
    let mut paths = Vec::new();
    collect_files(root, &mut paths)?;
    paths.sort();
    Ok(paths.into_iter().find(|p| {
        let relative = relative_path(root, p);
        !relative.starts_with("keys/") && relative.ends_with(ENCRYPTED_EXTENSION)
    }))
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

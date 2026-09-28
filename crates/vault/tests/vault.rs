use std::fs;
use std::path::Path;

use age::secrecy::SecretString;
use openquote_care_vault::{KEY_FILE, VAULT_FILE, Vault, VaultError};

fn pass(p: &str) -> SecretString {
    SecretString::from(p.to_owned())
}

const RECORD: &[u8] = br#"{"format":"openquote.change/0","fields":{"marker":"PLAINTEXT-MARKER-7f3a"}}"#;

fn all_bytes_under(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push((p.display().to_string(), fs::read(&p).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn a_new_vault_opens_with_its_passphrase_on_another_machine() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();

    // Nothing but the folder carries over: unlock from scratch.
    let reopened = Vault::unlock(dir.path(), pass("correct horse")).unwrap();
    let contents = reopened.read_all().unwrap();

    assert_eq!(contents.files, vec![("subjects/s1/0001.dev1.json".to_owned(), RECORD.to_vec())]);
    assert!(contents.undecryptable.is_empty());
    assert_eq!(reopened.recipient(), vault.recipient());
}

#[test]
fn no_plaintext_and_no_unwrapped_key_reach_the_disk() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();

    for (path, bytes) in all_bytes_under(dir.path()) {
        assert!(!contains(&bytes, b"PLAINTEXT-MARKER-7f3a"), "plaintext in {path}");
        assert!(!contains(&bytes, kit.secret_key().as_bytes()), "unwrapped key in {path}");
        assert!(!contains(&bytes, b"AGE-SECRET-KEY-"), "a secret key in {path}");
    }
    assert!(dir.path().join(VAULT_FILE).exists());
    assert!(dir.path().join(KEY_FILE).exists());
    assert!(dir.path().join("subjects/s1/0001.dev1.json.age").exists());
}

#[test]
fn a_wrong_passphrase_is_told_apart_from_damage() {
    let dir = tempfile::tempdir().unwrap();
    Vault::create(dir.path(), pass("correct horse")).unwrap();

    assert!(matches!(Vault::unlock(dir.path(), pass("wrong")), Err(VaultError::WrongPassphrase)));

    fs::write(dir.path().join(KEY_FILE), b"-----BEGIN AGE ENCRYPTED FILE-----\ngarbage\n").unwrap();
    assert!(matches!(Vault::unlock(dir.path(), pass("correct horse")), Err(VaultError::DamagedKeyFile)));

    fs::remove_file(dir.path().join(KEY_FILE)).unwrap();
    assert!(matches!(Vault::unlock(dir.path(), pass("correct horse")), Err(VaultError::DamagedKeyFile)));
}

#[test]
fn the_recovery_kit_opens_the_vault_without_passphrase_or_key_file() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, kit) = Vault::create(dir.path(), pass("forgotten")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    fs::remove_file(dir.path().join(KEY_FILE)).unwrap();

    let recovered = Vault::recover(dir.path(), kit.secret_key()).unwrap();

    assert_eq!(recovered.read_all().unwrap().files[0].1, RECORD);
}

#[test]
fn another_vaults_recovery_key_is_refused() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let (vault_a, _) = Vault::create(a.path(), pass("a")).unwrap();
    vault_a.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    let (_, kit_b) = Vault::create(b.path(), pass("b")).unwrap();

    assert!(matches!(Vault::recover(a.path(), kit_b.secret_key()), Err(VaultError::RecoveryKeyMismatch)));
    assert!(matches!(Vault::recover(a.path(), "not a key"), Err(VaultError::InvalidRecoveryKey)));
}

#[test]
fn nothing_is_ever_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _) = Vault::create(dir.path(), pass("p")).unwrap();
    vault.write_new("practitioners/0001.dev1.json", RECORD).unwrap();

    assert!(matches!(vault.write_new("practitioners/0001.dev1.json", b"other"), Err(VaultError::AlreadyExists)));
    assert!(matches!(Vault::create(dir.path(), pass("p")), Err(VaultError::AlreadyExists)));
    assert_eq!(vault.read_all().unwrap().files[0].1, RECORD);
}

#[test]
fn paths_stay_inside_the_vault_and_off_reserved_files() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _) = Vault::create(dir.path(), pass("p")).unwrap();

    for bad in ["", "/abs.json", "../out.json", "a/../b.json", "a//b.json", "a\\b.json", "C:/x.json", VAULT_FILE, "keys/other.json", "./a.json"] {
        assert!(matches!(vault.write_new(bad, RECORD), Err(VaultError::InvalidPath(_))), "{bad:?} was accepted");
    }
}

#[test]
fn a_damaged_record_file_is_reported_and_the_rest_are_read() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _) = Vault::create(dir.path(), pass("p")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    vault.write_new("subjects/s1/0002.dev1.json", RECORD).unwrap();
    let damaged = dir.path().join("subjects/s1/0002.dev1.json.age");
    let bytes = fs::read(&damaged).unwrap();
    fs::write(&damaged, &bytes[..bytes.len() / 2]).unwrap();
    fs::write(dir.path().join("subjects/s1/~sync-temp.tmp"), b"ignored").unwrap();

    let contents = vault.read_all().unwrap();

    assert_eq!(contents.files.len(), 1);
    assert_eq!(contents.undecryptable.len(), 1);
    assert_eq!(contents.undecryptable[0].path, "subjects/s1/0002.dev1.json.age");
}

#[test]
fn folders_that_are_not_encrypted_vaults_are_refused() {
    let empty = tempfile::tempdir().unwrap();
    assert!(matches!(Vault::unlock(empty.path(), pass("p")), Err(VaultError::NotAVault)));

    let plain = tempfile::tempdir().unwrap();
    fs::write(plain.path().join(VAULT_FILE), r#"{ "format": "openquote.vault/0", "encryption": "none" }"#).unwrap();
    assert!(matches!(Vault::unlock(plain.path(), pass("p")), Err(VaultError::NotEncrypted)));
}

/// Opens a record file with an independent age implementation, when one is available:
/// `OPENQUOTE_AGE_BIN` names an `age` or `rage` executable.
#[test]
fn an_independent_age_tool_opens_a_record_with_the_recovery_kit() {
    let Ok(tool) = std::env::var("OPENQUOTE_AGE_BIN") else {
        eprintln!("skipped: set OPENQUOTE_AGE_BIN to an age or rage executable");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let (vault, kit) = Vault::create(dir.path(), pass("p")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    let identity = dir.path().join("recovery.txt");
    fs::write(&identity, kit.secret_key()).unwrap();

    let out = std::process::Command::new(tool)
        .arg("-d")
        .arg("-i")
        .arg(&identity)
        .arg(dir.path().join("subjects/s1/0001.dev1.json.age"))
        .output()
        .unwrap();

    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(out.stdout, RECORD);
}

#[test]
fn reads_one_file_back_or_says_it_is_not_there() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _) = Vault::create(dir.path(), pass("p")).unwrap();
    vault.write_new("schemes/topic/v1.json", RECORD).unwrap();
    assert_eq!(vault.read("schemes/topic/v1.json").unwrap().as_deref(), Some(RECORD));
    assert_eq!(vault.read("schemes/topic/v2.json").unwrap(), None);
    assert!(matches!(vault.read("../outside.json"), Err(VaultError::InvalidPath(_))));
}

#[test]
fn a_prepared_vault_writes_nothing_until_asked() {
    let dir = tempfile::tempdir().unwrap();
    let new = Vault::prepare(dir.path(), pass("p")).unwrap();
    let kit = new.recovery_kit();
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0, "nothing on disk before write");

    let vault = new.write().unwrap();
    vault.write_new("a.json", b"{}").unwrap();
    assert!(Vault::unlock(dir.path(), pass("p")).is_ok());
    assert!(Vault::recover(dir.path(), kit.secret_key()).is_ok());
}

#[test]
fn a_prepared_vault_does_not_overwrite_one_made_meanwhile() {
    let dir = tempfile::tempdir().unwrap();
    let new = Vault::prepare(dir.path(), pass("first")).unwrap();
    Vault::create(dir.path(), pass("second")).unwrap();
    assert!(matches!(new.write(), Err(VaultError::AlreadyExists)));
    assert!(Vault::unlock(dir.path(), pass("second")).is_ok());
}

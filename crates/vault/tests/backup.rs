use std::fs;
use std::path::Path;

use age::secrecy::SecretString;
use openquote_care_vault::{BackupError, KEY_FILE, Vault, VaultError};

fn pass(p: &str) -> SecretString {
    SecretString::from(p.to_owned())
}

const RECORD: &[u8] = br#"{"format":"openquote.change/0","fields":{"marker":"PLAINTEXT-MARKER-7f3a"}}"#;

fn files_under(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(root, &p, out);
            } else {
                let relative = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.push((relative, fs::read(&p).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

#[test]
fn a_backup_is_the_vault_again_and_opens_with_the_same_passphrase() {
    let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    vault.write_new("practitioners/0002.dev1.json", RECORD).unwrap();

    vault.check_backup(backup.path()).unwrap();
    let report = vault.back_up(backup.path()).unwrap();

    assert_eq!(report.copied, 4, "the declaration, the key file and two records");
    assert_eq!(files_under(backup.path()), files_under(dir.path()));
    let copy = Vault::unlock(backup.path(), pass("correct horse")).unwrap();
    assert_eq!(copy.read_all().unwrap().files, vault.read_all().unwrap().files);
    for (path, bytes) in files_under(backup.path()) {
        assert!(!bytes.windows(22).any(|w| w == b"PLAINTEXT-MARKER-7f3a\"".as_slice()), "{path} holds plaintext");
    }
}

#[test]
fn only_what_the_backup_lacks_is_copied() {
    let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    vault.back_up(backup.path()).unwrap();

    assert_eq!(vault.back_up(backup.path()).unwrap().copied, 0);

    vault.write_new("subjects/s1/0003.dev1.json", RECORD).unwrap();
    let report = vault.back_up_written(backup.path(), &["subjects/s1/0003.dev1.json"]).unwrap();
    assert_eq!(report.copied, 1);
    assert!(!report.key_replaced);
    assert_eq!(files_under(backup.path()), files_under(dir.path()));
}

#[test]
fn a_new_passphrase_reaches_the_backup_and_the_old_one_stops_opening_it() {
    let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("old passphrase")).unwrap();
    vault.back_up(backup.path()).unwrap();

    vault.change_passphrase(pass("new passphrase")).unwrap();
    let report = vault.back_up_written(backup.path(), &[]).unwrap();

    assert!(report.key_replaced);
    assert_eq!(fs::read(backup.path().join(KEY_FILE)).unwrap(), fs::read(dir.path().join(KEY_FILE)).unwrap());
    assert!(matches!(Vault::unlock(backup.path(), pass("old passphrase")), Err(VaultError::WrongPassphrase)));
    Vault::unlock(backup.path(), pass("new passphrase")).unwrap();
}

#[test]
fn a_record_file_that_differs_in_the_backup_is_named_and_left_alone() {
    let (dir, backup) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    vault.back_up(backup.path()).unwrap();
    let copy = backup.path().join("subjects").join("s1").join("0001.dev1.json.age");
    fs::write(&copy, b"cut off").unwrap();

    let report = vault.back_up(backup.path()).unwrap();

    assert_eq!(report.differs, vec!["subjects/s1/0001.dev1.json.age".to_owned()]);
    assert_eq!(fs::read(&copy).unwrap(), b"cut off");
}

#[test]
fn a_backup_folder_must_be_apart_from_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _kit) = Vault::create(&dir.path().join("vault"), pass("correct horse")).unwrap();
    fs::create_dir_all(dir.path().join("vault").join("inside")).unwrap();

    for target in [dir.path().join("vault"), dir.path().join("vault").join("inside"), dir.path().to_path_buf()] {
        assert!(matches!(vault.check_backup(&target), Err(BackupError::Overlaps)), "{}", target.display());
        assert!(matches!(vault.back_up(&target), Err(BackupError::Overlaps)), "{}", target.display());
    }
}

#[test]
fn a_backup_folder_holds_nothing_or_this_vaults_backup() {
    let (dir, other_dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    let (other, _kit) = Vault::create(other_dir.path(), pass("correct horse")).unwrap();
    other.write_new("subjects/s9/0009.dev1.json", RECORD).unwrap();

    let papers = tempfile::tempdir().unwrap();
    fs::write(papers.path().join("notes.txt"), b"someone's files").unwrap();
    assert!(matches!(vault.check_backup(papers.path()), Err(BackupError::HoldsOther)));

    let others_backup = tempfile::tempdir().unwrap();
    other.back_up(others_backup.path()).unwrap();
    assert!(matches!(vault.check_backup(others_backup.path()), Err(BackupError::HoldsOther)));

    let own = tempfile::tempdir().unwrap();
    vault.check_backup(own.path()).unwrap();
    vault.back_up(own.path()).unwrap();
    vault.check_backup(own.path()).unwrap();
}

#[test]
fn a_missing_backup_folder_fails_the_backup_and_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    let gone = dir.path().with_file_name("no-such-backup-folder");

    assert!(matches!(vault.back_up(&gone), Err(BackupError::Io(_))));
    vault.write_new("subjects/s1/0001.dev1.json", RECORD).unwrap();
    assert_eq!(vault.read_all().unwrap().files.len(), 1);
}

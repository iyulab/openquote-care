use std::fs;

use age::secrecy::SecretString;
use openquote_care_vault::{PlainCopyError, Vault};

fn pass(p: &str) -> SecretString {
    SecretString::from(p.to_owned())
}

fn files() -> Vec<(String, Vec<u8>)> {
    vec![("기록.html".to_owned(), "<p>기록</p>".as_bytes().to_vec()), ("회기.csv".to_owned(), b"a,b\r\n".to_vec())]
}

#[test]
fn a_plain_copy_is_a_new_folder_apart_from_the_vault_holding_the_files_given() {
    let (dir, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    let folder = vault.write_plain_copy(out.path(), "기록 사본 2026-10-01", &files()).unwrap();
    assert_eq!(folder, out.path().join("기록 사본 2026-10-01"));
    assert_eq!(fs::read_to_string(folder.join("기록.html")).unwrap(), "<p>기록</p>");
    assert_eq!(fs::read(folder.join("회기.csv")).unwrap(), b"a,b\r\n");
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 2);
}

#[test]
fn a_plain_copy_never_lands_in_the_vault_or_in_a_folder_holding_it() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    fs::create_dir(&root).unwrap();
    let (vault, _kit) = Vault::create(&root, pass("correct horse")).unwrap();
    fs::create_dir(root.join("inside")).unwrap();
    for target in [root.clone(), root.join("inside"), dir.path().to_path_buf()] {
        assert!(matches!(vault.write_plain_copy(&target, "copy", &files()), Err(PlainCopyError::Overlaps)), "{}", target.display());
    }
    assert!(!root.join("copy").exists() && !root.join("inside").join("copy").exists() && !dir.path().join("copy").exists());
}

#[test]
fn a_plain_copy_replaces_nothing() {
    let (dir, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    fs::create_dir(out.path().join("copy")).unwrap();
    fs::write(out.path().join("copy").join("회기.csv"), b"earlier").unwrap();
    assert!(matches!(vault.write_plain_copy(out.path(), "copy", &files()), Err(PlainCopyError::Exists)));
    assert_eq!(fs::read(out.path().join("copy").join("회기.csv")).unwrap(), b"earlier");
}

#[test]
fn a_name_that_is_not_a_plain_file_name_writes_nothing() {
    let (dir, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (vault, _kit) = Vault::create(dir.path(), pass("correct horse")).unwrap();
    for bad in ["", ".", "..", "../up", "a/b", r"a\b", "c:", "name.", "name ", "a*b", "a\nb"] {
        assert!(matches!(vault.write_plain_copy(out.path(), bad, &files()), Err(PlainCopyError::BadName(_))), "{bad:?}");
        let with_bad_file = vec![(bad.to_owned(), b"x".to_vec())];
        assert!(matches!(vault.write_plain_copy(out.path(), "copy", &with_bad_file), Err(PlainCopyError::BadName(_))), "{bad:?}");
    }
    assert_eq!(fs::read_dir(out.path()).unwrap().count(), 0, "nothing written");
}

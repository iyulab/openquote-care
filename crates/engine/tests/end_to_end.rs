//! The first slice end to end, through the real sidecar process: create a vault, keep its
//! classification and report form, record sessions, run a monthly report and keep the run record,
//! then close everything, reopen from the passphrase alone and get the same numbers back.
//!
//! Needs a built sidecar: set OPENQUOTE_SIDECAR_EXE to its executable. Skipped otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use age::secrecy::SecretString;
use openquote_care_engine::{Engine, OpenVault, PlainFile};
use openquote_care_vault::Vault;
use serde_json::{Value, json};

fn sidecar() -> Option<PathBuf> {
    match std::env::var("OPENQUOTE_SIDECAR_EXE") {
        Ok(p) => Some(PathBuf::from(p)),
        Err(_) => {
            eprintln!("skipped: set OPENQUOTE_SIDECAR_EXE to a built openquote-care-sidecar executable");
            None
        }
    }
}

/// The scheme and report-form files a data pack would copy into a new vault.
fn pack_files() -> Vec<PlainFile> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/golden/scenario/static/1");
    ["schemes/topic/v1.json", "reports/monthly-topic/v1.json"]
        .iter()
        .map(|p| PlainFile { path: (*p).to_owned(), content: fs::read(root.join(p)).unwrap() })
        .collect()
}

fn topic(code: &str) -> Value {
    json!({ "scheme": "topic", "version": 1, "code": code })
}

fn without_stamp(mut record: Value) -> Value {
    let o = record.as_object_mut().unwrap();
    o.remove("id");
    o.remove("at");
    record
}

fn cell_counts(record: &Value) -> Vec<(String, u64)> {
    record["cells"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["row"].as_str().unwrap().to_owned(), c["count"].as_u64().unwrap()))
        .collect()
}

#[test]
fn record_report_close_reopen_same_numbers() {
    let Some(exe) = sidecar() else { return };
    let dir = tempfile::tempdir().unwrap();
    let passphrase = || SecretString::from("a passphrase for the test".to_owned());

    // Create the vault and put the data pack in it.
    let (vault, kit) = Vault::create(dir.path(), passphrase()).unwrap();
    let mut open = OpenVault::open(vault, Engine::start(&exe, "pc01").unwrap()).unwrap();
    for file in pack_files() {
        open.keep(file).unwrap();
    }

    // A practitioner, a subject with a case, and three sessions around the end of April.
    let practitioner = open.engine.change("/changes/practitioner", json!({ "fields": { "name": "synthetic practitioner" } })).unwrap();
    let practitioner_id = practitioner.path.split('/').nth(1).unwrap().split('.').next().unwrap().to_owned();
    open.keep(practitioner).unwrap();
    let subject = open.engine.change("/changes/subject", json!({ "fields": { "name": "SYNTHETIC-SUBJECT-NAME" } })).unwrap();
    let subject_id = subject.path.split('/').nth(1).unwrap().to_owned();
    open.keep(subject).unwrap();
    for (date, code) in [("2026-04-10", "depression"), ("2026-04-30", "depression"), ("2026-05-01", "anxiety")] {
        let session = open
            .engine
            .change(
                "/changes/in-subject",
                json!({ "subjectId": subject_id, "type": "session",
                        "fields": { "date": date, "practitioner": practitioner_id, "topic": topic(code) } }),
            )
            .unwrap();
        open.keep(session).unwrap();
    }

    // Run April and keep the run record.
    let (april, run_file) = open.engine.run_report("monthly-topic", 1, 2026, 4).unwrap();
    assert_eq!(cell_counts(&april), vec![("depression".to_owned(), 2)]);
    assert_eq!(april["total"]["count"], 2);
    let run_path = run_file.path.clone();
    open.keep(run_file).unwrap();
    assert_eq!(open.summary["unreadable"].as_array().unwrap().len(), 0);
    drop(open); // stops the sidecar; nothing but the folder remains

    // Nothing readable was left on disk.
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() { walk(&p, out) } else { out.push(p) }
        }
    }
    let mut files = Vec::new();
    walk(dir.path(), &mut files);
    for f in &files {
        let bytes = fs::read(f).unwrap();
        assert!(!bytes.windows(22).any(|w| w == b"SYNTHETIC-SUBJECT-NAME"), "plaintext in {}", f.display());
    }
    assert!(dir.path().join(format!("{run_path}.age")).exists());

    // Reopen from the passphrase alone, with a new engine process: the numbers are the same, and
    // the run record kept earlier is there to compare against.
    let reopened = OpenVault::open(Vault::unlock(dir.path(), passphrase()).unwrap(), Engine::start(&exe, "pc01").unwrap()).unwrap();
    assert!(reopened.undecryptable.is_empty());

    // A record file that cannot be decrypted (cut off while syncing, say) is shown, not dropped.
    let cut = dir.path().join("practitioners").join("01900000-0000-7000-8000-00000000abcd.pc02.json.age");
    fs::write(&cut, b"age-encryption.org/v1\n").unwrap();
    let mut reopened = reopened;
    let summary = reopened.reload().unwrap();
    let listed: Vec<_> = summary["unreadable"].as_array().unwrap().iter().filter(|u| u["reason"] == "Undecryptable").collect();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["path"], "practitioners/01900000-0000-7000-8000-00000000abcd.pc02.json.age");
    assert_eq!(listed[0]["kind"]["kind"], "practitioners", "named by what it was for");
    assert_eq!(reopened.current_summary().unwrap()["unreadable"], summary["unreadable"]);
    fs::remove_file(&cut).unwrap();
    reopened.reload().unwrap();
    let (again, _) = reopened.engine.run_report("monthly-topic", 1, 2026, 4).unwrap();
    assert_eq!(without_stamp(again), without_stamp(april.clone()));
    let kept = reopened.vault.read_all().unwrap().files.into_iter().find(|(p, _)| *p == run_path).unwrap();
    let kept: Value = serde_json::from_slice(&kept.1).unwrap();
    assert_eq!(without_stamp(kept), without_stamp(april));

    // The recovery kit opens the same vault without the passphrase.
    drop(reopened);
    let recovered = Vault::recover(dir.path(), kit.secret_key()).unwrap();
    assert!(recovered.read_all().unwrap().files.iter().any(|(p, _)| p.starts_with("subjects/")));
}

#[test]
fn a_file_the_vault_refuses_never_reaches_the_engine() {
    let Some(exe) = sidecar() else { return };
    let dir = tempfile::tempdir().unwrap();
    let (vault, _) = Vault::create(dir.path(), SecretString::from("p".to_owned())).unwrap();
    let mut open = OpenVault::open(vault, Engine::start(&exe, "pc01").unwrap()).unwrap();

    // A valid change file whose name is already taken on disk (written there behind the engine's
    // back): the vault refuses to replace it, so the engine must not see it either.
    let subject = open.engine.change("/changes/subject", json!({ "fields": { "name": "x" } })).unwrap();
    open.vault.write_new(&subject.path, b"{}").unwrap();

    assert!(open.keep(subject).is_err());
    assert_eq!(open.engine.entities("subject").unwrap().as_array().unwrap().len(), 0);
}

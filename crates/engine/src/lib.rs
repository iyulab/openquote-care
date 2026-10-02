//! Runs the Openquote engine sidecar and moves files between it and the encrypted vault.
//!
//! The sidecar holds no key and touches no disk. [`OpenVault`] decrypts the vault and hands the
//! plaintext files over; every change the engine makes comes back as a file, which is encrypted
//! and created in the vault first and only then handed back to the engine. A file the vault
//! refused to create never reaches the engine.

use std::fmt;
use std::path::Path;
use std::process::Command;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use openquote_care_vault::{UndecryptableFile, Vault, VaultError};
use serde_json::{Value, json};
use tauri_kit_sidecar::loopback::{Loopback, LoopbackOptions};

pub use tauri_kit_sidecar::loopback::Fault;

const READY_PREFIX: &str = "openquote-sidecar ready port=";
const TOKEN_ENV: &str = "OPENQUOTE_SIDECAR_TOKEN";

/// Why talking to the engine failed.
#[derive(Debug)]
pub enum EngineError {
    /// The sidecar could not be started, or stopped before announcing its port.
    Start(String),
    /// The sidecar answered with an error status: the status, the answer, and what went wrong
    /// inside it when it failed unexpectedly (its exception type and its own methods, never the
    /// message).
    Status(u16, String, Option<Fault>),
    /// The request did not complete.
    Transport(String),
    /// The vault refused the operation.
    Vault(VaultError),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Start(m) => write!(f, "the engine did not start: {m}"),
            Self::Status(s, m, _) => write!(f, "the engine answered {s}: {m}"),
            Self::Transport(m) => write!(f, "the engine could not be reached: {m}"),
            Self::Vault(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<VaultError> for EngineError {
    fn from(e: VaultError) -> Self {
        Self::Vault(e)
    }
}

/// A vault file in plaintext: its path relative to the vault root and its content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlainFile {
    pub path: String,
    pub content: Vec<u8>,
}

impl PlainFile {
    fn to_wire(&self) -> Value {
        json!({ "path": self.path, "content": BASE64.encode(&self.content) })
    }

    fn from_wire(v: &Value) -> Result<Self, EngineError> {
        let bad = || EngineError::Transport(format!("not a file: {v}"));
        let path = v.get("path").and_then(Value::as_str).ok_or_else(bad)?;
        let content = v.get("content").and_then(Value::as_str).ok_or_else(bad)?;
        Ok(Self { path: path.to_owned(), content: BASE64.decode(content).map_err(|_| bad())? })
    }
}

/// A running engine sidecar. Dropping it stops the process.
pub struct Engine {
    loopback: Loopback,
}

impl Engine {
    /// Starts the sidecar executable for `device`, with a fresh token, and waits for it to
    /// announce its port.
    pub fn start(executable: &Path, device: &str) -> Result<Engine, EngineError> {
        let mut command = Command::new(executable);
        command.env("OPENQUOTE_DEVICE", device);
        let loopback = Loopback::start(command, &LoopbackOptions::new(TOKEN_ENV, READY_PREFIX)).map_err(|e| EngineError::Start(e.to_string()))?;
        Ok(Engine { loopback })
    }

    fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, EngineError> {
        let client = self.loopback.client();
        let response = match method {
            "GET" => client.get(path),
            _ => client.post_json(path, &body.unwrap_or(Value::Null).to_string()),
        }
        .map_err(|e| EngineError::Transport(e.to_string()))?;
        if !response.is_success() {
            let fault = response.fault();
            return Err(EngineError::Status(response.status, response.body, fault));
        }
        if response.body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&response.body).map_err(|e| EngineError::Transport(e.to_string()))
    }

    fn files(files: &[PlainFile]) -> Value {
        json!({ "files": files.iter().map(PlainFile::to_wire).collect::<Vec<_>>() })
    }

    /// Replaces the engine's view of the vault with `files`, listing `undecryptable` — files present
    /// but not decrypted — with the ones it cannot use. Returns the engine's summary.
    pub fn load(&self, files: &[PlainFile], undecryptable: &[UndecryptableFile]) -> Result<Value, EngineError> {
        let mut body = Self::files(files);
        body["undecryptable"] = undecryptable
            .iter()
            .map(|f| json!({ "path": f.path, "plain": f.plain_path, "detail": f.reason }))
            .collect();
        self.call("POST", "/vault/load", Some(body))
    }

    /// The earliest vault format the vault needs as it is (`now`) and holding `files` as well (`with`).
    pub fn required(&self, files: &[PlainFile]) -> Result<Value, EngineError> {
        self.call("POST", "/vault/required", Some(Self::files(files)))
    }

    /// Hands the engine files that were just created in the vault.
    pub fn add(&self, files: &[PlainFile]) -> Result<Value, EngineError> {
        self.call("POST", "/vault/add", Some(Self::files(files)))
    }

    /// The merged entities of `entity_type`.
    pub fn entities(&self, entity_type: &str) -> Result<Value, EngineError> {
        self.call("GET", &format!("/entities/{entity_type}"), None)
    }

    /// Every change each entity of a type was built from, oldest first.
    pub fn history(&self, entity_type: &str) -> Result<Value, EngineError> {
        self.call("GET", &format!("/entities/{entity_type}/history"), None)
    }

    /// What the engine holds: counts, report forms, and files it could not read.
    pub fn summary(&self) -> Result<Value, EngineError> {
        self.call("GET", "/summary", None)
    }

    /// Every classification scheme version in the vault, with its items named in the vault's locale.
    pub fn schemes(&self) -> Result<Value, EngineError> {
        self.call("GET", "/schemes", None)
    }

    /// The fields the vault's packs declare for `entity_type`, labelled in the vault's locale.
    pub fn fields(&self, entity_type: &str) -> Result<Value, EngineError> {
        self.call("GET", &format!("/fields/{entity_type}"), None)
    }

    /// The version of `scheme` in force on `date` (`YYYY-MM-DD`), or `None` when the vault holds none.
    pub fn in_force(&self, scheme: &str, date: &str) -> Result<Option<u32>, EngineError> {
        let answer = self.call("POST", "/schemes/in-force", Some(json!({ "scheme": scheme, "date": date })))?;
        Ok(answer.get("version").and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()))
    }

    /// The records among `records` that wait for a person in a run of the report form: for each,
    /// the field and value the form carries and the codes to choose from. Records no longer
    /// pending are left out. `to` is the last day of the run's period (`YYYY-MM-DD`): a form
    /// counting in the version in force waits in the version in force that day.
    pub fn pending(&self, report: &str, version: u32, records: Value, to: Option<&str>) -> Result<Value, EngineError> {
        self.call("POST", "/reports/pending", Some(json!({ "report": report, "version": version, "records": records, "to": to })))
    }

    /// Codes suggested for the coded fields a record of `entity_type` being entered for `date`
    /// (`YYYY-MM-DD`) has no value for yet, learned from the vault's settled records, given the
    /// values it holds so far: per field, the scheme version and the codes in order, each with the
    /// settled records that hold it. Nothing is kept.
    pub fn suggestions(&self, entity_type: &str, date: &str, fields: Value) -> Result<Value, EngineError> {
        self.call("POST", "/suggestions", Some(json!({ "type": entity_type, "date": date, "fields": fields })))
    }

    /// The run records the vault keeps, oldest first.
    pub fn runs(&self) -> Result<Value, EngineError> {
        self.call("GET", "/runs", None)
    }

    /// Why two kept runs differ, record by record, with both runs.
    pub fn compare_runs(&self, earlier: &str, later: &str) -> Result<Value, EngineError> {
        self.call("POST", "/runs/compare", Some(json!({ "earlier": earlier, "later": later })))
    }

    /// Asks the engine for a change file; `path` is one of the `/changes/…` routes.
    pub fn change(&self, path: &str, request: Value) -> Result<PlainFile, EngineError> {
        PlainFile::from_wire(&self.call("POST", path, Some(request))?)
    }

    /// Lays the records from `from` to `to` (`YYYY-MM-DD`) out as an export form's rows. Nothing is kept in the vault.
    pub fn run_export(&self, export: &str, version: u32, from: &str, to: &str) -> Result<Value, EngineError> {
        self.call("POST", "/exports/run", Some(json!({ "export": export, "version": version, "from": from, "to": to })))
    }

    /// Runs a report form from `from` (`YYYY-MM-DD`) to `to`, or — without `to` — over the period of
    /// the form's unit that holds `from` (its day, month or year). Returns the run record and the
    /// file that records it.
    pub fn run_report(&self, report: &str, version: u32, from: &str, to: Option<&str>) -> Result<(Value, PlainFile), EngineError> {
        let result = self.call("POST", "/reports/run", Some(json!({ "report": report, "version": version, "from": from, "to": to })))?;
        let file = PlainFile::from_wire(&result["file"])?;
        Ok((result["record"].clone(), file))
    }
}

/// An unlocked vault with the engine looking at it.
pub struct OpenVault {
    pub vault: Vault,
    pub engine: Engine,
    /// Files that were present but could not be decrypted when the vault was opened.
    pub undecryptable: Vec<UndecryptableFile>,
    /// The engine's summary of what it read, with every file it could not use — and every file the
    /// vault could not decrypt — under `unreadable`.
    pub summary: Value,
}

impl OpenVault {
    /// Decrypts every record file of `vault` and hands them to `engine`.
    pub fn open(vault: Vault, engine: Engine) -> Result<OpenVault, EngineError> {
        let contents = vault.read_all()?;
        let files: Vec<PlainFile> = contents.files.into_iter().map(|(path, content)| PlainFile { path, content }).collect();
        let summary = engine.load(&files, &contents.undecryptable)?;
        Ok(OpenVault { vault, engine, undecryptable: contents.undecryptable, summary })
    }

    /// Reads the vault again and hands the engine everything in it: what other devices sharing
    /// the folder wrote since it was opened comes in, and the engine's merge decides the rest.
    pub fn reload(&mut self) -> Result<Value, EngineError> {
        let contents = self.vault.read_all()?;
        let files: Vec<PlainFile> = contents.files.into_iter().map(|(path, content)| PlainFile { path, content }).collect();
        self.undecryptable = contents.undecryptable;
        self.summary = self.engine.load(&files, &self.undecryptable)?;
        Ok(self.summary.clone())
    }

    /// The engine's current summary, with the files the vault could not decrypt.
    pub fn current_summary(&self) -> Result<Value, EngineError> {
        self.engine.summary()
    }

    /// The vault format writing `files` would call for, when it is above the one the folder
    /// declares; None when they fit the declared format.
    pub fn format_needed(&self, files: &[PlainFile]) -> Result<Option<u32>, EngineError> {
        let with = self.engine.required(files)?["with"].as_u64().unwrap_or(0) as u32;
        Ok((with > self.vault.format()).then_some(with))
    }

    /// Creates `file` in the vault (encrypted, never replacing anything) and, once it is on disk,
    /// hands it to the engine.
    pub fn keep(&mut self, file: PlainFile) -> Result<Value, EngineError> {
        self.keep_all(vec![file])
    }

    /// Creates every file in the vault, then hands them to the engine together — for files that
    /// only make sense as a set, such as a new scheme version with its crosswalk and report form.
    pub fn keep_all(&mut self, files: Vec<PlainFile>) -> Result<Value, EngineError> {
        for file in &files {
            self.vault.write_new(&file.path, &file.content)?;
        }
        let summary = self.engine.add(&files)?;
        self.summary = summary.clone();
        Ok(summary)
    }
}

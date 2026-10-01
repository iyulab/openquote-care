//! Error diagnostics, content-free by construction — reports built with `tauri-kit-diagnostics`.
//!
//! When the shell fails in a way that is its own fault — a panic, the engine not starting or
//! answering with an error, a file operation failing — it writes a report of that failure to a
//! file in the app's local data folder, outside every vault: one JSON line per failure, readable,
//! exactly what would be sent. A report holds what the crate allows and nothing else: the part of
//! the app that failed (a layer), a plain type or code name, frames of the app's own code (a place
//! in the shell's source, or the engine's own methods), the shell's failure code and the engine's
//! HTTP status as details, and the app version, operating system and architecture. There is no
//! field a record value, a file path, a vault name or an error message could travel in.
//!
//! Sending is off unless a connection string is configured — through the
//! `OPENQUOTE_DIAGNOSTICS_CONNECTION` environment variable, or embedded at build time under the
//! same name. When it is on, what the file gained since the last send goes out in the background
//! at launch and after each new report; what cannot go out now (no network, the service busy)
//! stays in the file for a later launch. Development and test builds, and builds without it,
//! only keep the file.

use std::panic::Location;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use openquote_care_engine::Fault;
use tauri_kit_diagnostics::{FrameRule, Layer, MAX_FILE_BYTES, Report, Reporter, RustSource, Sink, WebBundle, trim};

/// The only switch: absent or blank means nothing is sent.
pub const CONNECTION_VAR: &str = "OPENQUOTE_DIAGNOSTICS_CONNECTION";

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The configured destination: the environment variable first, then the build-time value. Anything
/// partial or malformed gives `None`, which turns sending off rather than sending elsewhere.
pub fn configured_sink() -> Option<Sink> {
    std::env::var(CONNECTION_VAR)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| option_env!("OPENQUOTE_DIAGNOSTICS_CONNECTION").map(str::to_owned))
        .and_then(|raw| Sink::parse(&raw))
}

/// The shell's own Rust code. A panic or call site is a path relative to the workspace root, in
/// `src-tauri` or in one of the workspace's `crates`; anything else (a dependency, whose path
/// is absolute on the build machine) keeps no frame.
fn shell() -> Layer {
    Layer::new("shell", RustSource::default().roots(["src-tauri", "crates"]))
}

/// The window: scripts of the app's own bundle. A page served by a development server counts only
/// in a development build.
fn webview() -> Layer {
    Layer::new("webview", WebBundle::default().dev_server(cfg!(debug_assertions)))
}

/// The engine sidecar: its own .NET methods, by name only.
fn host() -> Layer {
    Layer::new("host", FrameRule::dotnet_method())
}

/// A place in the shell's source, as a stack line its layer reads.
fn place(location: &Location<'_>) -> String {
    format!("{}:{}:{}", location.file(), location.line(), location.column())
}

/// The failure codes that are the app's own fault and worth a report. The rest (a wrong
/// passphrase, a folder that is not a vault, …) are a person's situation, not a defect.
pub fn is_fault(code: &str) -> bool {
    matches!(code, "engine-start" | "engine" | "io")
}

/// The report of a command that failed through the app's own fault. When the engine said what
/// went wrong inside it, the report is the engine's (its exception type, its methods); otherwise
/// it is the shell's, at the command's call site. Either way the shell's code and the engine's
/// HTTP status, when it answered with one, go along as details.
pub fn command_report(code: &str, at: &Location<'_>, status: Option<u16>, fault: Option<&Fault>) -> Report {
    let report = match fault {
        Some(fault) => Report::new(&host(), &fault.kind, &fault.frames.join("\n"), VERSION),
        None => Report::new(&shell(), "CommandFailed", &place(at), VERSION),
    };
    let report = report.detail("code", code);
    match status {
        Some(status) => report.detail("status", &status.to_string()),
        None => report,
    }
}

/// The report of a panic: where it happened, never what it said.
pub fn panic_report(at: &Location<'_>) -> Report {
    Report::new(&shell(), "Panic", &place(at), VERSION)
}

/// The report of a launch that found no web view runtime — so the publisher can see how often
/// installs end up without it.
pub fn webview_missing_report() -> Report {
    Report::new(&shell(), "WebviewMissing", "", VERSION)
}

/// The report of an error the window did not handle: its type name and its stack, of which only
/// the frames in the app's own bundle are kept — never the message.
pub fn window_report(kind: &str, stack: &str) -> Report {
    Report::new(&webview(), kind, stack, VERSION)
}

/// Where this installation keeps its reports: a folder in the app's local data, beside (never
/// inside) anything a vault holds.
pub fn folder(app_local_data: &Path) -> PathBuf {
    app_local_data.join("diagnostics")
}

/// The app's local data folder as Tauri resolves it, before Tauri has started — the reports of a
/// launch that ends before any window (a missing web view runtime) belong in the same place.
pub fn app_local_data(identifier: &str) -> Option<PathBuf> {
    dirs::data_local_dir().map(|dir| dir.join(identifier))
}

/// One launch's reports: written to the file, and sent from it when a destination is configured
/// and the person has not turned reporting off.
pub struct Diagnostics {
    reporter: Reporter,
    sender: Option<Sender>,
    /// Present while the person has turned reporting off; kept beside the reports.
    off_marker: PathBuf,
    off: AtomicBool,
}

/// What the window shows about reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Status {
    /// This installation has a destination for reports.
    pub configured: bool,
    /// Reports are written and sent: configured, and not turned off.
    pub sending: bool,
}

impl Diagnostics {
    /// Reports kept in `folder`, sent to `sink` when there is one. Trims the file first: it is
    /// evidence of recent failures, not an archive.
    pub fn new(folder: &Path, sink: Option<Sink>) -> Diagnostics {
        let (file, sent) = (folder.join("reports.jsonl"), folder.join("reports.sent"));
        let _ = trim(&file, &sent, MAX_FILE_BYTES);
        let sender = sink.map(|sink| Sender::new(sink, file.clone(), sent));
        let off_marker = folder.join("reporting-off");
        let off = AtomicBool::new(off_marker.exists());
        Diagnostics { reporter: Reporter::new(file), sender, off_marker, off }
    }

    /// Whether reports leave this device.
    pub fn sends(&self) -> bool {
        self.sender.is_some() && !self.off.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> Status {
        Status { configured: self.sender.is_some(), sending: self.sends() }
    }

    /// Turns reporting on or off, for this launch and the next ones. Off, the app neither writes
    /// nor sends reports; on again, it sends what the file still holds.
    pub fn set_sending(&self, on: bool) -> std::io::Result<()> {
        if on {
            match std::fs::remove_file(&self.off_marker) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        } else {
            if let Some(dir) = self.off_marker.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(&self.off_marker, b"")?;
        }
        self.off.store(!on, Ordering::Relaxed);
        if on {
            self.send_pending();
        }
        Ok(())
    }

    /// The reports as the file holds them, one JSON object per line — exactly what is sent. None
    /// written yet is an empty text.
    pub fn reports(&self) -> std::io::Result<String> {
        match std::fs::read_to_string(self.reporter.file()) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            read => read,
        }
    }

    /// Sends what the file holds that has not gone out yet, in the background.
    pub fn send_pending(&self) -> Option<mpsc::Receiver<()>> {
        if self.off.load(Ordering::Relaxed) {
            return None;
        }
        self.sender.as_ref().map(Sender::start)
    }

    /// Writes the report (once per failure per launch, up to the crate's limit) and, when it was
    /// new and sending is on, starts sending it. Writes nothing while reporting is off. Never
    /// panics: the panic hook calls it.
    pub fn record(&self, report: Report) -> Option<mpsc::Receiver<()>> {
        if self.off.load(Ordering::Relaxed) {
            return None;
        }
        match self.reporter.record(report) {
            Ok(true) => self.send_pending(),
            _ => None,
        }
    }
}

/// Sends the file's new reports, one send at a time: a send asked for while one runs makes that
/// one go round again rather than racing it over the record of how far has been sent.
struct Sender {
    sink: Sink,
    file: PathBuf,
    sent: PathBuf,
    state: Arc<Mutex<SendState>>,
}

#[derive(Default)]
struct SendState {
    running: bool,
    again: bool,
    waiting: Vec<mpsc::Sender<()>>,
}

impl Sender {
    fn new(sink: Sink, file: PathBuf, sent: PathBuf) -> Sender {
        Sender { sink, file, sent, state: Arc::default() }
    }

    /// Starts a send, or asks the running one to go round again. The receiver hears when the file
    /// has been sent as far as it then reached (or the send gave up until later).
    fn start(&self) -> mpsc::Receiver<()> {
        let (done, heard) = mpsc::channel();
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.waiting.push(done);
        if state.running {
            state.again = true;
            return heard;
        }
        state.running = true;
        drop(state);
        let (sink, file, sent, state) = (self.sink.clone(), self.file.clone(), self.sent.clone(), self.state.clone());
        let spawned = std::thread::Builder::new().name("diagnostics".into()).spawn(move || {
            let agent = Sink::agent();
            loop {
                let waiting = {
                    let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                    s.again = false;
                    std::mem::take(&mut s.waiting)
                };
                // What could not go out stays in the file for a later send.
                let _ = sink.send_pending(&agent, &file, &sent);
                for done in waiting {
                    let _ = done.send(());
                }
                let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                if !s.again {
                    s.running = false;
                    for done in s.waiting.drain(..) {
                        let _ = done.send(());
                    }
                    break;
                }
            }
        });
        if spawned.is_err() {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            s.running = false;
            s.waiting.clear();
        }
        heard
    }
}

static DIAGNOSTICS: OnceLock<Diagnostics> = OnceLock::new();

/// Whether this installation has a destination for reports and sends them — so the window can say
/// so, and offer to turn it off.
pub fn status() -> Status {
    DIAGNOSTICS.get().map_or(Status { configured: false, sending: false }, Diagnostics::status)
}

/// Turns reporting on or off (see [`Diagnostics::set_sending`]).
pub fn set_sending(on: bool) -> std::io::Result<()> {
    DIAGNOSTICS.get().map_or(Ok(()), |d| d.set_sending(on))
}

/// The reports written so far (see [`Diagnostics::reports`]).
pub fn reports() -> std::io::Result<String> {
    DIAGNOSTICS.get().map_or(Ok(String::new()), Diagnostics::reports)
}

/// Reports an error the window did not handle.
pub fn window_failed(kind: &str, stack: &str) {
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        diagnostics.record(window_report(kind, stack));
    }
}

/// Starts this launch's reports for the app `identifier` names: trims the file, sends what earlier
/// launches left (when sending is on), and reports any panic. Does nothing when the app's local
/// data folder cannot be found.
pub fn install(identifier: &str) {
    let Some(data) = app_local_data(identifier) else { return };
    if DIAGNOSTICS.set(Diagnostics::new(&folder(&data), configured_sink())).is_err() {
        return;
    }
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        diagnostics.send_pending();
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let (Some(diagnostics), Some(location)) = (DIAGNOSTICS.get(), info.location()) {
            diagnostics.record(panic_report(location));
        }
        previous(info);
    }));
}

/// Reports a failed command when the failure is the app's own fault.
pub fn command_failed(code: &str, at: &Location<'_>, status: Option<u16>, fault: Option<&Fault>) {
    if let Some(diagnostics) = DIAGNOSTICS.get()
        && is_fault(code)
    {
        diagnostics.record(command_report(code, at, status, fault));
    }
}

/// Reports that the web view runtime is missing, and gives the report up to `wait` to go out
/// before the launch ends.
pub fn webview_missing(wait: Duration) {
    if let Some(heard) = DIAGNOSTICS.get().and_then(|d| d.record(webview_missing_report())) {
        let _ = heard.recv_timeout(wait);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn line(file: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(file).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    #[test]
    fn a_call_site_in_the_shell_keeps_its_place() {
        // The place the compiler gives this very line — the shape every shell report starts from.
        let report = command_report("io", Location::caller(), None, None);
        assert_eq!(report.layer, "shell");
        assert_eq!(report.kind, "CommandFailed");
        assert_eq!(report.frames.len(), 1, "the call site is the app's own code: {}", place(Location::caller()));
        assert!(report.frames[0].starts_with("src/diagnostics.rs:"), "{:?}", report.frames);
        assert_eq!(report.details, BTreeMap::from([("code".to_owned(), "io".to_owned())]));
    }

    #[test]
    fn a_place_outside_the_workspace_keeps_no_frame() {
        let shell = shell();
        for stack in [
            "C:\\Users\\someone\\.cargo\\registry\\src\\x\\lib.rs:1:1",
            "/home/someone/.cargo/registry/src/x/lib.rs:1:1",
            "src-tauri/../secret/lib.rs:1:1",
        ] {
            assert!(Report::new(&shell, "Panic", stack, VERSION).frames.is_empty(), "{stack}");
        }
        assert_eq!(Report::new(&shell, "Panic", "crates\\vault\\src\\lib.rs:7:3", VERSION).frames, ["vault/src/lib.rs:7:3"]);
    }

    #[test]
    fn an_engine_fault_is_the_engines_report_with_the_shells_code_and_status() {
        let fault = Fault {
            kind: "System.FormatException".into(),
            at: Some("Openquote.Vault.VaultReader.Read".into()),
            frames: vec!["Openquote.Vault.VaultReader.Read".into(), "OpenquoteCare.Sidecar.Api.Load".into()],
        };
        let report = command_report("engine", Location::caller(), Some(500), Some(&fault));
        assert_eq!(report.layer, "host");
        assert_eq!(report.kind, "System.FormatException");
        assert_eq!(report.frames, ["Openquote.Vault.VaultReader.Read", "OpenquoteCare.Sidecar.Api.Load"]);
        assert_eq!(report.details, BTreeMap::from([("code".to_owned(), "engine".to_owned()), ("status".to_owned(), "500".to_owned())]));
    }

    #[test]
    fn nothing_from_the_engine_that_could_carry_content_is_kept() {
        let fault = Fault { kind: "a record, 2026.json".into(), at: None, frames: vec!["가상 학생".into(), "C:\\Users\\someone\\x.cs:line 3".into()] };
        let report = command_report("engine", Location::caller(), Some(500), Some(&fault));
        assert_eq!(report.kind, tauri_kit_diagnostics::UNRECOGNIZED_KIND);
        assert!(report.frames.iter().all(|f| f.is_ascii()), "{:?}", report.frames);
        let text = serde_json::to_string(&report).unwrap();
        for leaked in ["record", "가상", "someone"] {
            assert!(!text.contains(leaked), "{leaked} in {text}");
        }
    }

    #[test]
    fn only_the_apps_own_faults_are_reported() {
        for code in ["engine-start", "engine", "io"] {
            assert!(is_fault(code));
        }
        for code in ["wrong-passphrase", "not-a-vault", "recovery-key", "pack-conflict", "no-vault", "not-a-choice"] {
            assert!(!is_fault(code), "{code} is a person's situation, not a defect");
        }
    }

    #[test]
    fn a_panic_and_a_missing_web_view_are_the_shells() {
        let panic = panic_report(Location::caller());
        assert_eq!((panic.layer.as_str(), panic.kind.as_str(), panic.frames.len()), ("shell", "Panic", 1));
        let missing = webview_missing_report();
        assert_eq!((missing.layer.as_str(), missing.kind.as_str()), ("shell", "WebviewMissing"));
        assert!(missing.frames.is_empty() && missing.details.is_empty());
    }

    #[test]
    fn a_window_error_keeps_its_type_and_the_bundles_frames_only() {
        let stack = "TypeError: cannot read 'title' of 가상 학생\n    at save (http://tauri.localhost/assets/index-a1.js:3:120)\n    at https://example.com/x.js:1:1\n    at C:\\Users\\someone\\x.js:1:1";
        let report = window_report("TypeError", stack);
        assert_eq!((report.layer.as_str(), report.kind.as_str()), ("webview", "TypeError"));
        assert_eq!(report.frames, ["save index-a1.js:3:120"]);
        let text = serde_json::to_string(&report).unwrap();
        for leaked in ["title", "가상", "example", "someone"] {
            assert!(!text.contains(leaked), "{leaked} in {text}");
        }
        assert_eq!(window_report("a name, with words", "").kind, tauri_kit_diagnostics::UNRECOGNIZED_KIND);
    }

    #[test]
    fn turned_off_nothing_is_written_or_sent_and_it_stays_off_on_the_next_launch() {
        let data = tempfile::tempdir().unwrap();
        let folder = folder(data.path());
        let sink = || Sink::parse("InstrumentationKey=k;IngestionEndpoint=https://127.0.0.1:9/");
        let diagnostics = Diagnostics::new(&folder, sink());
        assert_eq!(diagnostics.status(), Status { configured: true, sending: true });
        assert_eq!(diagnostics.reports().unwrap(), "", "nothing written yet");
        diagnostics.set_sending(false).unwrap();
        assert_eq!(diagnostics.status(), Status { configured: true, sending: false });
        assert!(diagnostics.record(webview_missing_report()).is_none());
        assert!(diagnostics.send_pending().is_none());
        assert!(!folder.join("reports.jsonl").exists(), "nothing written while off");
        // The next launch remembers.
        let next = Diagnostics::new(&folder, sink());
        assert_eq!(next.status(), Status { configured: true, sending: false });
        next.set_sending(true).unwrap();
        assert_eq!(Diagnostics::new(&folder, sink()).status(), Status { configured: true, sending: true });
        let heard = next.record(webview_missing_report()).expect("written and being sent");
        heard.recv_timeout(Duration::from_secs(30)).expect("the send finished");
        assert!(next.reports().unwrap().contains("\"WebviewMissing\""));
    }

    #[test]
    fn without_a_destination_there_is_nothing_to_turn_off() {
        let data = tempfile::tempdir().unwrap();
        let diagnostics = Diagnostics::new(&folder(data.path()), None);
        assert_eq!(diagnostics.status(), Status { configured: false, sending: false });
    }

    #[test]
    fn reports_stay_in_the_app_folder_and_without_a_destination_nothing_is_sent() {
        let data = tempfile::tempdir().unwrap();
        let diagnostics = Diagnostics::new(&folder(data.path()), None);
        assert!(!diagnostics.sends());
        assert!(diagnostics.record(webview_missing_report()).is_none(), "nothing to wait for");
        // The same failure again is the same report.
        assert!(diagnostics.record(webview_missing_report()).is_none());
        let lines = line(&data.path().join("diagnostics").join("reports.jsonl"));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["kind"], "WebviewMissing");
        assert!(!data.path().join("diagnostics").join("reports.sent").exists());
    }

    #[test]
    fn a_destination_needs_a_key_and_an_https_endpoint() {
        assert!(Sink::parse("InstrumentationKey=k;IngestionEndpoint=https://region.in.example.com/").is_some());
        for raw in ["", "nonsense", "InstrumentationKey=k", "InstrumentationKey=k;IngestionEndpoint=http://127.0.0.1:9/"] {
            assert!(Sink::parse(raw).is_none(), "{raw:?}");
        }
    }

    #[test]
    fn a_send_that_cannot_reach_the_destination_keeps_the_report_and_says_when_it_gave_up() {
        let data = tempfile::tempdir().unwrap();
        // Nothing listens on port 9 of the loopback address: the send fails fast and gives up.
        let sink = Sink::parse("InstrumentationKey=k;IngestionEndpoint=https://127.0.0.1:9/").unwrap();
        let diagnostics = Diagnostics::new(&folder(data.path()), Some(sink));
        assert!(diagnostics.sends());
        let heard = diagnostics.record(panic_report(Location::caller())).expect("a send started");
        heard.recv_timeout(Duration::from_secs(30)).expect("the send finished");
        let folder = folder(data.path());
        assert_eq!(line(&folder.join("reports.jsonl")).len(), 1, "the report stays for a later launch");
        assert!(!folder.join("reports.sent").exists(), "nothing was recorded as sent");
    }
}

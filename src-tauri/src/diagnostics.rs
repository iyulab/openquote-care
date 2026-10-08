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
//! Sessions go beside the reports, in a file of their own: when the app starts, when it ends as it
//! should (how long it ran and the time on each of its screens, by the fixed names in [`SCREENS`]),
//! and, at the next start, a session that did not end — an installation is told apart only by a
//! random identifier made on the device. A session line has no field for anything a person wrote
//! or opened either.
//!
//! Sending happens when a connection string is configured — through the
//! `OPENQUOTE_DIAGNOSTICS_CONNECTION` environment variable, or embedded at build time under the
//! same name — and is not something a person turns off for now: what the files gained since the
//! last send goes out in the background at launch, after each new report and when the app ends;
//! what cannot go out now (no network, the service busy) stays in the files for a later launch.
//! Development and test builds, and builds without it, only keep the files.

use std::panic::Location;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use openquote_care_engine::Fault;
use tauri_kit_diagnostics::{
    FrameRule, InstallId, Layer, MAX_FILE_BYTES, Report, Reporter, RustSource, Screens, Session, SessionEvent, Sink, WebBundle, trim,
};

/// The app's screens, by the names the window gives them: its own screens before a vault is open,
/// and the screens of an open vault under `vault:`. Time on any other name is not kept apart.
pub const SCREENS: &[&str] = &[
    "welcome",
    "create",
    "open",
    "kit",
    "reports",
    "feedback",
    "vault:subjects",
    "vault:groups",
    "vault:practitioners",
    "vault:search",
    "vault:report",
    "vault:export",
    "vault:lists",
    "vault:devices",
    "vault:feedback",
];

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
    matches!(code, "engine-start" | "engine" | "io" | "feedback-refused")
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

/// One launch's reports and session: written to their files, and sent from them when a destination
/// is configured.
pub struct Diagnostics {
    folder: PathBuf,
    reporter: Reporter,
    sender: Option<Sender>,
    session: OnceLock<Session>,
    shown: Mutex<Shown>,
}

/// The screen the window last named, and whether the window is minimised now.
#[derive(Default)]
struct Shown {
    name: Option<String>,
    minimised: bool,
}

/// What the window shows about reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Status {
    /// This installation has a destination for reports and sessions, and sends them.
    pub configured: bool,
}

/// What the files hold, one JSON object per line — exactly what is sent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Lines {
    pub reports: String,
    pub sessions: String,
}

/// The marker earlier versions kept while a person had turned reporting off. Reporting is not
/// something to turn off now, so a launch removes it rather than leave a file that means nothing.
const RETIRED_OFF_MARKER: &str = "reporting-off";

impl Diagnostics {
    /// Reports and sessions kept in `folder`, sent to `sink` when there is one. Trims the files
    /// first: they are evidence of the recent past, not an archive.
    pub fn new(folder: &Path, sink: Option<Sink>) -> Diagnostics {
        let reports = Files::in_folder(folder, "reports");
        let sessions = Files::in_folder(folder, "sessions");
        for files in [&reports, &sessions] {
            let _ = trim(&files.file, &files.sent, MAX_FILE_BYTES);
        }
        let _ = std::fs::remove_file(folder.join(RETIRED_OFF_MARKER));
        let reporter = Reporter::new(reports.file.clone());
        let sender = sink.map(|sink| Sender::new(sink, reports, sessions));
        Diagnostics { folder: folder.to_path_buf(), reporter, sender, session: OnceLock::new(), shown: Mutex::default() }
    }

    /// Whether reports and sessions leave this device.
    pub fn sends(&self) -> bool {
        self.sender.is_some()
    }

    pub fn status(&self) -> Status {
        Status { configured: self.sends() }
    }

    /// What the two files hold; one not written yet is an empty text.
    pub fn lines(&self) -> std::io::Result<Lines> {
        let read = |file: &Path| match std::fs::read_to_string(file) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            read => read,
        };
        Ok(Lines { reports: read(self.reporter.file())?, sessions: read(&Files::in_folder(&self.folder, "sessions").file)? })
    }

    /// Sends what the files hold that has not gone out yet, in the background.
    pub fn send_pending(&self) -> Option<mpsc::Receiver<()>> {
        self.sender.as_ref().map(Sender::start)
    }

    /// Writes the report (once per failure per launch, up to the crate's limit) and, when it was
    /// new and there is a destination, starts sending it. Never panics: the panic hook calls it.
    pub fn record(&self, report: Report) -> Option<mpsc::Receiver<()>> {
        match self.reporter.record(report) {
            Ok(true) => self.send_pending(),
            _ => None,
        }
    }

    /// Starts this launch's session, once: the installation's identifier (made the first time),
    /// the window's language and what the app is set up for (`track`). A session an earlier launch
    /// left unfinished is written first. What the file gained goes out in the background.
    pub fn start_session(&self, locale: &str, track: &str) -> std::io::Result<()> {
        if self.session.get().is_some() {
            return Ok(());
        }
        let install = InstallId::load_or_create(&self.folder.join("install-id"))?;
        let session = Session::builder(&install, VERSION)
            .locale(locale)
            .track(track)
            .screens(Screens::new(SCREENS.iter().copied()))
            .start(Files::in_folder(&self.folder, "sessions").file, self.folder.join("session.running"))?;
        let _ = self.session.set(session);
        self.send_pending();
        Ok(())
    }

    /// The screen open now, by the window's name for it, or `None` while the window is hidden.
    pub fn screen(&self, name: Option<&str>) {
        let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
        shown.name = name.map(str::to_owned);
        self.tell(&shown);
    }

    /// The window was minimised (or brought back): no screen is in view meanwhile. The web view
    /// does not say so itself, so the shell tells the session from the window's own state.
    pub fn minimised(&self, minimised: bool) {
        let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
        if shown.minimised != minimised {
            shown.minimised = minimised;
            self.tell(&shown);
        }
    }

    fn tell(&self, shown: &Shown) {
        if let Some(session) = self.session.get() {
            session.screen(if shown.minimised { None } else { shown.name.as_deref() });
        }
    }

    /// Ends the session, once, and starts sending it.
    pub fn end_session(&self) -> Option<mpsc::Receiver<()>> {
        let session = self.session.get()?;
        session.end().ok()?;
        self.send_pending()
    }
}

/// A file of lines and the record of how far it has been sent.
#[derive(Clone)]
struct Files {
    file: PathBuf,
    sent: PathBuf,
}

impl Files {
    fn in_folder(folder: &Path, name: &str) -> Files {
        Files { file: folder.join(format!("{name}.jsonl")), sent: folder.join(format!("{name}.sent")) }
    }
}

/// Sends the files' new lines, one send at a time: a send asked for while one runs makes that one
/// go round again rather than racing it over the record of how far has been sent.
struct Sender {
    sink: Sink,
    reports: Files,
    sessions: Files,
    state: Arc<Mutex<SendState>>,
}

#[derive(Default)]
struct SendState {
    running: bool,
    again: bool,
    waiting: Vec<mpsc::Sender<()>>,
}

impl Sender {
    fn new(sink: Sink, reports: Files, sessions: Files) -> Sender {
        Sender { sink, reports, sessions, state: Arc::default() }
    }

    /// Starts a send, or asks the running one to go round again. The receiver hears when the files
    /// have been sent as far as they then reached (or the send gave up until later).
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
        let (sink, reports, sessions, state) = (self.sink.clone(), self.reports.clone(), self.sessions.clone(), self.state.clone());
        let spawned = std::thread::Builder::new().name("diagnostics".into()).spawn(move || {
            let agent = Sink::agent();
            loop {
                let waiting = {
                    let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                    s.again = false;
                    std::mem::take(&mut s.waiting)
                };
                // What could not go out stays in its file for a later send.
                let _ = sink.send_pending_of::<Report>(&agent, &reports.file, &reports.sent);
                let _ = sink.send_pending_of::<SessionEvent>(&agent, &sessions.file, &sessions.sent);
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

/// Whether this installation has a destination for reports and sessions — so the window can say
/// so.
pub fn status() -> Status {
    DIAGNOSTICS.get().map_or(Status { configured: false }, Diagnostics::status)
}

/// What the files hold (see [`Diagnostics::lines`]).
pub fn lines() -> std::io::Result<Lines> {
    DIAGNOSTICS.get().map_or(Ok(Lines { reports: String::new(), sessions: String::new() }), Diagnostics::lines)
}

/// Starts this launch's session (see [`Diagnostics::start_session`]).
pub fn start_session(locale: &str, track: &str) {
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        let _ = diagnostics.start_session(locale, track);
    }
}

/// The window was minimised or brought back (see [`Diagnostics::minimised`]).
pub fn minimised(minimised: bool) {
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        diagnostics.minimised(minimised);
    }
}

/// The screen open now (see [`Diagnostics::screen`]).
pub fn screen(name: Option<&str>) {
    if let Some(diagnostics) = DIAGNOSTICS.get() {
        diagnostics.screen(name);
    }
}

/// Ends the session as the app ends, giving it up to `wait` to go out — what does not stays for
/// the next launch.
pub fn end_session(wait: Duration) {
    if let Some(heard) = DIAGNOSTICS.get().and_then(Diagnostics::end_session) {
        let _ = heard.recv_timeout(wait);
    }
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
        for code in ["engine-start", "engine", "io", "feedback-refused"] {
            assert!(is_fault(code));
        }
        for code in ["wrong-passphrase", "not-a-vault", "recovery-key", "pack-conflict", "no-vault", "not-a-choice", "feedback-network", "feedback-busy", "feedback-empty"] {
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
    fn reporting_is_not_turned_off_by_the_marker_earlier_versions_kept() {
        let data = tempfile::tempdir().unwrap();
        let folder = folder(data.path());
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("reporting-off"), b"").unwrap();
        let sink = Sink::parse("InstrumentationKey=k;IngestionEndpoint=https://127.0.0.1:9/");
        let diagnostics = Diagnostics::new(&folder, sink);
        assert_eq!(diagnostics.status(), Status { configured: true });
        assert!(!folder.join("reporting-off").exists(), "the retired marker is removed");
        let heard = diagnostics.record(webview_missing_report()).expect("written and being sent");
        heard.recv_timeout(Duration::from_secs(30)).expect("the send finished");
        assert!(diagnostics.lines().unwrap().reports.contains("\"WebviewMissing\""));
    }

    #[test]
    fn without_a_destination_nothing_is_configured() {
        let data = tempfile::tempdir().unwrap();
        let diagnostics = Diagnostics::new(&folder(data.path()), None);
        assert_eq!(diagnostics.status(), Status { configured: false });
    }

    #[test]
    fn a_session_starts_once_keeps_time_under_the_fixed_screen_names_and_ends_in_its_own_file() {
        let data = tempfile::tempdir().unwrap();
        let folder = folder(data.path());
        let diagnostics = Diagnostics::new(&folder, None);
        diagnostics.start_session("ko-KR", "care-school-kr").unwrap();
        diagnostics.start_session("en", "other").unwrap();
        diagnostics.screen(Some("vault:report"));
        diagnostics.screen(Some("가상 학생 — 2026.json"));
        diagnostics.screen(None);
        assert!(diagnostics.end_session().is_none(), "no destination: nothing to wait for");
        assert!(diagnostics.end_session().is_none(), "a second end writes nothing");
        let lines = line(&folder.join("sessions.jsonl"));
        assert_eq!(lines.iter().map(|l| l["event"].as_str().unwrap()).collect::<Vec<_>>(), ["start", "end"]);
        assert_eq!((lines[0]["locale"].as_str(), lines[0]["track"].as_str()), (Some("ko-KR"), Some("care-school-kr")));
        let screens = lines[1]["screens"].as_object().unwrap();
        assert!(screens.contains_key("vault:report"));
        assert!(screens.contains_key(tauri_kit_diagnostics::UNRECOGNIZED_KIND));
        let text = diagnostics.lines().unwrap().sessions;
        for leaked in ["가상", "2026.json"] {
            assert!(!text.contains(leaked), "{leaked} in {text}");
        }
        let install = std::fs::read_to_string(folder.join("install-id")).unwrap();
        assert_eq!(lines[0]["install"].as_str(), Some(install.trim()));
        assert!(!folder.join("session.running").exists(), "an ended session leaves no marker");
    }

    #[test]
    fn a_launch_that_did_not_end_is_written_at_the_next_start_under_the_same_installation() {
        let data = tempfile::tempdir().unwrap();
        let folder = folder(data.path());
        Diagnostics::new(&folder, None).start_session("ko-KR", "care-school-kr").unwrap();
        // The process ended without `end_session` — a crash, or the system ending it.
        Diagnostics::new(&folder, None).start_session("ko-KR", "care-school-kr").unwrap();
        let lines = line(&folder.join("sessions.jsonl"));
        assert_eq!(lines.iter().map(|l| l["event"].as_str().unwrap()).collect::<Vec<_>>(), ["start", "unfinished", "start"]);
        assert_eq!(lines[0]["install"], lines[2]["install"]);
        assert_eq!(lines[0]["session"], lines[1]["session"], "the unfinished line names the session that did not end");
    }

    #[test]
    fn a_minimised_window_keeps_no_screen_time_and_picks_up_the_same_screen_when_back() {
        let data = tempfile::tempdir().unwrap();
        let folder = folder(data.path());
        let diagnostics = Diagnostics::new(&folder, None);
        diagnostics.start_session("ko", "school-kr").unwrap();
        diagnostics.screen(Some("vault:subjects"));
        diagnostics.minimised(true);
        diagnostics.minimised(true);
        // Named while minimised (the window can still change screen), counted only once it is back.
        diagnostics.screen(Some("vault:report"));
        diagnostics.minimised(false);
        diagnostics.end_session();
        let end = line(&folder.join("sessions.jsonl")).pop().unwrap();
        let screens = end["screens"].as_object().unwrap();
        assert_eq!(screens.keys().collect::<Vec<_>>(), ["vault:report", "vault:subjects"]);
        assert_eq!(screens["vault:report"]["opened"], 1, "brought back to the screen named meanwhile");
    }

    #[test]
    fn every_screen_the_window_names_is_one_of_the_fixed_list() {
        let screens = Screens::new(SCREENS.iter().copied());
        for name in SCREENS {
            assert_eq!(screens.name(name), *name, "{name} must be a plain identifier");
        }
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

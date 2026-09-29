//! Error diagnostics, content-free by construction.
//!
//! When the shell fails in a way that is its own fault — a panic, the engine not starting or
//! answering with an error, a file operation failing — it can report that the failure happened.
//! What a report may hold is fixed by the types below: an event name, a code from the shell's own
//! list, a place in the app's own source (`file:line`), an HTTP status, and the app version,
//! operating system and architecture. There is no field a record value, a file path, a vault
//! name or an error message could travel in, so nothing needs to be scrubbed.
//!
//! Reporting is off unless a connection string is configured — through the
//! `OPENQUOTE_DIAGNOSTICS_CONNECTION` environment variable, or embedded at build time under the
//! same name. Development and test builds, and builds without it, send nothing. A report is sent
//! once, in the background; if it cannot be delivered it is dropped, never stored or retried.

use std::panic::Location;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{Map, Value, json};

/// The only switch: absent or blank means no reports.
pub const CONNECTION_VAR: &str = "OPENQUOTE_DIAGNOSTICS_CONNECTION";

/// At most this many reports leave one run of the app, so a failure repeating in a loop cannot
/// turn into a stream.
const MAX_REPORTS: u32 = 10;

/// Where reports go, from an Application Insights connection string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    instrumentation_key: String,
    track_url: String,
}

impl Connection {
    /// Reads `InstrumentationKey` and `IngestionEndpoint` from a connection string. Anything
    /// partial or malformed gives `None`, which turns reporting off rather than sending elsewhere.
    pub fn parse(raw: &str) -> Option<Connection> {
        let mut key = None;
        let mut endpoint = None;
        for part in raw.split(';') {
            let Some((k, v)) = part.split_once('=') else { continue };
            let v = v.trim();
            match k.trim() {
                "InstrumentationKey" if !v.is_empty() => key = Some(v),
                "IngestionEndpoint" if !v.is_empty() => endpoint = Some(v),
                _ => {}
            }
        }
        Some(Connection {
            instrumentation_key: key?.to_owned(),
            track_url: format!("{}/v2/track", endpoint?.trim_end_matches('/')),
        })
    }

    /// The configured connection: the environment variable first, then the build-time value.
    pub fn configured() -> Option<Connection> {
        std::env::var(CONNECTION_VAR)
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| option_env!("OPENQUOTE_DIAGNOSTICS_CONNECTION").map(str::to_owned))
            .and_then(|raw| Connection::parse(&raw))
    }
}

/// A place in the app's own source. A location outside this workspace (a dependency, whose path
/// would include the build machine's folders) is reported only as `dependency`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourcePlace {
    file: &'static str,
    line: u32,
}

impl SourcePlace {
    pub fn of(location: &Location<'static>) -> SourcePlace {
        SourcePlace { file: location.file(), line: location.line() }
    }

    fn render(&self) -> String {
        if std::path::Path::new(self.file).is_absolute() || self.file.contains("registry") {
            "dependency".to_owned()
        } else {
            format!("{}:{}", self.file.replace('\\', "/"), self.line)
        }
    }
}

/// Every report the shell can make.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Report {
    /// The shell panicked at this place. The panic message is never included.
    Panic { at: SourcePlace },
    /// A command failed through the shell's own fault. `code` comes from the shell's list of
    /// failure codes; `status` is the engine's HTTP status, when it answered with one.
    CommandFailed { code: &'static str, at: SourcePlace, status: Option<u16> },
}

impl Report {
    fn name(&self) -> &'static str {
        match self {
            Report::Panic { .. } => "app.panic",
            Report::CommandFailed { .. } => "command.failed",
        }
    }

    fn properties(&self) -> Vec<(&'static str, String)> {
        match self {
            Report::Panic { at } => vec![("at", at.render())],
            Report::CommandFailed { code, at, status } => {
                let mut p = vec![("code", (*code).to_owned()), ("at", at.render())];
                if let Some(s) = status {
                    p.push(("status", s.to_string()));
                }
                p
            }
        }
    }
}

/// The failure codes that are the app's own fault and worth a report. The rest (a wrong
/// passphrase, a folder that is not a vault, …) are a person's situation, not a defect.
pub fn is_fault(code: &str) -> bool {
    matches!(code, "engine-start" | "engine" | "io")
}

/// The app's version, operating system and architecture: the facts every report carries.
#[derive(Clone, Debug)]
struct Facts {
    app_version: &'static str,
    os: &'static str,
    arch: &'static str,
}

impl Facts {
    fn current() -> Facts {
        Facts { app_version: env!("CARGO_PKG_VERSION"), os: std::env::consts::OS, arch: std::env::consts::ARCH }
    }
}

/// The Application Insights event envelope for one report. Only the fields named here are written.
fn envelope(report: &Report, connection: &Connection, facts: &Facts, time: &str) -> Value {
    let mut properties = Map::new();
    properties.insert("appVersion".into(), json!(facts.app_version));
    properties.insert("os".into(), json!(facts.os));
    properties.insert("arch".into(), json!(facts.arch));
    for (k, v) in report.properties() {
        properties.insert(k.into(), json!(v));
    }
    json!({
        "name": "Microsoft.ApplicationInsights.Event",
        "time": time,
        "iKey": connection.instrumentation_key,
        "tags": { "ai.cloud.role": "openquote-care", "ai.application.ver": facts.app_version },
        "data": { "baseType": "EventData", "baseData": { "ver": 2, "name": report.name(), "properties": properties } }
    })
}

/// Sends reports to one connection, in the background, at most [`MAX_REPORTS`] per run.
pub struct Diagnostics {
    connection: Connection,
    sent: Arc<AtomicU32>,
}

impl Diagnostics {
    pub fn new(connection: Connection) -> Diagnostics {
        Diagnostics { connection, sent: Arc::new(AtomicU32::new(0)) }
    }

    /// Sends one report without waiting for it. Returns the sending thread, or `None` when the
    /// report was not sent (the run's limit reached, or no thread could be started). Never
    /// panics: it is also called from the panic hook.
    pub fn send(&self, report: Report) -> Option<std::thread::JoinHandle<()>> {
        if self.sent.fetch_add(1, Ordering::Relaxed) >= MAX_REPORTS {
            return None;
        }
        let body = envelope(&report, &self.connection, &Facts::current(), &now_rfc3339());
        let url = self.connection.track_url.clone();
        std::thread::Builder::new()
            .name("diagnostics".into())
            .spawn(move || {
                let _ = agent().post(&url).header("Content-Type", "application/json").send_json(json!([body]));
            })
            .ok()
    }
}

/// An HTTP client that trusts the operating system's certificate store (so it works behind a
/// network that inspects TLS with its own certificate) and gives up after a few seconds.
fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .tls_config(ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build())
        .build()
        .new_agent()
}

static REPORTER: OnceLock<Diagnostics> = OnceLock::new();

/// Turns reporting on for this run when a connection is configured, including a report of any
/// panic. Does nothing otherwise.
pub fn install() {
    let Some(connection) = Connection::configured() else { return };
    if REPORTER.set(Diagnostics::new(connection)).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let (Some(reporter), Some(location)) = (REPORTER.get(), info.location()) {
            let place = SourcePlace { file: leak_file(location.file()), line: location.line() };
            if let Some(thread) = reporter.send(Report::Panic { at: place }) {
                // Give the report a moment before the process may end.
                let _ = thread.join();
            }
        }
        previous(info);
    }));
}

/// Reports a failed command when reporting is on and the failure is the app's own fault.
pub fn command_failed(code: &'static str, at: &'static Location<'static>, status: Option<u16>) {
    if let Some(reporter) = REPORTER.get()
        && is_fault(code)
    {
        reporter.send(Report::CommandFailed { code, at: SourcePlace::of(at), status });
    }
}

/// A panic location's file lives as long as the binary for code in this workspace, but the hook
/// only sees a borrowed `&str`; the few panics a run can report make leaking the copy harmless.
fn leak_file(file: &str) -> &'static str {
    Box::leak(file.to_owned().into_boxed_str())
}

/// Now as `YYYY-MM-DDTHH:MM:SSZ` in UTC, without a date library.
fn now_rfc3339() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    rfc3339(secs)
}

fn rfc3339(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let rem = epoch_secs % 86_400;
    // Civil date from days since the epoch (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    const CONNECTION: &str = "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://region.in.example.com/;LiveEndpoint=https://live.example.com/";

    fn place() -> SourcePlace {
        SourcePlace { file: "src-tauri/src/lib.rs", line: 42 }
    }

    #[test]
    fn a_connection_string_names_the_key_and_where_to_send() {
        let c = Connection::parse(CONNECTION).unwrap();
        assert_eq!(c.instrumentation_key, "00000000-0000-0000-0000-000000000000");
        assert_eq!(c.track_url, "https://region.in.example.com/v2/track");
        assert_eq!(Connection::parse("InstrumentationKey=k;IngestionEndpoint=https://x").unwrap().track_url, "https://x/v2/track");
    }

    #[test]
    fn a_partial_or_blank_connection_string_turns_reporting_off() {
        for raw in ["", "  ", "nonsense", "InstrumentationKey=k", "IngestionEndpoint=https://x/", "InstrumentationKey=;IngestionEndpoint=https://x/"] {
            assert_eq!(Connection::parse(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn only_the_apps_own_faults_are_reported() {
        for code in ["engine-start", "engine", "io"] {
            assert!(is_fault(code));
        }
        for code in ["wrong-passphrase", "not-a-vault", "recovery-key", "pack-conflict", "no-vault"] {
            assert!(!is_fault(code), "{code} is a person's situation, not a defect");
        }
    }

    #[test]
    fn a_place_outside_the_workspace_is_not_spelled_out() {
        assert_eq!(place().render(), "src-tauri/src/lib.rs:42");
        assert_eq!(SourcePlace { file: "crates\\engine\\src\\lib.rs", line: 7 }.render(), "crates/engine/src/lib.rs:7");
        for file in ["C:\\Users\\someone\\.cargo\\registry\\src\\x\\lib.rs", "/home/someone/.cargo/registry/src/x/lib.rs"] {
            assert_eq!(SourcePlace { file, line: 1 }.render(), "dependency");
        }
    }

    #[test]
    fn an_envelope_carries_only_the_listed_fields() {
        let c = Connection::parse(CONNECTION).unwrap();
        let facts = Facts { app_version: "0.1.0", os: "windows", arch: "x86_64" };
        let reports = [Report::Panic { at: place() }, Report::CommandFailed { code: "engine", at: place(), status: Some(500) }];
        for report in reports {
            let env = envelope(&report, &c, &facts, "2026-09-29T00:00:00Z");
            assert_eq!(env["iKey"], "00000000-0000-0000-0000-000000000000");
            assert_eq!(env["data"]["baseData"]["name"], report.name());
            let keys: Vec<&str> = env["data"]["baseData"]["properties"].as_object().unwrap().keys().map(String::as_str).collect();
            for key in &keys {
                assert!(["appVersion", "os", "arch", "at", "code", "status"].contains(key), "unlisted field {key}");
            }
        }
        let env = envelope(&Report::CommandFailed { code: "io", at: place(), status: None }, &c, &facts, "t");
        assert_eq!(env["data"]["baseData"]["properties"], json!({ "appVersion": "0.1.0", "os": "windows", "arch": "x86_64", "code": "io", "at": "src-tauri/src/lib.rs:42" }));
    }

    #[test]
    fn times_are_utc_calendar_times() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(1_000_000_000), "2001-09-09T01:46:40Z");
        assert_eq!(rfc3339(1_709_164_800), "2024-02-29T00:00:00Z");
    }

    /// A stand-in ingestion endpoint on the loopback address: answers each request with 200 and
    /// hands back the bodies it received.
    fn collector(requests: usize) -> (String, std::thread::JoinHandle<Vec<Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let mut bodies = Vec::new();
            for stream in listener.incoming().take(requests) {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                bodies.push(serde_json::from_slice(&body).unwrap());
                stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n").unwrap();
            }
            bodies
        });
        (url, thread)
    }

    #[test]
    fn a_report_reaches_the_collector_and_a_run_sends_at_most_its_limit() {
        let (url, collected) = collector(MAX_REPORTS as usize);
        let reporter = Diagnostics::new(Connection::parse(&format!("InstrumentationKey=k;IngestionEndpoint={url}")).unwrap());
        let mut threads = Vec::new();
        for _ in 0..MAX_REPORTS {
            threads.push(reporter.send(Report::CommandFailed { code: "engine-start", at: place(), status: None }).unwrap());
        }
        assert!(reporter.send(Report::Panic { at: place() }).is_none(), "the run's limit holds");
        for t in threads {
            t.join().unwrap();
        }
        let bodies = collected.join().unwrap();
        assert_eq!(bodies.len(), MAX_REPORTS as usize);
        assert_eq!(bodies[0][0]["data"]["baseData"]["name"], "command.failed");
        assert_eq!(bodies[0][0]["data"]["baseData"]["properties"]["code"], "engine-start");
    }

    /// Needs the network: the operating system's TLS completes a handshake with the public
    /// ingestion endpoint, which then refuses the made-up key with an HTTP status.
    #[test]
    #[ignore = "needs the network"]
    fn the_client_speaks_tls_with_the_systems_certificates() {
        let result = agent().post("https://dc.services.visualstudio.com/v2/track").header("Content-Type", "application/json").send_json(json!([]));
        match result {
            Ok(_) | Err(ureq::Error::StatusCode(_)) => {}
            Err(e) => panic!("no HTTP answer: {e}"),
        }
    }

    #[test]
    fn an_unreachable_collector_costs_nothing_but_the_report() {
        // Nothing listens on this port once the listener is gone.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let reporter = Diagnostics::new(Connection::parse(&format!("InstrumentationKey=k;IngestionEndpoint=http://127.0.0.1:{port}")).unwrap());
        reporter.send(Report::Panic { at: place() }).unwrap().join().unwrap();
    }
}

//! Feedback a person writes and chooses to send to the publisher.
//!
//! Nothing here runs by itself: a send happens only when the person writes something and presses
//! send, and what goes out is what they wrote, the reply address they gave (if any), and the app's
//! version, operating system and display language — never a record, a file path or a vault name.
//! The window shows that list before sending. The text itself is the person's: the window asks
//! them not to write counselling content in it, and the app does not read what they wrote.
//!
//! Sending is possible only where the build carries the destination's public key — the release
//! build, or a test through `OPENQUOTE_FEEDBACK_KEY`. Development and test builds without it do
//! not offer feedback at all. The destination is the publisher's own records service; it keeps
//! the time and the sender's IP address with each record.

use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri_kit_diagnostics::{Sink, ureq};

/// The address the feedback is written to; a test points it at a stand-in of its own.
pub const URL_VAR: &str = "OPENQUOTE_FEEDBACK_URL";
/// The destination's public key. Absent or blank, the app offers no feedback.
pub const KEY_VAR: &str = "OPENQUOTE_FEEDBACK_KEY";

/// The publisher's records service, the table this app's feedback goes to.
const DEFAULT_URL: &str = "https://api.iyulab.com/api/t/openquote/feedback";

/// The most a message may hold, in characters — a letter, not a file.
pub const MAX_MESSAGE_CHARS: usize = 4000;
/// The most a reply address may hold.
const MAX_EMAIL_CHARS: usize = 254;
/// The service refuses a request over 16 KB; a message at its limit, all in three-byte
/// characters, still fits under it with the rest of the record.
const MAX_BODY_BYTES: usize = 15 * 1024;

/// A person waits on a send: it gives up rather than hang.
const TIMEOUT: Duration = Duration::from_secs(20);

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Where feedback goes, when this build has somewhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destination {
    url: String,
    key: String,
}

/// The configured destination: the environment first, then the values the build carries. A key
/// that is absent or blank means no destination.
pub fn configured() -> Option<Destination> {
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    let key = var(KEY_VAR).or_else(|| option_env!("OPENQUOTE_FEEDBACK_KEY").filter(|v| !v.trim().is_empty()).map(str::to_owned))?;
    let url = var(URL_VAR).or_else(|| option_env!("OPENQUOTE_FEEDBACK_URL").map(str::to_owned)).unwrap_or_else(|| DEFAULT_URL.to_owned());
    Some(Destination { url, key })
}

/// What the window shows about feedback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// This installation can send feedback.
    pub configured: bool,
    /// What goes along with the message, as it will be sent.
    pub version: String,
    pub os: String,
    pub max_message: usize,
}

pub fn status() -> Status {
    Status { configured: configured().is_some(), version: VERSION.to_owned(), os: os(), max_message: MAX_MESSAGE_CHARS }
}

/// The operating system and architecture, as the record names them.
fn os() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Why feedback was not sent.
#[derive(Debug, PartialEq, Eq)]
pub enum Problem {
    /// Nothing written.
    Empty,
    /// More than the message may hold.
    TooLong,
    /// The reply address is not one.
    Email,
    /// This build has nowhere to send feedback.
    NotConfigured,
    /// The service could not be reached (no network, a proxy that stops it, a timeout).
    Network,
    /// The service is busy; a later send may go through.
    Busy,
    /// The service answered with a refusal — the app's own fault (a key or an address that is
    /// wrong), not the person's.
    Refused(u16),
}

impl Problem {
    pub fn code(&self) -> &'static str {
        match self {
            Problem::Empty => "feedback-empty",
            Problem::TooLong => "feedback-too-long",
            Problem::Email => "feedback-email",
            Problem::NotConfigured => "feedback-off",
            Problem::Network => "feedback-network",
            Problem::Busy => "feedback-busy",
            Problem::Refused(_) => "feedback-refused",
        }
    }
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Problem::Refused(status) => write!(f, "the feedback service refused the message ({status})"),
            other => f.write_str(other.code()),
        }
    }
}

/// The record that goes out: the message and reply address as the person wrote them (trimmed),
/// and what the window listed beside them.
pub fn record(message: &str, email: Option<&str>, locale: &str) -> Result<Value, Problem> {
    let message = message.trim();
    if message.is_empty() {
        return Err(Problem::Empty);
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(Problem::TooLong);
    }
    let email = email.map(str::trim).filter(|e| !e.is_empty());
    if let Some(email) = email
        && !looks_like_email(email)
    {
        return Err(Problem::Email);
    }
    let mut record = json!({ "message": message, "appVersion": VERSION, "os": os(), "locale": locale });
    if let Some(email) = email {
        record["email"] = json!(email);
    }
    if record.to_string().len() > MAX_BODY_BYTES {
        return Err(Problem::TooLong);
    }
    Ok(record)
}

/// One `@` with something on each side and a dot after it, no spaces — enough to catch a slip,
/// not a validation of the address.
fn looks_like_email(email: &str) -> bool {
    if email.chars().count() > MAX_EMAIL_CHARS || email.chars().any(char::is_whitespace) {
        return false;
    }
    match email.split_once('@') {
        Some((local, domain)) => !local.is_empty() && !domain.contains('@') && domain.split('.').count() > 1 && domain.split('.').all(|p| !p.is_empty()),
        None => false,
    }
}

/// Writes `record` to `destination` and waits for the answer.
pub fn send(destination: &Destination, record: &Value) -> Result<(), Problem> {
    // The agent the diagnostics send with: the OS's certificates and the PC's proxy.
    let agent: ureq::Agent = Sink::agent();
    // No `Origin`: this is not a page in a browser, and does not pretend to be one.
    let answer = agent
        .post(&destination.url)
        .config()
        .timeout_global(Some(TIMEOUT))
        .build()
        .header("X-Api-Key", &destination.key)
        .header("Content-Type", "application/json")
        .send(record.to_string());
    match answer {
        Err(_) => Err(Problem::Network),
        Ok(response) => match response.status().as_u16() {
            200..=299 => Ok(()),
            429 | 500..=599 => Err(Problem::Busy),
            status => Err(Problem::Refused(status)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// What a stand-in for the service heard: the request line, the headers (lower-cased names) and the body.
    struct Heard {
        line: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl Heard {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
        }
    }

    /// A one-request stand-in for the service on the loopback address, answering `status`.
    fn stand_in(status: u16) -> (Destination, mpsc::Receiver<Heard>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api/t/openquote/feedback", listener.local_addr().unwrap());
        let (tell, heard) = mpsc::channel();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut headers = Vec::new();
            loop {
                let mut h = String::new();
                reader.read_line(&mut h).unwrap();
                let h = h.trim_end();
                if h.is_empty() {
                    break;
                }
                let (name, value) = h.split_once(':').unwrap();
                headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
            }
            let length: usize = headers.iter().find(|(n, _)| n == "content-length").map_or(0, |(_, v)| v.parse().unwrap());
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut stream = stream;
            write!(stream, "HTTP/1.1 {status} X\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
            tell.send(Heard { line: line.trim_end().to_owned(), headers, body: String::from_utf8(body).unwrap() }).unwrap();
        });
        (Destination { url, key: "pk_test".into() }, heard)
    }

    #[test]
    fn the_record_is_the_message_the_reply_address_and_what_the_window_lists() {
        let sent = record("  화면이 좁으면 버튼이 가려집니다.  ", Some(" someone@example.com "), "ko").unwrap();
        assert_eq!(sent["message"], "화면이 좁으면 버튼이 가려집니다.");
        assert_eq!(sent["email"], "someone@example.com");
        assert_eq!(sent["appVersion"], VERSION);
        assert_eq!(sent["os"], os());
        assert_eq!(sent["locale"], "ko");
        let keys: Vec<&String> = sent.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 5, "nothing beyond what the window lists: {keys:?}");
        assert!(record("글", None, "en").unwrap().get("email").is_none(), "no address, no field");
        assert!(record("글", Some("  "), "en").unwrap().get("email").is_none());
    }

    #[test]
    fn an_empty_or_overlong_message_and_a_slip_in_the_address_are_the_persons_to_fix() {
        assert_eq!(record("   ", None, "ko"), Err(Problem::Empty));
        assert_eq!(record(&"가".repeat(MAX_MESSAGE_CHARS + 1), None, "ko"), Err(Problem::TooLong));
        assert!(record(&"가".repeat(MAX_MESSAGE_CHARS), Some(&format!("{}@example.com", "a".repeat(200))), "ko").is_ok(), "the longest message fits the service's limit");
        for slip in ["someone", "someone@", "@example.com", "some one@example.com", "a@b@example.com", "someone@example", "someone@example."] {
            assert_eq!(record("글", Some(slip), "ko"), Err(Problem::Email), "{slip}");
        }
    }

    #[test]
    fn a_send_posts_the_record_with_the_key_and_no_origin() {
        let (destination, heard) = stand_in(201);
        let sent = record("고맙습니다", None, "ko").unwrap();
        assert_eq!(send(&destination, &sent), Ok(()));
        let heard = heard.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(heard.line, "POST /api/t/openquote/feedback HTTP/1.1");
        assert_eq!(heard.header("x-api-key"), Some("pk_test"));
        assert_eq!(heard.header("content-type"), Some("application/json"));
        assert_eq!(heard.header("origin"), None, "the shell is not a web page");
        assert_eq!(serde_json::from_str::<Value>(&heard.body).unwrap(), sent);
    }

    #[test]
    fn answers_are_told_apart() {
        let sent = record("글", None, "ko").unwrap();
        for (status, expected) in [(429, Problem::Busy), (503, Problem::Busy), (403, Problem::Refused(403)), (401, Problem::Refused(401))] {
            let (destination, _heard) = stand_in(status);
            assert_eq!(send(&destination, &sent), Err(expected), "{status}");
        }
        // Nothing listens on port 9 of the loopback address.
        let nowhere = Destination { url: "http://127.0.0.1:9/feedback".into(), key: "pk_test".into() };
        assert_eq!(send(&nowhere, &sent), Err(Problem::Network));
    }
}

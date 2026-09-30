//! The web view runtime the window is drawn with. On Windows it is Microsoft Edge WebView2, which
//! is installed apart from the app; when it cannot be found, Tauri stops with an English message
//! of its own. The app looks first and says it in the person's language, with what to do.
//!
//! A runtime can be registered without its files being on disk; the check asks the runtime's own
//! loader, which finds the files, not the registration.

use serde::Deserialize;

/// A message the shell shows before any window exists.
#[derive(Debug, Deserialize)]
pub struct Message {
    pub title: String,
    pub body: String,
}

#[derive(Deserialize)]
struct NativeStrings {
    #[serde(rename = "webviewMissing")]
    webview_missing: Message,
}

/// What the person is told when the runtime is missing — kept with the window's strings.
pub fn missing_message() -> Message {
    serde_json::from_str::<NativeStrings>(include_str!("../../src/native-strings.json"))
        .expect("native-strings.json holds the shell's messages")
        .webview_missing
}

/// The message to show when no web view runtime can be found, or `None` when one can.
pub fn check() -> Option<Message> {
    tauri::webview_version().err().map(|_| missing_message())
}

/// Shows the message and waits for the person to close it.
#[cfg(windows)]
pub fn alert(message: &Message) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (title, body) = (wide(&message.title), wide(&message.body));
    // SAFETY: both strings are NUL-terminated and outlive the call; no owner window.
    unsafe { MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR) };
}

#[cfg(not(windows))]
pub fn alert(message: &Message) {
    eprintln!("{}\n\n{}", message.title, message.body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_missing_runtime_message_is_there_to_show() {
        let message = missing_message();
        assert!(!message.title.is_empty());
        assert!(message.body.contains("WebView2"));
    }

    #[cfg(windows)]
    #[test]
    fn an_installed_runtime_needs_no_message() {
        // Every machine these tests run on has the runtime; the window e2e depends on it too.
        assert!(check().is_none());
    }
}

//! The web view runtime the window is drawn with. On Windows it is Microsoft Edge WebView2, which
//! is installed apart from the app; when it cannot be found, Tauri stops with an English message
//! of its own. The app looks first and says it in the person's language, with what to do.
//!
//! A runtime can be registered without its files being on disk; the check asks the runtime's own
//! loader, which finds the files, not the registration.

use std::collections::HashMap;

use serde::Deserialize;
use tauri_kit_webview::Runtime;

use crate::locale;

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

/// The shell's messages per language, kept with the window's strings.
fn tables() -> HashMap<String, NativeStrings> {
    serde_json::from_str(include_str!("../../src/native-strings.json")).expect("native-strings.json holds the shell's messages")
}

/// What the person is told when the runtime is missing, in the language of `tag` — English when
/// there is no table for it, as in the window.
pub fn missing_message(tag: &str) -> Message {
    let mut tables = tables();
    let table = tables.remove(&locale::language(tag)).or_else(|| tables.remove("en")).expect("native-strings.json has English");
    table.webview_missing
}

/// The message to show when no web view runtime can be found, or `None` when one can.
pub fn check() -> Option<Message> {
    (tauri_kit_webview::runtime() == Runtime::Missing).then(|| missing_message(&locale::ui_locale()))
}

/// Shows the message before any window exists and waits for the person to close it.
pub fn alert(message: &Message) {
    tauri_kit_webview::alert(&message.title, &message.body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_missing_runtime_message_is_there_in_every_language() {
        for (language, table) in tables() {
            assert!(!table.webview_missing.title.is_empty(), "{language}");
            assert!(table.webview_missing.body.contains("WebView2"), "{language}");
        }
        assert_eq!(missing_message("ko-KR").title, tables()["ko"].webview_missing.title);
        assert_eq!(missing_message("fr-FR").title, tables()["en"].webview_missing.title);
    }

    #[cfg(windows)]
    #[test]
    fn an_installed_runtime_needs_no_message() {
        // Every machine these tests run on has the runtime; the window e2e depends on it too.
        assert!(check().is_none());
    }
}

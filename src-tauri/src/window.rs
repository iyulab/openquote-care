//! The main window, built here rather than from the configuration so that what the web view may
//! keep is decided in one place: it keeps nothing typed into it.
//!
//! A web view remembers form entries for autofill in its own profile, outside the vault. What is
//! typed into this window — names, a recovery key — must stay in the vault, so autofill is off.
//! Entries an earlier version left behind are cleared at start, and the profile copies the
//! runtime takes when it updates itself (which would carry those entries along) are removed
//! before the web view opens.

use tauri::{App, WebviewWindow, WebviewWindowBuilder};

/// The window's label in the configuration, where its size and title live.
pub const MAIN: &str = "main";

/// Builds the main window from its configuration, with autofill off.
pub fn build_main(app: &App) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .expect("the configuration defines the main window")
        .clone();
    if let Ok(data) = tauri::Manager::path(app).app_local_data_dir() {
        let _ = tauri_kit_webview::remove_profile_snapshots(&data);
    }
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?.general_autofill_enabled(false).build()?;
    clear_remembered_entries(&window);
    Ok(window)
}

/// Clears form entries and saved passwords the web view kept before autofill was turned off.
#[cfg(windows)]
fn clear_remembered_entries(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        let _ = tauri_kit_webview::forget_form_entries(&webview.controller());
    });
}

#[cfg(not(windows))]
fn clear_remembered_entries(_window: &WebviewWindow) {}

#[cfg(test)]
mod tests {
    /// Every configuration that defines windows leaves the main one to the shell.
    #[test]
    fn the_configuration_leaves_the_main_window_to_the_shell() {
        for (name, text) in [
            ("tauri.conf.json", include_str!("../tauri.conf.json")),
            ("tauri.e2e.conf.json", include_str!("../tauri.e2e.conf.json")),
        ] {
            let config: serde_json::Value = serde_json::from_str(text).unwrap();
            let main = config["app"]["windows"].as_array().unwrap().iter().find(|w| w["label"] == super::MAIN).unwrap();
            assert_eq!(main["create"], false, "{name}");
        }
    }
}

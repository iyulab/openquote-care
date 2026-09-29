//! The main window, built here rather than from the configuration so that what the web view may
//! keep is decided in one place: it keeps nothing typed into it.
//!
//! A web view remembers form entries for autofill in its own profile, outside the vault. What is
//! typed into this window — names, a recovery key — must stay in the vault, so autofill is off.
//! Entries an earlier version left behind are cleared at start, and the profile copies the
//! runtime takes when it updates itself (which would carry those entries along) are removed
//! before the web view opens.

use std::path::Path;

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
        remove_profile_snapshots(&data);
    }
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?.general_autofill_enabled(false).build()?;
    clear_remembered_entries(&window);
    Ok(window)
}

/// Removes the copies of the web view profile that the runtime keeps from before its updates.
/// They are only for rolling the runtime back and are made again from the current profile.
fn remove_profile_snapshots(app_data: &Path) {
    let _ = std::fs::remove_dir_all(app_data.join("EBWebView").join("Snapshots"));
}

/// Clears form entries and saved passwords the web view kept before autofill was turned off.
#[cfg(windows)]
fn clear_remembered_entries(window: &WebviewWindow) {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL, COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
        ICoreWebView2_13, ICoreWebView2Profile2,
    };
    use windows_core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let clear = || -> windows_core::Result<()> {
            let profile = webview.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
            profile.ClearBrowsingData(
                COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL | COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
                &ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(()))),
            )
        };
        let _ = clear();
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

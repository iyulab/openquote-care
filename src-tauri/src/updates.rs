//! New versions of the app, from where the publisher releases them.
//!
//! A released installer carries the updater's public key and one fixed address
//! (`src-tauri/tauri.updater.conf.json`, used only by the release build). At launch, and again
//! every twelve hours while the app stays open, the shell asks that address for the newest
//! version's description — a plain request carrying nothing about the person, their records or
//! this computer beyond what any connection does — and, when it names a newer version, tells the
//! window and downloads its installer in the background, checked against the public key. A
//! downloaded installer is installed when the app closes (the vault closed first), without starting
//! the app again; the person can also update now, which closes the vault, installs and starts the
//! new version.
//!
//! Development and test builds carry no key and never ask. A person can turn the check off; no
//! network, or one that blocks the address, is not an error — the app works the same.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Where the address can be pointed elsewhere, for a test serving its own version description.
pub const ENDPOINT_VAR: &str = "OPENQUOTE_UPDATE_ENDPOINT";

/// The event the window hears when a newer version is found.
pub const AVAILABLE: &str = "update-available";

const RECHECK: Duration = Duration::from_secs(12 * 60 * 60);
const TIMEOUT: Duration = Duration::from_secs(30);

/// What the window shows about new versions.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// This installation can update itself: it carries the updater's key.
    pub configured: bool,
    /// It looks for new versions: configured, and not turned off.
    pub checking: bool,
    /// The newer version found, if any.
    pub available: Option<String>,
    /// That version is downloaded and checked against the key: it is installed when the app closes.
    pub ready: bool,
}

/// A newer version found, and its installer once downloaded and checked.
struct Found {
    update: Update,
    installer: Option<Vec<u8>>,
}

/// The shell's state for new versions, managed by Tauri.
pub struct Updates {
    configured: bool,
    off_marker: PathBuf,
    found: Mutex<Option<Found>>,
}

impl Updates {
    /// `configured` when the build carries the updater's key; the switch is remembered in `folder`.
    pub fn new(configured: bool, folder: &Path) -> Self {
        Updates { configured, off_marker: folder.join("update-check-off"), found: Mutex::new(None) }
    }

    fn checking(&self) -> bool {
        self.configured && !self.off_marker.exists()
    }

    pub fn status(&self) -> Status {
        let found = self.found.lock().unwrap();
        Status {
            configured: self.configured,
            checking: self.checking(),
            available: found.as_ref().map(|f| f.update.version.clone()),
            ready: found.as_ref().is_some_and(|f| f.installer.is_some()),
        }
    }

    /// Turns the check on or off, for this launch and the next ones. Off forgets a version found,
    /// and an installer downloaded for it.
    pub fn set_checking(&self, on: bool) -> std::io::Result<()> {
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
            *self.found.lock().unwrap() = None;
        }
        Ok(())
    }

    /// Keeps a version found. The same version found again keeps the installer already
    /// downloaded for it; another version replaces both. Returns the version when it is new here.
    fn keep(&self, update: Update) -> Option<String> {
        let mut found = self.found.lock().unwrap();
        if found.as_ref().is_some_and(|f| f.update.version == update.version) {
            return None;
        }
        let version = update.version.clone();
        *found = Some(Found { update, installer: None });
        Some(version)
    }

    /// The version found, still to download.
    fn to_download(&self) -> Option<Update> {
        self.found.lock().unwrap().as_ref().filter(|f| f.installer.is_none()).map(|f| f.update.clone())
    }

    /// Keeps the installer downloaded for `version`, unless another version was found meanwhile.
    fn downloaded(&self, version: &str, installer: Vec<u8>) -> bool {
        let mut found = self.found.lock().unwrap();
        match found.as_mut() {
            Some(f) if f.update.version == version => {
                f.installer = Some(installer);
                true
            }
            _ => false,
        }
    }

    /// The version found and its installer, if downloaded; taken, so it is installed once.
    fn take(&self) -> Option<(Update, Option<Vec<u8>>)> {
        self.found.lock().unwrap().take().map(|f| (f.update, f.installer))
    }

    fn put_back(&self, update: Update, installer: Option<Vec<u8>>) {
        *self.found.lock().unwrap() = Some(Found { update, installer });
    }
}

/// Whether the app's configuration carries the updater's settings (the release build's only).
pub fn configured(config: &tauri::Config) -> bool {
    config.plugins.0.get("updater").is_some_and(|c| c.get("pubkey").and_then(|k| k.as_str()).is_some_and(|k| !k.is_empty()))
}

/// Looks for a newer version now and again for as long as the app runs.
pub fn watch<R: Runtime>(handle: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            check(&handle).await;
            tokio::time::sleep(RECHECK).await;
        }
    });
}

/// One look now, as when the check is turned on again.
pub fn check_now<R: Runtime>(handle: AppHandle<R>) {
    tauri::async_runtime::spawn(async move { check(&handle).await });
}

/// One look: a newer version found is kept, the window told, and its installer downloaded and
/// checked against the key in the background, so that it can be installed when the app closes —
/// the window is told again once it is ready. Any failure — no network, an address that does not
/// answer, a description or an installer that does not verify — leaves things as they were, and
/// the next look tries again.
async fn check<R: Runtime>(handle: &AppHandle<R>) {
    let updates = handle.state::<Updates>();
    if !updates.checking() {
        return;
    }
    let Ok(updater) = builder(handle).and_then(|b| b.build()) else { return };
    if let Some(update) = updater.check().await.ok().flatten()
        && let Some(version) = updates.keep(update)
    {
        let _ = handle.emit(AVAILABLE, version);
    }
    let Some(update) = updates.to_download() else { return };
    if let Ok(installer) = update.download(|_, _| {}, || {}).await
        && updates.downloaded(&update.version, installer)
    {
        let _ = handle.emit(AVAILABLE, update.version.clone());
    }
}

fn builder<R: Runtime>(handle: &AppHandle<R>) -> tauri_plugin_updater::Result<tauri_plugin_updater::UpdaterBuilder> {
    let builder = handle.updater_builder().timeout(TIMEOUT);
    match std::env::var(ENDPOINT_VAR).ok().and_then(|u| u.parse().ok()) {
        Some(url) => builder.endpoints(vec![url]),
        None => Ok(builder),
    }
}

/// Installs the version found now, as the person asked: its installer (downloaded now if it is not
/// yet), checked against the key, then `before_install` (the vault is closed there), then the
/// installer, which ends this process and starts the new version. Returns only when it could not:
/// nothing found, or the download or its check failed — then the app goes on as it was.
pub async fn apply<R: Runtime>(handle: &AppHandle<R>, before_install: impl FnOnce()) -> Result<(), String> {
    let updates = handle.state::<Updates>();
    let Some((update, installer)) = updates.take() else { return Err("no newer version found".into()) };
    let installer = match installer {
        Some(installer) => installer,
        None => match update.download(|_, _| {}, || {}).await {
            Ok(installer) => installer,
            Err(e) => {
                updates.put_back(update, None);
                return Err(e.to_string());
            }
        },
    };
    before_install();
    update.install(installer).map_err(|e| e.to_string())
}

/// As the app closes: when an installer is ready, `before_install` runs (the vault is closed
/// there) and the new version is installed — without starting it, since the person closed the
/// app. The installer ends this process. Does nothing when no installer is ready.
pub fn install_on_close<R: Runtime>(handle: &AppHandle<R>, before_install: impl FnOnce()) {
    let updates = handle.state::<Updates>();
    let Some((update, Some(installer))) = updates.take() else { return };
    before_install();
    let _ = update.restart_after_install(false).install(installer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(plugins: serde_json::Value) -> tauri::Config {
        let mut config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        config.plugins = serde_json::from_value(plugins).unwrap();
        config
    }

    #[test]
    fn only_a_build_carrying_the_updaters_key_looks_for_new_versions() {
        assert!(!configured(&config(serde_json::json!({}))));
        assert!(!configured(&config(serde_json::json!({ "updater": { "pubkey": "" } }))));
        assert!(configured(&config(serde_json::json!({ "updater": { "pubkey": "a key" } }))));
    }

    #[test]
    fn the_development_configuration_carries_no_key() {
        let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(!configured(&config), "only the release build may look for new versions");
    }

    #[test]
    fn the_release_configuration_carries_the_key_and_one_fixed_address() {
        let release: serde_json::Value = serde_json::from_str(include_str!("../tauri.updater.conf.json")).unwrap();
        let updater = &release["plugins"]["updater"];
        assert!(updater["pubkey"].as_str().is_some_and(|k| !k.is_empty()));
        assert_eq!(updater["endpoints"], serde_json::json!(["https://github.com/iyulab/openquote-care/releases/latest/download/latest.json"]));
        assert_eq!(release["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn turning_the_check_off_is_remembered_and_turning_it_on_again_forgets_that() {
        let dir = tempfile::tempdir().unwrap();
        let updates = Updates::new(true, dir.path());
        assert!(updates.status().checking);

        updates.set_checking(false).unwrap();
        assert_eq!(Updates::new(true, dir.path()).status(), Status { configured: true, checking: false, available: None, ready: false });

        updates.set_checking(true).unwrap();
        assert!(Updates::new(true, dir.path()).status().checking);
        assert!(!Updates::new(false, dir.path()).status().checking, "never without the key");
    }
}

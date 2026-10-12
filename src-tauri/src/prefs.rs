//! What a person sets for the app on this computer — not for a vault: the window's colours, the
//! language it speaks, whether it looks for new versions. One small file in the app's local data
//! folder, read by the shell before any window exists (the language of a message shown when the
//! web view runtime is missing; the colours the window opens in).
//!
//! The file keeps what it does not know: a later version may add settings, and going back to this
//! one and changing a setting must not lose them. It is written whole to a temporary file and moved
//! into place, so it is never seen half-written.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The file's name in the app's local data folder.
pub const FILE: &str = "preferences.json";

/// The marker versions before this file kept while the person had turned the check for new
/// versions off. Read once into the file, then removed.
const EARLIER_UPDATE_CHECK_OFF: &str = "update-check-off";

/// The window's colours: the system's choice, or always light, or always dark.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

impl Theme {
    /// The window's theme: none follows the system.
    pub fn window(self) -> Option<tauri::Theme> {
        match self {
            Theme::System => None,
            Theme::Light => Some(tauri::Theme::Light),
            Theme::Dark => Some(tauri::Theme::Dark),
        }
    }
}

/// The settings, as the file holds them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default)]
    pub theme: Theme,
    /// The language the window speaks, as a language tag; none follows the system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Whether a release build looks for new versions by itself.
    #[serde(default = "on")]
    pub check_for_updates: bool,
    /// What a later version wrote that this one does not know, kept as it was.
    #[serde(flatten)]
    rest: Map<String, Value>,
}

fn on() -> bool {
    true
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences { theme: Theme::System, language: None, check_for_updates: true, rest: Map::new() }
    }
}

/// Whether `tag` reads as a language tag (`en`, `fr-CA`): letters, digits and hyphens, starting with a letter.
pub fn is_language_tag(tag: &str) -> bool {
    tag.len() <= 35
        && tag.split('-').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric()))
        && tag.starts_with(|c: char| c.is_ascii_alphabetic())
}

/// The settings kept in `folder`. A file that cannot be read gives the defaults (it is replaced on
/// the next change, as one the person can no longer see would be). The earlier marker for the check
/// being off is taken into the file and removed.
pub fn read(folder: &Path) -> Preferences {
    let mut prefs = std::fs::read(folder.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok())
        .unwrap_or_default();
    if prefs.language.as_deref().is_some_and(|tag| !is_language_tag(tag)) {
        prefs.language = None;
    }
    let marker = folder.join(EARLIER_UPDATE_CHECK_OFF);
    if marker.exists() {
        prefs.check_for_updates = false;
        if write(folder, &prefs).is_ok() {
            let _ = std::fs::remove_file(marker);
        }
    }
    prefs
}

/// Writes the settings to `folder`, whole: to a temporary file first, then moved over the file.
pub fn write(folder: &Path, prefs: &Preferences) -> io::Result<()> {
    std::fs::create_dir_all(folder)?;
    let text = serde_json::to_vec_pretty(prefs).map_err(io::Error::other)?;
    let temporary = folder.join(format!("{FILE}.tmp"));
    std::fs::write(&temporary, text)?;
    std::fs::rename(&temporary, folder.join(FILE))
}

/// Reads the settings in `folder`, changes them with `change` and writes them back; returns them as written.
pub fn change(folder: &Path, change: impl FnOnce(&mut Preferences)) -> io::Result<Preferences> {
    let mut prefs = read(folder);
    change(&mut prefs);
    write(folder, &prefs)?;
    Ok(prefs)
}

static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// Names the app's local data folder for this launch, before anything reads the settings.
pub fn install(app_local_data: PathBuf) {
    let _ = FOLDER.set(app_local_data);
}

/// The app's local data folder named by [`install`].
pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}

/// This launch's settings; the defaults before [`install`] (or without a data folder).
pub fn load() -> Preferences {
    folder().map(read).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_a_file_the_app_follows_the_system_and_looks_for_new_versions() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()), Preferences::default());
        assert_eq!(read(dir.path()).theme, Theme::System);
        assert!(read(dir.path()).check_for_updates);
    }

    #[test]
    fn a_change_is_kept_for_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        change(dir.path(), |p| {
            p.theme = Theme::Dark;
            p.language = Some("en".into());
        })
        .unwrap();
        let read = read(dir.path());
        assert_eq!((read.theme, read.language.as_deref(), read.check_for_updates), (Theme::Dark, Some("en"), true));
        assert!(!dir.path().join(format!("{FILE}.tmp")).exists(), "nothing half-written left beside it");
    }

    #[test]
    fn settings_a_later_version_wrote_are_kept_when_this_one_changes_another() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), r#"{"theme":"light","fontScale":1.25}"#).unwrap();
        change(dir.path(), |p| p.check_for_updates = false).unwrap();
        let text: Value = serde_json::from_slice(&std::fs::read(dir.path().join(FILE)).unwrap()).unwrap();
        assert_eq!(text["fontScale"], 1.25);
        assert_eq!(text["theme"], "light");
        assert_eq!(text["checkForUpdates"], false);
    }

    #[test]
    fn a_file_that_cannot_be_read_gives_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), b"{ not json").unwrap();
        assert_eq!(read(dir.path()), Preferences::default());
        std::fs::write(dir.path().join(FILE), r#"{"theme":"sepia","language":"../x"}"#).unwrap();
        assert_eq!(read(dir.path()), Preferences::default(), "an unknown theme is not read as one");
        std::fs::write(dir.path().join(FILE), r#"{"language":"../x"}"#).unwrap();
        assert_eq!(read(dir.path()).language, None, "nor something that is not a language tag");
    }

    #[test]
    fn the_earlier_marker_for_the_check_being_off_is_taken_into_the_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(EARLIER_UPDATE_CHECK_OFF), b"").unwrap();
        assert!(!read(dir.path()).check_for_updates);
        assert!(!dir.path().join(EARLIER_UPDATE_CHECK_OFF).exists(), "the marker is gone once the file says it");
        assert!(!read(dir.path()).check_for_updates, "and the file keeps saying it");
    }

    #[test]
    fn language_tags() {
        for tag in ["ko", "en", "en-GB", "zh-Hant-TW"] {
            assert!(is_language_tag(tag), "{tag}");
        }
        for tag in ["", "-", "en-", "1a", "../x", "ko KR", "en_GB"] {
            assert!(!is_language_tag(tag), "{tag}");
        }
    }
}

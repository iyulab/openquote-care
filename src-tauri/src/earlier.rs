//! What an installation kept under the identifier the app had before: its own data folder.

use std::fs;
use std::io;
use std::path::Path;

/// The identifier the app was published under before. Its data folder holds the device's name, the
/// installation's number, the runs and reports, and the window's storage.
pub const EARLIER_IDENTIFIER: &str = "com.iyulab.openquote-care";

/// The identifier the app is published under now, which builds made for tests extend (`<identifier>.e2e`).
pub const IDENTIFIER: &str = "me.openquote.care";

/// The earlier identifier a build's `identifier` takes over from: the published app's from the published app's, and a
/// test build's from the same test build's (`me.openquote.care.e2e` from `com.iyulab.openquote-care.e2e`) — never a
/// test build's from the published app's, whose folder holds a person's own data. None for any other identifier.
fn earlier_of(identifier: &str) -> Option<String> {
    let rest = identifier.strip_prefix(IDENTIFIER)?;
    (rest.is_empty() || rest.starts_with('.')).then(|| format!("{EARLIER_IDENTIFIER}{rest}"))
}

/// What [`take_over`] found and did.
#[derive(Debug, PartialEq, Eq)]
pub enum TakeOver {
    /// Nothing to take over: no earlier folder, this identifier's folder already there, or an identifier with no earlier one.
    Nothing,
    /// The earlier folder became this identifier's, everything in it as it was.
    Moved,
    /// The earlier folder could not be moved (a copy of the earlier version still running, say): the device's
    /// name and the installation's number were copied, the rest stays behind.
    Copied,
}

/// Takes over the data folder of the identifier `identifier` had before (see [`earlier_of`]) under `base` (the system's
/// local data folder), once: when `identifier`'s folder does not exist yet and the earlier one does, the earlier one is renamed to it — the same
/// volume, so in one step — before anything (the diagnostics, the web view) makes a folder of its own. A rename
/// that fails leaves the earlier folder where it is and copies what names this device and installation.
pub fn take_over(base: &Path, identifier: &str) -> io::Result<TakeOver> {
    let Some(earlier) = earlier_of(identifier).map(|id| base.join(id)) else { return Ok(TakeOver::Nothing) };
    let now = base.join(identifier);
    if now.exists() || !earlier.is_dir() {
        return Ok(TakeOver::Nothing);
    }
    if fs::rename(&earlier, &now).is_ok() {
        return Ok(TakeOver::Moved);
    }
    for file in ["device-id", "diagnostics/install-id"] {
        let from = earlier.join(file);
        if from.is_file() {
            let to = now.join(file);
            fs::create_dir_all(to.parent().unwrap_or(&now))?;
            fs::copy(from, to)?;
        }
    }
    Ok(TakeOver::Copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = IDENTIFIER;

    fn earlier_folder(base: &Path) {
        let earlier = base.join(EARLIER_IDENTIFIER);
        fs::create_dir_all(earlier.join("diagnostics")).unwrap();
        fs::create_dir_all(earlier.join("EBWebView")).unwrap();
        fs::write(earlier.join("device-id"), "6qrzk5il").unwrap();
        fs::write(earlier.join("diagnostics/install-id"), "install-1").unwrap();
        fs::write(earlier.join("diagnostics/sessions.jsonl"), "{}\n").unwrap();
    }

    #[test]
    fn the_earlier_folder_becomes_this_identifiers_with_everything_in_it() {
        let base = tempfile::tempdir().unwrap();
        earlier_folder(base.path());

        assert_eq!(take_over(base.path(), NOW).unwrap(), TakeOver::Moved);

        let now = base.path().join(NOW);
        assert_eq!(fs::read_to_string(now.join("device-id")).unwrap(), "6qrzk5il");
        assert_eq!(fs::read_to_string(now.join("diagnostics/install-id")).unwrap(), "install-1");
        assert!(now.join("diagnostics/sessions.jsonl").is_file() && now.join("EBWebView").is_dir());
        assert!(!base.path().join(EARLIER_IDENTIFIER).exists());
    }

    #[test]
    fn a_folder_of_this_identifier_already_there_is_kept_and_the_earlier_one_left_alone() {
        let base = tempfile::tempdir().unwrap();
        earlier_folder(base.path());
        fs::create_dir_all(base.path().join(NOW)).unwrap();
        fs::write(base.path().join(NOW).join("device-id"), "14nj1wsp").unwrap();

        assert_eq!(take_over(base.path(), NOW).unwrap(), TakeOver::Nothing);

        assert_eq!(fs::read_to_string(base.path().join(NOW).join("device-id")).unwrap(), "14nj1wsp");
        assert!(base.path().join(EARLIER_IDENTIFIER).join("device-id").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_that_cannot_be_moved_gives_the_device_name_and_installation_number_and_stays() {
        let base = tempfile::tempdir().unwrap();
        earlier_folder(base.path());
        // A file open inside the folder keeps Windows from renaming it, as a running earlier version would.
        let _held = fs::File::open(base.path().join(EARLIER_IDENTIFIER).join("diagnostics/sessions.jsonl")).unwrap();

        assert_eq!(take_over(base.path(), NOW).unwrap(), TakeOver::Copied);

        let now = base.path().join(NOW);
        assert_eq!(fs::read_to_string(now.join("device-id")).unwrap(), "6qrzk5il");
        assert_eq!(fs::read_to_string(now.join("diagnostics/install-id")).unwrap(), "install-1");
        assert!(base.path().join(EARLIER_IDENTIFIER).join("EBWebView").is_dir());
    }

    #[test]
    fn a_test_build_takes_over_only_its_own_earlier_folder_never_the_published_apps() {
        let base = tempfile::tempdir().unwrap();
        earlier_folder(base.path());
        assert_eq!(take_over(base.path(), &format!("{IDENTIFIER}.e2e")).unwrap(), TakeOver::Nothing);
        assert!(base.path().join(EARLIER_IDENTIFIER).join("device-id").is_file(), "the published app's folder untouched");

        fs::create_dir_all(base.path().join(format!("{EARLIER_IDENTIFIER}.e2e"))).unwrap();
        assert_eq!(take_over(base.path(), &format!("{IDENTIFIER}.e2e")).unwrap(), TakeOver::Moved);
        assert!(base.path().join(format!("{IDENTIFIER}.e2e")).is_dir());
        assert!(base.path().join(EARLIER_IDENTIFIER).join("device-id").is_file());
    }

    #[test]
    fn nothing_is_done_without_an_earlier_folder_or_under_the_earlier_identifier_itself() {
        let base = tempfile::tempdir().unwrap();
        assert_eq!(take_over(base.path(), NOW).unwrap(), TakeOver::Nothing);
        assert!(!base.path().join(NOW).exists());

        earlier_folder(base.path());
        assert_eq!(take_over(base.path(), EARLIER_IDENTIFIER).unwrap(), TakeOver::Nothing);
        assert!(base.path().join(EARLIER_IDENTIFIER).join("device-id").is_file());
    }
}

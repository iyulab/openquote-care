//! The data packs bundled with the app, and the tracks a vault can be made on. A pack is a folder in
//! the vault's own layout that names itself in a manifest (`packs/<id>/v<n>.json`) and says which
//! packs it builds on; a track names the packs a new vault starts from, and brings what they build on.
//! Which packs and tracks exist is data (`packs/tracks.json` and the manifests): nothing here names one.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A track: the packs a new vault on it starts from, the locale their labels speak, and its name per language.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub id: String,
    pub packs: Vec<String>,
    pub locale: String,
    pub label: BTreeMap<String, String>,
}

impl Track {
    /// Its name in the language of `tag`, else in English, else its id.
    pub fn label_in(&self, tag: &str) -> String {
        let language = crate::locale::language(tag);
        self.label.get(&language).or_else(|| self.label.get("en")).cloned().unwrap_or_else(|| self.id.clone())
    }
}

#[derive(Deserialize)]
struct Tracks {
    tracks: Vec<Track>,
}

/// A bundled pack: its folder, its newest version, and the packs it builds on.
#[derive(Debug, Clone)]
struct Pack {
    dir: PathBuf,
    version: u64,
    depends: Vec<String>,
}

#[derive(Debug)]
pub enum BundleError {
    Io(io::Error),
    /// A manifest or the track list that cannot be read.
    Invalid(String),
    /// A track or a pack builds on a pack the bundle does not hold.
    MissingPack(String),
    /// Packs that build on each other in a circle.
    Cycle(String),
    /// A track the bundle does not offer.
    UnknownTrack(String),
}

impl std::fmt::Display for BundleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BundleError::Io(e) => write!(f, "{e}"),
            BundleError::Invalid(what) => write!(f, "cannot read {what}"),
            BundleError::MissingPack(id) => write!(f, "no bundled pack {id}"),
            BundleError::Cycle(id) => write!(f, "pack {id} builds on itself"),
            BundleError::UnknownTrack(id) => write!(f, "no track {id}"),
        }
    }
}

impl std::error::Error for BundleError {}

impl From<io::Error> for BundleError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// The bundled packs, by id, and the tracks over them.
#[derive(Debug, Clone, Default)]
pub struct Bundle {
    packs: BTreeMap<String, Pack>,
    tracks: Vec<Track>,
}

impl Bundle {
    /// Reads the bundle in `root`: `tracks.json`, and every folder holding a pack manifest.
    pub fn read(root: &Path) -> Result<Bundle, BundleError> {
        let tracks: Tracks = serde_json::from_slice(&fs::read(root.join("tracks.json"))?)
            .map_err(|e| BundleError::Invalid(format!("tracks.json: {e}")))?;
        let mut packs = BTreeMap::new();
        for entry in fs::read_dir(root)? {
            let dir = entry?.path();
            let manifests = dir.join("packs");
            if !manifests.is_dir() {
                continue;
            }
            for manifest in fs::read_dir(&manifests)? {
                let id_dir = manifest?.path();
                let Some(newest) = newest_manifest(&id_dir)? else { continue };
                let json: serde_json::Value = serde_json::from_slice(&fs::read(&newest)?)
                    .map_err(|e| BundleError::Invalid(format!("{}: {e}", newest.display())))?;
                let id = json["pack"].as_str().ok_or_else(|| BundleError::Invalid(newest.display().to_string()))?.to_owned();
                let version = json["version"].as_u64().ok_or_else(|| BundleError::Invalid(newest.display().to_string()))?;
                let depends = json["depends"].as_object().map(|d| d.keys().cloned().collect()).unwrap_or_default();
                packs.insert(id, Pack { dir: dir.clone(), version, depends });
            }
        }
        Ok(Bundle { packs, tracks: tracks.tracks })
    }

    /// The tracks a vault can be made on, in the order they are offered.
    pub fn tracks(&self) -> &[Track] {
        &self.tracks
    }

    /// The track to offer first for a window speaking `tag`: the first whose labels speak its language, else the first.
    pub fn default_track(&self, tag: &str) -> Option<&Track> {
        let language = crate::locale::language(tag);
        self.tracks.iter().find(|t| crate::locale::language(&t.locale) == language).or_else(|| self.tracks.first())
    }

    /// The folders of the packs `ids` name and every pack they build on, each after the packs it builds on.
    pub fn closure(&self, ids: &[String]) -> Result<Vec<PathBuf>, BundleError> {
        fn visit(bundle: &Bundle, id: &str, trail: &mut Vec<String>, order: &mut Vec<String>) -> Result<(), BundleError> {
            if order.iter().any(|o| o == id) {
                return Ok(());
            }
            if trail.iter().any(|t| t == id) {
                return Err(BundleError::Cycle(id.to_owned()));
            }
            let pack = bundle.packs.get(id).ok_or_else(|| BundleError::MissingPack(id.to_owned()))?;
            trail.push(id.to_owned());
            for dependency in &pack.depends {
                visit(bundle, dependency, trail, order)?;
            }
            trail.pop();
            order.push(id.to_owned());
            Ok(())
        }
        let mut order = Vec::new();
        for id in ids {
            visit(self, id, &mut Vec::new(), &mut order)?;
        }
        Ok(order.iter().map(|id| self.packs[id].dir.clone()).collect())
    }

    /// Of the packs a vault holds — `held`, each id with the version the vault holds — those the
    /// bundle has a later version of, in id order.
    pub fn newer<'a>(&self, held: impl IntoIterator<Item = (&'a str, u64)>) -> Vec<String> {
        let mut ids: Vec<String> = held
            .into_iter()
            .filter(|(id, version)| self.packs.get(*id).is_some_and(|p| p.version > *version))
            .map(|(id, _)| id.to_owned())
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }

    /// The folders a new vault on `track` is filled from, in order.
    pub fn track_packs(&self, track: &str) -> Result<Vec<PathBuf>, BundleError> {
        let track = self.tracks.iter().find(|t| t.id == track).ok_or_else(|| BundleError::UnknownTrack(track.to_owned()))?;
        self.closure(&track.packs)
    }

    /// The track a vault made before packs named themselves belongs to: of the tracks whose files it
    /// holds none of in a different form, the one it shares the most files with — at least one.
    /// `held` answers what the vault holds at a path. None when no track fits.
    pub fn adoption(&self, held: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Option<&Track>, BundleError> {
        let mut best: Option<(&Track, usize)> = None;
        'tracks: for track in &self.tracks {
            let mut shared = 0;
            for dir in self.closure(&track.packs)? {
                for file in crate::app::pack_files(&dir)? {
                    match held(&file.path) {
                        Some(content) if content == file.content => shared += 1,
                        Some(_) => continue 'tracks,
                        None => {}
                    }
                }
            }
            if shared > 0 && best.is_none_or(|(_, most)| shared > most) {
                best = Some((track, shared));
            }
        }
        Ok(best.map(|(track, _)| track))
    }
}

// The manifest of the newest version in a `packs/<id>/` folder.
fn newest_manifest(dir: &Path) -> io::Result<Option<PathBuf>> {
    if !dir.is_dir() {
        return Ok(None);
    }
    let mut newest: Option<(u32, PathBuf)> = None;
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        let version = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix('v')?.strip_suffix(".json")?.parse::<u32>().ok());
        if let Some(v) = version
            && newest.as_ref().is_none_or(|(n, _)| v > *n)
        {
            newest = Some((v, path));
        }
    }
    Ok(newest.map(|(_, p)| p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(root: &Path, path: &str, json: &str) {
        let file = root.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, json).unwrap();
    }

    fn manifest(id: &str, depends: &[&str]) -> String {
        let depends: Vec<String> = depends.iter().map(|d| format!("\"{d}\":1")).collect();
        format!(r#"{{"format":"openquote.pack/0","pack":"{id}","version":1,"label":"{id}","depends":{{{}}},"provides":[]}}"#, depends.join(","))
    }

    /// A bundle of four packs: `base`, `region` and `field` on it, `local` on both; tracks over `local` and `region`.
    fn bundle() -> (tempfile::TempDir, Bundle) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        put(root, "base/packs/base/v1.json", &manifest("base", &[]));
        put(root, "base/schemes/core/v1.json", r#"{"core":1}"#);
        put(root, "region/packs/region/v1.json", &manifest("region", &["base"]));
        put(root, "field/packs/field/v1.json", &manifest("field", &["base"]));
        put(root, "local/packs/local/v1.json", &manifest("local", &["field", "region"]));
        put(root, "local/schemes/topic/v1.json", r#"{"topic":1}"#);
        put(root, "local/reports/monthly/v1.json", r#"{"monthly":1}"#);
        put(
            root,
            "tracks.json",
            r#"{"tracks":[{"id":"local","packs":["local"],"locale":"fr","label":{"fr":"Local","en":"Local track"}},
                          {"id":"plain","packs":["region"],"locale":"en","label":{"en":"Plain"}}]}"#,
        );
        let bundle = Bundle::read(root).unwrap();
        (dir, bundle)
    }

    fn names(dirs: &[PathBuf]) -> Vec<String> {
        dirs.iter().map(|d| d.file_name().unwrap().to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn names_the_packs_a_vault_holds_an_earlier_version_of() {
        let (dir, _) = bundle();
        put(dir.path(), "region/packs/region/v2.json", &manifest("region", &["base"]).replace(r#""version":1"#, r#""version":2"#));
        let bundle = Bundle::read(dir.path()).unwrap();

        assert_eq!(bundle.newer([("region", 1), ("base", 1), ("elsewhere", 1)]), ["region"]);
        assert!(bundle.newer([("region", 2), ("base", 3)]).is_empty(), "a vault at or past the bundled version takes nothing on");
    }

    #[test]
    fn a_track_brings_the_packs_it_builds_on_in_dependency_order() {
        let (_dir, bundle) = bundle();
        assert_eq!(names(&bundle.track_packs("local").unwrap()), ["base", "field", "region", "local"]);
        assert_eq!(names(&bundle.track_packs("plain").unwrap()), ["base", "region"]);
    }

    #[test]
    fn a_track_naming_a_pack_the_bundle_lacks_is_an_error() {
        let (_dir, bundle) = bundle();
        assert!(matches!(bundle.closure(&["nowhere".to_owned()]), Err(BundleError::MissingPack(id)) if id == "nowhere"));
        assert!(matches!(bundle.track_packs("nowhere"), Err(BundleError::UnknownTrack(_))));
    }

    #[test]
    fn packs_that_build_on_each_other_in_a_circle_are_an_error() {
        let (dir, _) = bundle();
        put(dir.path(), "base/packs/base/v2.json", &manifest("base", &["local"]));
        let bundle = Bundle::read(dir.path()).unwrap();
        assert!(matches!(bundle.track_packs("local"), Err(BundleError::Cycle(_))));
    }

    #[test]
    fn an_earlier_vault_is_adopted_by_the_track_whose_files_it_holds_unchanged() {
        let (_dir, bundle) = bundle();
        let held = |path: &str| match path {
            "schemes/topic/v1.json" => Some(br#"{"topic":1}"#.to_vec()),
            "reports/monthly/v1.json" => Some(br#"{"monthly":1}"#.to_vec()),
            "schemes/topic/v2.json" => Some(b"anything".to_vec()), // not a bundled file: it does not count
            _ => None,
        };
        assert_eq!(bundle.adoption(&held).unwrap().map(|t| t.id.as_str()), Some("local"));
    }

    #[test]
    fn a_vault_whose_files_differ_is_not_adopted() {
        let (_dir, bundle) = bundle();
        let held = |path: &str| match path {
            "schemes/topic/v1.json" => Some(br#"{"topic":1}"#.to_vec()),
            "reports/monthly/v1.json" => Some(br#"{"monthly":"edited"}"#.to_vec()),
            _ => None,
        };
        assert_eq!(bundle.adoption(&held).unwrap(), None);
    }

    #[test]
    fn a_vault_sharing_no_file_is_not_adopted() {
        let (_dir, bundle) = bundle();
        assert_eq!(bundle.adoption(&|_: &str| None).unwrap(), None);
    }

    #[test]
    fn the_first_track_speaking_the_windows_language_is_offered_first() {
        let (_dir, bundle) = bundle();
        assert_eq!(bundle.default_track("en-GB").unwrap().id, "plain");
        assert_eq!(bundle.default_track("fr").unwrap().id, "local");
        assert_eq!(bundle.default_track("ja").unwrap().id, "local");
        assert_eq!(bundle.tracks()[1].label_in("ko"), "Plain");
    }

    #[test]
    fn the_bundled_packs_read_and_every_track_closes() {
        let bundle = Bundle::read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs")).unwrap();
        assert!(!bundle.tracks().is_empty());
        for track in bundle.tracks() {
            let packs = bundle.track_packs(&track.id).unwrap();
            assert!(!packs.is_empty(), "{}", track.id);
        }
    }
}

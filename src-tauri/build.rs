use std::{env, fs, path::Path};

fn main() {
    // tauri-build copies each resource next to the binary (`tauri.conf.json` maps `../packs` to `packs`) and
    // never removes a file the source no longer has: a pack file deleted, or left by a build of another
    // branch, would still be read by a development or test build. Starting from no copy makes it the
    // source's again; the directory is watched so that a file removed from it runs this again.
    println!("cargo:rerun-if-changed=../packs");
    if let Some(profile) = env::var_os("OUT_DIR").as_deref().map(Path::new).and_then(|out| out.ancestors().nth(3)) {
        let _ = fs::remove_dir_all(profile.join("packs"));
    }
    tauri_build::build()
}

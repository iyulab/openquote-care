//! The desktop shell: Tauri commands over the vault and the engine sidecar.

mod app;

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::{Manager, State};

pub use app::{App, AppError, device_id};

/// A failed command as the window receives it: a code to choose wording by, and the shell's own
/// description for logs.
#[derive(Debug, Serialize)]
struct CommandError {
    code: &'static str,
    message: String,
}

impl From<AppError> for CommandError {
    fn from(e: AppError) -> Self {
        CommandError { code: e.code(), message: e.to_string() }
    }
}

type CommandResult<T> = Result<T, CommandError>;

fn text<T>(r: Result<T, AppError>) -> CommandResult<T> {
    r.map_err(CommandError::from)
}

#[tauri::command]
fn create_vault(folder: String, passphrase: String, app: State<App>, handle: tauri::AppHandle) -> CommandResult<String> {
    let pack = pack_dir(&handle);
    text(app.create_vault(&PathBuf::from(folder), passphrase, &pack))
}

#[tauri::command]
fn confirm_recovery_kit(typed: String, app: State<App>) -> CommandResult<()> {
    text(app.confirm_recovery_kit(&typed))
}

#[tauri::command]
fn open_vault(folder: String, passphrase: String, app: State<App>) -> CommandResult<Value> {
    text(app.open_vault(&PathBuf::from(folder), passphrase))
}

#[tauri::command]
fn close_vault(app: State<App>) {
    app.close_vault();
}

#[tauri::command]
fn record(route: String, request: Value, app: State<App>) -> CommandResult<String> {
    text(app.record(&route, request))
}

#[tauri::command]
fn entities(entity_type: String, app: State<App>) -> CommandResult<Value> {
    text(app.entities(&entity_type))
}

#[tauri::command]
fn apply_pack(folder: String, app: State<App>) -> CommandResult<Vec<String>> {
    text(app.apply_pack(&PathBuf::from(folder)))
}

#[tauri::command]
fn resolve(target_version: u32, values: Value, app: State<App>) -> CommandResult<Value> {
    text(app.resolve(target_version, values))
}

#[tauri::command]
fn runs(app: State<App>) -> CommandResult<Value> {
    text(app.runs())
}

#[tauri::command]
fn compare_runs(earlier: String, later: String, app: State<App>) -> CommandResult<Value> {
    text(app.compare_runs(&earlier, &later))
}

#[tauri::command]
fn refresh(app: State<App>) -> CommandResult<Value> {
    text(app.refresh())
}

#[tauri::command]
fn vault_summary(app: State<App>) -> CommandResult<Value> {
    text(app.summary())
}

#[tauri::command]
fn schemes(app: State<App>) -> CommandResult<Value> {
    text(app.schemes())
}

#[tauri::command]
fn run_report(report: String, version: u32, year: i32, month: u32, app: State<App>) -> CommandResult<Value> {
    text(app.run_report(&report, version, year, month))
}

/// The data pack a new vault starts from: bundled with the app, or the source tree in development.
fn pack_dir(handle: &tauri::AppHandle) -> PathBuf {
    handle
        .path()
        .resource_dir()
        .map(|d| d.join("packs").join("care-kr"))
        .ok()
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../packs/care-kr"))
}

/// The engine sidecar: `OPENQUOTE_SIDECAR_EXE` in development; in an installed app, the copy
/// bundled with it (`src-tauri/tauri.bundle.conf.json`).
fn sidecar_path(handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("OPENQUOTE_SIDECAR_EXE") {
        return PathBuf::from(p);
    }
    let resources = handle.path().resource_dir().unwrap_or_default();
    bundled_sidecar(&resources)
}

/// Where the installer puts the sidecar among the app's resources.
fn bundled_sidecar(resources: &std::path::Path) -> PathBuf {
    let name = if cfg!(windows) { "openquote-care-sidecar.exe" } else { "openquote-care-sidecar" };
    resources.join("sidecar").join(name)
}

/// Brings the running window forward when the app is started again. One window per device: a
/// second window would write changes under the same device id as the first without either seeing
/// the other's unsaved state.
#[cfg(desktop)]
fn bring_forward(handle: &tauri::AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Registered first, so a second start ends before anything else runs.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|handle, _args, _cwd| bring_forward(handle)));
    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|tauri_app| {
            let config = tauri_app.path().app_local_data_dir()?;
            let device = device_id(&config)?;
            tauri_app.manage(App::new(sidecar_path(tauri_app.handle()), device));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_vault,
            confirm_recovery_kit,
            open_vault,
            close_vault,
            record,
            entities,
            schemes,
            vault_summary,
            apply_pack,
            resolve,
            runs,
            refresh,
            compare_runs,
            run_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running Openquote Care");
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_bundled_sidecar_is_where_the_bundle_config_puts_it() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.bundle.conf.json")).unwrap();
        let resources = config["bundle"]["resources"].as_object().unwrap();
        let placed = resources.values().filter_map(|v| v.as_str()).find(|v| v.starts_with("sidecar/")).unwrap();
        assert_eq!(super::bundled_sidecar(std::path::Path::new("")), std::path::Path::new(placed));
    }
}

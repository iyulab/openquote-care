//! The desktop shell: Tauri commands over the vault and the engine sidecar.

mod app;

use std::path::PathBuf;

use serde_json::Value;
use tauri::{Manager, State};

pub use app::{App, AppError, device_id};

type CommandResult<T> = Result<T, String>;

fn text<T>(r: Result<T, AppError>) -> CommandResult<T> {
    r.map_err(|e| e.to_string())
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

/// The engine sidecar: `OPENQUOTE_SIDECAR_EXE` in development, otherwise next to the app.
fn sidecar_path() -> PathBuf {
    if let Ok(p) = std::env::var("OPENQUOTE_SIDECAR_EXE") {
        return PathBuf::from(p);
    }
    let name = if cfg!(windows) { "openquote-care-sidecar.exe" } else { "openquote-care-sidecar" };
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join(name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|tauri_app| {
            let config = tauri_app.path().app_local_data_dir()?;
            let device = device_id(&config)?;
            tauri_app.manage(App::new(sidecar_path(), device));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_vault,
            confirm_recovery_kit,
            open_vault,
            close_vault,
            record,
            entities,
            run_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running Openquote Care");
}

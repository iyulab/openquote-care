//! The desktop shell: Tauri commands over the vault and the engine sidecar.

mod app;
mod bundle;
mod diagnostics;
mod feedback;
pub mod locale;
pub mod runtime;
mod updates;
mod window;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, State};

pub use app::{App, AppError, device_id};
pub use bundle::Bundle;

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

/// Hands a command's outcome to the window. A failure that is the app's own fault is also
/// reported (see [`diagnostics`]), naming the command by where it called this.
#[track_caller]
fn text<T>(r: Result<T, AppError>) -> CommandResult<T> {
    let at = std::panic::Location::caller();
    r.map_err(|e| {
        let (status, fault) = match &e {
            AppError::Engine(openquote_care_engine::EngineError::Status(status, _, fault)) => (Some(*status), fault.as_ref()),
            _ => (None, None),
        };
        diagnostics::command_failed(e.code(), at, status, fault);
        CommandError::from(e)
    })
}

#[tauri::command]
fn create_vault(folder: String, passphrase: String, track: Option<String>, app: State<App>) -> CommandResult<String> {
    // Without a choice, the track the window's language suggests.
    let track = track.or_else(|| app.default_track(&locale::ui_locale()).map(|t| t.id.clone())).unwrap_or_default();
    text(app.create_vault(&PathBuf::from(folder), passphrase, &track))
}

/// A track as the window offers it: its id, and its name in the app's language.
#[derive(Serialize)]
struct TrackView {
    id: String,
    label: String,
    locale: String,
}

#[tauri::command]
fn tracks(app: State<App>) -> Vec<TrackView> {
    let tag = locale::ui_locale();
    let first = app.default_track(&tag).map(|t| t.id.clone());
    // The suggested track first, then the rest in the bundle's order.
    let mut views: Vec<TrackView> =
        app.tracks().iter().map(|t| TrackView { id: t.id.clone(), label: t.label_in(&tag), locale: t.locale.clone() }).collect();
    views.sort_by_key(|v| Some(&v.id) != first.as_ref());
    views
}

#[tauri::command]
fn confirm_recovery_kit(typed: String, app: State<App>) -> CommandResult<()> {
    text(app.confirm_recovery_kit(&typed))
}

#[tauri::command]
fn restore_declaration(folder: String, app: State<App>) -> CommandResult<()> {
    text(app.restore_declaration(&PathBuf::from(folder)))
}

#[tauri::command]
fn open_vault(folder: String, passphrase: String, app: State<App>) -> CommandResult<Value> {
    text(app.open_vault(&PathBuf::from(folder), passphrase))
}

#[tauri::command]
fn open_vault_with_key(folder: String, recovery_key: String, app: State<App>) -> CommandResult<Value> {
    text(app.open_vault_with_key(&PathBuf::from(folder), &recovery_key))
}

#[tauri::command]
fn change_passphrase(passphrase: String, app: State<App>) -> CommandResult<()> {
    text(app.change_passphrase(passphrase))
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
fn history(entity_type: String, app: State<App>) -> CommandResult<Value> {
    text(app.history(&entity_type))
}

#[tauri::command]
fn cases(app: State<App>) -> CommandResult<Value> {
    text(app.cases())
}

#[tauri::command]
fn scales(app: State<App>) -> CommandResult<Value> {
    text(app.scales())
}

#[tauri::command]
fn scale_summary(from: String, to: String, app: State<App>) -> CommandResult<Value> {
    text(app.scale_summary(&from, &to))
}

#[tauri::command]
fn apply_pack(folder: String, raise_format: Option<bool>, app: State<App>) -> CommandResult<Vec<String>> {
    text(app.apply_pack(&PathBuf::from(folder), raise_format.unwrap_or(false)))
}

#[tauri::command]
fn add_local_item(scheme: String, date: String, label: String, anchor: String, raise_format: Option<bool>, form_suffix: String, app: State<App>) -> CommandResult<Vec<String>> {
    text(app.add_local_item(&scheme, &date, &label, &anchor, raise_format.unwrap_or(false), &form_suffix))
}

#[tauri::command]
fn write_local_forms(form_suffix: String, app: State<App>) -> CommandResult<Vec<String>> {
    text(app.write_local_forms(&form_suffix))
}

#[tauri::command]
fn update_bundled_packs(app: State<App>) -> CommandResult<Vec<String>> {
    text(app.update_bundled_packs())
}

#[tauri::command]
fn pending(report: String, version: u32, records: Value, to: Option<String>, app: State<App>) -> CommandResult<Value> {
    text(app.pending(&report, version, records, to.as_deref()))
}

#[tauri::command]
fn carry(entity_type: String, subject: String, date: String, app: State<App>) -> CommandResult<Value> {
    text(app.carry(&entity_type, &subject, &date))
}

#[tauri::command]
fn suggestions(entity_type: String, date: String, fields: Value, app: State<App>) -> CommandResult<Value> {
    text(app.suggestions(&entity_type, &date, fields))
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
fn set_backup(folder: Option<String>, app: State<App>) -> CommandResult<Value> {
    text(app.set_backup(folder.map(PathBuf::from).as_deref()))
}

/// One file of a plain copy, as the window made it.
#[derive(Deserialize)]
struct PlainFile {
    name: String,
    content: String,
}

#[tauri::command]
fn write_plain_copy(folder: String, name: String, files: Vec<PlainFile>, app: State<App>) -> CommandResult<String> {
    let files: Vec<(String, Vec<u8>)> = files.into_iter().map(|f| (f.name, f.content.into_bytes())).collect();
    text(app.write_plain_copy(Path::new(&folder), &name, &files))
}

#[tauri::command]
fn restore_from_backup(app: State<App>) -> CommandResult<Value> {
    text(app.restore_from_backup())
}

#[tauri::command]
fn replace_damaged_from_backup(app: State<App>) -> CommandResult<Value> {
    text(app.replace_damaged_from_backup())
}

#[tauri::command]
fn backup_status(app: State<App>) -> Value {
    app.backup_status()
}

#[tauri::command]
fn ui_locale() -> String {
    locale::ui_locale()
}

#[tauri::command]
fn diagnostics_status() -> diagnostics::Status {
    diagnostics::status()
}

#[tauri::command]
fn diagnostics_reports() -> CommandResult<diagnostics::Lines> {
    text(diagnostics::lines().map_err(AppError::from))
}

/// The screen the window shows now, by its fixed name, or none while the window is hidden — so
/// the session can keep time on each screen (and nothing about what a screen shows).
#[tauri::command]
fn screen_shown(name: Option<String>) {
    diagnostics::screen(name.as_deref());
}

/// An error the window did not handle: its type name and stack, of which the report keeps only
/// what the diagnostics allow.
#[tauri::command]
fn report_window_error(kind: String, stack: String) {
    diagnostics::window_failed(&kind, &stack);
}

#[tauri::command]
fn feedback_status() -> feedback::Status {
    feedback::status()
}

/// Sends what the person wrote to the publisher, off the window's thread: the person waits on the
/// answer, and the window stays responsive while they do.
#[tauri::command]
async fn send_feedback(message: String, email: Option<String>) -> CommandResult<()> {
    let sent = tauri::async_runtime::spawn_blocking(move || {
        let destination = feedback::configured().ok_or(feedback::Problem::NotConfigured)?;
        let record = feedback::record(&message, email.as_deref(), &locale::ui_locale())?;
        feedback::send(&destination, &record)
    })
    .await
    .unwrap_or(Err(feedback::Problem::Network));
    sent.map_err(|problem| {
        // A refusal is the app's own fault (its key or address), and every send would meet it.
        if let feedback::Problem::Refused(status) = problem {
            diagnostics::command_failed(problem.code(), std::panic::Location::caller(), Some(status), None);
        }
        CommandError { code: problem.code(), message: problem.to_string() }
    })
}

#[tauri::command]
fn update_status(updates: State<updates::Updates>) -> updates::Status {
    updates.status()
}

#[tauri::command]
fn set_update_checking(on: bool, updates: State<updates::Updates>, handle: tauri::AppHandle) -> CommandResult<()> {
    text(updates.set_checking(on).map_err(AppError::from))?;
    if on {
        updates::check_now(handle);
    }
    Ok(())
}

/// Installs the newer version found: the vault is closed first, and the app ends and starts
/// again as the new version. Returns only when that could not happen.
#[tauri::command]
async fn apply_update(handle: tauri::AppHandle) -> CommandResult<()> {
    let closing = handle.clone();
    updates::apply(&handle, move || closing.state::<App>().close_vault())
        .await
        .map_err(|message| CommandError { code: "update", message })
}

#[tauri::command]
fn vault_summary(app: State<App>) -> CommandResult<Value> {
    text(app.summary())
}

#[tauri::command]
fn fields(entity_type: String, app: State<App>) -> CommandResult<Value> {
    text(app.fields(&entity_type))
}

#[tauri::command]
fn in_force(scheme: String, date: String, app: State<App>) -> CommandResult<Option<u32>> {
    text(app.in_force(&scheme, &date))
}

#[tauri::command]
fn schemes(app: State<App>) -> CommandResult<Value> {
    text(app.schemes())
}

#[tauri::command]
fn run_export(export: String, version: u32, from: String, to: String, app: State<App>) -> CommandResult<Value> {
    text(app.run_export(&export, version, &from, &to))
}

#[tauri::command]
fn run_report(report: String, version: u32, from: String, to: Option<String>, app: State<App>) -> CommandResult<Value> {
    text(app.run_report(&report, version, &from, to.as_deref()))
}

/// The data packs bundled with the app, or the source tree's in development. A bundle that cannot
/// be read leaves no track to make a vault on — said when one is made — and still opens vaults.
fn bundled_packs(handle: &tauri::AppHandle) -> Bundle {
    let root = handle
        .path()
        .resource_dir()
        .map(|d| d.join("packs"))
        .ok()
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../packs"));
    Bundle::read(&root).unwrap_or_default()
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
    if let Some(window) = handle.get_webview_window(window::MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The event the window hears when another device (or a sync client) changed the open vault.
const VAULT_CHANGED: &str = "vault-changed";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    diagnostics::install(&context.config().identifier);
    // Only the release build carries the updater's key; without it the plugin is not registered.
    let can_update = updates::configured(context.config());
    // Tauri would stop with an English message of its own; say it in the person's language first.
    if let Some(message) = runtime::check() {
        runtime::alert(&message);
        // The person has read the message by now; the report gets a moment more to go out.
        diagnostics::webview_missing(std::time::Duration::from_secs(5));
        std::process::exit(1);
    }
    let builder = tauri::Builder::default();
    // Registered first, so a second start ends before anything else runs.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|handle, _args, _cwd| bring_forward(handle)));
    #[cfg(desktop)]
    let builder = if can_update { builder.plugin(tauri_plugin_updater::Builder::new().build()) } else { builder };
    builder
        .plugin(tauri_plugin_dialog::init())
        // Minimised, no screen is in view: the session stops keeping time until it is back.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(_) = event {
                diagnostics::minimised(window.is_minimized().unwrap_or(false));
            }
        })
        .setup(move |tauri_app| {
            window::build_main(tauri_app)?;
            let config = tauri_app.path().app_local_data_dir()?;
            tauri_app.manage(updates::Updates::new(can_update, &config));
            if can_update {
                updates::watch(tauri_app.handle().clone());
            }
            let device = device_id(&config)?;
            let handle = tauri_app.handle().clone();
            let app = App::new(sidecar_path(tauri_app.handle()), device)
                .with_bundle(bundled_packs(tauri_app.handle()))
                .on_outside_change(move || {
                    let _ = handle.emit(VAULT_CHANGED, ());
                });
            // What this installation is set up for: the track a new vault starts from in the
            // window's language (a vault's own track is not known until one is open).
            let locale = locale::ui_locale();
            let track = app.default_track(&locale).map_or("none", |t| t.id.as_str()).to_owned();
            diagnostics::start_session(&locale, &track);
            tauri_app.manage(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_vault,
            confirm_recovery_kit,
            open_vault,
            open_vault_with_key,
            change_passphrase,
            close_vault,
            record,
            entities,
            schemes,
            fields,
            in_force,
            vault_summary,
            update_status,
            set_update_checking,
            apply_update,
            diagnostics_status,
            diagnostics_reports,
            report_window_error,
            screen_shown,
            feedback_status,
            send_feedback,
            ui_locale,
            tracks,
            apply_pack,
            add_local_item,
            write_local_forms,
            update_bundled_packs,
            pending,
            suggestions,
            carry,
            runs,
            refresh,
            set_backup,
            backup_status,
            restore_declaration,
            restore_from_backup,
            replace_damaged_from_backup,
            write_plain_copy,
            history,
            cases,
            scales,
            scale_summary,
            compare_runs,
            run_report,
            run_export,
        ])
        .build(context)
        .expect("error while running Openquote Care")
        .run(|handle, event| {
            // The session ends as the app does: before the engine stops, and before an update
            // waiting for the app to close is installed. It gets a moment to go out; what does
            // not stays for the next launch. Then a downloaded update is installed, the vault
            // closed first, and the app is not started again — the person closed it.
            if let tauri::RunEvent::Exit = event {
                diagnostics::end_session(std::time::Duration::from_millis(1500));
                updates::install_on_close(handle, || handle.state::<App>().close_vault());
            }
        });
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

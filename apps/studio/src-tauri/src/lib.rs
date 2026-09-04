mod packs;
mod projects;
mod signing;
mod sidecar;

use std::sync::Mutex;

use packs::{InstalledPack, PackStore};
use signing::Trust;
use projects::{ProjectMeta, ProjectPayload, Store};
use sidecar::SidecarState;
use tauri::{Manager, RunEvent};

struct StoreState(Mutex<Store>);
struct PackState(Mutex<PackStore>);

#[tauri::command]
fn list_projects(state: tauri::State<StoreState>) -> Result<Vec<ProjectMeta>, String> {
    state.0.lock().map_err(|e| e.to_string())?.list()
}

#[tauri::command]
fn create_project(
    state: tauri::State<StoreState>,
    name: String,
    payload: ProjectPayload,
) -> Result<ProjectMeta, String> {
    state.0.lock().map_err(|e| e.to_string())?.create(&name, &payload)
}

#[tauri::command]
fn save_project(
    state: tauri::State<StoreState>,
    id: String,
    payload: ProjectPayload,
) -> Result<ProjectMeta, String> {
    state.0.lock().map_err(|e| e.to_string())?.save(&id, &payload)
}

#[tauri::command]
fn load_project(
    state: tauri::State<StoreState>,
    id: String,
) -> Result<(ProjectMeta, ProjectPayload), String> {
    state.0.lock().map_err(|e| e.to_string())?.load(&id)
}

#[tauri::command]
fn delete_project(state: tauri::State<StoreState>, id: String) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.delete(&id)
}

#[tauri::command]
fn list_packs(state: tauri::State<PackState>) -> Result<Vec<InstalledPack>, String> {
    state.0.lock().map_err(|e| e.to_string())?.list()
}

/// How far a pack can be trusted before installing it, so the studio can ask
/// for confirmation on anything unsigned or from an unknown publisher.
#[tauri::command]
fn check_pack_signature(
    id: String,
    version: String,
    sha256: String,
    size_bytes: u64,
    signature: Option<String>,
    key_id: Option<String>,
) -> Trust {
    let trusted: Vec<(String, String)> = signing::BUILTIN_KEYS
        .iter()
        .map(|(id, key)| ((*id).to_string(), (*key).to_string()))
        .collect();
    signing::verify_pack(
        &id,
        &version,
        &sha256,
        size_bytes,
        signature.as_deref(),
        key_id.as_deref(),
        &trusted,
    )
}

/// Install a pack from an already-downloaded archive. The frontend fetches the
/// bytes (so a school server on the LAN works with no extra plumbing) and this
/// side verifies the digest before anything touches the pack directory.
///
/// A signature that does not match the manifest is refused outright: unlike an
/// unsigned pack, it means the bytes are not what the publisher approved.
#[tauri::command]
fn install_pack(
    state: tauri::State<PackState>,
    id: String,
    version: String,
    sha256: String,
    size_bytes: Option<u64>,
    signature: Option<String>,
    key_id: Option<String>,
    archive: Vec<u8>,
) -> Result<InstalledPack, String> {
    let trust = check_pack_signature(
        id.clone(),
        version.clone(),
        sha256.clone(),
        size_bytes.unwrap_or(archive.len() as u64),
        signature,
        key_id,
    );
    if trust == Trust::Invalid {
        return Err(format!(
            "{id} {version}: the signature does not match this archive; refusing to install"
        ));
    }

    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .install(&id, &version, &archive, &sha256)
}

#[tauri::command]
fn uninstall_pack(state: tauri::State<PackState>, id: String) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.uninstall(&id)
}

/// Reads a single file out of an installed pack by its own relative path
/// (e.g. "pack.json", or one of the paths its own contents.robot_defs
/// array names) -- Robot Builder Phase 8. Generic over content type; the
/// frontend is what knows to parse the bytes as a robot-def document.
#[tauri::command]
fn read_pack_file(state: tauri::State<PackState>, id: String, path: String) -> Result<Vec<u8>, String> {
    state.0.lock().map_err(|e| e.to_string())?.read_file(&id, &path)
}

/// Writes an exported robot-def (or, in the future, world-def) document to
/// a path the student picked via the native save dialog
/// (@tauri-apps/plugin-dialog's `save()`, frontend-side) -- Robot Builder
/// Phase 8. A bare write to an arbitrary path, unlike every other
/// filesystem command in this module, which are all confined to
/// app_data_dir()-managed directories -- this one is exactly what a native
/// "Save As" is for.
#[tauri::command]
fn export_robot_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            save_project,
            load_project,
            delete_project,
            list_packs,
            install_pack,
            uninstall_pack,
            check_pack_signature,
            read_pack_file,
            export_robot_file
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app.path().app_data_dir()?;
            let store = Store::open(data_dir.clone()).map_err(std::io::Error::other)?;
            app.manage(StoreState(Mutex::new(store)));

            let packs = PackStore::new(data_dir.join("packs")).map_err(std::io::Error::other)?;
            app.manage(PackState(Mutex::new(packs)));

            // Start the Python sidecar so students' Python works out of the box.
            let child = sidecar::resolve(app.path().resource_dir().ok())
                .map(|resolution| sidecar::spawn(&resolution));
            match child {
                Some(Ok(process)) => {
                    log::info!("python sidecar started (pid {})", process.id());
                    app.manage(SidecarState(Mutex::new(Some(process))));
                }
                Some(Err(error)) => {
                    log::warn!("python sidecar failed to start: {error}");
                    app.manage(SidecarState(Mutex::new(None)));
                }
                None => {
                    log::warn!("python runtime not found; sidecar not started");
                    app.manage(SidecarState(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                sidecar::stop(&state);
            }
        }
    });
}

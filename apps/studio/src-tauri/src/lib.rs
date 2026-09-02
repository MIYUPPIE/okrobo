mod projects;
mod sidecar;

use std::sync::Mutex;

use projects::{ProjectMeta, ProjectPayload, Store};
use sidecar::SidecarState;
use tauri::{Manager, RunEvent};

struct StoreState(Mutex<Store>);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            save_project,
            load_project,
            delete_project
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
            let store = Store::open(data_dir).map_err(std::io::Error::other)?;
            app.manage(StoreState(Mutex::new(store)));

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

//! Spawns and stops the OKROBO Python sidecar (contracts/robot-remote/v0).
//!
//! Interpreter and runtime resolution, in order:
//!   1. bundled: <resources>/runtime-dist/cpython/bin/python3 with
//!      <resources>/runtime-python (packaged installs, fully offline)
//!   2. system python3 with <resources>/runtime-python (packaged, no bundle)
//!   3. dev: system python3 with <repo>/runtime/python (cargo/tauri dev)

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

pub struct SidecarState(pub Mutex<Option<Child>>);

pub struct Resolution {
    pub python: PathBuf,
    pub runtime_dir: PathBuf,
    /// firmware/okrobo_car, wherever this install keeps it — read by
    /// okrobo.sidecar's flash_firmware op (arduino-cli compile + upload).
    pub firmware_dir: PathBuf,
}

pub fn resolve(resource_dir: Option<PathBuf>) -> Option<Resolution> {
    if let Some(resources) = resource_dir {
        let bundled_python = resources.join("runtime-dist/cpython/bin/python3");
        let runtime = resources.join("runtime-python");
        if runtime.join("okrobo/sidecar.py").exists() {
            let python = if bundled_python.exists() {
                bundled_python
            } else {
                PathBuf::from("python3")
            };
            return Some(Resolution {
                python,
                runtime_dir: runtime,
                firmware_dir: resources.join("firmware/okrobo_car"),
            });
        }
    }
    // Dev fallback: the repo checkout relative to src-tauri.
    let dev_runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/python");
    if dev_runtime.join("okrobo/sidecar.py").exists() {
        return Some(Resolution {
            python: PathBuf::from("python3"),
            runtime_dir: dev_runtime,
            firmware_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../firmware/okrobo_car"),
        });
    }
    None
}

fn build_command(resolution: &Resolution) -> Command {
    let mut command = Command::new(&resolution.python);
    command
        .args(["-m", "okrobo.sidecar"])
        .current_dir(&resolution.runtime_dir)
        .env("OKROBO_FIRMWARE_DIR", &resolution.firmware_dir)
        // Inherited python env must not leak into the sidecar: the AppImage
        // runtime exports PYTHONHOME for the GTK stack, and user shells may
        // carry PYTHONPATH (e.g. ROS). Both break the bundled interpreter.
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Tie the sidecar's life to ours: RunEvent::Exit covers a normal
        // quit, but a SIGTERM/SIGKILL on the app skips it. The kernel then
        // delivers SIGTERM to the child when this process dies, however it dies.
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                Ok(())
            });
        }
    }
    command
}

pub fn spawn(resolution: &Resolution) -> std::io::Result<Child> {
    build_command(resolution).spawn()
}

pub fn stop(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_resolution_finds_repo_runtime() {
        let resolution = resolve(None).expect("dev runtime should resolve in the repo");
        assert!(resolution.runtime_dir.join("okrobo/sidecar.py").exists());
        assert_eq!(resolution.python, PathBuf::from("python3"));
        assert!(
            resolution.firmware_dir.join("okrobo_car.ino").exists(),
            "dev firmware_dir should point at the real firmware/okrobo_car sketch"
        );
    }

    #[test]
    fn bundled_runtime_wins_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        std::fs::create_dir_all(resources.join("runtime-python/okrobo")).unwrap();
        std::fs::write(resources.join("runtime-python/okrobo/sidecar.py"), "").unwrap();
        std::fs::create_dir_all(resources.join("runtime-dist/cpython/bin")).unwrap();
        std::fs::write(resources.join("runtime-dist/cpython/bin/python3"), "").unwrap();
        let resolution = resolve(Some(resources.clone())).unwrap();
        assert_eq!(
            resolution.python,
            resources.join("runtime-dist/cpython/bin/python3")
        );
        assert_eq!(resolution.runtime_dir, resources.join("runtime-python"));
        assert_eq!(resolution.firmware_dir, resources.join("firmware/okrobo_car"));
    }

    #[test]
    fn packaged_without_bundle_falls_back_to_system_python() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        std::fs::create_dir_all(resources.join("runtime-python/okrobo")).unwrap();
        std::fs::write(resources.join("runtime-python/okrobo/sidecar.py"), "").unwrap();
        let resolution = resolve(Some(resources)).unwrap();
        assert_eq!(resolution.python, PathBuf::from("python3"));
    }

    #[test]
    fn spawn_passes_firmware_dir_as_an_env_var() {
        // Inspect the real Command spawn() builds, not a duplicate of it.
        let resolution = resolve(None).expect("dev runtime should resolve in the repo");
        let command = build_command(&resolution);
        let found = command.get_envs().any(|(key, value)| {
            key == "OKROBO_FIRMWARE_DIR" && value == Some(resolution.firmware_dir.as_os_str())
        });
        assert!(found, "OKROBO_FIRMWARE_DIR should be set to firmware_dir");
    }
}

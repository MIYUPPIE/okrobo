# Decision: cross-platform desktop builds (Linux, Windows, macOS)

**Date:** 2026-09-12

## Scope

The desktop app (`scripts/build-desktop.sh`, `apps/studio/src-tauri/`) had only ever been built and tested on Linux: deb + AppImage, a hardcoded `x86_64-unknown-linux-gnu` python-build-standalone target in `fetch-python-runtime.sh`, and `sidecar.rs`'s interpreter resolution baked in `bin/python3` and `PR_SET_PDEATHSIG` (a Linux-only `prctl(2)` option). Schools running Windows or macOS laptops — the actual majority case — had no installer at all. This closes that gap: the same scripts, unmodified, now produce a native installer on any of the three OSes, plus a GitHub Actions matrix that builds all three from one push.

## Why native runners, not cross-compiling

Cross-compiling Tauri's Rust binary is possible in principle, but the bundled Python runtime and its `.deps` (websockets, pyserial, mujoco — mujoco ships prebuilt platform-specific wheels with real compiled extensions) are not cross-compilable at all; they need the target OS's own wheel. Trying to cross-compile the Rust half while somehow separately obtaining native Python wheels for the other two OSes would be strictly more complex than just building on that OS's own machine. GitHub Actions provides free hosted runners for all three (`ubuntu-latest`, `windows-latest`, `macos-latest`), so `.github/workflows/build-desktop.yml` runs the exact same `fetch-python-runtime.sh` / `build-desktop.sh` a contributor would run locally, once per OS, with no Docker and no cross-compilation toolchain to maintain.

## The three real platform differences, found by reading `python-build-standalone`'s and Tauri's own layouts, not guessed

1. **Where the interpreter lives after extraction.** Every `python-build-standalone` release archive unpacks a top-level `python/` directory, but only the Windows release skips the `bin/` subdirectory: `python/bin/python3` on Linux and macOS, `python/python.exe` on Windows. `fetch-python-runtime.sh` extracts a `python_bin_for(target)` function for this exact branch; `sidecar.rs` mirrors it as `bundled_python_relpath_for(windows: bool)` (an explicit bool parameter rather than reading `cfg!(target_os = "windows")` directly inside the function, specifically so both branches are unit-testable from any one host OS — confirmed by two new tests, `bundled_python_relpath_differs_only_on_windows` / `system_python_differs_only_on_windows`, both of which run and pass on this Linux dev machine despite asserting the Windows branch's behavior too).
2. **The system-Python fallback name.** When no bundle is present, Linux/macOS installs put `python3` on PATH; Windows installs from python.org put `python` on PATH (no `python3.exe`). Same `_for(windows: bool)` pattern, same reasoning.
3. **`PR_SET_PDEATHSIG` does not exist outside Linux.** It's a Linux-only `prctl(2)` flag — not merely unsupported on macOS, but genuinely absent from `libc`'s macOS bindings, so the old `#[cfg(unix)]` guard would have failed to *compile* on macOS, not just behaved differently. Narrowed to `#[cfg(target_os = "linux")]`; macOS and Windows fall back entirely to `RunEvent::Exit`'s explicit `sidecar::stop()` on a normal quit, which was already the only mechanism `PR_SET_PDEATHSIG` supplemented (a hard kill/crash without a clean exit already couldn't rely on it as the sole safety net before this change either).

## The one Linux-only bundling wrinkle: mujoco's plugin `.so` files

`mujoco`'s Linux wheel ships optional plugin shared libraries (`plugin/*.so` — actuator/elasticity/sdf/sensor extensions) with a build-machine-absolute `RUNPATH` baked in (`/tmpfs/src/git/mujoco_internal/build/lib`), left over from however DeepMind's own CI built the wheel. A plain `python -c "import mujoco"` never notices: by the time a plugin `dlopen`s `libmujoco.so.3.9.0`, the main `mujoco` extension module has already loaded that library by soname, so the plugin's own broken `RUNPATH` is never consulted. `linuxdeploy` (which `tauri build` invokes to bundle the AppImage) does notice — it performs a static dependency walk of every `.so` it bundles, resolves `RUNPATH`s literally, can't find the build-machine path, and aborts the whole bundle with "Could not find dependency." `scripts/fix-mujoco-plugin-rpath.sh` repoints each plugin's `RUNPATH` at `$ORIGIN/..` (its real sibling `mujoco/` directory, one level up from `mujoco/plugin/`) with `patchelf`, run right before `tauri build` in both `build-desktop.sh` and the CI workflow. Confirmed this is Linux-only rather than assumed: macOS's equivalent (`@rpath`/`install_name` in the `.dylib`s) has the same kind of build-machine-absolute path baked in, but macOS's `.app`/`.dmg` bundler doesn't do `linuxdeploy`'s strict static walk, so nothing trips over it there; Windows's plugin DLLs resolve via the process's DLL search path at load time, not an embedded rpath, so there's nothing to patch on either of the other two platforms. The script checks `uname -s` and no-ops immediately on anything but Linux.

## Platform-specific bundle targets

Tauri's own `tauri.<platform>.conf.json` overlay mechanism (merged onto the base `tauri.conf.json` automatically, no extra flag needed) carries the one thing that has to differ per OS: which bundle format to produce. `tauri.macos.conf.json` → `["dmg", "app"]`, `tauri.windows.conf.json` → `["nsis"]`. The base config's own Linux target list (`deb`, `appimage`) is untouched.

## Unsigned builds, on purpose for V1

Neither Windows (Authenticode) nor macOS (Apple Developer ID) code-signing is configured — both cost real money and require an ongoing identity to maintain. Windows shows a SmartScreen warning and macOS a Gatekeeper warning on first launch; both are one-click-through, same as any indie app without a paid certificate, and neither blocks installation. Revisit once there's a real distribution channel that makes the cost worth it.

## Verification

- `scripts/lib/fetch-python-runtime-check.sh`: a new deterministic, network-free gate test that shadows `uname` to exercise `detect_target()`'s Linux / macOS-Intel / macOS-Apple-Silicon / Windows(Git Bash) branches and `python_bin_for()`'s two branches, all from this one Linux dev machine — plus a rejected-unsupported-OS case. Wired into `scripts/test-all.sh`.
- `sidecar.rs`: 2 new Rust unit tests for the OS-branching helpers (both pass on Linux while asserting Windows behavior, via the explicit-bool-parameter pattern above); the 3 existing resolution tests updated to call the same helpers instead of hardcoding `"python3"`, so they stay correct if the fallback name ever changes again.
- Ran the actual scripts for real on this machine (Linux): `fetch-python-runtime-check.sh` passes, `cargo test sidecar::` passes (6/6), and the full `test-all.sh` gate suite (ctest, pytest, the WASM+parity gates, `npm run test`, typecheck, build, both browser E2E checks) all green.
- Did **not** run an actual `tauri build` on Windows or macOS from this session (no such machine available here) — the `.github/workflows/build-desktop.yml` matrix is what proves those two for real, the first time it runs on GitHub's own hosted runners.

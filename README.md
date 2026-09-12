# OKROBO

OKHUB Robotics Studio: a local robotics development environment with a browser-like interface, working completely offline. For schools where internet is unreliable or expensive.

Students build programs in blocks or real Python, run them against a C++ simulated robot in 3D, and follow lessons — all with the network off.

- **[build.md](build.md)** is the master plan. Every session starts there.
- [docs/vision.md](docs/vision.md) holds the original vision notes.
- [docs/decisions/](docs/decisions/) records the decisions that shaped the build.

## Quick start

```bash
./scripts/setup.sh             # once per clone: emsdk, mujoco, node modules, python deps
./scripts/test-all.sh          # all gate suites
./scripts/check-dev-server.sh  # the dev server really loads the engine + 3D
cd apps/studio && npm run dev  # the studio
```

`setup.sh` never uses sudo. It installs what lives inside the repo and prints
anything left for you (Rust and the GTK/WebKit libraries, both needed only for
the desktop app).

Real Python execution needs the sidecar running (`./scripts/run-python-sidecar.sh`);
the studio shows `py ✓` in the status bar once it connects.

## Desktop app

Zero-install, no Docker: a native app any laptop can just double-click and
run, with a fully offline, bundled Python (no system Python, no internet)
so a real robot's students' programs work out of the box.

```bash
./scripts/fetch-python-runtime.sh   # once: bundle standalone CPython (offline installs)
./scripts/build-desktop.sh          # this OS's native installer, in apps/studio/src-tauri/target/release/bundle
```

Both scripts auto-detect the host OS/arch and run unmodified on Linux,
Windows, and macOS. Locally you only get an installer for the OS you're
running on; `.github/workflows/build-desktop.yml` builds all three at once
(one native GitHub Actions runner per OS — no cross-compiling, no
containers) and uploads them as workflow artifacts. Trigger it from the
Actions tab (Build Desktop App → Run workflow) or by pushing a `studio-v*`
tag, then hand out the matching download:

| Laptop | File | Run it |
|---|---|---|
| Linux | `okrobo-studio_*.AppImage` | `chmod +x`, then double-click (or `.deb` via your package manager) |
| Windows | `okrobo-studio_*-setup.exe` | run the installer |
| macOS | `okrobo-studio_*.dmg` | open, drag to Applications |

These builds are unsigned (no code-signing certificate configured), so
Windows shows a SmartScreen prompt and macOS a Gatekeeper prompt the first
time — click through once, same as any indie app without a paid cert.

## School server

One machine on the LAN serves packs to every studio, so a class downloads a pack once:

```bash
node scripts/build-pack-index.mjs   # archives + index.json in dist/packs
node scripts/school-server.mjs      # prints the LAN address to enter in File → Asset Store…
```

## Hardware

A physical car (`firmware/okrobo_car/`, any ESP32/Arduino-class board) speaks
the same protocol the simulator does, so an unmodified student program drives
either one. Flash it from the Hardware section in the studio's sidebar (needs
[arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/) on
PATH), or by hand — see [firmware/README.md](firmware/README.md).

## Layout

| Directory | What |
|---|---|
| `contracts/` | Versioned schemas every side mirrors (TS, Python, C++, Rust) |
| `apps/studio/` | React + TypeScript UI, and the Tauri desktop shell in `src-tauri/` |
| `engine/` | C++ simulation core (the only home of the sim math) |
| `runtime/python/` | `okrobo` student Python package and the sidecar |
| `packs/` | Worlds, robots (URDF), and lessons |
| `firmware/` | Physical car firmware — host-tested protocol parser + board-specific `.ino` |
| `scripts/` | Glue: builds, test runner, school server |
| `tools/` | Fetched build toolchains (Emscripten, MuJoCo) — gitignored, `setup.sh` populates them |

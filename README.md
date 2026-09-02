# OKROBO

OKHUB Robotics Studio: a local robotics development environment with a browser-like interface, working completely offline. For schools where internet is unreliable or expensive.

Students build programs in blocks or real Python, run them against a C++ simulated robot in 3D, and follow lessons — all with the network off.

- **[build.md](build.md)** is the master plan. Every session starts there.
- [docs/vision.md](docs/vision.md) holds the original vision notes.
- [docs/decisions/](docs/decisions/) records the decisions that shaped the build.

## Quick start

```bash
./scripts/setup.sh             # once per clone: emsdk, node modules, python deps
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

```bash
./scripts/fetch-python-runtime.sh   # once: bundle standalone CPython (offline installs)
./scripts/build-desktop.sh          # deb + AppImage in apps/studio/src-tauri/target/release/bundle
```

## School server

One machine on the LAN serves packs to every studio, so a class downloads a pack once:

```bash
node scripts/build-pack-index.mjs   # archives + index.json in dist/packs
node scripts/school-server.mjs      # prints the LAN address to enter in File → Asset Store…
```

## Layout

| Directory | What |
|---|---|
| `contracts/` | Versioned schemas every side mirrors (TS, Python, C++, Rust) |
| `apps/studio/` | React + TypeScript UI, and the Tauri desktop shell in `src-tauri/` |
| `engine/` | C++ simulation core (the only home of the sim math) |
| `runtime/python/` | `okrobo` student Python package and the sidecar |
| `packs/` | Worlds, robots (URDF), and lessons |
| `scripts/` | Glue: builds, test runner, school server |

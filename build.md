# OKROBO: Build Plan

**Product:** a local robotics development environment with a browser-like interface, working completely offline.
Think VS Code + Webots + Tinkercad + Scratch + ROS 2 in one desktop app. The UI uses web tech; the app is native.

**Target user:** students in schools with poor or expensive internet. Install once, everything works offline. Internet is only for updates, packs, and sync.

This file is the master plan. Every session starts here: read this file, pick the next unchecked task in the current phase, do it, check it off, commit. The original vision notes are preserved in [docs/vision.md](docs/vision.md).

---

## Locked decisions

These are settled. Do not re-litigate them in future sessions unless something breaks.

| Decision | Choice | Why |
|---|---|---|
| UI | React + TypeScript + Vite | Vision doc choice. Largest ecosystem for Blockly/Monaco/Three integrations. |
| 3D | Three.js, WebGL2 default | Bigger ecosystem than Babylon, more tutorials, r3f available if wanted later. WebGPU behind a flag later, not a dependency. |
| Sim engine | C++ core, one implementation of the math | Vision doc choice. Performance-critical parts live here. |
| Engine delivery to UI | WASM (Emscripten) first, native sidecar later | WASM runs inside the webview: one distributable, zero IPC setup, works in plain-browser dev mode. The native sidecar (same C++ core, different target) comes when hardware access needs it. |
| Student Python | Bundled local CPython sidecar (python-build-standalone), not Pyodide | Vision requires real local Python for AI/CV packages and hardware. Pyodide can't load native wheels reliably and can't touch serial ports. |
| Desktop shell | Tauri | Vision doc preference. Smaller binaries than Electron, and the C++ engine is WASM/sidecar so the shell language barely matters. |
| Boundary protocol | JSON messages defined in `contracts/`, versioned (v0, v1, ...) | Every side (TS, Python, C++) mirrors the same schema. Contract change = version bump + both sides updated in one commit. |
| Storage | SQLite + plain project files on disk | Vision doc choice. Offline-first, no server. |
| Units | Meters, radians internally; degrees at the student-facing Python/Blockly API | Students think in degrees; math doesn't. |
| Offline | First-class from day one | No feature may require the network except the asset store, updates, and sync. |
| Physics | Phase 1-4 use the kinematic model (no physics lib). Full physics engine chosen in Phase 5, MuJoCo is the leading candidate (Apache-2.0, robotics-grade, deterministic) | A differential-drive robot on a plane needs no rigid-body solver. Don't pay the integration cost before a robot arm or drone exists. |

## Open decisions (decide when the phase starts, not before)

- **Phase 5:** MuJoCo vs Bullet3 vs Jolt for full physics. Re-run the library search then (stars, last commit, issue activity), per the search-before-building rule.
- **Phase 7:** Web Serial from the webview vs serial from the Python sidecar for ESP32/Arduino. Depends on Tauri webview serial support at that time.
- **Blockly execution target:** generate Python (one execution path, slower loop) vs generate JS (fast, second path to maintain). Decide in Phase 2 after Monaco+Python exists.

---

## Architecture

```text
┌──────────────────────────────────────────────┐
│ UI  apps/studio                              │
│ React + TS + Vite                            │
│ Three.js viewport, Blockly, Monaco           │
├──────────────────────────────────────────────┤
│ SHELL (Phase 4)                              │
│ Tauri                                        │
├──────────────────────────────────────────────┤
│ ENGINE  engine/                              │
│ C++ core: kinematics, world, sensors         │
│ Targets: WASM (in webview) + native sidecar  │
├──────────────────────────────────────────────┤
│ PYTHON  runtime/python                       │
│ okrobo package: student Robot API            │
│ Bundled CPython sidecar (Phase 3)            │
├──────────────────────────────────────────────┤
│ CONTRACTS  contracts/                        │
│ Versioned JSON schemas all sides mirror      │
├──────────────────────────────────────────────┤
│ PACKS  packs/                                │
│ Robots, worlds, lessons. Core pack ships;    │
│ others download via asset store (Phase 6)    │
└──────────────────────────────────────────────┘
```

One rule holds everything together: **the sim math exists once, in `engine/`**. The Python package carries a small pure-Python reference model (`okrobo/_sim.py`) that acts as the executable spec; a parity test (Phase 1) locks the C++ engine to it. Nobody implements robot math a third time, not in TS, not anywhere.

## Repo layout

```text
okrobo/
├── build.md              # this file: the master plan
├── README.md
├── contracts/
│   └── robot-api/v0/     # schema.json, examples/, contract doc
├── apps/
│   └── studio/           # React + TS + Vite UI shell
├── engine/               # C++ core, CMake, ctest
│   ├── src/
│   └── tests/
├── runtime/
│   └── python/           # okrobo package + tests
├── packs/
│   └── core/             # basic robot + world definitions (grows in Phase 1)
├── docs/
│   └── vision.md         # original vision notes, kept verbatim
└── scripts/
    └── test-all.sh       # runs every gate suite
```

Services-first: each top-level directory has its own tests and can be worked on by a separate session without touching the others. Cross-directory edits mean a contract change: bump the version, update both sides, one commit.

---

## Roadmap

Each phase ends with a demo you can run, not a report. Don't start phase N+1 with phase N's acceptance test red.

### Phase 0: Foundation ✅ (this commit)

- [x] Monorepo layout, git initialized
- [x] `contracts/robot-api/v0`: drive/stop/reset commands, state message, examples, structural tests
- [x] `engine/`: C++ kinematic core (diff-drive pose integration, rectangular arena, forward distance sensor), builds with CMake, ctest green
- [x] `runtime/python`: `okrobo.Robot` student API (`forward`, `turn_left`, `distance`) on the reference model, pytest green, runnable demo
- [x] `apps/studio`: Vite + React + TS shell with the studio layout (menu bar, robot sidebar, viewport, code panel, run bar), builds clean
- [x] `scripts/test-all.sh` green end to end

**Acceptance:** `./scripts/test-all.sh` passes; `python3 -m okrobo.demo` drives a robot to a wall and turns; `npm run dev` in `apps/studio` shows the studio shell.

### Phase 1: Simulator in the browser ✅

Goal: the robot visibly drives in the viewport, powered by the C++ engine.

- [x] Emscripten SDK in `tools/emsdk` (gitignored); `scripts/build-engine-wasm.sh` compiles `engine/` to a single-file ES module at `apps/studio/public/engine/okrobo_engine.js` (generated, gitignored). API surface: scalar exports in `engine/src/wasm_api.cpp`, contract messages assembled on the TS side
- [x] Parity gate: `engine/tests/parity/parity.mjs` runs the shared scenario through `okrobo/_sim.py` (via `okrobo.dump_trace`) and the WASM engine; 1730 states match at 8.9e-16 max diff (tolerance 1e-9)
- [x] Three.js viewport (`src/Viewport3D.tsx`): floor, grid, walls, cylinder robot with heading nose, orbit camera
- [x] Run bar live: Run cruises forward and auto-stops at 0.2 m from the wall, Stop halts, Reset restores. Fixed 10 ms timestep via `src/lib/fixedStep.ts` (vitest-covered)
- [x] Sensor ray drawn live from the robot's front edge, shortens toward walls
- [x] World loaded from `packs/core/worlds/arena.json`, schema at `contracts/world/v0`, runtime-validated in `src/lib/validateWorld.ts` (vitest-covered) and `WorldConfig.from_dict` in Python

Deviations from plan: the world always steps (wheels are just zero when idle), which made keyboard teleop (arrows/WASD) nearly free, so it's in. Engine exports are scalar getters instead of a `get_state` blob: no marshalling, and the contract shape lives in one TS spot (`EngineWorld.ts`).

**Acceptance: verified in headless Chrome** — clicked Run against the built app; robot drove x 1.00 → 1.70 and reported "stopped at wall", sensor at 0.20 m. Works with wifi off (engine and world are bundled/local).

### Phase 2: Code drives the robot

Goal: students write programs.

- [ ] Monaco editor panel wired into the layout
- [ ] Blockly panel with a starter toolbox (start, move, turn, wait, if, repeat, distance sensor)
- [ ] Blockly generates Python source shown read-only in Monaco (decide execution target here, see open decisions)
- [ ] A TS-side program runner executes the generated program against the WASM engine step loop (interpret, or transpile; keep the sim math in the engine)
- [ ] Stop button interrupts a running program safely

**Acceptance:** the wall-avoider from the vision doc, built in blocks, runs: `if distance < 0.2: turn_left`.

### Phase 3: Real local Python

Goal: `robot.forward()` in real CPython controls the sim.

- [ ] Bundle python-build-standalone CPython under the app
- [ ] Python sidecar process speaks contract v0 over WebSocket/stdio to the app
- [ ] `okrobo.Robot` gains a `connect()` transport so the same student code runs against the sidecar-to-engine bridge instead of `_sim.py`
- [ ] Monaco "Python" tab executes the student file through the sidecar, stdout/stderr in an output panel
- [ ] Sandboxing pass: student code runs in a subprocess with its own cwd, killable from the Stop button

**Acceptance:** type the vision doc's Python snippet in Monaco, press Run, the 3D robot obeys.

### Phase 4: Desktop app

Goal: it stops being a dev server and becomes OKHUB Robotics Studio.

- [ ] Prerequisite: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` (Rust for Tauri, user-space, no sudo)
- [ ] Tauri wraps `apps/studio`; engine WASM and Python runtime bundled as resources
- [ ] Project save/load: SQLite index + project directories (blocks, python files, world ref)
- [ ] File menu: New/Open/Save project; recent projects
- [ ] Installer builds for Linux (deb/AppImage) in CI

**Acceptance:** install the package on a machine with no toolchains and no internet; create, save, reopen, and run a project.

### Phase 5: Real physics and more robots

- [ ] Choose physics lib (see open decisions), integrate into `engine/` behind the same contract
- [ ] Robotic arm model, URDF import for the core robots
- [ ] Contract v1: joint commands, joint state, camera/LiDAR sensor messages
- [ ] Robot sidebar actually switches robots (Car, Arm as the first two)

### Phase 6: Packs and the school server

- [ ] Pack format: manifest + assets + lessons, signed, versioned
- [ ] Asset store UI: list, download, install, fully usable offline afterwards
- [ ] School server: one static-file server on the LAN that mirrors packs; app discovers it and prefers it over the internet
- [ ] Lesson player: markdown lessons with embedded runnable exercises from `packs/`

### Phase 7: Hardware

- [ ] Serial transport (decide webview vs sidecar, see open decisions)
- [ ] ESP32/Arduino firmware speaking contract robot-api over serial
- [ ] The same Blockly/Python program that drove the sim drives the physical robot

### Phase 8: ROS 2 and AI packs

- [ ] ROS 2 pack: optional local install, topic bridge from the engine
- [ ] AI pack: local OpenCV/YOLO models callable from student Python
- [ ] Camera sensor in sim feeds student CV code

---

## Rules for every session

1. **Gate tests with every change.** Engine: ctest + WASM parity vs the Python reference. Python: pytest. Studio: `tsc --noEmit` + vitest + `vite build`. All free, all fast, all in `scripts/test-all.sh`. A phase task without its test in the same commit is not done.
2. **Offline check.** Before checking off any task: does it work with the network off? Asset store and updates are the only exceptions.
3. **One directory per session** where possible. Contract changes are the exception and get called out in the commit message.
4. **Sim math lives in `engine/` only.** `okrobo/_sim.py` is the frozen reference spec, changed only together with the engine and the parity test.
5. **Update this file** as tasks complete: check the box, note real deviations in one line. This file is the project's memory.

## Current state and prerequisites

- Machine has: Node 25, npm 11, Python 3.12 (+pytest), CMake 3.28, g++ 11, git, and the Emscripten SDK in `tools/emsdk` (gitignored; a fresh clone re-installs it, `scripts/build-engine-wasm.sh` prints the commands). Missing: Rust (needed Phase 4).
- No git remote configured (the gh token can't create repos); work is committed locally.

## How to continue

```bash
./scripts/test-all.sh                 # everything green before you start
cd apps/studio && npm run dev         # the studio: Run/Stop/Reset + arrow-key driving
python3 -m okrobo.demo                # student API on the reference sim
```

Then open Phase 2, take the first unchecked box, build it with its test, check it off here, commit.

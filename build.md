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

- ~~Phase 5 physics library~~ decided: MuJoCo, integration deferred to the first contact-dynamics feature ([docs/decisions/physics-engine.md](docs/decisions/physics-engine.md)).
- **Phase 7:** Web Serial from the webview vs serial from the Python sidecar for ESP32/Arduino. Depends on Tauri webview serial support at that time.
- ~~Blockly execution target~~ decided in Phase 2: JS for execution (async runner, interruptible), Python for display until Phase 3 makes it the real path.

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

### Phase 2: Code drives the robot ✅

Goal: students write programs.

- [x] Monaco panel (`src/PythonPanel.tsx`): read-only Python view, dark theme; trimmed to core editor + Python grammar (the full monaco entry ships a 7MB TS worker)
- [x] Blockly panel (`src/BlocksPanel.tsx`): move/turn/wait/distance blocks plus if/repeat/while/compare, dark theme, media served locally (`scripts/sync-blockly-media.mjs`, offline rule) — the vision doc's wall avoider is preloaded so Run works on first open
- [x] Execution target decided: blocks generate JavaScript for execution now and Python (exact okrobo package API) for the Monaco preview, which becomes the real path in Phase 3. One executed language, one displayed
- [x] Program runner (`src/program/ProgramRunner.ts`): async robot API with Python-Robot semantics (duration-based movements, exact partial end step, collision early-stop) driven by the render loop's fixed timestep; generated loops await a checkpoint each iteration so `while (true)` never freezes the UI
- [x] Stop interrupts at any await point (ProgramStoppedError); teleop keys also preempt a running program

Tests: 12 new vitest cases run generated programs against the real WASM engine, including the wall avoider (turns at the wall, drives on) and safe interruption.

**Acceptance: verified in headless Chrome** — clicked Run on the preloaded blocks: status showed "program running", the robot crossed the arena, turned at the wall and reached y 1.70 on the far side, Stop cleared it; the Python preview contains `from okrobo import Robot` and `robot.turn_left(90)`.

### Phase 3: Real local Python ✅

Goal: `robot.forward()` in real CPython controls the sim.

- [x] Sidecar (`runtime/python/okrobo/sidecar.py`): WebSocket server on 127.0.0.1:8355 speaking `contracts/robot-remote/v0`; started with `./scripts/run-python-sidecar.sh`, the studio connects and reconnects automatically (`src/python/PythonBridge.ts`, status chip py ✓/✗)
- [x] Student code runs in a killable subprocess (`okrobo/worker.py`) with a neutral cwd; robot calls travel worker → socketpair → sidecar → WebSocket → ProgramRunner → engine
- [x] Instead of a `connect()` method, the worker injects a proxy `okrobo` module before exec, so a byte-identical `from okrobo import Robot` file runs against the local reference sim or the studio engine. Less API surface, same outcome
- [x] Monaco is editable, seeded from the blocks until the user edits (resync button); Run on the Python tab executes the file through the sidecar; stdout/stderr stream into an output pane
- [x] Stop terminates the subprocess (SIGTERM, then SIGKILL after 2 s) and rejects any in-flight movement; teleop preempts too
- [ ] Bundle python-build-standalone CPython → moved to Phase 4 packaging, where the app bundle exists to put it in. Until then the sidecar uses system python3; its only dependency installs repo-locally (`pip install --target=.deps`, no venv, no sudo)

Tests: 8 new pytest cases (worker RPC protocol, clean tracebacks, full sidecar loop against the reference sim, stop-kill) and 8 new vitest cases, including an end-to-end run where a REAL sidecar subprocess executes REAL student Python against the REAL WASM engine, all local.

**Acceptance: verified in headless Chrome with the sidecar running** — Run on the Python tab executed the Monaco file (the vision snippet) as real CPython: status showed "python running", the robot crossed the arena and turned (y reached 1.70), Stop killed the subprocess and the output pane logged the exit.

### Phase 4: Desktop app ✅

Goal: it stops being a dev server and becomes OKHUB Robotics Studio.

- [x] Prerequisites installed (Rust 1.98 via rustup, webkit2gtk/gtk3/librsvg dev packages)
- [x] Tauri 2 wraps `apps/studio` (`src-tauri/`); the engine WASM ships inside the frontend dist; the okrobo Python runtime and its `.deps` bundle as resources
- [x] Shell spawns the sidecar on launch and kills it on exit (`src-tauri/src/sidecar.rs`); interpreter resolution: bundled CPython → system python3 → repo dev path. `scripts/fetch-python-runtime.sh` downloads python-build-standalone into `src-tauri/runtime-dist/` (gitignored) for fully offline installs; without it the package falls back to the machine's python3
- [x] Project store (`src-tauri/src/projects.rs`): SQLite index + one directory per project (blocks.json, program.py, project.json with world + python_edited), in the app data dir; 6 cargo tests
- [x] File menu is real in the desktop app: New / Open… (list, delete with confirm) / Save (Ctrl+S), recent projects, project name in the window title and titlebar chip. Browser mode keeps the menu disabled
- [x] Installer build: `scripts/build-desktop.sh` produces deb (70 MB) + AppImage (108 MB, fully self-contained) locally (no CI until a git remote exists, deliberate)

Deviations and hard-won facts:
- "CI builds the installer" became a local build script; there is no remote or CI by choice (GitHub parked).
- The sidecar child gets `PR_SET_PDEATHSIG`, because SIGTERM on the app skips Tauri's RunEvent::Exit and would orphan it; and the spawn scrubs `PYTHONHOME`/`PYTHONPATH`, because the AppImage GTK AppRun exports PYTHONHOME (and shells can carry ROS paths), which breaks the bundled interpreter.
- tkinter is pruned from the bundled CPython: its tcl/tk 9 libs make linuxdeploy's dependency walk fail.
- Tauri's bundler staging (`target/release/bundle/appimage_deb`, `runtime-dist` next to the binary) never refreshes stale files: after changing bundled resources, `rm -rf target/release/bundle` before rebundling.

**Acceptance: verified on this machine** — the release binary and the AppImage both launch, autospawn the sidecar (the AppImage from its own bundled CPython, confirmed via /proc/pid/exe), initialize the project store, and kill the sidecar on exit including plain SIGTERM. Full offline install on a clean machine: install the deb or run the AppImage; nothing else needed. In-app File menu (New/Open/Save/recents) is wired to 6 cargo-tested store commands; a hands-on UI pass is Olayemi's to do on first launch.

**Acceptance:** install the package on a machine with no toolchains and no internet; create, save, reopen, and run a project.

### Phase 5: More robots and the physics decision ✅

- [x] Physics library chosen: **MuJoCo**, with the integration deliberately deferred until a feature needs contact dynamics — reasoning and rejected alternatives in [docs/decisions/physics-engine.md](docs/decisions/physics-engine.md). The arm is joint-space kinematics (rate-limited targets + FK), which needs no solver; contract v1 is solver-agnostic so MuJoCo drops in behind it later
- [x] 4-DOF arm in the engine (`engine/src/arm.cpp`): base yaw + shoulder/elbow/wrist pitch, clamped limits, FK tip. Second parity gate locks it to the reference model (838 states, 5.6e-17 max diff)
- [x] Contract v1 (`contracts/robot-api/v1`): arm commands/state plus the lidar fan, `$ref`-ing v0 for the car so nothing v0 changed. Remote contract v1 (`contracts/robot-remote/v1`) adds `arm_move`, `arm_move_all`, `arm_angles`, `arm_tip`, `lidar`
- [x] Lidar: `world_ray(offset)` primitive in the engine; `Robot.lidar(rays, fov)` in Python; a 9-ray fan drawn live in the car viewport
- [x] Robot sidebar switches robots for real: Car and Arm each get their own 3D scene, camera framing, Blockly toolbox, starter program, Python header (`Robot` vs `Arm`), and HUD. Switching halts everything running first; projects remember their robot
- [x] Student `Arm` API in Python (`okrobo/arm.py`) and its remote proxy, so the same file runs locally or in the studio
- [ ] URDF import → moved to Phase 6 (pack format lands there; URDF is pack content, not engine core)

Tests added: 6 ctest (arm), 12 pytest (arm model, Arm API, lidar, worker arm RPC), 12 vitest (arm runner, bridge v1 dispatch, generators, and an end-to-end real-sidecar `from okrobo import Arm` program driving the WASM arm).

**Acceptance: verified in headless Chrome** — from a clean load on Car, clicking Arm swapped the viewport, blocks, and Python (`from okrobo import Arm`); Run executed the wave and the HUD showed the joints sweeping through four distinct readings (0°/60° → 45°/35°), Stop cleared it. Camera framing was fixed after the first screenshot showed the arm rendered too small in the arena-sized view.

### Phase 6: Packs and the school server

- [ ] Pack format: manifest + assets + lessons, signed, versioned
- [ ] URDF import for robot models shipped in packs (carried from Phase 5)
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
1b. **Verify the dev server, not only the built app.** They differ: Vite's dev server transforms modules while `vite build` copies `public/` verbatim, so a broken import can pass the build and fail `npm run dev`. That exact bug shipped in Phase 1 and survived to Phase 5. Run `./scripts/check-dev-server.sh` (headless, asserts the engine loads and the 3D renders) whenever you touch loading, assets, or the build config.
2. **Offline check.** Before checking off any task: does it work with the network off? Asset store and updates are the only exceptions.
3. **One directory per session** where possible. Contract changes are the exception and get called out in the commit message.
4. **Sim math lives in `engine/` only.** `okrobo/_sim.py` is the frozen reference spec, changed only together with the engine and the parity test.
5. **Update this file** as tasks complete: check the box, note real deviations in one line. This file is the project's memory.

## Current state and prerequisites

- Machine has: Node 25, npm 11, Python 3.12 (+pytest), CMake 3.28, g++ 11, git, Rust 1.98 (~/.cargo, add to PATH), webkit2gtk/gtk3 dev libs, and the Emscripten SDK in `tools/emsdk` (gitignored; a fresh clone re-installs it, `scripts/build-engine-wasm.sh` prints the commands).
- Desktop build: `./scripts/build-desktop.sh` (runs `scripts/fetch-python-runtime.sh` output if present). Dev app: `cd apps/studio && npx tauri dev`.
- No git remote configured (the gh token can't create repos); work is committed locally.

## How to continue

```bash
./scripts/test-all.sh                 # everything green before you start
./scripts/check-dev-server.sh         # the dev server really loads the engine + 3D
./scripts/run-python-sidecar.sh       # optional: real Python execution (py ✓ in the studio)
cd apps/studio && npm run dev         # the studio: blocks, python, 3D sim, teleop
python3 -m okrobo.demo                # student API on the reference sim (from runtime/python)
```

Then open Phase 6, take the first unchecked box, build it with its test, check it off here, commit.

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

- ~~Phase 5 physics library~~ decided: MuJoCo, integration deferred to the first contact-dynamics feature, **integrated 2026-09-03** for the arm's graspable object ([docs/decisions/physics-engine.md](docs/decisions/physics-engine.md)).
- ~~Blockly execution target~~ decided in Phase 2: JS for execution (async runner, interruptible), Python for display until Phase 3 makes it the real path.
- ~~Phase 7 serial transport~~ decided: the Python sidecar, because WebKitGTK has no Web Serial API ([docs/decisions/serial-transport.md](docs/decisions/serial-transport.md)).

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
│ C++ core: kinematics, arm, sensors, camera   │
│ Targets: WASM (in webview) + host build      │
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
├── engine/               # C++ core (kinematics, arm, camera), CMake, ctest
│   ├── src/
│   └── tests/            # incl. parity/: locks WASM to the Python reference
├── firmware/             # ESP32/Arduino robot, protocol gate-tested on host
├── runtime/
│   └── python/           # okrobo package (Robot, Arm, vision, ros_bridge) + tests
├── packs/                # core, robotics, ai, ros2: worlds, robots, lessons
├── docs/
│   ├── vision.md         # original vision notes, kept verbatim
│   └── decisions/        # why physics/serial/signing went the way they did
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

- [x] Emscripten SDK in `tools/emsdk` (gitignored); `scripts/build-engine-wasm.sh` compiles `engine/` to a single-file ES module at `apps/studio/src/generated/okrobo_engine.js` (generated, gitignored; it lived under `public/` until the Phase 6 dev-server fix). API surface: scalar exports in `engine/src/wasm_api.cpp`, contract messages assembled on the TS side
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

### Phase 6: Packs and the school server ✅

- [x] Pack format (`contracts/pack/v0`): `pack.json` manifest + worlds/robots/lessons, semver'd, with `sha256` and `size_bytes`. `scripts/build-pack-index.mjs` builds deterministic `.tar.gz` archives and an `index.json`. Two packs ship: `core` (arena, arm URDF, two lessons) and `robotics` (4x4 m arena)
- [x] URDF import (`src/packs/urdf.ts`): the documented subset — links, revolute/continuous/fixed joints, origins, axes, limits — ignoring unsupported elements rather than rejecting real-world files. A gate test asserts `packs/core/robots/arm.urdf` describes the same arm `engine/src/arm.cpp` simulates (link lengths, limits, velocities), so the two cannot drift
- [x] Asset store UI (`src/AssetStore.tsx`): discovers a source, lists packs as available/installed/upgradable, downloads, installs, uninstalls. Install goes through Rust (`src-tauri/src/packs.rs`): digest verified before unpacking, staging directory swapped in atomically, previous version restored on any failure, archives that lie about their contents refused
- [x] School server (`scripts/school-server.mjs`): a static file server with CORS, prints its LAN addresses on start, refuses path traversal. The studio tries school-server addresses before the internet, so 30 students download a pack once over the LAN
- [x] Lesson player: a Lessons tab listing lessons from the core pack, with per-step "Try this" that loads the code into the Python editor and switches robots when the lesson needs the other one. Lesson prose renders through React text nodes only (`src/packs/markdown.tsx`) — pack content is untrusted, so there is no HTML injection surface at all rather than a sanitiser to trust

Tests: 31 pack tests (manifest/index validation incl. path-escape rejection, URDF parsing, lesson parsing, the shipped packs, store discovery and catalogue), 9 Rust pack tests (SHA-256 known-answer vectors, tamper rejection with rollback, upgrade, uninstall), and a seam test asserting the frontend's invoke payloads match the Rust command signatures — verified by renaming a Rust parameter and watching it fail. The school-server check is now part of `scripts/test-all.sh`.

**Acceptance: verified in headless Chrome** — the Lessons tab listed both core lessons; opening "Wave the arm" showed 4 steps with 3 runnable blocks; "Try this" switched the robot from Car to Arm, moved to the Python tab, and loaded `from okrobo import Arm` code ready to Run. The store pipeline was verified against a live school server: index published with digests, archive downloaded, digest matched.

Not done here: pack signing (the manifest carries a content digest, not a publisher signature) — it needs a key-distribution decision for schools, so it is deliberately deferred rather than half-built. **Closed in Phase 7** (Ed25519 signing, key-distribution decision documented in `docs/decisions/pack-signing.md`) — see below.

### Phase 7: Hardware ✅

- [x] Transport decided by evidence, not preference: **the Python sidecar, not Web Serial**. The desktop app renders in WebKitGTK, which has no Web Serial API, so building on it would work in a Chrome dev tab and be missing from the actual product ([docs/decisions/serial-transport.md](docs/decisions/serial-transport.md))
- [x] `contracts/robot-serial/v0`: a compact ASCII line protocol a microcontroller can parse without an allocator, carrying exactly the fields of robot-api v0 state, with a 1-second no-command watchdog so an unplugged cable cannot leave a robot driving
- [x] Firmware (`firmware/okrobo_car/`): `protocol.hpp` holds all parsing and formatting and is **gate-tested on this machine** (7 ctest cases: malformed input, overlong lines, fixed-point formatting without printf), so the code that ships to the board is tested without a board. `okrobo_car.ino` is only pins, motors, sensor, odometry
- [x] `okrobo/serial_link.py` presents a physical robot behind the *simulated World's* interface, so `okrobo.Robot` drives real hardware with no change to student code. Tested end to end against a fake board on a pty (12 cases: identity handshake, boot noise, drive/state round trip, close-stops-wheels)
- [x] Cross-language parity gate: every command the Python side emits is fed through the **firmware's real parser** and must be understood, mirroring the simulator's parity pattern
- [x] Sidecar routes robot calls to hardware when connected, with `list_ports` / `connect_hardware` / `disconnect_hardware`. A test proves a student program drives the board **and the simulator is never asked**
- [x] Studio sidebar has a Hardware section: port list, connect, disconnect, identity in the status bar
- [x] Pack signing (carried from Phase 6): Ed25519 over `id|version|sha256|size_bytes`, signed by `scripts/sign-pack.mjs` (Node's native Ed25519, no dependency) and verified in Rust with ed25519-dalek. A mismatched signature is refused outright; unsigned or unknown-publisher packs install only after an explicit confirmation naming the pack, because refusing outright pushes teachers to disable checks entirely ([docs/decisions/pack-signing.md](docs/decisions/pack-signing.md))

**Bug found and fixed while wiring the gates:** `-DCMAKE_BUILD_TYPE=Release` defines `NDEBUG`, which compiles `assert()` away — so every C++ suite had been passing **vacuously** in `scripts/test-all.sh` since Phase 0. Test targets now compile with `-UNDEBUG`; verified by planting a wrong assertion and watching the Release run fail.

Also fixed before shipping: the first draft of `sign-pack.mjs` derived the key id from the last 32 bytes of the PKCS8 DER, which for a private key is the **private seed** — it would have published the secret. Key ids now always go through `createPublicKey`, and a gate check asserts the private key text never contains the published id.

**Acceptance:** the full hardware path runs locally with no board attached — a real sidecar, a fake ESP32 on a pty speaking the real protocol, and unmodified student Python driving it. Signing verified across languages: a signature made by the Node signer verifies in Rust (fixture test), and both a swapped archive digest and a version downgrade break it.

Not done: flashing firmware from inside the studio (arduino-cli integration) and testing against a physical board, which needs hardware on the desk.

### Phase 8: ROS 2 and AI packs ✅

- [x] **Coloured obstacles** (`contracts/world/v1`): vision needs something to look at, so the world gained axis-aligned coloured boxes that the distance sensor, lidar and camera all see. The shipped arena has a red and a blue box. A v0 world is a valid v1 world with no obstacles
- [x] **Camera in the engine**, not the viewport (`engine/src/camera.hpp`): a raycast renderer, so a camera frame exists everywhere the simulator does — headless in the sidecar, in the browser, and in the parity gate — and is deterministic, which a GPU render is not. That determinism is what lets a vision lesson have a reliable answer. **Third parity gate: 8 frames match the Python reference byte for byte**
- [x] **Vision** (`okrobo/vision.py`): `find_color` returns bearing, coverage and area, and works with **no dependencies installed**, so a school with no internet still gets working vision lessons. OpenCV accelerates the same operation when the AI pack is present, and a parity test asserts both give identical answers — a lesson's expected result never depends on which packs a machine has
- [x] **ROS 2 bridge** (`okrobo/ros_bridge.py`): publishes `/okrobo/odom` and `/okrobo/scan`, subscribes to `/okrobo/cmd_vel`, driving the simulator or a serial robot. rclpy is imported lazily and nothing else depends on it, so machines without ROS are unaffected. Tested against the real rclpy on this machine
- [x] Camera preview in the studio sidebar showing exactly the frame `robot.camera()` returns, so what a student debugs by eye is what their program gets
- [x] `ai` and `ros2` packs with lessons; the pack gate now checks **every** pack's lessons only call APIs the runtime actually exposes

**Three bugs found by the new tests, all real:**
1. Student code could not `from okrobo.vision import ...` through the sidecar at all: the worker's injected `okrobo` stand-in was a plain module, not a package. It now carries `__path__` pointing at the real package, so genuine submodules load while `Robot` stays the remote proxy.
2. `robot.camera()` had no route over the remote contract, so the AI lesson would have failed in the studio. Added to the worker proxy, the bridge dispatch and `contracts/robot-remote/v1`.
3. The taller sidebar stretched the CSS grid row instead of scrolling, pushing the 3D viewport off-screen on short displays — exactly the hardware schools have. Caught by measuring the layout in a 437 px window, fixed with `min-height: 0` plus internal scrolling.

**Acceptance: verified in headless Chrome** — the status bar reads 0.50 m (the red box, not the 0.9 m wall), the camera preview draws live engine frames with 940 red pixels and a red centre pixel, and the arena renders both boxes. A student vision program (`find_color` → bearing → drive) runs end to end through the real sidecar in the automated gate.

Not done: YOLO/torch models. They are a large download that cannot ship offline; the pack format and vision API are ready for them, and colour detection covers the teaching goal without a 500 MB dependency.

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
cd apps/studio && npm run dev         # the studio: blocks, python, lessons, 3D sim, teleop
python3 -m okrobo.demo                # student API on the reference sim (from runtime/python)

# packs / school server
node scripts/build-pack-index.mjs     # archives + index.json in dist/packs
node scripts/school-server.mjs        # serve them to the LAN (File → Asset Store…)
```

All eight phases are done. Next work comes from the "Not done" notes in each phase (physics integration, firmware flashing from the studio, YOLO models) or from what students and teachers ask for once it is in their hands.

## Post-Phase-8 hardening

Work done after all eight phases shipped, closing gaps the phase-by-phase build left behind. Same bar as any phase: gate-tested, committed, `test-all.sh` green.

- **Fresh-clone verification.** `git clone` into a clean directory and ran the documented steps — this is not implied by a green working tree, since a working tree accumulates installed dependencies and generated files the repo never mentions. Found and fixed: `requirements.txt` missing `pyserial` silently zeroed out all 83 Python tests (module-level `importorskip` in a package aborts collection of the whole package — `test-all.sh` now compares collected files to files on disk and fails loudly); a guard test crashing on a not-yet-generated directory; `scripts/setup.sh` added so a clone reaches green with two commands.
- **Dev-server ENOSPC.** Vite was watching `src-tauri/target`, which stages a full bundled CPython (tens of thousands of files) once the desktop app is built, exhausting the inotify limit. `npm run dev` worked on a clean tree and crashed for anyone who had run `build-desktop.sh` first. Fixed by excluding `src-tauri`, `tools`, `dist` from Vite's watcher.
- **React UI test coverage.** 109 studio tests existed and none touched the UI layer, including the Asset Store's install/trust decision — the single most security-relevant judgment call in the app. Added `@testing-library/react` + `user-event` + `jest-dom`, extracted `NameDialog`/`OpenDialog` out of `App.tsx` into `src/dialogs.tsx` for testability, and added 28 tests: the trust flow (verified installs silently, unsigned/unknown-publisher packs require explicit confirmation and install nothing on cancel, a signature mismatch is refused with no override), the project dialogs (delete requires a second confirming click), and the lesson player (list/open/back, "Try this" carries the right code and robot).
- **Extracted the two pieces of real logic still buried in `App.tsx`.** Keyboard-teleop key mapping and the run-bar status-line formatter were pure functions living inline with no coverage. Moved to `src/lib/teleop.ts` and `src/lib/statusText.ts` (30 tests: every direction, diagonal combination, opposite-key cancellation, every engine/run/hardware state the status line can show). Verified as a behavior-preserving refactor: unit tests passed unmodified on the first run, the dev server's status output matched byte-for-byte before and after, and a live-browser check confirmed ArrowUp and a forward+right diagonal still drive the WASM-simulated robot.
- **A permanent browser E2E gate — and the real bug it immediately found.** Nothing in `test-all.sh` ever drove the browser through the student journeys; every "acceptance in headless Chrome" across all 8 phases was a hand-run script, thrown away after. `scripts/check-studio-e2e.sh` (+ `scripts/lib/studio-e2e-check.mjs`, on a small shared CDP client in `scripts/lib/cdp.mjs`, no Puppeteer/Playwright needed) is now a required stage of `test-all.sh`: engine boot, the camera rendering the shipped arena's red box, Run/Stop/Reset on the preloaded blocks, the Python mirror, Car↔Arm switching, and a lesson's "Try this". Writing the "Try this" check surfaced a real, deterministic bug: switching robots from a lesson step showed the *previous* robot's stale code in the dev server. Root cause: React StrictMode's dev-mode double-invoke of effects (mount→cleanup→mount again, to catch non-idempotent effects) exposed that seeding a freshly-mounted `BlocksPanel`/`PythonPanel` via an imperative `ref.load()` call from a *parent* effect was exactly the kind of non-repeatable effect that check exists to catch — a shared ref got "consumed" (cleared) by StrictMode's first pass, so its second pass saw it already gone. The identical pattern was also used for opening a saved project on a different robot, so it carried the same latent bug. Fixed both by moving the seed to a prop each panel reads *only at its own mount* (`initialWorkspace`/`initialOverride`) — props are frozen per render, so both StrictMode passes see the same value, unlike a live ref read. Verified with a dedicated diagnostic script and a live console trace that pinpointed the exact double-invoke, then confirmed stable across 4 consecutive clean runs.

Recurring theme across all five: a failure that looks like success (0 tests silently "passing", a crash only after a specific prior step, a UI path or a piece of logic with no coverage at all, a bug that only a real browser driving real effects could catch) is worse than one that's visible. Guard accordingly before calling something done.

## Gaps found against the vision doc (2026-09-02)

Asked to list what had been built, a live look at the running app (not just this log) found real gaps between "8 phases done" and what a student can actually do: the C++ tab is a dead placeholder ("C++ track opens after Phase 6", unchanged since that phase shipped), Drone is a disabled sidebar label with no engine/API/blocks behind it at all, the block library covers only 8 primitives (nothing for lidar, vision, or ROS, though the Python APIs exist), and — the one picked to fix first — there was no way to add, move, resize, recolor, or delete an object in the arena from the UI at all; `packs/core/worlds/arena.json` had to be hand-edited. None of this was a regression; it was scope `docs/vision.md` promised that got narrowed during Phase 2/6 without that narrowing ever being surfaced as a decision. C++, Drone, and a deeper block library remain open.

- **World editor.** A new World tab (`src/WorldPanel.tsx`), Car-only (the Arm has no arena to edit): arena width/height, robot start pose, and up to 16 coloured objects, each with position/size/color/label, add/delete freely. Edits are a local draft — nothing reaches the sim until "Apply changes" — because the World-keyed effect in `App.tsx` does a full engine + 3D-scene rebuild (same mechanism a robot switch already used), which resets the camera framing; applying on every keystroke would make the viewport jump while typing a number. "Reset to pack default" bypasses the draft and applies immediately.
- **Persisted per project**, not just live in memory: `world_custom` (a full `contracts/world/v1` blob) on `ProjectPayload`, both sides — `#[serde(default)]` on the Rust struct so every project.json saved before this feature still loads. Untrusted on read like any pack world: a corrupted `world_custom` falls back to the pack default instead of crashing the app.
- **A real, pre-existing bug found and fixed in the same struct.** `robot` had been sent by the frontend on every save since Phase 4/5 but was never a field on the Rust `ProjectPayload`/`SideMeta` structs — serde silently dropped it on write, so every saved **Arm** project reopened as **Car**. Unlike the flat pack commands (`install_pack` etc.), `create_project`/`save_project` take one struct argument, so the existing seam test (which compares `invoke()` call args against Rust command params) could not have caught a field missing *inside* that struct — it only diffs the outer call. Added a second seam test (`tauriSeam.test.ts`) that parses and directly diffs the Rust struct's field list against the TS interface's; proved it actually catches this class of bug by planting a renamed field and watching it fail before reverting.
- **Verified live, not just unit-tested.** RTL covers the form in isolation (8 tests: seeding, add/delete, apply-gated-on-validation, the obstacle cap). Separately, in headless Chrome against the real dev server: moving the shipped red box's x from 1.7 to 1.3 and clicking Apply moves the actual distance-sensor reading from 0.50 m to 0.10 m — proof an edit reaches the live WASM engine, not just the form's local state. That check is now permanent, in `scripts/lib/studio-e2e-check.mjs`.
- **A second, smaller bug this work surfaced in the shared browser-check library**: `cdp.mjs`'s `click`/`clickText` compute an element's bounding rect once and dispatch a synthetic mouse event at that fixed point; a state update from an edit made just before (e.g. typing a field) can re-render and shift the target before the dispatch lands, missing the click with no error. Added `evalClick`/`evalClickText` (a real DOM `.click()`, immune to the race) and `setInputValue` as additive, non-breaking alternatives — used them for the World tab's checks, left every existing check's calls untouched.
- Inserting a tab in the middle of `CODE_TABS` broke two *existing* e2e checks that selected tabs by position (`.code-tab:nth-of-type(3)` was "Lessons"; became "World"). Fixed by switching those (and the Python-tab selector next to them) to select by label text instead, the same way the Car/Arm and lesson checks already did — removes the whole class of "reordering a tab silently breaks an unrelated check" for good, not just for this change.

**Acceptance: verified in headless Chrome** — World tab renders for Car; starts with the arena's 2 shipped objects; editing the red box's position and clicking Apply changes the live distance-sensor reading (0.50 m → 0.10 m), not just the form; "reset to pack default" restores it; Run/Stop/Reset still work afterward. `cargo test` (28, incl. the robot/world_custom roundtrip and a legacy-project.json-without-these-fields backward-compat test), `vitest` (148), and the full `test-all.sh` all green.

## Deepen the block library (2026-09-02)

Second item off the same gap list: Blocks only covered 8 primitives (move/turn/wait/distance/arm), so a student who never touches Python could not reach lidar, vision, or anything past the front-facing distance sensor — the Python APIs (`Robot.lidar`, `okrobo.vision.find_color`) already existed and were already reachable from real Python, just not from Blocks.

- **Three new car blocks**: `closest object anywhere (m)` (the shortest reading across the existing 9-ray/180° lidar scan — `min(robot.lidar())` / `Math.min(...robot.lidar())`, no new engine or Python API needed, the primitive was already there), `sees [color] object?` (boolean), and `bearing to [color] object (°)` (signed degrees, 0 if not seen). Colour options (red/green/blue/yellow) come from one shared list so the block dropdown, the JS/Python generators, and `okrobo.vision.COLORS` can't drift apart.
- **A real TS port of `find_color`** (`src/lib/vision.ts`): blocks execute as JS against the WASM engine (`program/execute.ts` hands generated code only a `robot` object, no Python import machinery), so a "sees color" block needs a JS-side implementation, not just a call into the Python module. Wired into `ProgramRunner.api.findColor()`, which pulls a real camera frame straight from the engine — same pattern as `distance()`/`lidar()`.
- **A fourth parity gate**, matching the WASM-engine, OpenCV, and firmware ones: `scripts/lib/vision-parity-check.mjs` renders real frames through `okrobo.dump_vision` (new, mirrors `dump_trace`'s convention) and asserts the JS port's `findColor` agrees with Python's `find_color` field-for-field on the same pixels. Now a required `test-all.sh` stage. The first version of this gate had a real hole: every test frame placed its obstacle dead-centre, so `bearing` was 0 regardless of the FOV constant — a planted wrong constant sailed through undetected. Fixed by adding an off-centre vector; the same planted-bug check that exposed the hole then confirmed it closed.
- **The Python preview only imports what it uses**: `from okrobo.vision import find_color` is added to the generated header only when a vision block is actually on the workspace, so a plain move/turn program's Python tab doesn't grow an unused import.
- Toolbox is Car-only — the Arm has no camera or lidar in this build, so its toolbox is untouched.

Tests: 3 new okroboBlocks.test.ts cases (JS codegen, Python codegen, the conditional import), 5 new vision.test.ts cases (patch found/not found, all-dark frame, centred-vs-off-centre bearing, unknown-colour error), 4 new ProgramRunner.test.ts cases against the **real WASM engine and the shipped arena** (`findColor("red")` finds the arena's actual red box dead ahead; `findColor("blue")` correctly returns null — the shipped blue box is behind the car's start heading, outside the camera's FOV; `findColor("green")` returns null because there is no green box; lidar-min agrees with the full scan). Confirmed live in headless Chrome: the three new blocks render in the Car toolbox flyout with working colour dropdowns.

## Build the Drone (2026-09-02)

Last item off the original gap list: the sidebar had a disabled "Drone" entry (`id: null, phase: "Phase 6+"`) with nothing behind it — no engine model, no API, no blocks. Comparable in scope to Phase 5's arm: a full robot kind, end to end, through every layer the project has (reference model, C++ engine, WASM export, contract, sidecar/remote protocol, blocks, 3D rendering, tests at every layer, a lesson).

- **Kinematic model** (`DroneWorld` in `_sim.py`, mirrored exactly in `engine/src/drone.{hpp,cpp}`): a point mass, the same "no physics engine" spirit as the car and the arm. Four degrees of freedom — forward speed and yaw rate in the horizontal plane, plus a vertical speed — chosen so the *exact* duration-based movement mechanism the car already has (full steps + one exact partial step, collision-early-stop) reuses without new machinery. The drone **shares the car's arena footprint and its `World` tab**: same `arena_width`/`arena_height`/`robot_radius`, same obstacles rendered in its 3D scene, clamped to the same walls. It flies above the ground-level boxes, so its distance sensor deliberately ignores them — only the arena walls, floor, and altitude ceiling (`max_altitude`, default 1.0 m) are hazards, which is what `collided` and the sensor are for. **Third parity gate**, alongside the car's and the arm's: 759 states match the Python reference to 2.22e-16.
- **Contract v2** (`contracts/robot-api/v2`, `contracts/robot-remote/v2`): v1 (car+arm+lidar) unchanged via `$ref`, plus `drone_drive {forward, vertical, yaw_rate}` / `drone_stop` / `drone_reset` and `drone_state` (pose now carries `z` for altitude). The remote protocol's methods are named after the student-facing verbs (`drone_takeoff`, `drone_forward`, `drone_up`, ...), not the raw engine commands — `takeoff`/`land` compute the needed delta and drive vertically, matching the pattern `okrobo.Drone` and the studio's `ProgramRunner` both implement independently (kept in lockstep by the worker/PythonBridge tests below, not by sharing code — there's nothing to share across a Python subprocess and a browser tab).
- **Student API** (`okrobo/drone.py`): `takeoff`/`land`/`forward`/`backward`/`up`/`down`/`turn_left`/`turn_right`/`wait`/`altitude`/`distance`/`heading`/`position`/`stop` — the car's shape, plus altitude. Real, unmodified code: the same file runs against the local reference sim or, through `worker.py`'s new `Drone` remote proxy, against the studio engine — exactly like `Robot` and `Arm` already do.
- **Blocks execute as JS**, so the runtime pieces exist twice by necessity, not accident: `ProgramRunner.ts` gained a whole second movement queue (`droneMovement`, `droneMove`, `droneTurn`) mirroring the car's queue field-for-field, since the two must be independently trackable — a test proves the car and the drone can each be mid-movement at once without interfering. 8 new car-block types (`takeoff`/`land`/`forward`/`backward`/`up`/`down`/`turn_left`/`turn_right`) plus 2 sensor reporters, in a Drone-only toolbox; `okrobo_wait` is shared across all three robots (every engine steps every tick regardless of which one's movement queue is active, so a shared timer block was already safe — proven, not assumed, since the arm already relies on the same fact).
- **3D**: a simple X-frame quadrotor model (four rotor discs, a heading-marking nose cone, a plumb line straight down to the ground so altitude reads clearly in perspective) sharing the car's arena walls/obstacles rendering. Scene elevation is literally the drone's altitude — no separate "height" concept invented, `state.pose.z` maps directly to scene Y.
- **Two real bugs found by inspection while wiring lessons**, neither caught by any prior test because nothing had a third robot kind to expose them: `packs/lesson.ts`'s `parseLesson` hardcoded `robot === "arm" ? "arm" : "car"` — a `robot: drone` lesson would have silently loaded as a **Car** lesson, switching to the wrong robot on "Try this" with no error. `LessonsPanel.tsx` had the identical two-way ternary twice more, for the robot badge. Both fixed; a permanent E2E check now opens the new "Fly a square" lesson specifically to prove "Try this" switches to Drone, not Car.
- **A lesson** (`packs/core/lessons/03-fly-a-square.md`, `robot: drone`): takeoff, forward+turn, the full four-leg square, land — mirroring the car and arm lessons' pacing. The pack gate's "lessons only call APIs the runtime actually exposes" check now recognizes `drone.*` calls too.
- **A real infrastructure bug fixed in passing**: `check-dev-server.sh` and `check-studio-e2e.sh` leaked a live `vite` process on every run (hit three times while verifying this feature) — `npm run dev` runs `predev` then `dev` as separate child processes, so killing the top-level `npm` PID doesn't reliably kill the actual `vite` grandchild. Fixed with a small recursive `kill_tree`; verified fixed by running each script and confirming its port is free immediately after.

Tests: 9 new ctest cases (`test_drone.cpp`), 18 new pytest cases (`test_drone.py`: reference model + the student API, including wall/floor/ceiling collision-stop), 2 new worker RPC tests, 2 new PythonBridge dispatch tests, 8 new ProgramRunner tests against the **real WASM engine** (takeoff/land/forward/turn/stop-early-at-wall/stop-early-at-ceiling/abort/concurrent-with-car), 4 new block codegen tests, 2 new LessonsPanel tests, 1 new lesson-parser test. **Acceptance: verified in headless Chrome, full round trip** — switching to Drone shows altitude telemetry; the Python tab shows real `from okrobo import Drone` code; clicking Run executes takeoff, a four-leg 0.3 m square, and landing, ending back at its exact start position (`x 1.00 y 1.00`) and altitude 0; opening "Fly a square" and clicking "Try this" switches to Drone (not Car) and loads real `drone.takeoff(...)` code. `cargo test`, `pytest` (103), `vitest` (177), all four parity gates, and the full `test-all.sh` all green.

## A real C++ track (2026-09-02)

Last item on the original gap list. The C++ tab had been a dead placeholder since Phase 6 ("C++ track opens after Phase 6", never updated). Investigated what a *real* version would need first: firmware's C++ is low-level only (pins, PWM, a serial line protocol) — no `robot.forward()`-style student API existed in C++ anywhere, so an honest C++ tab needed that layer built from scratch, not just a Blockly generator pointed at nothing. Scoped to the Car, matching how the very first Python API also started with just the car (Phase 2) before the block library and other robots grew into it later.

- **`engine/api/robot.hpp`**: a real, header-only, standalone C++ SDK — a direct, careful port of `runtime/python/okrobo/robot.py` (same constants, same blocking duration-based movement, same early-stop-at-collision) wrapping `engine/src/world.hpp`'s `World`, which the car's own parity gate already locks to the Python reference. No new simulation math, only the friendly calling shape every other language surface already has. Compiles and runs with a single `g++` command and no build system — verified directly, not assumed: `g++ -std=c++17 -I engine/src -I engine/api program.cpp engine/src/world.cpp -o program` was run for real during this work, more than once.
- **`engine/tests/test_robot_api.cpp`**: mirrors `runtime/python/tests/test_robot.py`'s scenarios and expected numbers exactly — the same inputs, the same hand-computed numbers, asserted independently in two languages. All ten passed on the first real build.
- **Blockly generates C++ too, for the Car**: Blockly ships no C++ target, but its bundled JavaScript generator already emits valid C++ for every control/logic/math block the toolbox uses (`if (a < b) { }`, `while (true) { }` are identical in both languages) — confirmed by direct inspection of its actual output before relying on it, not assumed from the languages looking similar. Built a `cppGenerator` by borrowing those handlers from `javascriptGenerator.forBlock` and patching only the one real difference (`controls_repeat_ext`'s `for (var ...` — C++ has no `var`). Lidar and vision blocks have no C++ port yet, so they generate a clear inline comment (`/* vision not in the C++ track yet */`) rather than Blockly's opaque "does not know how to generate" error.
- **The strongest test in the diff**: a vitest case that generates C++ from a real block program, writes it to a temp file, **compiles it with a real `g++` subprocess, runs the resulting binary, and asserts its output** — not a string-shape check, an actual end-to-end proof that Blocks → C++ → compiler → running program produces the right simulated position and heading. Caught a real test-design mistake immediately: the first version asserted the *distance sensor* reading after a forward-then-90°-turn sequence, which is a different wall after turning — not a bug, just the wrong thing to assert; fixed to check position and heading instead, which the manual trace confirmed unambiguously.
- **C++ tab UI**: real generated code for the Car, replacing the dead placeholder; an honest "the Arm/Drone doesn't have a C++ SDK yet" note for the other two robots instead of stale or wrong content.

Not done, deliberately: Arm and Drone C++ SDKs (natural follow-ons, same pattern, no new design needed); compiling *from inside the studio* or flashing to hardware (there is no C++ compiler in a browser — this is a preview to take and build yourself, like Python was before Phase 3 added real execution, clearly labelled as such); camera/vision in C++.

Tests: 1 new ctest suite (`test_robot_api.cpp`, 10 cases), 3 new codegen tests including the real-compile-and-run one. `cargo test`, `pytest` (103), `vitest` (180), all four parity gates, and the full `test-all.sh` all green. **Acceptance: verified in headless Chrome** — the C++ tab shows real, correct code for the Car's preloaded wall avoider with no JS/Python leftovers; switching to Arm shows the honest unavailable-yet note instead of stale content.

This closes every item from the original gap-list audit (2026-09-02): World/environment editor, deepened block library, the Drone, and now a real C++ track.

## Arm and Drone C++ SDKs (2026-09-02)

The natural follow-on flagged when the C++ track shipped Car-only. Extended `engine/api/` with `arm.hpp` and `drone.hpp`, mirroring `robot.hpp`'s exact pattern, plus their Blockly C++ generators — so all three robots now have real, compilable C++.

- **A real naming collision, found by the compiler, not guessed**: the engine's own low-level classes were already called `okrobo::Arm` and `okrobo::Drone` (from Phase 5 and the Drone work), the same names the new student wrappers needed. Python had avoided this by naming its low-level classes `ArmWorld`/`DroneWorld`; C++ never had to until a second class needed the bare name. Fixed by renaming the engine internals to match Python exactly: `engine/src/arm.{hpp,cpp}` → `arm_world.{hpp,cpp}` (class `Arm` → `ArmWorld`), same for drone. Mechanical, ~4 files each, immediately re-verified by the full ctest + WASM parity suite (all still green, since Emscripten exports C-ABI function names, not C++ class names — the WASM boundary was never affected). A second, related collision then showed up the same way: `engine/api/arm.hpp` (student SDK) and the soon-to-be-renamed `engine/src/arm.hpp` (engine internals) shared a filename, so `#include "arm.hpp"` resolved ambiguously — caught immediately by a real compile failure ("'Arm' is not a member of 'okrobo'"), not by inspection.
- **`engine/api/arm.hpp` → `okrobo::Arm`** and **`engine/api/drone.hpp` → `okrobo::Drone`**: direct ports of `arm.py`/`drone.py`, same blocking-until-arrival / duration-based semantics, wrapping the now-renamed `ArmWorld`/`DroneWorld`. Verified standalone-compilable exactly like `robot.hpp` was — the documented `g++` command was actually run for both, not assumed from the pattern matching.
- **Blockly C++ generation extended to Arm and Drone blocks**, reusing the same borrowed-`javascriptGenerator`-handlers approach. `okrobo_wait`'s C++ generator needed to become receiver-aware (car/arm/drone), matching how Python's `pythonReceiver` already worked — and doing that surfaced a real bug in the *Car* path: the first version set the C++ receiver to the literal robot-kind string (`cppReceiver = robot`), which is correct for "arm"/"drone" but wrong for "car" (the car's student-facing variable is named `robot`, not `car`) — generating `car.wait(2);`, uncompilable. Caught by a test asserting the car case specifically, not just the two new ones; fixed by reusing the same `RECEIVER_BY_ROBOT` map the Python generator already had, rather than inventing a second one.
- **Real compile-and-run tests for all three now**, same rigor as the Car's: each generates C++ from its real starter workspace, compiles it with a real `g++` subprocess, runs the binary, and asserts its output. The drone one lands back exactly at its start position, matching the browser E2E result for the identical program.

Tests: 2 new ctest suites (`test_arm_api.cpp` — 3 cases mirroring `test_arm.py`'s Arm-API scenarios exactly; `test_drone_api.cpp` — 7 cases mirroring `test_drone.py`'s Drone-API scenarios exactly), 6 new block codegen tests including 2 real-compile-and-run ones, 2 extended wait-receiver tests (now covering C++ too, which is what caught the car/robot receiver bug). `cargo test`, `pytest` (103), `vitest` (190), all four parity gates, and the full `test-all.sh` all green. **Acceptance: verified in headless Chrome** — the C++ tab shows real, robot-specific code (car/arm/drone) that follows the robot switch immediately, with no stale content left over from the previously-active robot.

## Camera and vision in C++ (2026-09-02)

The remaining gap the Arm/Drone C++ SDK round flagged: `camera()`/`find_color()` had no C++ port on any robot, and the block generator's `okrobo_lidar_min` placeholder said "not in the C++ track yet" even though `lidar()` had actually been on `Robot` since the very first C++ commit — the block just never got wired to call it.

- **`Frame` and `camera()` added directly to `robot.hpp`** (Car only — no other language has a camera on Arm/Drone either, so this isn't a C++-specific gap): a direct port of `okrobo/camera.py`'s `Frame` dataclass, rendered by calling the engine's own `render_camera` (`engine/src/camera.hpp`) on the private `World` member — no new rendering math, the exact same deterministic raycaster every other language already uses.
- **`engine/api/vision.hpp` → `okrobo::find_color`**: a direct, dependency-free port of `okrobo.vision.find_color`, returning `std::optional<Detection>` (Python's `Detection | None` made idiomatic C++). Verified against the exact same numbers the JS/Python vision parity gate already established earlier this session (area=1152, coverage=0.375, bearing=0.00 for the dead-ahead red box) — now confirmed correct independently in a third language, not just assumed to follow from the port being "similar."
- **Fixed the stale lidar placeholder**: `okrobo_lidar_min` now generates real `*std::min_element(robot.lidar().begin(), robot.lidar().end())`, since `lidar()` was real all along. `okrobo_see_color`/`okrobo_color_bearing` now generate real `okrobo::find_color(...)` calls; `<algorithm>`/`vision.hpp` are only included when the workspace actually uses them, matching the same conditional-import pattern the Python generator already had for `find_color`.
- **The strongest test again**: builds the exact program a student would from "if sees red, back up" (nesting `okrobo_see_color` inside `logic_compare`-free `controls_if`, the same connection shape the wall avoider already uses for `okrobo_distance`), compiles it with a real `g++`, runs it, and asserts it actually detected the box (`bearing=0.00 area=1152`) and actually acted on it (backed up from x=1.00 to x=0.90).

Tests: 1 new ctest suite (`test_vision_api.cpp`, 9 cases mirroring `test_vision.py`'s scenarios and expected values exactly — colour matching, left/right bearing sign, coverage-vs-distance, unknown-colour rejection), 3 new block codegen tests including the real-compile-and-run one. `cargo test`, `pytest` (103), `vitest` (192), all four parity gates, and the full `test-all.sh` all green.

## Firmware flashing from the studio (2026-09-02)

The last real "Not done" note that wasn't deliberately deferred: `firmware/README.md` always required leaving the studio and running `arduino-cli compile`/`upload` by hand. MuJoCo and YOLO stay deliberately deferred (no feature needs contact dynamics yet; the offline-size cost still isn't worth it), and in-studio C++ compilation was already a made decision, not a gap ("a preview to take and build yourself" — build.md's own C++-track section says so). Flashing was the one genuinely open item, and `docs/decisions/serial-transport.md` had already scoped where it belongs: "Port enumeration, reconnect, and firmware flashing are OS-level jobs. Python has mature tooling; the webview has none" — the same reasoning that put `list_ports`/`connect_hardware` in the sidecar already covers flashing, so this was implementation, not a new architecture call.

- **`runtime/python/okrobo/flasher.py`**: a thin, dependency-free wrapper around `arduino-cli compile`/`upload` subprocesses. `arduino-cli` itself stays external and optional, the same treatment ROS/OpenCV/pyserial already get elsewhere in this codebase (imported/invoked lazily, never bundled) — `is_available()` checks PATH and a missing binary produces a plain install-link message instead of a stack trace or a hang. Every subprocess call is injectable (`run=subprocess.run` by default), the same `open_port`-injection pattern `serial_link.py` already used for pyserial, so all 8 unit tests run with zero real toolchain installed.
- **`okrobo.sidecar` gained `flash_firmware`**: compiles then uploads `firmware/okrobo_car` to a chosen port, streaming `{"op": "flash", "stage": ...}` events (`compile` → `upload` → `done`, or `error` at whichever stage failed) the same way `connect_hardware` already streams `{"op": "hardware", ...}`. A live hardware link is disconnected first — arduino-cli needs exclusive access to the port — so flashing never fights a stale connection for it. `OKROBO_FIRMWARE_DIR` is resolved once, matching the existing dev-vs-bundled resolution `sidecar.rs` already does for the Python runtime itself: `apps/studio/src-tauri/src/sidecar.rs`'s `Resolution` gained a `firmware_dir` field (packaged: `<resources>/firmware/okrobo_car`; dev: the repo checkout), passed to the sidecar as an env var, with `firmware/okrobo_car` added to `tauri.conf.json`'s bundled resources so a packaged install has it too.
- **4 new sidecar-level integration tests** (`test_sidecar_flash.py`, mirroring `test_sidecar_hardware.py`'s real-websocket-to-real-sidecar shape, `okrobo.flasher` monkeypatched so no real arduino-cli is needed) prove the sidecar's own sequencing: missing arduino-cli reported plainly, compile-then-upload in that order, a failed compile never reaches upload, and flashing silently disconnects a live board link first (proven by watching the fake board actually receive the stop command from the disconnect).
- **Hardware panel UI**: a ⚡ button next to each port in the picker (and a "Flash new firmware" link once connected), disabled mid-flash, echoing `compiling…`/`uploading…`/`done`/`error: ...` into the same Python output console `run`/`stop` already use, plus a dedicated status line in the sidebar itself.
- **Verified in a real headless-Chrome run against a real sidecar** (no permanent gate script for this — the sibling hardware feature, `list_ports`/`connect_hardware`, has none either; this matches that same coverage tier instead: real end-to-end sidecar tests plus a TS-level `PythonBridge` integration test against a real spawned sidecar process): clicking ⚡ on this machine (no arduino-cli installed) correctly shows "arduino-cli not found on PATH. Install it from https://arduino.github.io/arduino-cli/latest/installation/..." in both the output console and the sidebar's error note — the exact real failure mode a school without arduino-cli set up yet will hit, handled cleanly rather than crashing or hanging.

Tests: 8 new `flasher.py` unit tests (`test_flasher.py`, real subprocess-shaped fakes, no arduino-cli needed), 4 new sidecar integration tests (`test_sidecar_flash.py`), 1 new Rust test (`spawn_passes_firmware_dir_as_an_env_var`) plus an extended `dev_resolution_finds_repo_runtime` assertion, 1 new PythonBridge integration test against a real spawned sidecar. `cargo test` (29), `pytest` (115), `vitest` (193), all four parity gates, and the full `test-all.sh` all green.

Remaining "Not done" items are all deliberately out of scope for the reasons already on record: MuJoCo (deferred until a feature needs contact dynamics), YOLO models (offline-size cost), in-studio/on-device C++ compilation (a made decision, not a gap), and testing this flashing path against a physical board (needs hardware on the desk, which this environment doesn't have).

## MuJoCo arrives: the arm can pick things up and drop them (2026-09-03)

The one remaining deferred decision. MuJoCo's integration trigger
("objects to push/grasp, gravity-driven interaction") was pulled forward on
request rather than waiting for a feature to force it, so this round started
with a real feasibility question the original decision doc had only assumed
an answer to: **can MuJoCo actually be compiled to WASM for this project,
and does it produce correct physics there?** That was answered first, as an
isolated spike confined to a gitignored `tools/mujoco/` sandbox before any
engine code changed — see [docs/decisions/physics-engine.md](docs/decisions/physics-engine.md)'s
new "Integration" section for the full finding: MuJoCo 3.9.0 has first-class
upstream Emscripten support (zero patches needed), and a free-fall test
matched the exact discrete solution to machine precision.

**Scope, deliberately narrower than the original decision's wording
implied**: "MuJoCo replaces [the arm's kinematic backend] behind these same
messages" read as the arm's own joint motion migrating into an articulated
physics model. What shipped instead: MuJoCo simulates one new graspable
object — a free body with real gravity and contact — while the arm's
joints stay exactly Phase 5's kinematic model, unchanged, still gated by
the same `test_arm.cpp`/`test_arm.py`. This delivers the stated trigger
without the much bigger, different project of rewriting the arm's whole
motion model, which nothing asked for. `contracts/robot-api/v3/contract.md`
documents this explicitly as a narrower reading than v1's own note, rather
than leaving that note's wording uncorrected.

- **`engine/src/physics_object.hpp`/`.cpp`**: a small, MuJoCo-opaque wrapper
  (no MuJoCo type appears in the header) — held is plain kinematics
  (position pinned wherever the caller puts it, zero simulation cost),
  `release()` hands it to MuJoCo as a free body. `ArmWorld` gained
  `grip()`/`release()`/`ArmState.holding`/`ArmState.object`; `grip()`
  succeeds within `kGraspTolerance` (0.05 m) of the object, found reachable
  against the default `ArmConfig` by a numeric search over the joint ranges
  (not hand-derived trig) — see `engine/tests/test_arm_physics.cpp`.
- **Vendoring, twice, both gitignored under `tools/mujoco/`** (same
  treatment `tools/emsdk` already gets): `scripts/build-mujoco-native.sh`
  (host, for `engine/`'s own ctest — added via CMake FetchContent, bumping
  the engine to C++20 since MuJoCo's own implementation needs it, though its
  public C API header stays plain-C-compatible either way) and
  `scripts/build-mujoco-wasm.sh` (the proven spike recipe, formalized).
  `build-engine-wasm.sh` now links the WASM engine against the latter.
- **Python gets real physics too, not a stub**: `runtime/python/okrobo/physics.py`
  uses the official `mujoco` PyPI package, pinned to the *exact* tag
  (`3.9.0`) the C++/WASM side vendors — same solver on both sides of the
  parity gate, not just "a" solver. Pulls ~135 MB into `.deps`
  (numpy/glfw/pyopengl/absl-py/etils, all hard deps of the base `mujoco`
  package even though this project never calls its renderer) — accepted
  as the honest cost of using the official package as intended, the same
  way bundling a full CPython already was.
- **A fifth parity gate**: `engine/tests/parity/parity.mjs` replays a
  grip → swing-while-holding → release → settle scenario through both the
  WASM engine and the Python reference and compares field-by-field. The
  tolerance question was resolved by measuring, not guessing: the concern
  that the WASM build's portable scalar fallback (no AVX under Emscripten)
  might diverge from whatever SIMD the native Python wheel picks turned out
  not to matter here — the actual max diff is 5.55e-17, so the gate uses
  the same 1e-9 tolerance as every other field in this file rather than a
  loose bound that would mask a real future regression.
- **Full stack, all four languages**: `engine/api/arm.hpp` gained
  `grip`/`release`/`holding`/`object` (the C++ track's README now documents
  the extra MuJoCo link step this one class needs — `-std=c++20` and six
  more `-l` flags, the honest consequence of "no build system beyond a C++
  compiler" no longer being quite true for the Arm specifically);
  `contracts/robot-api/v3` and `contracts/robot-remote/v3` (new command/state
  fields, new RPC methods); `runtime/python/okrobo/arm.py` and `worker.py`'s
  remote proxy; the WASM `wasm_api.cpp` exports and `EngineArm.ts`/`ProgramRunner.ts`;
  four new Blockly blocks (`grip object`, `release object`, `holding
  object?`, `object height (m)`) with JS/Python/C++ codegen.
- **A real, load-bearing consequence found immediately, not assumed
  away**: the existing Arm C++ SDK compile-and-run gate test broke the
  moment `arm_world.cpp` started depending on `physics_object.cpp` — a
  plain `g++ ... arm_world.cpp` no longer linked. Fixed by adding
  `physics_object.cpp` plus the MuJoCo link flags to that test and to the
  README's documented command, not by working around it.
- **The strongest test again**: a vitest case builds a real "reach, grip,
  swing the base, release" program from Blockly blocks, compiles it with a
  real `g++` against the real headers, runs the binary, and asserts the
  object's exact settled position (`"0.30 0.00 0.03"`) — proof the object
  really fell and really stopped at the box's half-extent, not a string
  check. Verified in a real headless-Chrome run too: the Arm toolbox
  genuinely renders the four new blocks with the right labels.
- **A gap in my own verification, caught by the full gate suite doing its job**: `npx tsc --noEmit` alone (run repeatedly through this round as a quick check) only covers `tsconfig.json`; `npm run build` also runs `tsconfig.test.json`, which caught a real error `tsc --noEmit` alone missed — `statusText.test.ts`'s hand-built `ArmState` mock was missing the new `holding`/`object` fields. Fixed, and a reminder that "the quick check passed" isn't the same claim as "the actual gate passed" — `test-all.sh`'s full run is the one that counts.
- **One process-hygiene near-miss during manual browser verification**: an
  ad hoc verification script's `kill $DEVPID` missed an orphaned vite
  process (the backgrounding shell job it was tracking had already exited
  for an unrelated reason), leaving a stray dev server on port 5198 —
  caught by the same `ss -ltnp` post-check habit this session already uses,
  fixed by killing the specific leaked PID directly rather than assuming
  the generic cleanup trap had worked.

Tests: 6 new `engine/tests/test_arm_physics.cpp` cases, 7 new
`runtime/python/tests/test_arm_physics.py` cases (mirroring the C++ ones
exactly), 1 extended `test_arm.py` (state message shape), 1 new fifth
parity-gate section, 4 new `armPhysics.test.ts` vitest cases against the
**real WASM engine**, 2 new `okroboBlocks.test.ts` cases including the
real-compile-and-run one, 1 new + 1 extended Rust `sidecar.rs` test carried
over from the prior round untouched. `cargo test`, `pytest`, `vitest`, all
five parity gates, and the full `test-all.sh` all green (see the commit for
exact counts). `test-all.sh` now bootstraps `tools/mujoco/build-native`
automatically on a machine that doesn't have it yet, the same pattern it
already used for `runtime/python/.deps`.

**A real miss, caught by the user immediately after "done": the object was
never actually visible.** Every layer below the pixel — engine physics,
parity gate, contracts, Blockly, the C++ SDK — was built and gate-tested,
but `Viewport3D.tsx` never got a mesh for the graspable object, so a student
switching to Arm and running a grip/release program would see the arm move
and nothing else: no box to grip, no fall to watch. All of this session's
"verify empirically" discipline had been aimed at the simulation being
*correct*; nobody had pointed a browser at whether the result was
*visible*, which for a visual simulator is not a lesser bug, it is the
whole product. Fixed: `Viewport3D.tsx` gained a box mesh, a child of the
same `root` group the arm links use, updated every frame from
`state.object` with the identical `(x, z, -y)` sim→Three.js mapping the
drone's position updates already established, colour-coded orange (resting
free) / green (held) as a bonus is-it-gripped cue that cost nothing extra.
`DEFAULT_ARM_OBJECT` added to `contracts/robotApi.ts` alongside the existing
`DEFAULT_ARM`/`DEFAULT_WORLD`/`DEFAULT_DRONE` viewport-drawing constants,
same pattern. Verified the only way that actually proves a rendering fix:
a real headless-Chrome run against a real sidecar, clicking through the new
"Pick and drop" lesson's first step for real and screenshotting the 3D
canvas before and after — the box is visibly orange at its resting spot,
then visibly green and relocated to the tip once gripped (`tip z 0.06 m`
in the status line matching the screenshot exactly).

## Robot Builder Phase 1: Foundation (2026-09-04)

The first slice of turning OKROBO from "pick Car, Arm, or Drone and program
it" into a general-purpose, component-based Robot & World Builder. Phase 1
only, deliberately narrow: a versioned, language-mirrored **structural**
schema for an arbitrary robot — bodies, joints, actuators, sensors — plus
serialization and validation. No 3D builder UI, no MJCF generation, no
engine/WASM wiring, no Blockly/Python API changes. Car/Arm/Drone are
completely untouched — this is purely additive, sitting next to the
existing hardcoded robots until a later phase decides whether/how to
re-express them as ordinary assemblies on top of it.

New contract family `contracts/robot-def/v0/` (schema.json + contract.md +
`examples/` + `invalid/`), deliberately separate from the existing
message-oriented `contracts/robot-api/`: robot-def describes what a robot
*is* (a static document — bodies/joints/actuators/sensors), robot-api is the
protocol a running robot speaks (commands in, state out). The kinematic tree
is defined entirely by `joints[]` edges, not a `body.parent` field, mirroring
URDF and this repo's own `apps/studio/src/packs/urdf.ts` idiom exactly, so
there's never a second, possibly-disagreeing way to express the same tree.

Hand-mirrored into Python (`runtime/python/okrobo/robot_def.py`, the
executable spec — the same role `_sim.py` already plays for kinematics),
TypeScript (`apps/studio/src/contracts/robotDef.ts`), and C++
(`engine/src/robot_def.{hpp,cpp}`), following this repo's established
hand-mirror-no-codegen convention. The C++ side needed real JSON parsing for
the first time in this engine — `wasm_api.cpp` has always deliberately
avoided it, keeping the WASM boundary to primitive scalars. Vendored
**nlohmann/json** via `FetchContent`, the same mechanism already used for
MuJoCo, scoped to its own `okrobo_robot_def` CMake target that is never
linked into `okrobo_engine` and never added to
`scripts/build-engine-wasm.sh`'s source list — it structurally cannot reach
the WASM bundle students' browsers download. Recorded in
`docs/decisions/robot-definition-schema.md`, alongside the tree-via-joints
and new-family-not-a-version-bump decisions.

23 validation rules (duplicate/unknown ids, invalid geometry/mass/inertia,
invalid joint axis/limits/damping, missing-root/multiple-root/cycle
detection on the joint graph, unresolvable actuator/sensor targets), each
with its own `invalid/<rule-id>.json` fixture read identically by all three
language test suites — a rule that drifts between languages fails in all
three at once. `validate_robot_def`/`validateRobotDef`/`ValidateRobotDef`
never throw: they always return a list of issues, so a future builder UI can
show every problem on a robot at once (a deliberate departure from
`validateWorld.ts`'s throw-on-first-error style — see contract.md).
Parsing still throws on malformed shape, same posture as every existing
pack/world parser.

The graph checks (root-counting, cycle detection) needed real care to keep
every fixture triggering exactly one rule: duplicate ids are deduplicated
(first occurrence wins) before any graph logic runs, so a
`body-duplicate-id` fixture can't also manufacture a phantom extra root;
multiple joints targeting the same child are excluded from the tree (only
the first becomes an edge) so `joint-duplicate-child` can't masquerade as
`robot-cycle`; and cycle detection only runs once at least one root exists,
so a `robot-no-root-body` fixture doesn't also fire `robot-cycle` on the
same disconnected loop. Verified by writing all 23 Python tests first and
getting every one green before porting the identical logic to TypeScript
and C++ — both ports needed zero changes to the fixtures or the rule logic
once the Python version was right, and all three independently agreed on
every fixture on the first try.

Tests: `runtime/python/tests/test_robot_def.py` (52 cases: round-trip +
parametrized fixture loop + one message-wording assertion per rule),
`apps/studio/src/contracts/robotDef.test.ts` (52 cases, same structure),
`engine/tests/test_robot_def.cpp` (round-trip + fixture loop over all 23
`invalid/*.json`, C++20 defaulted `operator==` for structural equality).
`pytest` (174 passed, 1 skipped), `vitest`, `tsc --noEmit` (both
tsconfigs), and the full `engine/` ctest suite (10/10, including every
pre-existing gate) all green. Nothing outside `contracts/robot-def/`,
`docs/decisions/robot-definition-schema.md`,
`runtime/python/okrobo/{robot_def.py,__init__.py}`,
`runtime/python/tests/test_robot_def.py`,
`apps/studio/src/contracts/robotDef.{ts,test.ts}`, `engine/CMakeLists.txt`,
`engine/src/robot_def.{hpp,cpp}`, and `engine/tests/test_robot_def.cpp`
changed — the five existing parity gates, the CDP e2e script, and every pack
and lesson are untouched.

## Robot Builder Phase 2: 3D Builder (2026-09-04)

A real 3D construction UI on top of Phase 1's `robot-def` schema: a new,
standalone **Build** mode (a titlebar Simulate/Build toggle) where a
student assembles an arbitrary robot from bodies — click-select in the 3D
view or a hierarchy tree, a properties inspector, add/delete body, a
translate/rotate `TransformControls` gizmo, and real persistence through
the existing project save/load pipeline. Car/Arm/Drone, `Viewport3D.tsx`,
and the whole simulate-mode code path are completely untouched — Build
mode has its own state (`mode`, `robotDef`), its own renderer
(`apps/studio/src/builder/BuilderViewport.tsx`), and no WASM engine, since
a robot-def in progress isn't simulated yet (that's Phase 3).

New `apps/studio/src/builder/` module: `robotTree.ts` (kinematic tree from
`joints[]` edges, mirroring `validateRobotDef`'s own dedup/first-edge-wins
graph logic — cross-checked against it directly in tests so the two can't
drift apart), `robotThree.ts` (generic `RobotDef` → three.js scene graph;
one function, no per-robot-kind branching — box/sphere/cylinder/capsule/
cone/plane map to real geometry, `mesh` gets a placeholder since file
loading is out of scope), `robotEdits.ts` (default robot/body construction,
cascading body deletion through referencing joints/actuators/sensors),
`HierarchyList.tsx`, `BodyInspector.tsx` (replicates `WorldPanel.tsx`'s
draft + live-`validateRobotDef` + explicit-Apply pattern, but scoped to
just the selected body's own issues — an unrelated pre-existing error
elsewhere in the document doesn't block fixing this one), `BuilderViewport.tsx`
(two effects: a mount-once renderer/camera/`OrbitControls`/`TransformControls`/
picking effect that must never re-run — re-running it would reset the
camera on every edit — and a rebuild effect keyed on the document/selection/
gizmo mode), and `BuilderPanel.tsx` (composes the three panes as sibling
Fragment children so each participates directly in the CSS grid).

Persistence mirrors `world_custom` exactly: `robot_def: RobotDef | null` on
`ProjectPayload` (TS and Rust), `#[serde(default)]` on the Rust side for
back-compat, threaded through the same `collectPayload`/`applyProjectWorld`-
style flow in `App.tsx`. No new Tauri dependency — this repo has no native
file-dialog plugin, and the existing per-project SQLite store already had
the exact right shape for "an optional builder-authored document."

A real bug caught by the first unit test run, not by inspection: `attach()`
in `robotThree.ts` recursed infinitely on a genuine joint cycle with no
external root (`childrenOf` has no natural stopping point for a pure a↔b
cycle) — `RangeError: Maximum call stack size exceeded` on the very first
test targeting it. Fixed with an early-return guard once a body is already
attached, which doubles as the correct rendering behavior for a
`validateRobotDef`-flagged `robot-cycle` document: something still renders
rather than hanging the tab.

Verified in a real headless-Chrome run against the actual dev server, not
just the CDP e2e script: entered Build mode, created a robot, added a
second body (confirmed as an intentional extra root — `1 issue` — since
joint-creation is out of scope this phase, not a bug), edited it with the
gizmo toolbar and the inspector, deleted it, switched back to Simulate,
screenshotted the result. Status bar read
`offline · Builder · New Robot · 2 bodies · 1 issue`, matching
`formatBuilderStatus`'s format exactly; Run/Stop/Reset were correctly
greyed out (no engine exists in Build mode).

**A real scope discovery, not a shortcut**: the plan called for a
Save-As → reload → reopen persistence check in the permanent CDP e2e
script, but that script drives a plain browser against the Vite dev server,
where `isTauri()` is false and the File menu (Save/Open) stays disabled —
so that flow cannot run in this harness at all, with or without more
effort. The persistence path is instead covered where it actually can be
exercised: two extended `cargo test` cases in `projects.rs` proving the
Store really saves and reloads `robot_def` (`robot_and_world_custom_roundtrip`)
and that pre-Builder projects still load with `robot_def: None`
(`legacy_project_json_without_new_fields_still_loads`). Stated plainly in
the e2e script's own comments, the same way the arm-physics round's tests
state their coverage gaps rather than silently having them.

Tests: 8 new/extended files in `apps/studio/src/builder/` (round-trip +
fixture-cross-check tests for `robotTree.ts`, real-`THREE.Group` structural
tests for `robotThree.ts` including the cycle-recursion regression, cascade
tests for `robotEdits.ts`, RTL component tests for `HierarchyList.tsx` and
`BodyInspector.tsx`, and a `BuilderPanel.tsx` test that mocks
`BuilderViewport` — jsdom can't construct a `WebGLRenderer` — to exercise
everything else for real), 1 extended `statusText.test.ts`
(`formatBuilderStatus`), 2 extended `projects.rs` cargo tests, 11 new
`studio-e2e-check.mjs` checks. `tsc --noEmit` (both tsconfigs), `npm run
test` (294 passed), `npm run build`, `cargo test` (29 passed), and the full
`test-all.sh` gate suite (engine, firmware, Python, WASM+parity ×5, vision
parity, packs/signing, Rust, TypeScript, dev-server check, full CDP e2e)
all green.

## Robot Builder Phase 3: MuJoCo Physics (2026-09-04)

Given an arbitrary `contracts/robot-def/v0` document, real physics:
`GenerateMjcf` compiles it to MJCF and simulates it with the same vendored
MuJoCo already driving the Arm's graspable object
(`engine/src/physics_object.cpp`). New `engine/src/robot_tree.{hpp,cpp}`
(kinematic tree from `joints[]` edges, cross-checked directly against
`robotThree.ts`/`validateRobotDef`'s identical graph logic so the C++ port
and the TypeScript original can't silently diverge) and
`engine/src/built_robot.{hpp,cpp}` (`GenerateMjcf`, `class BuiltRobot`) —
bodies, joints, collision, mass, and actuators; sensors are Phase 4.

Build mode gets a top-level Edit/Test toggle. Test mode snapshots the
current document once, builds an independent `EngineBuiltRobot` against it
(never writing back — exiting Test just destroys the instance), and
renders it live in a new `TestViewport.tsx` with a simple slider per
actuator (`ActuatorPanel.tsx`).

Crossing into WASM: reversed Phase 1's deliberate no-JSON-in-WASM stance —
an arbitrary, variable-shaped document is exactly what JSON is for, and a
scalar-call accumulation API would badly reinvent it. `robot_def.cpp`/
`robot_tree.cpp`/`built_robot.cpp` joined the WASM build; `wasm_api.cpp`
gained a `built_*` export family taking/returning JSON strings via the
existing malloc/HEAPU8/free idiom. Recorded, alongside several other real
interpretive calls a schema this general forces (every root body gets a
synthesized `<freejoint/>`, a synthesized floor plane, `cone`→cylinder and
`mesh`→placeholder-box fallbacks, why `plane` collision geometry and a
non-root `free` joint can never compile, actuators targeting `ball`/`free`
joints silently skipped, an open question about which frame `joint.axis`
is really specified in), in `docs/decisions/robot-builder-physics.md`.

A real, if small, naming collision the compiler caught: `physics_object.hpp`
and the newly-included `robot_def.hpp` both declared
`namespace okrobo { struct Vec3 }`, harmless until `wasm_api.cpp` needed
both visible at once. Fixed by renaming `physics_object.hpp`'s to
`PhysicsVec3` (5 call sites, `arm_world.{hpp,cpp}` included) rather than
touching the newer, contract-governed one.

Tests: `engine/tests/test_robot_tree.cpp` (5 new cases, including two that
assert the port agrees with `validateRobotDef`'s own cycle/duplicate-child
detection), `engine/tests/test_built_robot.cpp` (3 new cases — every
fixture in `contracts/robot-def/v0/examples/` compiles, a dropped body
settles at a measured rest height, an actuator moves its target joint by a
measured amount), `apps/studio/src/engine/EngineBuiltRobot.test.ts` (new,
against the real compiled WASM module, not a mock),
`apps/studio/src/builder/ActuatorPanel.test.tsx` (new), plus 5 new
`studio-e2e-check.mjs` checks. Verified in a real headless-Chrome run:
entering Test mode requires the document to have zero error-severity
issues (`BuilderPanel` disables the button otherwise) — confirming this
needed reordering the e2e script's own checks to run Test mode after
Delete body cleared an earlier two-body test fixture back down to one,
single-root body. A first attempt at proving the render loop stays alive
with a canvas-pixel-diff check between two snapshots a few seconds apart
came back flaky — the tiny default starter body settles almost instantly
under headless Chrome's unthrottled `requestAnimationFrame`, so both
snapshots were identical (already-settled), not evidence of a frozen loop
— replaced with a simpler, honest "the canvas still exists after a few
seconds" check instead.

## Robot Builder Phase 4: Sensors (2026-09-04)

Gives runtime behavior to seven of `contracts/robot-def/v0`'s eight sensor
types — `encoder`, `gps`, `distance`, `touch`, `force_torque`, `imu`,
`lidar` (`camera` stays deferred, a genuinely different subsystem — see
below). Six share one generic mechanism: `GenerateMjcf` mounts a `<site>`
at each sensor's own `transform` and emits the matching native MJCF sensor
element (`jointpos` for encoder — direct joint attach, no site —
`framepos` for gps, `rangefinder` for distance, `touch`, `force`+`torque`,
`accelerometer`+`gyro` for imu), read back through a generic
`sensor_type`/`sensor_adr`/`sensor_dim` lookup mirroring the existing
body/actuator id-resolution pattern. `gps` deliberately uses
`objtype="site"` rather than `"body"` so a sensor's own mount offset is
actually honored, not silently ignored. Lidar has no native MJCF multi-ray
element and is computed directly via `mj_multiRay` at read time, fanning
`params_json`'s `rays`/`fov_degrees` (defaulting `9`/`180.0`, matching —
not inventing — the convention already set by `Robot.lidar()` elsewhere in
this codebase) across the mounting site's local XZ plane. Encoders pointed
at a non-scalar (`ball`/`free`/`fixed`) joint get the same defensive skip
Phase 3 gave actuators in the same situation, rather than failing the
whole robot's MJCF compile over one bad sensor.

Test mode's inspector gains a second, live-polling `SensorPanel.tsx`
alongside the existing actuators one.

Every reading was measured against the real compiled engine, not assumed —
two things only turned up by actually running it, both recorded in
`docs/decisions/robot-builder-sensors.md`: `mj_multiRay`'s `cutoff`
parameter is a search-radius hint, not a hard clamp (a ray whose true
intersection was past the requested cutoff still returned its real, longer
distance); and a box resting on a plane contacts near its four corners,
not its center, so a touch sensor site placed at a box's center can read
zero while genuinely resting on the floor —
`test_built_robot.cpp`'s touch test uses a sphere instead, to get the
single, centered contact point a touch zone can actually be aimed at (a
real, documented gap for boxes, not silently worked around). Getting the
lidar test to actually hit something also took two real fixes: the
sensor's `rotation_rpy` was left at identity, so its local +Z pointed
straight up instead of at the wall (fixed by rotating it to face +X), and
the "open" case's first fov (90°) had its downward-tilted rays legitimately
hitting the floor at a real, non-cutoff distance even with no obstacle in
front — narrowed to a 10° near-horizontal fov so the test isolates
wall-detection from floor-detection.

Tests: `engine/tests/test_built_robot.cpp` (8 new cases, one per sensor
type plus the encoder-skip case), `apps/studio/src/engine/EngineBuiltRobot.test.ts`
(extended, against the real WASM module), `apps/studio/src/builder/SensorPanel.test.tsx`
(new), 1 new `studio-e2e-check.mjs` check (the sensor panel's empty state).
`docs/decisions/robot-builder-sensors.md` also records why camera is
deferred: the Car's existing 2D raycaster (`engine/src/camera.hpp`) has no
notion of arbitrary 3D MJCF geometry and can't be extended into one, and no
offscreen-rendering mechanism exists anywhere in `TestViewport.tsx` yet —
real refactoring work, not a drop-in addition. `camera` sensors still
parse/validate fine; `SensorPanel.tsx` shows an explicit "not available
yet" placeholder rather than silently omitting them.

## Robot Builder Phase 5: World Builder Foundation (2026-09-04)

A robot can now be tested against a real environment instead of an empty
floor. New contract family `contracts/world-def/v0/` — deliberately
separate from the existing 2D `contracts/world/v1` (the Car/Drone's
arena), which requires differential-drive-specific fields (`robot_radius`/
`wheel_base`) and whose "obstacles" are non-colliding raycast targets in a
hand-rolled kinematic model, structurally incompatible with an arbitrary
MuJoCo-simulated `BuiltRobot`. Unlike `robot-def`, a world has no kinematic
tree at all: every object is independently placed and permanently static
(no joints, no actuators, no sensors, no mass) — a flat
`{id, name, transform?, geometry, material?}` list, deliberately reusing
`robot-def`'s own `Vec3`/`Transform`/`Geometry`/`Material` types directly
across all three language mirrors rather than reinventing an equivalent
shape a second time (a position/rotation and a primitive shape are the
same concept for a world object as for a robot body). `robotDef.ts`/
`robot_def.py` each got a small, additive touch-up (four previously-private
transform/geometry parse/serialize helpers made public) to make that reuse
possible without duplicating the logic; C++ still needed one small,
deliberate, documented duplication, since `robot_def.cpp`'s equivalent
helpers have internal (anonymous-namespace) linkage and are genuinely
unreachable from another translation unit.

`GenerateMjcf`/`BuiltRobot`/`built_create` all gain an optional second
`WorldDef`/JSON payload; world objects are emitted as bare
`<geom name="world_{id}" .../>` with no `<body>` wrapper — confirmed by
the existing synthesized floor geom already doing exactly this, since a
geom with no enclosing body attaches to MuJoCo's own implicit world body.
Verified as real collision, not just a rendered decoration: a robot body
positioned above a world-def platform box settles resting on the
platform's top surface (measured z=0.139892, platform top 0.1 + robot
half-height 0.04, within a 5e-3 tolerance), reproduced identically through
the WASM boundary.

The studio's Test mode gets a minimal `<select>` world picker (new
`worldThree.ts` for three.js materialization, `worldExamples.ts` for three
hand-written starter worlds — Empty/Obstacle Course/Ramp, mirroring
`robotEdits.ts`'s own precedent that `contracts/` fixtures are contract/
test assets, not something the shipped app imports directly) — deliberately
not a full drag-and-drop authoring UI, the same "schema and pipeline
first, authoring later" scoping Phase 1→2 already established. Picking a
world while already in Test mode rebuilds the physics instance live
(`EngineBuiltRobot`'s effect now depends on the selected world, not only
on entering Test mode); world objects themselves are materialized once
into the three.js scene and never touched again per frame, since — unlike
the robot's own bodies — nothing about them ever moves.

Tests: `contracts/world-def/v0/` gets the same three-language round-trip +
fixture treatment Phase 1 established for `robot-def` (Python 10 cases,
TypeScript 7, C++ round-trip + fixture loop), `engine/tests/test_built_robot.cpp`
and `EngineBuiltRobot.test.ts` each gain a world-collision case asserting
the measured settle height above, and new `worldThree.test.ts`/
`worldExamples.test.ts`/extended `BuilderPanel.test.tsx` cover the
frontend pipeline and the picker itself. `scripts/lib/cdp.mjs` gained a
`setSelectValue` helper (none of this repo's e2e checks had needed to
drive a `<select>` before) backing 2 new `studio-e2e-check.mjs` checks —
the picker lists every example world, and picking a non-empty one rebuilds
physics without losing the canvas. `./scripts/test-all.sh` green end to
end (engine ctest, firmware ctest, Python pytest, WASM+parity, vision
parity, packs, Rust desktop shell, `apps/studio` typecheck + 332 vitest
tests across 37 files + production build, dev-server check, full CDP e2e).

## Robot Builder Phase 6: Programming (2026-09-04)

A built robot can now be driven by a written program in Test mode, not just
nudged with `ActuatorPanel`'s sliders — addressed by the student's own
actuator/sensor string ids, not a fixed, hardcoded vocabulary the way
Car/Arm/Drone's own `RobotApi` is. New `apps/studio/src/program/BuiltProgramRunner.ts`
(`BuiltRobotApi`/`class BuiltProgramRunner`) is deliberately much simpler
than the existing `ProgramRunner`: MuJoCo actuators are continuous control
(set-and-forget), not the Car's discrete, step-and-resolve kinematic
movements, so only `wait(seconds)` needs real tick coordination — `set()`/
`read()`/`stop()` are synchronous passthroughs to `EngineBuiltRobot`,
resolving a student-chosen id to the underlying array index (throwing on an
unknown one, guarding the WASM boundary since `setActuatorCtrl` takes a raw
index with no validation of its own). `execute.ts`'s `runProgram` became
generic (`runProgram<Api>`) so the same AsyncFunction compiler now serves
both `RobotApi` and `BuiltRobotApi` unchanged.

`contracts/robot-api/` was deliberately not extended for this — it's
fundamentally robot-kind-specific (`v3/schema.json` hardcodes
`joint: integer 0..3`) and isn't even the live transport for anything today
(`ProgramRunner` calls WASM directly; the real Python path goes through an
ad hoc sidecar RPC). See `docs/decisions/robot-builder-programming.md`.

Two new Blockly blocks give this a Blocks UI: `okrobo_built_set_actuator`
and `okrobo_built_read_sensor`, each with a dropdown populated from the
*current* built robot's own actuators/sensors. Checked against the
installed `blockly@13.2.1` package first, not assumed: a JSON-defined
block's dropdown (`defineBlocksWithJsonArray`, what every other block in
`okroboBlocks.ts` uses) only accepts a literal options array — there is no
JSON path to a dynamic one. These two blocks are the first in this codebase
defined imperatively instead, passing a `MenuGeneratorFunction` straight
into `new Blockly.FieldDropdown(fn)`, re-invoked fresh every time the
dropdown opens, sourced from a small module-level list
(`setBuiltRobotFields`, called synchronously in `BuilderPanel.tsx`'s render
body — before `BlocksPanel`'s own mount effect calls `Blockly.inject`, the
same ordering hazard its `initialWorkspace` doc comment already flags for a
related reason). `validateOptions` throws on an empty array and Build mode
still has no joint/actuator-authoring UI, so both dropdowns fall back to a
placeholder tuple when the document has none — a real, expected v0 case,
not an edge case. A new `BlocksRobotKind = RobotKind | "built"` widens only
the Blockly-facing signatures (`BlocksPanel`'s prop,
`toolboxFor`/`starterWorkspace`/`generatePython`/`generateCpp`); `RobotKind`
itself stays untouched since `App.tsx`'s Simulate-mode robot picker,
`LessonsPanel.tsx`, and `packs/lesson.ts`'s `Lesson.robot` can never target
a built robot.

Test mode's stage gained a fixed-height Program drawer (Run/Stop + a status
span, then Blocks/Python/C++ tabs reusing Simulate mode's own
`.code-tabs`/`.code-content`/`.tab-panel` classes) docked under a new
`.builder-test-main` wrapper — `.builder-stage` became a column flexbox
(harmless for Edit mode, since `BuilderViewport`'s canvas and
`.builder-toolbar` are both `position: absolute` and ignore it).
Python/C++ are read-only, explicitly-labeled illustrative previews only —
no `okrobo.BuiltRobot` package, no `engine/api/built_robot.hpp`, no sidecar
wiring; that's real, separate infrastructure and a future phase's work, not
a silent scope cut.

A real, non-obvious physics discovery, not assumed: `abort()`/`stop()`
zero every actuator's control value, but what "zero" *means* depends on the
actuator's own MJCF mapping (Phase 3's `built_robot.cpp`) — `motor`/
`force`/`torque` map to `<motor>` (ctrl is a force, zero is genuinely
passive), `velocity` maps to `<velocity>` (zero is genuinely "stop"), but
`servo` maps to `<position>` (ctrl is a *target angle* — zero drives the
joint toward 0 rad, which is real, visible motion if it wasn't already
there). Found by a failing `BuiltProgramRunner.test.ts` assertion that
first assumed "stop" meant "freeze in place" for every actuator type — not
true for `servo`, fixed by asserting the physically correct behavior
instead (the joint settles back near 0 rad) and recorded in the decision
doc so it isn't mistaken for a bug later.

Tests: `apps/studio/src/program/BuiltProgramRunner.test.ts` (new, 7 cases
against the real compiled WASM module — set/read by id, unknown-id
rejection, `wait()` timing, `abort()`'s zero-every-actuator semantics,
`arm()` re-enabling a new run), `apps/studio/src/blocks/okroboBlocks.test.ts`
(6 new cases — empty-document dropdown fallback, JS codegen for both new
blocks, illustrative-only Python/C++ previews, toolbox/starter-workspace
resolution), `apps/studio/src/builder/BuilderPanel.test.tsx` (3 new cases,
mocking `../BlocksPanel` for the same jsdom-can't-lay-out-real-SVG reason
`BuilderViewport`/`TestViewport` are already mocked — the drawer only
renders in Test mode, Run/Stop enablement tracks the real physics
lifecycle, clicking Run drives a real `BuiltProgramRunner` end to end and
never mutates the document), 7 new `studio-e2e-check.mjs` checks (the
drawer and its three tabs, Run/Stop against the real default `wait(1)`
starter both interrupted and left to finish naturally, the drawer's absence
back in Edit mode) — all passed on the first real-browser run, no
flakiness. `npm run test` (348 passed across 38 files), `npm run build`,
and the full `test-all.sh` gate suite all green.

## Robot Builder Phase 7: Templates (2026-09-04)

Build mode's "New Robot" flow gained a real template library instead of
always creating the same single hardcoded box: a new picker dialog
(`apps/studio/src/builder/TemplateDialog.tsx`, mirroring
`apps/studio/src/dialogs.tsx`'s existing `OpenDialog` shape rather than
inventing a new modal pattern) lists three hand-written `RobotDef`
constants (`apps/studio/src/builder/robotTemplates.ts`) — Blank (today's
exact starter, unchanged), Two-Wheeled Rover (a chassis on two
continuously-rotating hinge-jointed wheels, driven by actuators), and
Simple Arm (a base plus two hinge-jointed links, one servo actuator, one
encoder). Deliberately does not touch two things earlier phases already
flagged as separate, larger decisions: migrating Car/Arm/Drone onto
`robot-def` (`docs/decisions/robot-definition-schema.md:27`), and
joint-authoring in Build mode's UI (still Phase 2's own non-goal). See
`docs/decisions/robot-builder-templates.md`.

A real, previously-undiscovered engine bug, found and worked around at the
template level rather than silently ignored: the rover's `velocity`-type
actuators are the *first* time that actuator type has ever been exercised
against real physics anywhere in this codebase (grepped: only referenced in
type definitions and a slider-range display before this). A physically
"realistic" wheel inertia crashed the instant any nonzero ctrl was applied
— surfacing in the WASM/Node test environment as an opaque
`TypeError: Cannot read properties of null (reading 'push')` inside
`printChar`/`_fd_write`. Reproduced natively instead (a small scratch
program linking `robot_def.cpp`/`built_robot.cpp` directly against native
MuJoCo, sidestepping the WASM build's incomplete I/O shim that was
swallowing MuJoCo's own diagnostic text), which revealed the real message:
`WARNING: Nan, Inf or huge value in QACC at DOF 6. The simulation is
unstable.` — MJCF's fixed `kv=1` velocity-actuator gain (no schema field to
soften it) against a very low rotational inertia blows up in the first
explicit-Euler substep, a textbook actuator/inertia stiffness mismatch, not
a logic bug. Fixed at the template level (inertia raised ~100x past
physical realism, verified natively to hold under a real 3-second drive and
a real turn, then re-verified through the actual TS/WASM path) — the
general case (any student-built robot with a `velocity` actuator on a
low-inertia joint can hit the same instability today) is explicitly left
open and documented, not silently patched over: fixing it generally is real
engine work touching every existing built robot's physics, not a
"templates" feature. A second, smaller discovery: a MuJoCo cylinder's
symmetry axis runs along its own local Z by default, so the wheels
initially lay flat like a puck rather than standing on edge like a wheel —
fixed with a 90°-about-X body rotation once a physics test caught the
resting height coming back at half the cylinder's length instead of its
radius.

Tests: `apps/studio/src/builder/robotTemplates.test.ts` (8 cases — every
template validates with zero issues, unique ids/labels, structural shape),
`apps/studio/src/builder/robotTemplates.physics.test.ts` (new, 3 cases
against the real compiled WASM — the rover settles then drives forward and
turns measurably, the arm's shoulder-actuated link moves measurably
matching its encoder reading), `apps/studio/src/builder/TemplateDialog.test.tsx`
(4 cases, mirroring `dialogs.test.tsx`'s own `OpenDialog` tests). 3 new
`studio-e2e-check.mjs` checks verify the dialog's own browser wiring (lists
real template data, picking one creates the robot) without re-deriving
template correctness already proven by the tests above — all passed on the
first real-browser run, no flakiness. `npm run test` (363 passed across 41
files), `npm run build`, and the full `test-all.sh` gate suite all green.

## Robot Builder Phase 8: Packs (2026-09-04)

A Build-mode robot can now be exported as a standalone
`contracts/robot-def/v0` file, and an installed pack's `robot_defs`
content can now actually be read back and loaded into the New Robot
picker. Investigating this phase surfaced a bigger, pre-existing gap not
specific to Robot Builder at all: `install_pack`/`list_packs` already
worked (`apps/studio/src-tauri/src/packs.rs`), but nothing ever read an
installed pack's content back out — only the bundled core pack is wired
in, via Vite's `@packs/*` build-time alias statically importing its JSON
straight into the bundle. A downloaded, non-core pack sitting in
`app_data_dir()/packs/<id>/` was completely inert. New `read_file` on
`PackStore` (wrapped as the `read_pack_file` Tauri command) closes this
generically — a plain `(pack_id, relative_path) -> bytes` read reusing the
existing, previously test-only `safe_entry_path` traversal guard — not
something robot-def-specific, so any future pack content type gets the
same read-back path for free. Deliberately does not build pack
authoring/signing/publishing — turning an export into pack content stays
a manual, teacher-side step through the existing, unchanged
`scripts/build-pack-index.mjs`/`sign-pack.mjs`, the same way
`packs/core/robots/arm.urdf` is hand-authored today, not exported by any
UI. See `docs/decisions/robot-builder-packs.md`.

`contracts/pack/v0` gained `contents.robot_defs`/`contents.world_defs`
(optional arrays, mirroring `worlds`/`robots`/`lessons`'s shape) extended
in place rather than forked to a `v1` — a deliberate divergence from
`robot-api`/`robot-def`/`world-def`'s stricter "frozen once shipped"
policy, recorded explicitly: pack.json's own hand-rolled validator
(`apps/studio/src/packs/manifest.ts`) already treated unknown `contents`
keys leniently before this phase touched it, so an old manifest stays
valid and a new one degrades gracefully against old app code.

Export has two mechanisms, since this app runs both as a plain web app and
the Tauri desktop shell, and neither had any existing file-save code
before this phase (zero `Blob(`/`download=` hits anywhere in
`apps/studio/src/`; neither `tauri-plugin-dialog` nor `tauri-plugin-fs`
was a dependency): browser mode uses a `Blob` + synthetic `<a download>`
click (no new dependency); desktop mode adds `tauri-plugin-dialog`
(checked crates.io/the official docs first, not guessed) for a native
save picker, plus one new `export_robot_file` command doing a bare
`std::fs::write` to the chosen path, mirroring `write_payload`'s existing
pattern in `projects.rs`. The read-back picker reuses Phase 7's
`TemplateDialog` rather than a new screen — a second, async-loaded
section lists robot-def content found in installed packs
(`apps/studio/src/builder/packRobots.ts`), skipping (and logging, not
throwing on) any single pack or file that fails to parse so one corrupt
pack can't blank the whole picker.

A real, stated gap in this phase's own e2e coverage, not papered over:
`studio-e2e-check.mjs` drives the app as a plain browser tab (the Vite dev
server, not the Tauri desktop shell), so every Tauri IPC call this feature
needs is unreachable from that harness — the new e2e checks prove only
what they honestly can there (the pack picker settles to a clean empty
state instead of hanging, Export doesn't crash and never mutates the
document); the real read-back and desktop-save paths are proven instead by
`packRobots.test.ts`/`exportRobot.test.ts` (mocked IPC) and the new Rust
`read_file` tests in `packs.rs`.

Tests: 3 new Rust tests in `packs.rs` (real content read from a real
installed test pack, `../`-escape rejection, missing-pack/file error not a
panic) — 32 Rust tests total, all green. `apps/studio/src/packs/manifest.test.ts`
and `corePack.test.ts` extended for the new fields.
`apps/studio/src/builder/exportRobot.test.ts` (4 cases, both branches),
`packRobots.test.ts` (5 cases, including the skip-on-corrupt-content
behavior), `TemplateDialog.test.tsx` (2 new cases), `BuilderPanel.test.tsx`
(1 new case) — all against real parsing/serialization logic, mocked only
at the Tauri IPC boundary. 3 new `studio-e2e-check.mjs` checks, all passed
on the first real-browser run. `cargo test` (32 passed), `npm run test`
(376 passed across 43 files), `npm run build`, and the full `test-all.sh`
gate suite all green.

## Robot Builder: Joint Authoring in Build Mode (2026-09-05)

Closed the gap every phase since Phase 2 restated as an accepted non-goal:
Build mode now has a real way to attach a new body to a parent with a
joint. A new "Add Joint" toolbar tool sits alongside Move/Rotate; while
active, picking a parent then a child body swaps the inspector to a new
`JointCreator` panel (`apps/studio/src/builder/JointCreator.tsx`),
mirroring `BodyInspector.tsx`'s own draft/live-validate/Apply idiom.
Researched against this app's own patterns before designing anything new
(no drag-and-drop library or `draggable` attribute exists anywhere in this
codebase) -- the toolbar-tool-then-pick-two-bodies design directly extends
`BuilderViewport.tsx`'s existing raycast-click machinery rather than
inventing a new interaction paradigm. See
`docs/decisions/robot-builder-joints.md`.

Two real design problems solved, not glossed over:

- **Picking must not teleport the child.** Before a joint exists, both
  bodies are independent roots with root-relative transforms; a joint's
  `origin` means something different (the child's pose in the *parent's*
  frame). `robotEdits.ts`'s new `computeJointOrigin(parent, child)` composes
  real `THREE.Matrix4`s (not a naive position subtraction -- either body
  may already be rotated) so the child's world pose is bit-for-bit
  unchanged the instant Apply is clicked; `JointCreator` then resets the
  child's own `transform` to identity, matching how the shipped templates
  already author a jointed child's mount point. Verified against the
  actual invariant (`parent ∘ origin` reconstructs `child`), not hand-typed
  literals that could just as easily encode an arithmetic mistake.
- **Validation reuses the real rules via a diff, not a reimplementation.**
  A bad joint can surface its error on either body, the joint itself, or
  the whole robot (a cycle can land on any body in the loop) -- rather
  than guessing which, `issuesIntroducedBy(before, after)` (`robotEdits.ts`)
  diffs `validateRobotDef`'s own output before vs. after the draft joint
  and gates Apply on anything new, so every one of `joint-duplicate-child`/
  `robot-cycle`/`joint-self-loop`/etc. is enforced through its one real
  implementation.

A second, real input path beyond what was originally scoped: `HierarchyList`
rows are wired to the same picking handler as the 3D viewport's raycast
click, added because it's a genuine standalone improvement (a real
DOM-button alternative to hunting for a body in 3D) that also happens to
close a testing gap honestly -- `studio-e2e-check.mjs` has no way to
compute where a body renders on screen for a coordinate-based 3D click
(the same limitation already stated plainly for gizmo-drag), so the new
e2e checks drive the tree instead of faking coordinates.

Tests: `robotEdits.test.ts` (7 new cases -- `nextJointId`, three
`computeJointOrigin` cases including the self-checking reconstruction
invariant, three `issuesIntroducedBy` cases), `JointCreator.test.tsx` (7
cases: defaults, type-dependent field visibility, a valid Apply, a
duplicate-child rejection, a manufactured-cycle rejection, Cancel).
`BuilderPanel.test.tsx` (3 new cases: Add Joint's disabled state, the full
pick-then-Apply flow via the extended `BuilderViewport` mock, Cancel
staying in the tool). 4 new `studio-e2e-check.mjs` checks (tool entry and
hint text, parent/child picking via real `HierarchyList` rows, the form
appearing, Apply actually restructuring the tree) -- all passed on the
first real-browser run. `npm run test` (394 passed across 44 files),
`npm run build`, and the full `test-all.sh` gate suite all green.

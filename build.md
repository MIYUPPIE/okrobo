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

## CAD Kernel — Phase 1: Foundation (2026-09-05)

First slice of the CAD initiative the user asked for after Joint Authoring
shipped: real parametric CAD solid modeling (Extruded/Revolved/Boundary
Boss & Cut, Chamfer, Draft, Shell, Fillet), scoped across 7 phases with the
user explicitly choosing "Full CAD kernel (OpenCascade.js)" over a
primitive-only approximation. This phase ships only Extrude, end to end,
with **no sketch UI and no Build-mode changes at all** -- kernel
integration, a new `cad_mesh` geometry variant, a real three.js render, a
real MuJoCo collider, and one offline-authored example. See
`docs/decisions/cad-kernel-foundation.md` for the full reasoning; summary
below.

Adopted [replicad](https://github.com/sgenoud/replicad) (MIT), a
high-level wrapper around `opencascade.js` (the WASM port of OpenCascade,
LGPL-2.1) purpose-built for sketch -> extrude/revolve/loft ->
fillet/chamfer/shell/draft. `contracts/robot-def` forks `v0` -> `v1` (v0's
own contract.md states a real frozen-once-shipped policy, unlike
`pack.json`'s in-place Phase 8 extension) -- all three mirrors
(`apps/studio/src/contracts/robotDef.ts`, `runtime/python/okrobo/robot_def.py`,
`engine/src/robot_def.{hpp,cpp}`) moved to v1 together, adding one new
`Geometry` variant: `cad_mesh` (flat, baked `vertices`/`faces` arrays, no
live feature tree yet -- that's Phase 7).

The one real technical risk -- getting a physics-collidable mesh into
MuJoCo's WASM build with no filesystem -- was resolved by empirical proof,
not assumption. Research flagged the STL-decoder-plugin/VFS-file path as
carrying an unverified static-linking risk; instead, a native scratch C++
program (compiled against `tools/mujoco/build-native/lib/libmujoco.a`)
proved `mjs_addMesh`/`mjs_setName`/`mjs_setFloat(uservert)`/`mjs_setInt(userface)`,
called on the `mjSpec*` between the engine's existing `mj_parseXMLString`
and `mj_compile` calls, compiles a `<geom type="mesh">` with **no**
`<asset>` block at all. `built_robot.cpp`'s new `AddCadMesh` is that exact
technique, shipping now; its own gate test drops a hand-authored 8-vertex
box mesh under real gravity and confirms it settles at the *same* resting
height (0.04 m) a native box geometry of the same size would -- proof of a
real convex-hull collider, not a placeholder (which would settle at a
different, wrong height).

`cad_mesh` support was extended to world-def objects too (not just robot
bodies) -- not optional, since `world_def.cpp`/`worldDef.ts`/`built_robot.cpp`
all reuse `robot_def.hpp`'s shared `GeometryType` enum in `-Werror`
switches with no `default:` case; adding the new enum value forced a real
decision at every one of them, the same way TypeScript's own exhaustiveness
checking already forced `BodyInspector.tsx`/`robotThree.ts` earlier in this
phase.

`replicad`/`opencascade.js` (~23 MB WASM) stays entirely out of the main
app bundle -- confirmed via a real `npm run build`, whose output chunk list
has no trace of it, since nothing in the running app's import graph
reaches the new `apps/studio/src/cad/` directory yet. `kernel.ts` holds
the real sketch/extrude/mesh logic (portable to Node and a browser
Worker); `worker.ts` is a real, ready `comlink`-exposed Worker entry point
for Phase 2's eventual sketch UI, unused today; `extrude.ts` (the plan's
promised public API) calls the kernel directly rather than through the
worker, since nothing in a live tab needs off-main-thread isolation yet --
and a direct call is what makes it runnable under plain Node (the offline
authoring script, `scripts/generate-cad-examples.mjs`) and testable under
vitest's `node` environment.

That script actually ran the real kernel and produced
`contracts/robot-def/v1/examples/cad-l-bracket.json` -- two real extruded
slabs welded with a fixed joint, not a canned fixture -- and the new
example round-trips cleanly through all three language mirrors (added
explicitly to Python's and C++'s hardcoded example lists; TypeScript picks
it up automatically since it globs the whole `examples/` directory).

Tests: `robotDef.test.ts` (+cad_mesh geometry suite, 4 cases: round-trip,
non-multiple-of-3 rejection, out-of-range face index, non-numeric throw),
`robotThree.test.ts` (+1: `cad_mesh` produces a real `BufferGeometry`, not
the mesh-placeholder box), `test_robot_def.py`/`test_robot_def.cpp`
(mirrored cad_mesh suites + the new example), `test_built_robot.cpp` (+1:
the real-collider settling proof), `extrude.test.ts` (2 cases against the
*real* replicad/OpenCascade pipeline -- no mocks -- asserting non-degenerate
mesh bounds for a box and a cylinder extrusion). `npm run test` (402
passed across 45 files), `npm run typecheck`, `npm run build`,
`ctest` (13/13), `python3 -m pytest` (189 passed), the WASM/parity gate,
and the full `test-all.sh` gate suite (including the browser E2E suite)
all green.

## CAD Kernel — Phase 2: Sketch UI (2026-09-05)

Build mode can now create a real `cad_mesh` body for the first time --
Phase 1 shipped the whole kernel/geometry/render/collider pipeline with
deliberately zero UI. A new "Extrude" toolbar tool opens `CadExtrudeCreator`
(`apps/studio/src/builder/CadExtrudeCreator.tsx`): pick a profile (Rectangle
or Circle -- the only two the kernel supports), type exact dimensions,
watch a live 3D preview update as you type, click Apply. Researched first
(zero 2D canvas/drag-drawing precedent anywhere in this codebase, same
finding the joints decision doc already made for drag-and-drop) and
presented the resulting fork directly to the user -- a freeform 2D sketch
surface vs. a parametric dimensions form -- who chose the parametric form.
See `docs/decisions/cad-kernel-sketch-ui.md`.

This is the first time the real browser Worker + real OpenCascade WASM
(`apps/studio/src/cad/worker.ts`, built in Phase 1 specifically for this)
gets exercised by anything other than a direct Node call. A new
`cadClient.ts` lazily constructs exactly one Worker, memoized for the
session -- confirmed via a real production build that the worker chunk
(~274KB) and the WASM asset (~23MB) both land separately from the main
bundle, which grew by only ~9KB from Phase 1's build. The live preview
(`BuilderViewport.tsx`'s new third effect) renders a separate, never-
raycast-reachable ghost mesh built from the same `geometryFor` `cad_mesh`
branch Phase 1 already shipped, positioned via the same `makeCadBody`
helper (`robotEdits.ts`) Apply itself uses -- so a part can never visually
"jump" between preview and Applied. Every numeric field is validated
client-side before ever calling the worker (OpenCascade throws on
degenerate input like zero width), so a bad value shows an inline error
instantly with no debounce wait.

Tests: `cadClient.test.ts` (5 cases, the first mocked-`Worker`+comlink test
in this repo -- a real browser Worker doesn't exist under vitest),
`robotEdits.test.ts` (+4: `makeCadBody`), `CadExtrudeCreator.test.tsx` (8
cases, using `vi.useFakeTimers()` + `fireEvent` rather than `userEvent` to
sidestep a known userEvent-v14/fake-timer interaction, plus `act()`-wrapped
timer advances so React actually flushes the debounced worker call's own
state updates before each assertion), `BuilderPanel.test.tsx` (+5: tool
mutual exclusivity, Apply/Cancel wiring, preview pass-through, via a new
`CadExtrudeCreator` stub mirroring the existing `BuilderViewport`/
`TestViewport` stubs). 7 new `studio-e2e-check.mjs` checks -- the one place
the real Worker + real OpenCascade WASM gets driven through actual UI
interaction, run against a real dev server and a real headless browser: a
cold rectangle extrude (~30s WASM+Worker spin-up budgeted), a warm circle
extrude, Apply landing a real schema-valid `cad_mesh` body, and a
degenerate-input rejection that never touches the worker at all. One real
bug found and fixed while first running these for real (not assumed): a
coordinate-based `clickText` immediately following Apply's own DOM
mutation raced the re-render and intermittently missed -- removed
entirely once traced back to Apply already auto-selecting the new body
(mirroring "+ Add body"'s own behavior), so no click was needed there in
the first place. `npm run test` (424 passed across 47 files), `npm run
typecheck`, `npm run build`, and the full `test-all.sh` gate suite
(including the new CAD E2E checks, run for real against a live dev server
and headless Chrome) all green.

## CAD Kernel — Phase 3: Revolve + Boundary (2026-09-05)

Two more real CAD operations in Build mode, reusing every piece of Phase
2's infrastructure (the `cad_mesh` contract, the comlink Worker, the live-
preview mechanism): **Revolve** (a profile swept around the world Y axis --
a lathe operation, e.g. a torus from a circle profile, a ring from a
rectangle one) and **Boundary** (a solid lofted between an independently-
chosen Start and End profile -- e.g. a circle blending into a rectangle).
See `docs/decisions/cad-kernel-revolve-boundary.md`.

Both operations were empirically verified against the real replicad/
OpenCascade kernel before writing the implementation plan, the same
discipline that found the MuJoCo mesh-injection technique in Phase 1. Two
real, non-obvious gotchas surfaced this way, not from documentation:

- **Revolve's own `origin` config must be explicit.** Left at its
  documented default ("the sketch origin"), it resolves to the *offset
  point itself* -- the revolution axis then runs straight through the
  profile's center, self-intersecting for a full 360deg sweep, and threw a
  real (opaquely reported) WASM exception the first time it was tried.
  `revolveMesh` (`apps/studio/src/cad/kernel.ts`) now always passes
  `origin: [0,0,0]` explicitly. `CadRevolveCreator.tsx` also rejects an
  `offset` smaller than the profile's own half-extent client-side, before
  ever calling the worker -- that configuration is always self-
  intersecting for the same reason.
- **`loftWith`'s doc comment claims it deletes its own input sketches** --
  verified directly (calling `.delete()` on them again afterward never
  throws and the resulting solid stays usable either way), so `loftMesh`
  deletes both explicitly regardless, matching `extrudeMesh`/`revolveMesh`'s
  own consistent cleanup posture.

`CadExtrudeCreator.tsx`'s own debounce/cancel/status lifecycle (~25 lines)
was extracted into a new shared hook, `apps/studio/src/builder/useCadPreview.ts`,
once Revolve and Boundary needed the identical logic in the same phase --
three real call sites landing together, not a hypothetical future reuse.
`CadExtrudeCreator` was retrofitted to use it too; its own test suite
re-ran unchanged afterward, confirming a pure internal refactor with no
external behavior change. `CadBoundaryCreator.tsx` allows its Start and End
profiles to be independently Rectangle or Circle -- the kernel cost of a
cross-shape loft is zero, so there was no reason to restrict it to
matching shapes.

Tests: `extrude.test.ts` (+5 real-pipeline cases: a torus, a solid-of-
revolution edge case, a partial-angle revolve, and two lofts -- rectangle-
to-circle and circle-to-circle, all against the real kernel, no mocks),
`cadClient.test.ts` (+2 mocked-wiring cases), `useCadPreview.test.ts` (new,
4 cases including a stale-response race), `CadRevolveCreator.test.tsx` /
`CadBoundaryCreator.test.tsx` (new, 7 and 6 cases respectively, mirroring
`CadExtrudeCreator.test.tsx`'s own fireEvent+fake-timer technique),
`BuilderPanel.test.tsx` (+7: two new toolbar tools, three-way CAD-tool
mutual exclusivity, Apply/Cancel wiring for each). 8 new
`studio-e2e-check.mjs` checks (Revolve and Boundary each opening their own
form, computing a real preview through the already-warm CAD worker, Apply
landing a real schema-valid `cad_mesh` body). One more real bug found and
fixed while first running those for real: a coordinate-based click
immediately following a just-clicked Cancel/Apply raced the re-render and
missed -- the same class of bug Phase 2 already found once, fixed the same
way (an eval-based click instead of a coordinate-based one). `npm run
test` (455 passed across 50 files), `npm run typecheck`, `npm run build`
(bundle chunks stay the same shape as Phase 2 -- worker/WASM separate from
the main bundle, which grew by only ~8KB), and the full `test-all.sh` gate
suite (including all new E2E checks, run for real against a live dev
server and headless Chrome) all green.

## CAD Kernel — Phase 4: Cut operations (2026-09-05)

Extruded Cut, Revolved Cut, Boundary Cut -- the boolean-subtraction
counterpart to every Boss operation shipped so far, each removing a tool
shape from an **existing** body in place instead of creating a new one.
This looked architecturally blocked at first (Phase 1-3 bodies are baked,
frozen mesh data with no live B-rep to boolean against) but isn't:
replicad exposes a second, mesh-native boolean path via a new dependency,
`manifold-3d` (~530KB WASM, tiny next to OpenCascade's ~23MB, loaded
lazily in the same Worker). A baked body's mesh round-trips through an
STL blob into a real, boolean-operable `MeshShape` with zero *additional*
precision loss (STL is itself a flat triangle format, nothing curved left
to facet a second time) -- verified end to end with a real scratch test
before committing to the design (a baked box, an off-center cylinder
tool, a real 72-vertex cut result, outer bounding box unchanged) exactly
the same discipline that found Phase 3's revolve-origin gotcha. Two more
real questions were resolved the same way before writing `cutMesh`'s final
body: `Solid.translate()` returns a new object (the original still needs
its own `.delete()`), and the cut result stays fully usable even after
every input is deleted immediately. See
`docs/decisions/cad-kernel-cut-operations.md`.

The user chose "any body type" as a Cut target over restricting to
already-`cad_mesh` bodies -- covering the real common case (drilling a
hole in a plain box) directly. The bridge:
`apps/studio/src/builder/geometryToMesh.ts` reuses `robotThree.ts`'s
existing `geometryFor` (already built for rendering every primitive type)
and reads its buffers back into the same flat mesh shape the kernel
already works with -- no new tessellation code. A cut body permanently
becomes a baked `cad_mesh` part afterward, same as any Boss body -- no
live feature tree yet (Phase 7).

Each Cut creator needed the identical profile-authoring fields its Boss
counterpart already has, plus a new Position (X/Y/Z) block -- rather than
writing that block a 5th and 6th time, `CadProfileFields.tsx` was
extracted and `CadExtrudeCreator`/`CadRevolveCreator`/`CadBoundaryCreator`
retrofitted to use it too, their own test suites re-running unchanged
afterward to confirm a pure internal refactor. Caught and fixed one real
wording regression during that retrofit before it shipped: the generic
version produced "Start Radius" (capitalized) where the original produced
"Start radius" (lowercase). `BuilderViewport.tsx` gained a new `bodyPick`
prop (a single pick, structurally parallel to but not unified with the
existing two-step `jointPick`) and a `suppressedBodyId` prop that hides
the target's own real mesh while its live cut-result preview shows in its
place.

Tests: `extrude.test.ts` (+2 real-pipeline cases: a hole punched through a
box with its outer bounding box unchanged, plus revolved/lofted cutting
tools), `cadClient.test.ts` (+1 mocked wiring), `geometryToMesh.test.ts`
(new, 5 cases -- box/sphere/cylinder/cad_mesh/undefined all produce sane
flat arrays), `robotEdits.test.ts` (+4: `replaceBodyGeometry`), three new
Cut creator test files (7/5/5 cases), `BuilderPanel.test.tsx` (+11: the
picking flow, three new stubs, all-eight-tools mutual exclusivity). 10 new
`studio-e2e-check.mjs` checks -- picking an existing plain box body and
chaining all three Cut tools onto it in sequence (box to cad_mesh via
Extruded Cut, then Revolved Cut and Boundary Cut onto the now-already-
cad_mesh body), proving Cut works on both a fresh primitive and an
existing CAD part, through the real Worker + real OpenCascade + real
Manifold. One real bug found and fixed while first running those for
real: the check assumed the starter "Chassis" body would still exist at
that point in the flow, but the *earlier* Add Joint section's own "Delete
body" step deletes Chassis itself, not its joint partner -- traced
directly (a short isolated replay reproduced the wrong assumption, not a
timing race) and fixed by targeting the body that actually survives
(`body-2`). `npm run test` (492 passed across 54 files), `npm run
typecheck`, `npm run build` (manifold's WASM lands as its own separate
asset, main bundle grew by only ~11KB), and the full `test-all.sh` gate
suite (including all new E2E checks, run for real against a live dev
server and headless Chrome) all green.

## CAD Kernel — Phase 5: Fillet + Chamfer (2026-09-05)

Rounding (Fillet) and beveling (Chamfer) edges, shipped two ways: an
optional step inside each Boss creator (Extrude/Revolve/Boundary) that
lets a student round/bevel edges of the shape they're building before
Apply bakes it, and a new standalone "Fillet/Chamfer" tool targeting an
already-placed box or cylinder body -- the user chose this wider scope
over the narrower "Boss-flow only" option via `AskUserQuestion`.

The real constraint, found before planning further: `Solid.fillet()`/
`.chamfer()` only exist on a live OpenCascade B-rep, never on `MeshShape`
(Cut's own output) or any baked mesh -- every already-placed body has
exactly that baked shape, no live solid behind it. So this can only
target a fresh Boss shape mid-creation, or a body whose exact analytic
parameters are already known (a box's `size`, a cylinder's
`radius`/`length` -- rebuilt via replicad's own `makeBox`/`makeCylinder`
with zero information loss, verified to match `robotThree.ts`'s own
centered/axis conventions exactly). Sphere/cone/capsule/plane bodies and
any already-baked `cad_mesh` body stay out of scope until a real feature
tree exists (Phase 7).

Identifying a picked edge turned out to need real verification, not
assumption -- the obvious approach, `Shape.hashCode`, was tried and
rejected: two independently-built, geometrically identical boxes produced
entirely different hash sets (hashCode is tied to the OCC object
instance, not the shape's geometry). The reliable identifier instead: a
geometric descriptor point on the edge (a straight edge's own true
midpoint, or an interior polyline sample for a curved one -- never a
shared vertex, which matched 2-3 edges at once in testing), re-found via
`EdgeFinder.near(point, tolerance)` on any freshly rebuilt, geometrically
identical solid -- verified this survives an independent rebuild end to
end. This keeps the kernel fully stateless, matching every other CAD
operation shipped so far (no live solid handle kept alive across worker
calls). Also verified: multiple edges with different values in one
`.fillet()` call (the callback form of `RadiusConfig`), and a chained
`.fillet(...).chamfer(...)` targeting different edges of the same solid --
though chaining surfaced a real, documented limitation: filleting one edge
trims/moves its immediately adjacent edges, so a chamfer recorded against
the pristine shape can fail to find a neighbor on the already-filleted
result (replicad throws a clear, catchable error for this; non-adjacent
edges are unaffected). See `docs/decisions/cad-kernel-fillet-chamfer.md`.

Every prior pick interaction in this codebase (Add Joint, Cut) already
ships with a real DOM element as the canonical, E2E-tested input path --
there's no per-edge equivalent to reuse, so this phase adds one:
`FilletEdgeList.tsx` renders one row per edge with an Add button (picking
via the DOM, not a 3D click); `BuilderViewport.tsx` gets a companion
`edgeOverlay` prop -- colored lines, recolored once picked -- as a purely
visual aid, no new raycasting layer. `useCadPreview` became generic
(`useCadPreview<T = CadMesh>`) so the identical debounce/status lifecycle
also drives this second, independent "pickable edges" preview every
fillet/chamfer-capable creator needs. `CadPreview` gained an optional
`rotation` field too -- a small, directly relevant side-fix: the ghost-
preview effect only ever set `.position`, so editing an already-rotated
body in place (Cut, and now this tool) rendered a visually misaligned
ghost even though the final baked result was always correct.

Tests: `extrude.test.ts` (+4 real-pipeline cases: pickable edges for a
Boss shape and a standalone primitive, a mixed fillet+chamfer round trip,
an oversized-radius throw caught with a readable message),
`cadClient.test.ts` (+2 mocked wiring), `filletPicks.test.ts` (new, 8
cases), `FilletEdgeList.test.tsx` (new, 6 cases), the three Boss creators'
own test suites extended (+3 fillet-flow cases each, existing cases
re-verified passing), `CadFilletChamferEditor.test.tsx` (new, 8 cases:
unsupported-type message, box/cylinder happy paths, pick/apply/cancel),
`BuilderPanel.test.tsx` (+3: the new tool's pick/apply/cancel flow,
mutual exclusivity now covering nine tools). 4 new `studio-e2e-check.mjs`
checks -- an embedded fillet inside Extrude, then the standalone tool on
a fresh plain box body with one fillet and one chamfer on deliberately
non-adjacent edges. Two real bugs found and fixed while first running
those for real, both in the *test script* rather than the app: a
hardcoded target body id ("body-4") that drifted once earlier Boss
sections in the same continuous document had already claimed that id
(fixed by reading the newly-added body's id back from the DOM instead of
assuming it), and the adjacent-edge fillet+chamfer limitation itself
(fixed by picking two edges that don't share a vertex). `npm run test`
(534 passed across 57 files), `npm run typecheck`, `npm run build` (no
new WASM asset -- fillet/chamfer only ever needs OpenCascade), and the
full `test-all.sh` gate suite (including the new E2E checks, run for real
against a live dev server and headless Chrome) all green.

## CAD Kernel — Phase 6: Shell + Draft (2026-09-06)

Shell (hollow out a body, removing picked faces, leaving a wall of a given
thickness) and Draft (taper picked faces by an angle), each shipped as a
new standalone tool targeting an already-placed box or cylinder body --
the user chose this narrower scope over also embedding either as a step
inside Extrude/Revolve/Boundary, since both apply one shared global
parameter (a thickness, or an angle) to their whole pick set, not a
per-element one like Fillet/Chamfer's own radius, and embedding either
raised real, unresolved ordering questions against Fillet/Chamfer's own
picks with no obvious default.

Same live-B-rep constraint and edge-picking discipline as Phase 5 (only a
fresh Boss shape mid-creation, or an exactly-reconstructable box/cylinder
primitive, has a solid to pick from; `Shape.hashCode` confirmed unstable
across independent rebuilds again, ruled out as an identifier again) --
but a real, non-obvious difference surfaced for faces specifically: a
face's own mesh-triangulated centroid isn't a safe stand-in for the exact
`Face.center` the way an edge's own polyline sample was safe for edges.
Verified empirically -- a cylinder's curved side face's mesh centroid
landed ~0.054 units off the true center, uncomfortably close to the
planned matching tolerance. So `previewFaces()` returns real `Face.center`
values alongside the mesh, carried through end to end rather than
re-derived from the mesh client-side. Also verified: `FaceFinder.either()`
correctly selects an arbitrary set of picked faces (not just one) via a
logical OR across `.near()` filters, since chaining `.near()` calls
directly would AND them instead. And a real, gracefully-handled gotcha:
`.draft()` throws when a picked face is parallel to its neutral plane (a
box's own top face vs the default "XY") -- side walls and a cylinder's
curved side work reliably against that same fixed plane, so the tool
never exposes a plane picker at all this phase. See
`docs/decisions/cad-kernel-shell-draft.md`.

`toleranceFor()` extracted from `applyFilletPicks`'s own inline
bounding-box-diagonal calculation, now shared by three callers.
`shapeFromGeometry` (the box/cylinder -> FilletBaseShape mapping) pulled
out of `CadFilletChamferEditor.tsx` into its own small module,
`cadTargetShape.ts`, once a third standalone editor needed it too. Shell
and Draft are structurally identical standalone editors (pick faces via a
new `FacePickList.tsx` -- a Select/Deselect toggle, simpler than
`FilletEdgeList.tsx`'s own Add-then-configure rows, since there's no
per-face value -- author one shared numeric parameter, Apply replaces the
target's geometry in place via the existing `replaceBodyGeometry`), so one
shared `CadFacePickEditor.tsx` (parameterized by title/value-label/
validation/which kernel call to make) serves both rather than two
near-duplicate files. `BuilderViewport.tsx` gained a `faceOverlay` prop
mirroring `edgeOverlay`'s own visual-only-aid posture -- one
semi-transparent `THREE.Mesh` per picked-or-pickable face, built via
`setDrawRange` over a shared vertex/index buffer rather than copying per
face, no raycasting added.

Tests: `extrude.test.ts` (+7 real-pipeline cases: face-list sanity for a
box and a cylinder, shell removing one and multiple faces with a real
bounding-box-unchanged check, draft on a box's side wall and a cylinder's
curved side, the parallel-face-throws case), `cadClient.test.ts` (+3
mocked wiring), `cadTargetShape.test.ts` (new, 4 cases), `FacePickList.test.tsx`
(new, 6 cases), `CadFacePickEditor.test.tsx` (new, 10 cases covering both
Shell- and Draft-shaped configurations), `BuilderPanel.test.tsx` (+6: both
new tools' pick/apply/cancel flow via `it.each`, mutual exclusivity now
covering eleven tools). 12 new `studio-e2e-check.mjs` checks -- Shell and
Draft each on their own fresh plain box body. One real bug found and
fixed while first running those for real: picking the target body's own
hierarchy row via a coordinate-based click intermittently missed once the
list had accumulated enough prior rows from earlier sections in the same
continuous document -- the exact click race this file's own `evalClick`
docstring warns about, fixed the same established way (a real DOM
`.click()` instead). `npm run test` (570 passed across 60 files), `npm run
typecheck`, `npm run build` (no new WASM asset), and the full
`test-all.sh` gate suite (including the new E2E checks, run for real
against a live dev server and headless Chrome) all green.

## CAD Kernel — Phase 7.1: Feature tree data model (2026-09-06)

The user chose the most ambitious of three presented Phase 7 scopes: a
genuinely reorderable, live-recomputing feature tree. Large enough to need
its own internal roadmap (4 sub-phases); this is 7.1 only -- the data
model, every existing creator writing its own feature entry, and a new
read-only panel. No editing, no recompute, no reordering yet.

`contracts/robot-def` forked v1 -> v2 (per its own frozen-versioning
policy): one new optional `Body.features: Feature[]`, a discriminated
union covering every operation Build mode's CAD tools already perform
(root kinds `extrude`/`revolve`/`loft`/`box`/`cylinder`; modifier kinds
`cut`/`fillet_chamfer`/`shell`/`draft`), plus `Profile`/`CadPick`/
`FilletChamferPick`/`BossOperation`. `CadPick.source_step`/`local_index`
are stored but read by nothing yet -- reserved for Phase 7.2's real
topological identity (OpenCascade's own `Modified`/`Generated`/
`IsDeleted` history via replicad's own exported `getOC()`, verified
empirically this session as reachable with no fork of replicad needed,
including a two-step cut-then-fillet chain correctly tracking one face's
identity through both operations). One new validation rule,
`body-features-without-cad-mesh`. All three mirrors (TypeScript, Python,
C++) updated in the same commit, same as every prior contract version
bump.

Every standalone modifier tool (Fillet/Chamfer, Shell, Draft, Cut) can
only ever target a bare box/cylinder body (Phase 5/6's own
`shapeFromGeometry` restriction), and once touched, that body permanently
stops being a valid target again -- so in every real call path, a
modifier's own target has no recorded history yet, but does have exactly-known
prior geometry. `robotEdits.ts`'s `replaceBodyGeometry` synthesizes that
missing root once, generically (`implicitRootFeatures`), rather than
silently dropping it. The three Boss creators (Extrude/Revolve/Boundary)
can already bake two features in one Apply, since each supports an
embedded Fillet/Chamfer step (Phase 5) on its own not-yet-baked shape --
`makeCadBody`/`replaceBodyGeometry` both take a `Feature[]`, not a single
`Feature`, for exactly this reason.

New read-only `FeatureTreeList.tsx`, wired into `BodyInspector.tsx` right
below the existing "CAD part -- baked mesh, not editable here" note: one
line per feature, in order, naming the same tools/labels Build mode's own
toolbar already uses ("Boundary" for a `loft`, "Extruded"/"Revolved"/
"Boundary" for a `cut`'s own tool kind) -- nothing clickable or
reorderable yet (7.3/7.4's job).

Tests: `robotEdits.test.ts` (+9: makeCadBody/replaceBodyGeometry feature
writes, synthesized-root cases for box/cylinder/sphere, appending to an
existing history), all three Boss creator test files, all three Cut
creator test files, `CadFilletChamferEditor.test.tsx`,
`CadFacePickEditor.test.tsx`, `BodyInspector.test.tsx` (+2), and the new
`FeatureTreeList.test.tsx` (new, 6 cases covering every feature kind's own
label). 4 new `studio-e2e-check.mjs` checks against a live CAD worker --
an Extrude-with-embedded-fillet body and three separately-modified plain
boxes (Fillet/Chamfer, Shell, Draft), each confirming the Construction
history panel renders the synthesized root plus the real applied step, in
order. `npm run test` (600 passed across 61 files), `npm run typecheck`,
`python3 -m pytest` (204 passed, 1 skipped), `ctest` (13/13), and the full
`test-all.sh` gate suite (including the new E2E checks, run for real
against a live dev server and headless Chrome) all green.

## CAD Kernel — Phase 7.2: Live-recompute executor (2026-09-06)

The real hard part: a new module, `apps/studio/src/cad/executor.ts`,
reimplements fillet/chamfer/shell/draft directly against raw OpenCascade
builders (`BRepFilletAPI_MakeFillet`/`MakeChamfer`,
`BRepOffsetAPI_MakeThickSolid`, `BRepOffsetAPI_DraftAngle`, reached via
replicad's own exported `getOC()` -- no fork needed) instead of replicad's
own `.fillet()`/`.chamfer()`/`.shell()`/`.draft()` convenience wrappers,
which destroy their builder before its `Modified()`/`Generated()`/
`IsDeleted()` history can ever be read (verified by reading replicad's own
source). `replayFeatures(features)` walks a body's own recorded
`Feature[]` history (Phase 7.1) and keeps ONE live OpenCascade solid alive
across every step -- the previous step's own output feeds directly into
the next step's operation, which is what lets Cut become a real B-rep
boolean here (replicad's own `Shape3D.cut()`) instead of `cutMesh`'s own
Manifold mesh-boolean-via-STL-roundtrip (that path, and the three
standalone Cut creators that still use it, are untouched -- they can
target ANY existing body, `cad_mesh` included, which the executor's own
root-replay approach can't).

Verified empirically against real OpenCascade WASM (not assumed) that
`Modified()`/`Generated()`/`IsDeleted()` behave very differently across
operation families: `BRepFilletAPI_MakeFillet`/`MakeChamfer`/
`BRepOffsetAPI_DraftAngle` only track history for entities their own
operation actually touched -- `IsDeleted()` comes back `true` for
anything untouched too, which is NOT evidence of removal, just "nothing
was tracked"; the geometric near() fallback (Phase 5/6's own established
mechanism) correctly finds those. `BRepOffsetAPI_MakeThickSolid` (shell)
gives a real, meaningful `Modified()` entry even for the face passed in
as "to remove" -- it becomes a thin rim face at the opening, not nothing.
`BRepAlgoAPI_Cut` tracks `Modified()` for essentially every face, touched
or not. A genuinely fully-consumed entity (verified: a cut tool that
entirely engulfs a face) gives empty history AND no geometric match
either -- correctly resolves "deleted". And a real gotcha: filleting/
chamfering an edge doesn't produce a successor edge -- `Generated()`
returns a FACE (the new blend/bevel surface), so `resolveAfterOperation`'s
own `pointOfRawShape` reads each candidate's actual `ShapeType()` (via
replicad's own public `downcast()`, since Embind's own binding runtime
rejects a plain `TopoDS_Shape` where a `TopoDS_Edge`/`TopoDS_Face` is
expected) rather than assuming it matches the original pick's kind. See
`docs/decisions/cad-kernel-live-recompute-executor.md`.

Scope, deliberately: this ships the primitive (`resolveAfterOperation`)
and the full-chain replay, fully tested -- it does NOT wire anything into
the UI, detect an edit, or implement "recompute downstream of step K".
Nothing can edit a stored Feature yet; that orchestration is Phase 7.3's
own job, once real UI requirements exist to design it against.
`executor.ts` is currently unreferenced by the shipped app -- confirmed
via `npm run build` (843 modules, WASM asset sizes byte-identical to
Phase 7.1's own build).

Tests: `executor.test.ts` (new, 15 cases, real OpenCascade WASM, no
mocks, mirroring `extrude.test.ts`'s own "real pipeline" posture and 30s
timeout) -- cross-checks replayFeatures's own fillet_chamfer/shell/draft
output byte-for-byte against kernel.ts's own single-shot fillet()/
shell()/draft(), a full 3-step chain (box -> shell -> draft) with every
pick resolving "ok", and direct verification of resolveAfterOperation's
"ok" (history-informed and geometric-fallback) and "deleted" paths against
hand-built raw OpenCascade scenarios. `npm run test` (615 passed across 62
files), `npm run typecheck`, `npm run build` all green. No contract,
Python, or C++ changes this phase.

## CAD Kernel — Phase 7.3: Edit-any-step + live recompute (2026-09-07)

Wires the 7.1 read-only Construction history panel to be interactive:
click any step's own row and its own editor reopens, pre-filled, with a
whole-chain live preview and a real Apply that recomputes everything
through 7.2's `replayFeatures` executor. All 9 feature kinds a body can
record are editable this way -- Boss roots (extrude/revolve/loft), bare
primitive roots (box/cylinder, via a new `CadPrimitiveRootEditor.tsx` --
no create-mode equivalent existed for these), Cut, Fillet/Chamfer, Shell,
Draft.

One shared `editing?: {feature, stepIndex, allFeatures, onApply, ...}`
prop convention across all 9 components, rather than 9 separate edit-mode
components: present, the draft seeds from the stored feature, create-only
UI hides, and Apply calls `editing.onApply(builtFeature)` instead of the
normal create path; absent, every component behaves exactly as it did
before this phase (every pre-existing create-mode test still passes
unmodified). `recomputeFeatureStep.ts` (new) is the one function every
edit-mode Apply calls through -- swaps the edited feature into the body's
own array, calls `replayFeatures`, and returns `{ok:false, message}`
instead of throwing on a real rebuild failure.

Caught before shipping (via an independent Explore subagent spawned
specifically to check the claim): the first pass previewed every edit
using the OLD single-shot per-operation function, showing only the
isolated edited step -- never any downstream step (a shell/draft/cut
recorded after it) that would still apply on top once Apply commits.
Fixed across all 9 components: every edit-mode preview now calls
`replayFeatures` on the WHOLE features array with only the edited step
swapped -- the exact same call Apply itself makes, so preview and commit
can never silently diverge.

Re-opening an existing fillet_chamfer/shell/draft step needs pickable
geometry that no longer exists on the body itself (already baked to
`cad_mesh` the moment any such step was recorded) -- `executor.ts` gained
`previewEdgesAtStep`/`previewFacesAtStep`, replaying just the PREFIX of a
body's own recorded history (`features.slice(0, stepIndex)`) into a live
shape purely to mesh its current edges/faces for that step's own editor
to re-pick from. Both built on a newly-extracted `replayToShape`, now the
one shared core underneath `replayFeaturesSync` and both preview
functions.

Real-browser E2E surfaced a genuine, worth-documenting limitation (not a
bug): a picked face/edge's match tolerance is `diagonal * 0.005` --
small enough that resizing a root along the SAME axis a downstream pick's
own position depends on almost always breaks that pick, even for a
"modest" change (a 0.05m box shelled on its own -X face, pick at
`x=-0.025`, is reliably broken by resizing Size X to 0.08, while Size Y/Z
edits leave the same pick fully intact). Accepted and documented the same
way Phase 5/6 documented their own pick-ambiguity limits, rather than
"fixed" -- see `docs/decisions/cad-kernel-edit-any-step.md`.

Tests: `recomputeFeatureStep.test.ts` (new, 6 cases -- also where a real
Vitest quirk was root-caused: a `beforeEach` calling `mockReset()`/
`mockClear()` on a mock ANY later test configures with a rejected
promise trips a spurious "unhandled rejection" failure even though the
code under test genuinely catches it; fixed by dropping the shared
`beforeEach` and clearing inline only where needed), `executor.test.ts`
(+3, previewEdgesAtStep/previewFacesAtStep), `cadClient.test.ts` (+3),
`FeatureTreeList.test.tsx` (+3, onSelectStep), `BodyInspector.test.tsx`
(+1), `CadPrimitiveRootEditor.test.tsx` (new, 10 cases), 3 new "editing"
cases in each of the other 8 creator/editor `.test.tsx` files,
`BuilderPanel.test.tsx` (+6, the full edit-any-step state machine). New
`studio-e2e-check.mjs` section against a live CAD worker: reopen the Box
root editor pre-filled, whole-chain preview, Apply recomputes with the
Shell step surviving an orthogonal-axis resize, re-opening to make a
same-axis edit that breaks the Shell step's own pick shows the real
rebuild-error message with Apply disabled, Cancel leaves the document
unchanged. `npm run test` (675 passed across 64 files), `npm run typecheck`,
`npm run build`, and the full `test-all.sh` gate (C++ ctest, Python
pytest, TS vitest/typecheck/build, and the E2E checks run for real
against a live dev server and headless Chrome) all green. No contract,
Python, or C++ changes this phase.

## CAD Kernel — Phase 7.4: Reorder/insert/delete (2026-09-07)

The last Phase 7 sub-phase: every Construction history row can now move
up/down, be permanently deleted (modifier rows only -- the root always
stays feature 0), and any row (root included) can have a brand-new step
inserted right after it, at any position, not just the tail. No contract
change needed -- delete/move/insert are just operations on the existing
`Feature[]` array (filter an index out, swap two adjacent entries, splice
a new one in); this is the first CAD Kernel sub-phase since 7.1 that
touches zero contract/Python/C++ code.

`recomputeFeatureStep.ts`'s own Phase 7.3 shape (build a candidate
`Feature[]`, call `replayFeatures` off the main thread, commit or report
a real rebuild-error message) is now a shared `recomputeFeatures` core
behind four thin callers: `recomputeFeatureStep` (replace, unchanged),
`deleteFeatureStep` (refuses the root -- nothing to replay from, and a
full CAD-history wipe is already the Body Inspector's own separate
"change to box" escape hatch), `moveFeatureStep` (refuses moving the
root, or moving anything INTO the root's own slot), and
`insertFeatureStep` (splices a new feature in after `afterIndex`, 0
through the current tail). Insert reuses Phase 7.3's own
`previewEdgesAtStep`/`previewFacesAtStep` prefix-replay verbatim (called
at `afterIndex + 1` -- the state right after the insertion point) -- no
new executor code this phase.

The 5 modifier creators/editors that can meaningfully become a new step
(Fillet/Chamfer, the shared Shell/Draft editor, all 3 Cut creators) each
grew a sibling `inserting?: {afterIndex, allFeatures, onApply}` prop next
to Phase 7.3's own `editing` -- same shape minus the seed feature (a fresh
default draft, same as create-mode), same "preview the WHOLE chain via
replayFeatures, never an isolated op" principle. The 2 Boss root creators
and CadPrimitiveRootEditor got no `inserting` prop -- a root is never
insertable, only ever fixed at feature 0.

New UI in `FeatureTreeList.tsx`: inline ↑/↓ and a two-click-confirm
Delete per modifier row (mirroring Body Inspector's own "Delete body"
convention exactly), and a "+ Insert step" button on every row that
expands into a menu of the same six insertable kinds the toolbar's own
standalone tools already use (Fillet/Chamfer, Shell, Draft, Extruded/
Revolved/Boundary Cut) -- the same vocabulary, not a second one. Move/
delete act directly from this list with no separate editor panel, so
they got their own pending/error pair (`treeActionPending`/
`treeActionError`) rather than reusing `editingStep`/`insertingStep`'s
own -- cleared automatically when a different body is selected, so a
stale error can never misleadingly linger on the wrong body's own panel.

Every e2e check that proves reorder/insert/delete actually recomputes
correctly uses Cut, deliberately, never Shell/Draft/Fillet-Chamfer: a cut
carries no picks at all, and set-difference is commutative regardless of
overlap (A-B-C == A-C-B, always) -- reordering or deleting a cut is
mathematically guaranteed safe, isolating the check to the mechanism
itself, independent of the real pick-tolerance limitation Phase 7.3's own
edit-any-step section already found and documents (an edit or reorder
that moves a picked face/edge along its own dependent axis will almost
always break that specific pick -- a Shell/Draft/Fillet-Chamfer concern,
not a reorder-mechanism one). See
docs/decisions/cad-kernel-reorder-insert-delete.md.

A real, latent bug caught by exactly this real-browser E2E (present since
Phase 7.3, just never manifesting until now): all 5 modifier creator/
editor components' own `useCadPreview` call depended on the WHOLE
`editing`/`inserting` prop object, which `BuilderPanel.tsx` constructs
fresh, inline, on every render -- so a successful preview's own
`onPreviewChange` call (triggering one more parent render) reconstructed
that object, re-fired the SAME effect, and restarted the debounce right
as it would have gone "ready", forever. Fast single-op previews (Phase
7.3's edit mode) still landed in that vanishing "ready" window often
enough for a test's poll to usually catch it; insert mode's own longer
multi-feature chains made it rare enough to reliably miss, surfacing as
misleading, load-dependent timeouts no amount of timeout-bumping fixed.
Root-caused via timed diagnostics (ruled out a genuine hang) and fixed
everywhere at once: every `useCadPreview`-family dependency array now
lists `editing`/`inserting`'s own STABLE inner fields (`.feature`,
`.stepIndex`, `.allFeatures`, `.afterIndex`) instead of the wrapper
object. Confirmed via two independent full E2E runs back to back, both
green.

Tests: `recomputeFeatureStep.test.ts` (+20, deleteFeatureStep/
moveFeatureStep/insertFeatureStep), `FeatureTreeList.test.tsx` (+15,
move/delete/insert UI), `BodyInspector.test.tsx` (+1, prop threading), 3
new "inserting" cases in each of the 5 modifier creator/editor test files
(+15), `BuilderPanel.test.tsx` (+10, the full insert-kind-menu dispatch
and the delete/reorder wiring, including a test that switching bodies
clears a stale tree-action error). New `studio-e2e-check.mjs` section:
inserts an Extruded Cut then a Revolved Cut into an already-existing
2-step body's own history (not appended via the old toolbar -- spliced
via the tree), swaps their order, and deletes one with a two-click
confirm, all through the real CAD worker. `npm run test` (726 passed
across 64 files), `npm run typecheck`, `npm run build`, and the full
`test-all.sh` gate all green. No contract, Python, or C++ changes this
phase -- the CAD Kernel Phase 7 roadmap (data model, live-recompute
executor, edit-any-step, reorder/insert/delete) is now complete.

## Vision Lab: real object detection (2026-09-07)

The "Not done: YOLO/torch models" line from the Phase-8 era assumed
bundling a full PyTorch/Ultralytics training framework (~500 MB) to run a
model that needs only inference. Re-researched with real, current numbers
(WebSearch/PyPI/GitHub, not memory) rather than re-asserting the old
estimate: an inference-only stack (onnxruntime + a pretrained ONNX model)
costs ~76 MB, smaller than the MuJoCo integration's own ~135 MB pull.
Verified feasible first via a real spike (background agent, confined to
gitignored `tools/yolox-spike/`, same discipline as the MuJoCo spike):
real download, real onnxruntime inference against a real photo (correctly
found dog/car/bicycle), real onnxruntime-web WASM cross-check (9.89e-5 max
diff -- floating-point noise), real license check -- full pass before any
application code was written.

Model: **YOLOX-Nano** (Megvii-BaseDetection, Apache-2.0), not Ultralytics
YOLO -- every Ultralytics YOLO variant (v5n through the current YOLO26) is
AGPL-3.0 by default, which would force this project (no LICENSE file today,
private/commercial posture) to open-source entirely or buy an Enterprise
license. This was a real, previously-unflagged legal blocker independent of
the size question. YOLOX-Nano's own COCO-80 pretrained ONNX (3.5 MB) is a
direct official-release download, no training/export needed.

**Deliberately not wired to `robot.camera()`.** Checked
`runtime/python/okrobo/camera.py`'s own `render()` first: it's a 1D
raycaster drawing flat-shaded colour bands, nothing else -- no shape, no
texture, nothing a COCO-trained detector would ever recognise. Pointing a
real object detector at that feed would return garbage or nothing, always.
`find_color` already works there because it's built for exactly that
imagery; a general detector needs real photos instead. So
`okrobo.vision.detect_objects()` works on any `Frame` -- `load_image()`
reads a real photo file (a student's own upload, no bundled samples --
sourcing verifiably-licensed sample photos wasn't worth the risk under time
pressure, see the decision doc) into the same `Frame` shape
`camera.render()` already produces, decoupled entirely from the robot's own
simulated feed. A new lesson, `packs/ai/lessons/02-detect-real-objects.md`
(pack bumped to 1.1.0), teaches it.

**Python-only, deliberately -- no Blockly block, no TS/C++ mirror.**
Surveyed the full existing vision-block architecture first
(`apps/studio/src/blocks/okroboBlocks.ts`, `program/execute.ts`): Blockly's
own generated JS runs as `new AsyncFunction("robot", code)` with nothing
else in scope -- there's no sandbox reachability for a non-robot capability,
and no C++ Blockly call site to mirror either. `find_color_opencv` already
established this exact "Python-only enhancement, no block" precedent in the
same file. The proven onnxruntime-web parity (9.89e-5) stays banked for if
a real reason to add a JS/C++ mirror shows up later.

`detect_objects()`'s own grid-decode and NMS are a direct Python port of
YOLOX's own reference demo (`demo/ONNXRuntime/onnx_inference.py`,
`data_augment.py`, `demo_utils.py`) -- a modified file per the Apache
License's own Section 4(b), documented in
`runtime/python/okrobo/models/NOTICE.md` alongside the model's own exact
provenance (sha256-verified download) and `LICENSE` (Apache-2.0, Megvii
Inc.).

Tests split across CLAUDE.md's own two lanes: gate tests
(`test_vision.py`, +13 -- decode/NMS math against hand-built numpy arrays
with known-correct answers, structural/robustness checks on a synthetic
image, no network/photo needed) vs. a real-photo accuracy eval
(`tests/eval_vision_lab.py`, deliberately NOT `test_*.py` so pytest's
default collection and `test-all.sh`'s own on-disk-file-count guard both
skip it -- fetches a real photo at run time, never bundled, asserts a pass
threshold, run by hand before shipping a vision.py change, not per-commit).
Plus a real worker-subprocess smoke test (`test_worker.py`, +1) and an
extended pack-lesson API allowlist (`corePack.test.ts`).

**A real, previously-latent production bug this surfaced:**
`sidecar.py`'s own `start_program()` spawns the worker subprocess with no
`env=` at all -- it silently inherited whatever `PYTHONPATH` happened to be
set on the sidecar process itself. The sidecar sees `.deps` via `from .
import _deps`, which patches `sys.path` -- a process-local change a
subprocess never inherits, only real environment variables do. Every
worker-executed capability before `detect_objects()` needed nothing from
`.deps` (`find_color`/`Frame` are dependency-free pure Python by design),
so this was fully latent: a real student "Run" of a Vision Lab lesson would
have failed with `ModuleNotFoundError` inside the worker subprocess even
though the sidecar process itself imports onnxruntime fine. Caught by
`test_worker.py`'s own harness failing under `test-all.sh`'s bare `python3
-m pytest` invocation while passing when run manually with `PYTHONPATH`
pre-set -- fixed at the actual production call site (`sidecar.py`, not just
the test harness), verified with `env -u PYTHONPATH pytest
tests/test_sidecar.py tests/test_worker.py` (both green) plus a new
full-stack regression test running the real `serve()`/`start_program` path
end to end.

`pytest` (`test_vision.py` 22 passed/1 skipped, `test_worker.py` 13 passed,
`test_sidecar.py` +1, full suite 214 passed/4 skipped with no `PYTHONPATH`
pre-set in the shell), eval passing 3/3 expected classes, `corePack.test.ts`
6/6. See docs/decisions/vision-lab-object-detection.md for the full
reasoning.

## Competition Arena — C1: Definition + Scoring (2026-09-09)

The first of three sub-phases scoping "Competition Arena" out of a much
larger platform brainstorm (`nextphase.md`, untracked): a student picks a
competition (arena + objectives + scoring + time limit) and runs their
EXISTING robot program against it. C1 ships only the definition contract
and the pure scoring engine underneath it -- no UI yet (C2), no shipped
content yet (C3).

New `contracts/competition/v0`: `robot` ("car" only, forward-compatible
enum), `arena` (embedded, field-for-field identical to
`contracts/world/v1` -- nothing in the pack system lets one content file
reference another, so a competition stays one portable document), and
`objectives[]` -- three independent, unordered kinds for v0: `reach_zone`
(a circle worth points, awarded once), `avoid_obstacle_collision` (a
penalty per distinct hit), `time_limit` (ends the run). Deliberately
**TypeScript-only** -- the one contract in this repo with no Python/C++
mirror, because a competition is judged from OUTSIDE the student's own
program (which still just calls `robot.forward()`/`robot.findColor()`
exactly as before) -- there's no student-callable surface and no engine
change to mirror in the first place.

The real finding driving the scoring design: checked `engine/src/world.cpp`
directly before writing any of this, and confirmed the Car/Drone World's
own `collided` flag is wall-boundary-only -- a robot drives straight
through an "obstacle" box today, since obstacles only ever feed the
ray-cast distance/lidar sensor. `avoid_obstacle_collision` can't reuse
that flag; `apps/studio/src/compete/score.ts`'s own `circleIntersectsAabb`
computes overlap independently from the robot's own pose (already exposed
every tick via `EngineWorld.state()`) and the arena's own obstacle list --
zero new engine/WASM work needed. Collision penalties are edge-triggered
per obstacle (one continuous overlap = one hit, not one per tick);
`reach_zone` is idempotent (awarded once, on first touch).

`ProgramRunner.tick()` gained one new optional trailing parameter
(`onStep?: (state, dt) => void`), called once per simulated step --
purely additive, every existing call site (`Viewport3D.tsx`,
`apps/studio/src/builder/TestViewport.tsx`) passes no third argument and
is unaffected (proven by a regression test). `state()` is now computed
once per iteration and reused for both the pre-existing movement-collision
check and the new hook, instead of twice.

Tests: `competitionDef.test.ts` (examples/invalid fixtures, mirroring
`robotDef.test.ts`'s own harness exactly), `score.test.ts` (16 cases:
`circleIntersectsAabb` edge/corner/inside cases, reach_zone
idempotency, collision edge-triggering including two obstacles overlapping
in the same tick, time-limit accumulation deliberately avoiding an
exact-1.0-second float boundary, plus one hand-computed full-run fixture),
`packCompetitions.test.ts` (mirrors `packRobots.test.ts`), extensions to
`ProgramRunner.test.ts`/`manifest.test.ts`/`store.test.ts`/`corePack.test.ts`.
`npm run test`, `npm run typecheck`, `npm run build` all green. No
contract change needed for Python/C++, so `pytest`/`ctest` re-run clean as
a pure regression check. See
docs/decisions/competition-arena-definition-scoring.md for the full
reasoning, including the complete list of what's deliberately out of
scope (ordered checkpoints, Robot-Builder-authored robots in
competitions, AI opponents, tournaments, team mode, an AI coach, and the
full "OKHUB FutureLab" rebrand itself).

## Competition Arena — C2: Compete mode UI (2026-09-09)

The 3rd top-level `mode` in `App.tsx` (`"simulate" | "build" | "compete"`),
reusing the exact same car-physics path Simulate mode already drives --
same `engine`/`arm`/`drone`/`world`/`runner` state, same `<Viewport3D>`
instance, same Blocks/Python/World/Lessons/C++ tabs. A competition changes
only which arena is loaded and adds an outside-the-program scoring layer;
the student's program is untouched.

Rather than giving Compete mode a fully separate JSX block (Build mode's
own precedent, needed there because it mounts an entirely different
MuJoCo/`BuilderViewport` stack with no code tabs at all), the existing
`{mode === "simulate" && (...)}` block widened to
`{(mode === "simulate" || mode === "compete") && (...)}`, with only the
sidebar's own inner content branching per mode. This keeps the ~150-line
viewport/code-panel markup shared instead of duplicated -- see
docs/decisions/competition-arena-definition-scoring.md's C2 section for
the full reasoning, including why this reads as staying inside the
approved plan's real intent rather than departing from it.

Three new components in `apps/studio/src/compete/`: `CompetitionDialog.tsx`
(a competition picker, structural mirror of `builder/TemplateDialog.tsx`),
`CompeteHud.tsx` (a live scoreboard overlay), `CompeteReport.tsx` (an
end-of-run report with "Run again"/"Choose another competition"). New
`App.tsx` state (`competition`, `competeRun`, `competeDialogOpen`) and an
`onEngineStep` hook wired into `Viewport3D` only in Compete mode, calling
`evaluateTick` every simulated step; finalizing a run reuses the existing
`run()`/`stop()`/`reset()` lifecycle points (`finishRun`) rather than
inventing new ones.

Tests: `CompetitionDialog.test.tsx` (7 cases), `CompeteHud.test.tsx` (3),
`CompeteReport.test.tsx` (3) -- 787 total passing, up from 774. `npm run
test`, `npm run typecheck`, `npm run build` (852 modules) all green.
`./scripts/check-studio-e2e.sh` run for real in headless Chrome: 5 new
"Compete mode" checks pass (mode switches in, picker opens and settles to
a real empty state since no competitions are shipped yet, Cancel returns
to a clean "nothing chosen" sidebar with Run/Stop/Reset disabled,
switching back to Simulate restores the sim UI) alongside the full
existing suite. The live-run path (pick a competition, watch the
scoreboard, Stop shows a report) is proven directly by `score.test.ts` /
`CompeteHud.test.tsx` / `CompeteReport.test.tsx` against real
`CompetitionRunState` values; a real pick-and-play e2e path lands with C3
once `packs/core/competitions/*.json` exist. See
docs/decisions/competition-arena-definition-scoring.md for the full
reasoning.

## Competition Arena — C3: real competition packs + a lesson (2026-09-09)

Three real competitions in `packs/core/competitions/`, using only C1's
three objective types, grounded in the Car's real lidar/distance sensor
(no line sensor exists, so nothing "line-following"): **Sprint to the
Zone** (open arena, one `reach_zone`, generous time limit -- the simplest
end-to-end path), **Obstacle Slalom** (three posts straddling the direct
line, forcing real distance-sensor avoidance, `avoid_obstacle_collision`
+ a tighter time limit), **Precision Docking** (a walled bay behind a
0.6 m gate, a 0.15 m-radius zone tucked inside with only 0.05 m clearance
to the back wall -- genuine precision, not nominal). Plus
`packs/core/lessons/05-welcome-to-compete-mode.md` and a `pack.json`
version bump (1.0.0 → 1.1.0).

Real bug found and fixed while wiring this up: `Viewport3D.tsx` steps
both physics worlds every animation frame regardless of Run/Stop (true
since Phase 1, for the idle-camera-preview case) -- C2's `onEngineStep`
rode along on that same unconditional step, so a competition's clock
started counting down the instant its arena loaded, before Run was ever
pressed, and kept counting after Stop. Fixed with a new
`competeActiveRef` in `App.tsx`, flipped true by each of `run()`'s three
paths (cruise/Python/program) and false by `haltEverything()`/the
program's own `.finally()`; `onEngineStep` now gates on it. A second,
smaller fix rode along: the time-up auto-stop had been calling
`haltEverything()` from inside a `setCompeteRun` functional updater --
React can invoke an updater more than once per event to check purity, so
this moved to a `useEffect` keyed on `competeRun?.timeUp` instead, keeping
the updater itself a pure transition.

`scripts/lib/studio-e2e-check.mjs`'s Compete-mode section now drives a
real pick-Run-Stop-report loop against the actual bundled competitions
(previously only the empty-state picker was provable, since no content
existed yet). Caught and fixed one test-harness gotcha along the way (not
an app bug): a much earlier lesson's "Try this" step leaves the shared
Blocks/Python tab on Python for the rest of the suite, so the Compete
section now reselects Blocks first before pressing Run, matching real
sidecar-gated behavior instead of tripping over leftover test state.

`npm run test` (787 passing, same count -- the new competitions/lesson
are covered by `corePack.test.ts`'s existing loops), `npm run typecheck`,
`npm run build` (856 modules), `./scripts/check-studio-e2e.sh` all green,
including a real pick-and-play run in headless Chrome. This closes out
Competition Arena's C1-C3 scope in full. See
docs/decisions/competition-arena-definition-scoring.md for the complete
reasoning.

## Robot Builder — B1: real Python execution (2026-09-09)

The user flagged unfinished work from earlier phases -- specifically that a
Build-mode robot's sensors/actuators (Robot Builder Phases 3/4, real MuJoCo
physics, done since 2026-09-04) only ever worked inside Build mode's own
isolated Test-mode sandbox, and even there its Python tab was explicit,
labeled illustrative-only text with no real backend ("no real Python API
for a built robot yet -- a future phase"). This closes that gap: Test
mode's Python tab is now real, sidecar-connected, sidecar-executed code,
exactly like Car/Arm/Drone's own Python tabs. C++ stays illustrative-only
**permanently** -- a fixed compiled header genuinely can't represent
per-student dynamic actuator/sensor ids, already documented in
`docs/decisions/robot-builder-programming.md` as a real (not deferred)
non-goal.

`runtime/python/okrobo/worker.py` gained a `BuiltRobot` remote-proxy class
(`set`/`read`/`wait`/`stop`), mirroring `Arm`/`Drone`'s exact shape --
`wait`/`stop` reuse the same generic RPC names Robot/Arm/Drone already use,
`built_set`/`built_read` are the two new ones. Unlike Robot/Arm/Drone,
`BuiltRobot` has no local/offline implementation anywhere in the `okrobo`
package (a built robot's shape is arbitrary and per-student, with no fixed
physics to mirror) -- it exists only as this remote proxy and can never
run standalone outside the studio. `sidecar.py` needed zero changes,
confirmed fully method-agnostic before writing any of this.

`apps/studio/src/python/PythonBridge.ts`'s `PythonBridge` class became
generic (`PythonBridge<TRobot = RobotApi>`) with an injectable dispatch
function (default `executeRemoteRequest`, so every existing 3-arg call
site compiles unchanged), plus a new narrow `executeBuiltRemoteRequest`
handling `built_set`/`built_read`/`wait`/`stop` against `BuiltRobotApi`.
Considered and rejected: extending `ProgramRunner`/`RobotApi` itself to
also cover built robots -- that class's `move()`/`tick()` machinery is
Car-wheel-specific and would tangle two genuinely different execution
models together.

A useful correction found by direct verification before writing any code:
`okroboBlocks.ts`'s Python codegen for the two built-robot blocks
(`okrobo_built_set_actuator`/`okrobo_built_read_sensor`) was **already**
real, correct code (`robot.set("id", value)` / `robot.read("id")[0]`) --
only the `BUILT_PYTHON_HEADER` constant and its own stale comments said
"illustrative only." Shrunk that part of the work considerably once
confirmed by reading the actual generator functions instead of assuming
the whole codegen path needed rewriting.

`BuilderPanel.tsx`'s Test-mode program drawer replaced its `<pre>` preview
+ placeholder note with a real, connected `PythonPanel` (the same
component Simulate mode already uses) wired to a dedicated
`PythonBridge<BuiltRobotApi>`, constructed/torn down alongside
`builtRunner`. `runProgramCode`/`stopProgram` gained the same
Blocks-vs-Python branch `App.tsx`'s own `run()` already has.

Tests: `test_worker.py` (+3, RPC-shape and generic-name-reuse cases),
`PythonBridge.test.ts` (+4, `executeBuiltRemoteRequest` against a real
compiled WASM `EngineBuiltRobot`+`BuiltProgramRunner` fixture),
`integration.test.ts` (+1, a real spawned sidecar running a real
`from okrobo import BuiltRobot` program end to end, asserting both stdout
and the actual actuator movement), `okroboBlocks.test.ts` (updated: Python
assertion flipped from "illustrative" to "real import", C++ untouched),
`BuilderPanel.test.tsx` (a new `PythonPanel` mock, matching the existing
`BlocksPanel` mock -- jsdom can't construct Monaco's real editor).
`scripts/lib/studio-e2e-check.mjs`'s Test-mode Python check now asserts a
real, sidecar-aware panel instead of the old illustrative note. `npm run
test` (792 passing, up from 787), `npm run typecheck`, `npm run build`,
`./scripts/check-studio-e2e.sh` all green. Manually verified against a
**real running sidecar** in a real headless-Chrome session: Build mode ->
New Robot -> Simple Arm template -> Test mode -> Python tab shows
"python: connected", Run executes a real `BuiltRobot` program against the
real sidecar and finishes cleanly. See
docs/decisions/robot-builder-python-execution.md for the full reasoning,
including why C++ stays out of scope permanently and why `BuiltRobot` has
no local/offline implementation.

## Robot Builder — B2: built robots in Simulate mode (2026-09-09)

Closes the other half of the gap the user flagged: a built robot could
only ever be driven inside Build mode's own isolated Test-mode sandbox,
never in the app's main Simulate mode where Car/Arm/Drone live. Now a
student can pick a built robot from a 4th sidebar entry in Simulate mode
and drive it for real -- same run-bar, same Blocks/Python tabs, real
`okrobo.BuiltRobot` Python from B1.

Deliberately does **not** widen `RobotKind` to a 4th value --
`docs/decisions/robot-builder-programming.md` already recorded, before
this was even a stated goal, that `RobotKind` reaches lessons/pack-content
schema/`App.tsx`'s own picker in ways a built robot could never sensibly
join. Instead, `App.tsx` gained an orthogonal `simulateBuilt` state,
independent of `robot: RobotKind` -- Car/Arm/Drone's own always-resident
engine trio is completely untouched by this feature. Architecturally
honest too: Car/Arm/Drone are three fixed kinds multiplexed by one
`ProgramRunner`; a built robot is on-demand, constructed/destroyed per
pick, exactly like Build mode's own Test-mode lifecycle already is -- not
a 4th peer value, a different kind of thing.

Reused wholesale rather than re-implemented: `TestViewport.tsx` renders
directly inside Simulate mode's own viewport in place of `Viewport3D`
(the actual component, not a ported copy); the construction effect
mirrors `BuilderPanel.tsx`'s own Test-mode one almost verbatim; Python
execution reuses B1's `PythonBridge<BuiltRobotApi>` + `executeBuiltRemoteRequest`
via a second bridge instance; `BlocksPanel`/`PythonPanel` needed zero
changes (`BlocksRobotKind` already covered `"built"`); the World tab
reuses Build mode's own `WORLD_OPTIONS` `<select>` (a built robot's
`contracts/world-def/v0` is a structurally different, differently-named
`WorldDef` from the Car/Drone arena's own -- imported under an alias,
`BuiltWorldDef`, to avoid a real naming collision); the new
`BuiltRobotDialog.tsx` picker mirrors `TemplateDialog.tsx`/`CompetitionDialog.tsx`'s
exact shape, reusing Phase 8's existing `listPackRobots()` unchanged. One
small new piece: `EngineBuiltRobot` has no `reset()` (Test mode never
needed one), so Simulate mode's own Reset button re-identities
`simulateBuilt` to retrigger the same construction effect a fresh pick
uses, rather than adding a new WASM export for one button.

Tests: `BuiltRobotDialog.test.tsx` (8 cases, mirroring
`CompetitionDialog.test.tsx`'s own structure -- gated/ungated current-
robot row, packs-section states, corrupt-pack resilience, Cancel). `npm
run test` (800 passing, up from 792), `npm run typecheck`, `npm run
build`. `scripts/lib/studio-e2e-check.mjs` gained a new "Simulate mode:
built robot" section -- honestly scoped to what the shared e2e document
actually allows: by that point in the run, Build mode's own long CAD-
Kernel/Joint-Authoring sequence has left the document with several real,
un-cleaned-up validation errors (a natural byproduct of exercising
manufactured-cycle/rebuild-error/insert-delete test cases back to back,
not a bug), so the permanent check proves the picker opens, correctly
disables an invalid document with the right message, and the packs
section settles cleanly -- itself real proof the validity gate works, not
a weaker substitute. The full happy path (pick a valid robot, real
`TestViewport` renders in Simulate mode, Run/Stop drive it for real) is
proven by `BuiltRobotDialog.test.tsx`'s own controlled fixture and was
verified by hand in a real headless-Chrome session: Build mode -> New
Robot -> Simple Arm template -> Simulate mode -> 🔧 Built robot… -> pick
it -> TestViewport renders -> Run drives the default starter -> Stop ->
"Back to Car/Arm/Drone" restores the stock UI cleanly. This closes out
the Robot Builder → Simulate-mode integration gap in full (B1 + B2). See
docs/decisions/robot-builder-simulate-mode.md for the complete reasoning.

## Robot Builder — D1: actuator & sensor authoring (2026-09-09)

The user flagged another real gap: even with B1/B2's real Python execution
and Simulate-mode integration shipped, Build mode still had no way to
*add* an actuator or sensor to a hand-built robot -- both existed only in
two hardcoded templates (Rover, Simple Arm). Test mode's `ActuatorPanel`/
`SensorPanel` were always real (Phases 3/4, real MuJoCo physics); nothing
populated them for a custom-built robot. Closed with two new toolbar
tools, "Add Actuator" and "Add Sensor," plus a new Actuators/Sensors list
for viewing, editing, and deleting what's already there -- and, per the
user's own ask, real explanatory copy baked directly into both creator
forms (one sentence per actuator/sensor type, updating live as the
student changes the selection), not a separate doc to go find.

`ActuatorCreator.tsx`/`SensorCreator.tsx` mirror `JointCreator.tsx`'s own
draft/live-validate/Apply idiom almost mechanically (`issuesIntroducedBy`-
gated Apply, `nextActuatorId`/`nextSensorId` mirroring `nextJointId`). Both
also support editing an existing entity in place, reusing `robotEdits.ts`'s
new `applyActuator`/`applySensor`'s own `replacingId` parameter -- CAD
Kernel Phase 7.3's "click any step to edit it" precedent applied here too.
An actuator's target is a joint chosen from a `<select>` (no viewport pick
-- a dropdown is the right UI for "one of a short named list," not a
spatial point), filtered to exclude `fixed` joints (`validateRobotDef`
already rejects actuating one). A sensor DOES need a body pick, reusing
the existing single-body `TARGET_PICK_TOOLS` flow Fillet/Chamfer/Shell/
Draft already established, unchanged. `encoder` is the one sensor type
that mounts via joint, not body+transform -- the form visually branches on
it, hiding the mount-position fields and showing a joint picker instead,
filtered to joints actually connected to the picked body.

One live warning `validateRobotDef` itself can't provide: an actuator
targeting a `ball`/`free` joint is schema-legal but MJCF has no matching
actuator element for it (already documented in
`docs/decisions/robot-builder-physics.md`) -- the control would silently
do nothing in Test mode, so the creator shows a non-blocking banner for
this case. `ActuatorSensorList.tsx` is a new, separate component (neither
actuators nor sensors have a tree position the way bodies do), mirroring
`FeatureTreeList.tsx`'s own "click to edit, two-click delete" row idiom
and CSS classes directly, not `HierarchyList.tsx`'s body-only shape.

A real, non-obvious e2e-harness bug found and fixed while verifying this
in a real browser: two new always-visible toolbar buttons shifted every
later toolbar button's on-screen position, exposing a latent
coordinate-click race (`scripts/lib/studio-e2e-check.mjs`'s own
`page.clickText(".builder-toolbar button"/"​.hierarchy-row", ...)` calls
compute a pixel position then dispatch at it -- if the DOM shifts in
between, the click misses; `cdp.mjs`'s own `evalClick` docstring already
names this exact risk). Fixed by converting every such toolbar/hierarchy-
row click in that file to `evalClickText`/`evalClick` (a real DOM
`.click()`, immune to the race) -- a systematic hardening pass across the
whole file, not a one-off patch, verified by running the full e2e suite
twice in a row for stability after the fix.

A real user-reported bug found right after shipping: "actuator button not
clicking." Root cause: `.builder-toolbar button` had no `:disabled` style
anywhere in `App.css` -- a disabled button looked pixel-identical to an
enabled one, so a fresh "Blank" robot's default-disabled "Add Actuator"
(needs a joint first) looked broken rather than disabled. Not new to this
phase (every existing toolbar tool had the same gap), but this phase is
what made it show up in practice, since a fresh robot always starts with
zero joints. Fixed with a real `:disabled` rule (dimmed + `not-allowed`
cursor), verified in a real browser both ways: correctly non-interactive
with no joint, correctly opens the form once a real hinge joint exists.

Tests: `ActuatorCreator.test.tsx` (8 cases), `SensorCreator.test.tsx` (8),
`ActuatorSensorList.test.tsx` (5), `robotEdits.test.ts` extended (+12,
including one proving the new single-entity delete functions agree with
`removeBody`'s own existing cascade), `BuilderPanel.test.tsx` extended
(+7). `npm run test` (838 passing, up from 800), `npm run typecheck`,
`npm run build`. `./scripts/check-studio-e2e.sh` gained a fully self-
contained "Add Actuator / Add Sensor" section (adds its own fresh bodies
and hinge joint, rather than depending on whatever joint types the long
CAD-Kernel/Joint-Authoring sequence above happened to leave behind) --
passed twice in a row alongside the full existing suite. See
docs/decisions/robot-builder-actuator-sensor-authoring.md for the complete
reasoning.

## Robot Builder — D2: robot lifecycle (2026-09-09)

Closes the last two gaps the user flagged: no way to finish one robot and
start a new one without discarding the whole project (`actionNew()` --
File > New Project -- was the only way to clear `robotDef`, wiping
Blocks/Python/world too), and no way to reuse a robot saved in a
*different* project inside Simulate mode's own built-robot picker.

Investigated first, before writing anything: this repo's existing project
system already answers "multiple saved robots" -- `ProjectPayload` is a
flat one-robot-per-project bundle, and `OpenDialog`/`NameDialog` already
give a full list/open/delete UI for named saved things. Once a "clear
just the robot" action exists, "build one, Save As, clear, build the
next" is already a working library with zero new backend concept needed.

`actionNewRobot()` clears only `robotDef` -- project name, Blocks/Python,
world, and Robot Builder B2's own `simulateBuilt` snapshot all stay
untouched (B2 already established `simulateBuilt` as independent of
Build mode's in-progress document; this stays consistent with that, not
reaching across it). Gated behind a two-click confirm (mirroring the
existing body/feature-step delete idiom) -- a deliberate exception to
this app's otherwise-no-warnings-anywhere pattern (confirmed directly:
neither `actionNew()` nor `openProjectById()` warns before discarding
work today), justified because the new trigger button is *always visible*
once a robot exists, unlike today's "+ New Robot" (reachable only once,
from the empty state).

New `apps/studio/src/builder/projectRobots.ts` mirrors `packRobots.ts`'s
own resilience conventions (one corrupt project skipped and logged, never
blanks the list; a fresh `make()` per pick) but is structurally simpler --
`loadProject()` already returns the full payload in one round trip, no
separate manifest-then-file read needed. `BuiltRobotDialog.tsx` gained a
third "From your saved projects" section, excluding the currently-open
project (already covered by the existing "current robot" row).

Tests: `projectRobots.test.ts` (7 cases), `BuiltRobotDialog.test.tsx`
extended (+3), `BuilderPanel.test.tsx` extended (+2). `npm run test` (850
passing, up from 838), `npm run typecheck`, `npm run build`.
`./scripts/check-studio-e2e.sh` gained one more check (the saved-projects
section settles to a real empty state in this browser-mode harness, which
has no way to create a second real Tauri-backed project to prove the full
cross-project pick -- that's proven by `projectRobots.test.ts` instead,
stated plainly, matching Phase 8's own precedent for Tauri-only paths).
Manually verified in real headless Chrome: two-click New Robot correctly
confirms before clearing, and Blocks/Python content survives the clear
untouched. This closes the Robot Builder initiative's full D1+D2 scope --
sensors/actuators can be authored, explained, saved, and reused. See
docs/decisions/robot-builder-lifecycle.md for the complete reasoning.

## Robot Builder — D3: joint editing (2026-09-10)

The user reported the same symptom twice: "actuator button not clicking,"
then, after that first fix shipped, "alot still wrong" / "the actuator
not working again." The first report's root cause (no `:disabled` CSS on
`.builder-toolbar button`, D1) was real and fixed, but reproducing the
user's exact realistic flow in a live browser session -- Add Joint, pick
two bodies, Apply without touching the "Joint type" dropdown -- exposed a
second, deeper bug wearing the same symptom: `JointCreator.tsx` defaults
new joints to `type: "fixed"`, which can't be actuated, and there was no
UI to fix an existing joint's type short of deleting its child body and
starting over (`HierarchyList.tsx` only ever rendered bodies, never
joints).

Fixed by making joints a first-class editable/deletable entity, mirroring
D1's own actuator/sensor edit-in-place pattern: `robotEdits.ts` gained
`applyJoint`/`deleteJoint`; `JointCreator.tsx` gained an `existing?: Joint`
prop with per-type-narrowed prefill; `ActuatorSensorList.tsx` gained a
new Joints section, listed *first* since fixing a wrongly-typed joint is
the prerequisite for Add Actuator's own gate. "Add Actuator" now
distinguishes "no joint at all" from "a joint exists but every one is
fixed" with two different messages (button title + a new always-visible
inline hint, not just a hover tooltip), since a beginner who doesn't
think to hover a disabled button would otherwise never learn why.

Tests: `robotEdits.test.ts` extended (+2 describe blocks, 44 passing),
`JointCreator.test.tsx` extended (+3, "editing an existing joint"),
`ActuatorSensorList.test.tsx` rewritten with a `renderList` helper (+1
test, 6 total -- also fixed two pre-existing ambiguous assertions once
"Joint 1" started matching both a joint row and an actuator's target
label), `BuilderPanel.test.tsx` extended (+3: open-for-edit-prefilled and
fixed-to-hinge-replace-in-place, two-click joint delete, the no-joint-vs-
only-fixed-joints distinguishing message). `npm run test` (860 passing,
up from 857), `npm run typecheck`, `npm run build`.

`./scripts/check-studio-e2e.sh`'s existing Add Actuator/Add Sensor section
now deliberately leaves its fixture joint at the default "fixed" type
(rather than immediately setting it to hinge) and walks the full
disabled-message -> edit-in-list -> hinge -> enabled -> real-actuator
sequence -- passed twice in a row for stability alongside the full
existing suite. A hand-written CDP script separately reproduced the
user's exact original bug report end to end against a fresh dev-server +
headless-Chrome session (Blank robot, add a body, Add Joint, pick both,
Apply without touching the type dropdown, confirm the specific disabled
message, fix it via the new Joints list, confirm Add Actuator becomes
enabled and actually works) -- every step passed. See
docs/decisions/robot-builder-joint-editing.md for the complete reasoning.
This closes the Robot Builder initiative's full D1+D2+D3 scope.

## Web persistence: import a robot file + real Save/Open on the web build (2026-09-10)

User: "i should be able to import existing robots and also save robots on web
perfectly." Investigated first: the entire File menu (New Project/Open/Save/
Save As, recent projects) was `disabled={!inDesktop}` -- a web user had no
way to persist a project at all, and there was no Import counterpart to the
existing single-robot "Export" button on either platform.

Scoped via plan-mode. Two pieces, both shipped together:
- A browser-local project store (`apps/studio/src/projects/webStore.ts`,
  localStorage-backed) mirroring `src-tauri/src/projects.rs`'s own behavioral
  contract field-for-field (id/timestamp semantics, list ordering, exact
  error messages) -- wired into `projects/api.ts`'s existing 5 functions via
  an `inDesktop` branch, so every caller (`App.tsx`, `BuiltRobotDialog.tsx`,
  `projectRobots.ts`) needed zero changes. The File menu button itself is now
  un-gated; only "Asset Store..." (pack install/signing, a separate
  filesystem-bound concern) stays desktop-only.
- `apps/studio/src/builder/importRobot.ts`, the reciprocal of Export, wired
  into `TemplateDialog.tsx`'s "New Robot" picker as a third "From a file"
  section -- reachable only from the empty-robot state, so it never risks
  clobbering an in-progress robot without a confirm step, the same safety
  every other row there already has for free.

**A real, surprising find while writing tests**: this repo's Node 26 +
vitest + jsdom combination does not actually provide a working
`localStorage` global (Node's own built-in Web Storage implementation
returns `undefined` unless launched with `--localstorage-file`, and jsdom
here defers to it rather than installing its own) -- caught by a failing
diagnostic test, not assumed. Fixed by making the storage backend an
injectable `KeyValueStore` parameter (defaulting to the real global for
production, a plain in-memory fake in tests) rather than adding
`fake-indexeddb` or wiring a Node flag into the test runner.

Tests: `webStore.test.ts` (10, mirroring `projects.rs`'s own 8-case suite
plus 2 new defensive cases), `projects/api.test.ts` (2, new -- proves the
`inDesktop` routing itself, nothing tested this before), `importRobot.test.ts`
(4), `TemplateDialog.test.tsx` extended (+2). `npm run test` (878 passing, up
from 860), `npm run typecheck`, `npm run build`.

`./scripts/check-studio-e2e.sh` gained a full File > Save As -> Open ->
Save-in-place -> Delete round trip against the real browser-local store (the
first-ever real-browser proof web save actually works), plus an Import check
using a new `DOM.setFileInputFiles`-based helper in `cdp.mjs` (CDP's own
documented way to inject a real file into a file input) feeding a real
fixture file the script writes to disk. One pre-existing check needed
narrowing (the new "From a file" row shares the existing template-row
styling class, so a bare `.template-row .project-name` query started
picking it up too) -- found and fixed by actually running the suite. Passed
twice in a row for stability. See
docs/decisions/robot-builder-web-persistence.md.

## Competition Arena C4: ordered checkpoints (2026-09-10)

Continuing `nextphase.md`'s "OKHUB FutureLab" brainstorm (the same source
Competition Arena C1-C3 was carved from) -- user picked "ordered checkpoints
+ two new competitions" from a shortlist of 3 candidate next slices. Closes
brainstorm items #9 (Object Delivery Race) and #10 (Maze Challenge), and the
deferral C1's own decision doc named explicitly ("an ordered-sequence
objective is a natural, contained addition once real students have used the
unordered version").

Scoped via plan-mode. `contracts/competition/v0` forked to `v1` (the
project's own stated versioning policy): `reach_zone` gained optional
`sequence`/`label` fields, fully backward compatible (omitted = v0's only
behavior, unchanged). `score.ts`'s `ObjectiveOutcome` gained `locked`,
gated against the previous tick's outcomes so the result never depends on
objective ordering in the JSON.

A real, pre-existing gap surfaced while designing this and folded into
scope: `reach_zone` objectives had no visual representation anywhere in
`Viewport3D.tsx` -- fine with one zone per competition, unplayable with
ordered ones a student can't see. Fixed for all 5 competitions (not just
the 2 new ones): a ground ring per zone, colored locked/active/achieved,
via a new `zoneStatesRef` prop mirroring `autopilotRef`'s own existing
plain-ref convention in that component.

**A real, pre-existing product bug found by this phase's own e2e check**:
picking a second competition mid-session re-instantiates the WASM engine
asynchronously, but `engineStatus` never reset to "loading" during that
window -- Run stayed visually enabled and silently no-op'd if clicked
inside it. Found via a genuine ~1-in-3 e2e flake, traced with a hand-rolled
CDP probe, fixed at the root (`setEngineStatus("loading")` now runs
synchronously at the top of the `[world]` effect) rather than just papered
over in the test.

New content: Object Delivery Race (pickup-then-delivery, a crate blocking
the naive straight line) and Maze Challenge (one wall sealing off the
direct route and the whole north side, leaving exactly one solvable path)
-- the maze's own solvability is asserted by a permanent test
(`bundledCompetitions.test.ts`) sampling a real waypoint path through
`score.ts`'s own `circleIntersectsAabb`, not just eyeballed. A new lesson
(`06-ordered-checkpoints.md`) introduces the locked-zone concept.

Tests: `bundledCompetitions.test.ts` (5, new), `competitionDef.test.ts`
(+6), `score.test.ts` (+6), `CompeteHud.test.tsx`/`CompeteReport.test.tsx`
(+2). `npm run test` (899 passing, up from 878), `npm run typecheck`,
`npm run build`. `./scripts/check-studio-e2e.sh` -- 4 consecutive clean
runs after the `engineStatus` fix (down from ~1-in-3 flaky before it), plus
two manual screenshot passes confirming the ground markers and maze layout
are visibly correct in a real browser, not just numerically so. See
docs/decisions/competition-arena-definition-scoring.md's C4 addendum.

## Competition run history: best scores, remembered across sessions (2026-09-10)

User: "pick from nextphase.md" -- delegated the choice this time. Picked
run history over the other remaining buildable candidates (most of what's
left in the Competition Mode brainstorm section needs real multi-robot
physics this engine doesn't have, still correctly deferred): it directly
builds on the web-persistence work just shipped, and it's the missing data
layer underneath three separate brainstorm items at once -- Competition
Analytics, Competition Readiness Score, and Tournament Mode all assume
"what happened on past runs" exists somewhere, and nothing persisted a
run's own result before this. Scoped via plan-mode.

New `apps/studio/src/compete/runHistory.ts` mirrors `projects/webStore.ts`'s
own two conventions exactly: an injectable `KeyValueStore` (default: real
`localStorage`, Node+vitest doesn't reliably provide one) and one JSON blob
per competition id, capped at 20 most-recent runs. Wired into `App.tsx` via
a new `useEffect` keyed on `competeRun?.finished` (never inside the
`setCompeteRun` updater itself, same Strict-Mode-purity reasoning already
documented for the existing `timeUp` effect). Surfaces as a "Best: N" hint
on each competition's own row in the picker, and a "New best!" / "Best: N"
line in the end-of-run report.

**A real bug caught by this feature's own new e2e check before it
shipped**: the first cut computed "new best" via `score > (previousBest ??
-Infinity)`, so a competition's genuinely first-ever run trivially "beat" a
nonexistent best and showed "New best!" when nothing should show at all.
`CompeteReport.test.tsx` couldn't catch it (it tests rendering against an
explicit prop, not the computation that builds one) and `App.tsx` has no
unit test file by this project's own convention -- caught instead by a
real-browser e2e run. Fixed: `isNewBest: previousBest !== null && score >
previousBest`.

Tests: `runHistory.test.ts` (7, new), `CompeteReport.test.tsx` (+3),
`CompetitionDialog.test.tsx` (+3). `npm run test` (912 passing, up from
899), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh`
gained a real two-competition-run localStorage round trip (first run shows
no best line, the picker's own row then shows the recorded best, a second
run shows the comparison) -- 3 consecutive clean real-browser runs after
the fix. See docs/decisions/competition-run-history.md.

## Real obstacle collision for the Car (2026-09-10)

User observed: "there something i observed there is no physics / the robots
can enter into the obstacles anytime." Confirmed real and pre-existing
(`engine/src/world.cpp` only ever clamped against the arena's outer walls,
never obstacle boxes -- documented since Competition Arena C1, and
`world.hpp`'s own `Obstacle` comment "the robot can see and bump into"
already implied this was unfinished). Asked whether to fix it (a real
engine change) before scoping; user said yes. Scoped via plan-mode.

Standard circle-vs-AABB push-out added to `World::step` -- geometrically
correct at corners (verified with a dedicated diagonal-approach test),
unlike a simpler inflated-box clamp would have been. Had to change TWO
implementations identically: `engine/src/world.cpp` and its own reference
model, `runtime/python/okrobo/_sim.py`, which `engine/tests/parity/
parity.mjs` locks together tick-by-tick at 1e-9 tolerance. Extended the
shared parity scenario with a real drive-into-an-obstacle phase (now 2037
states compared, max diff 8.88e-16) to prove parity on the new behavior
itself, not just inherit it by accident. `apps/studio/src/compete/
score.ts`'s own scoring penalty needed no changes -- it's an independent
overlap check that already composes correctly with real physical blocking.

One pre-existing studio test needed updating (`ProgramRunner.test.ts`'s
"forward stops early at the wall") since the shared default arena has a
real obstacle directly ahead of the default start pose that now blocks it
before the wall -- turned the robot to face a genuinely clear direction for
that test, added a new test asserting the obstacle-stop position
specifically.

Verified against the exact production WASM artifact (not a mock): driving
the shipped Arena's car straight for 10s now stops at x=1.4999999999999998
(0.1m short of the red box) instead of reaching the far wall at x=1.9.
`ctest` 13/13, `pytest` 223 passing, parity check clean, `npm run test` 913
passing, typecheck, build, full `check-studio-e2e.sh` green twice in a row.
Full `test-all.sh` green. See docs/decisions/car-obstacle-collision.md.

## Kid-usable Blocks: easier if/else, a resizable code panel, a livelier theme (2026-09-10)

User sent a screenshot of the `controls_if` mutator popup: "work on the
conditions too, i can't use the else if at all," plus "the code environment
should be responsive and adjustable by users perfectly" and "i need the app
color to be perfectly for kids... lively color." Investigated the mutator
claim directly before assuming a Blockly bug: `controls_if` is Blockly's
own stock, un-customized block -- the real root cause was `.studio`'s own
CSS grid hardcoding the whole Blocks/Python/World/Lessons/C++ panel to a
flat 220px row, measured at ~188px of real visible content height,
regardless of window size. Not "Blockly is broken" -- "there's nowhere
near enough room" for an already-fiddly mutator drag. Scoped via plan-mode.

Three parts, closed together since they're genuinely related:
- **If/else without the mutator**: verified Blockly's own toolbox JSON
  supports seeding a block's mutator state via `extraState` (no custom
  block code) -- the toolbox now offers plain if, if/else, and
  if/elseif/else as three directly-draggable pre-built shapes.
- **Real resizable panels**: new `ResizeHandle.tsx` (a thin draggable bar
  writing directly to a CSS custom property during drag, persisted to
  localStorage on release) replaces four previously-fixed pixel
  dimensions (sidebar, code panel, Build mode's hierarchy/inspector) with
  CSS-variable-driven, user-draggable ones. The code panel's own default
  is `max(220px, 35vh)` -- genuinely responsive to window size, never
  smaller than the old fixed height.
- **A livelier, still-dark theme**: more saturated accent/status colours,
  named `--error`/`--warning` variables replacing 18 scattered hex
  literals (2 of which this session itself had introduced inconsistently
  for the run-history feature), a real per-robot accent colour on each
  sidebar row instead of one blue for everything, a uniform border-radius
  bump (34 identical `6px` occurrences -> `8px`, safe because of that very
  uniformity), and a solid-fill Run button.

**A real, repeatable test gotcha closed for good**: `ResizeHandle`
rendering inside `BuilderPanel.test.tsx` crashed ~73 unrelated tests --
this repo's Node+vitest+jsdom doesn't provide a working `localStorage`
(hit and separately worked around three times already this session via
per-function DI). Rather than a fourth one-off fix, `src/testSetup.ts` now
installs one global in-memory polyfill, closing this for any future
component.

**A real, self-inflicted e2e bug found and fixed**: the first version of
the new resize check dragged the panel 200px and never reset it -- that
persisted in localStorage for the rest of the script, squeezing the layout
enough to break unrelated coordinate-based clicks in the Arm/Drone
sections much further down. Fixed with a smaller delta plus an explicit
cleanup + reload. Also found `check-studio-e2e.sh` never set an explicit
`--window-size`, defaulting to headless Chrome's own tiny ~780x437 --
where a naive `35vh`-only default would have been *smaller* than the old
220px, an actual regression this feature's own check caught before
shipping. Fixed both: the CSS default is `max(220px, 35vh)`, and the
script now launches at a realistic 1280x900 (a permanent improvement to
the whole suite, not just this feature's own checks).

Tests: `ResizeHandle.test.tsx` (8, new), `okroboBlocks.test.ts` (+3).
`npm run test` (924 passing, up from 912), `npm run typecheck`,
`npm run build`. `./scripts/check-studio-e2e.sh` -- 3 consecutive clean
runs after the window-size and self-cleanup fixes. Full `test-all.sh`
green. Manual screenshots confirmed the panel genuinely grows, the drag
persists across a reload, and the toolbox's if/elseif/else shape renders
and is directly draggable. See
docs/decisions/blocks-editor-usability.md.

## Top nav bar (titlebar) responsiveness on narrow windows (2026-09-10)

Direct follow-up question after the Blocks-usability pass: "how about the
interface color and the nav bar responsiveness." Color was already done;
the titlebar (app name, File/Edit/Robot/Simulation/Help menus, the
Simulate/Build/Compete mode toggle, the project-name chip) had not been
touched. Confirmed the bug with a real 550px-wide headless-Chrome
screenshot before assuming anything: `.titlebar` was a plain flex row
with no wrap/overflow handling -- "OKHUB Robotics Studio" wrapped to 3
lines, blowing out the fixed 40px row height and pushing the mode toggle
(Build/Compete became fully unreachable) and the project chip off the
visible window edge with no way back.

Two-layer fix, in the order a user actually hits them: (1) `flex-shrink:
0` + `white-space: nowrap` on every titlebar child so the row can never
wrap or break its own height, with `overflow-x: auto` as the safety net
underneath; (2) rather than just permitting a silent sideways scroll (a
real discoverability trap for a kid -- nothing on screen hints Build/
Compete exist off-canvas), a `max-width: 720px` media query swaps the
wordmark for a short "OKHUB" form and tightens the row's own spacing.
Measured, not guessed: closed the shortfall from 225px to 11px at 550px
wide -- every control (5 menus, the full 3-way mode toggle, the project
chip) fully visible with no scrolling needed; the 11px is headroom for
anything narrower still.

**A real bug caught mid-verification**: the media query's first draft sat
*before* the base `.menu-item`/`.mode-toggle button` rules later in the
file -- at equal specificity, source order decides ties regardless of the
media condition, so the padding overrides silently lost the cascade.
Caught empirically: re-ran the screenshot script after adding them and
got byte-identical layout numbers to the prior run, which was the tell.
Fixed by moving the block to after the last base rule it needs to win
against.

`npm run test -- --run` (924/924), `npm run typecheck`, `npm run build`
all clean -- pure CSS/markup, no new dependencies. `./scripts/
check-studio-e2e.sh` run twice, fully green both times (the existing
suite's own titlebar menu/mode-toggle interactions already exercise this
row on every run). Full `test-all.sh` green. Real headless-Chrome
screenshots confirmed both ends: 550px wide now shows everything on one
line with only the short "OKHUB" form; 1280px wide is pixel-for-pixel
unchanged from before this fix (`scrollWidth === width`, full wordmark).
See docs/decisions/titlebar-responsiveness.md.

## Cross-platform desktop builds: Linux, Windows, macOS (2026-09-12)

The desktop app had only ever been built and tested on Linux -- deb +
AppImage, a hardcoded `x86_64-unknown-linux-gnu` python-build-standalone
target, `sidecar.rs`'s interpreter resolution baked in `bin/python3` and
`PR_SET_PDEATHSIG` (a Linux-only `prctl(2)` flag not even present in
`libc`'s macOS bindings). Schools on Windows or macOS laptops -- the actual
majority case -- had no installer at all.

`scripts/fetch-python-runtime.sh` now auto-detects the host OS/arch
(`detect_target()`: Linux, macOS Intel, macOS Apple Silicon, Windows) and
picks the matching python-build-standalone release asset and the right
extracted-interpreter path (`python/bin/python3` everywhere except
Windows's `python/python.exe`). `sidecar.rs` mirrors the same branch with
an explicit `bundled_python_relpath_for(windows: bool)` / `system_python_for
(windows: bool)` pair -- an explicit bool parameter rather than reading
`cfg!(target_os = "windows")` inline, specifically so both platforms'
behavior is unit-tested from this one Linux dev machine (2 new tests, both
passing here while asserting the Windows branch too).
`apps/studio/src-tauri/tauri.macos.conf.json` / `tauri.windows.conf.json`
add the per-OS bundle targets (dmg+app, nsis) via Tauri's own automatic
overlay-config merge. `.github/workflows/build-desktop.yml` runs the exact
same `fetch-python-runtime.sh` / `build-desktop.sh` a contributor would run
locally, once per OS on GitHub's own hosted runners (no cross-compiling, no
Docker -- mujoco's `.deps` wheel has real compiled native extensions per
platform, which rules out cross-compiling the Python side regardless of
what's done with the Rust side).

**One Linux-only wrinkle, root-caused before patching anything**: mujoco's
Linux wheel ships plugin `.so` files with a build-machine-absolute
`RUNPATH` baked in from DeepMind's own CI. A plain `import mujoco` never
notices (the plugin `dlopen`s `libmujoco.so` by soname, already loaded by
the main extension module, so its own broken `RUNPATH` is never
consulted) -- but `linuxdeploy` (which `tauri build` invokes for the
AppImage) does a strict static dependency walk that resolves `RUNPATH`
literally and aborts the whole bundle. `scripts/fix-mujoco-plugin-rpath.sh`
repoints each plugin's `RUNPATH` to `$ORIGIN/..` with `patchelf`, and
no-ops immediately on anything but Linux -- confirmed, not assumed, that
macOS's bundler doesn't do this kind of strict walk and Windows resolves
plugin DLLs via the process search path rather than an embedded rpath, so
neither of the other two platforms has anything to patch.

Unsigned for V1 on purpose: no Windows Authenticode or macOS Developer ID
certificate configured (both cost money and need an ongoing identity to
maintain). Windows shows a SmartScreen prompt, macOS a Gatekeeper prompt,
on first launch -- one click through, same as any indie app without a
paid cert, never blocking install.

Tests: `scripts/lib/fetch-python-runtime-check.sh` (new) -- a
deterministic, network-free gate shadowing `uname` to exercise every
OS/arch branch from this one machine, wired into `test-all.sh`; 2 new
Rust unit tests for `sidecar.rs`'s OS-branching helpers; 3 existing
`sidecar.rs` resolution tests updated to call the same helpers instead of
hardcoding `"python3"`. `cargo test`, `pytest` (223), `npm run test`
(924), typecheck, build, both browser E2E checks, and the full
`test-all.sh` all green on this machine.

**Closes a real previously-deferred bug, proven with a real build, not
just trusted from the fix's own reasoning**: ran `scripts/build-desktop.sh`
for real on this machine specifically to check whether
`fix-mujoco-plugin-rpath.sh` actually fixes the AppImage/`linuxdeploy`
bundling failure that had been left "deferred by user choice, not fixed."
`patchelf` wasn't installed here (no sudo in this environment) --
installed it via `pip install --target=<scratch dir> patchelf` (a real
prebuilt binary on PyPI) rather than skip the check. Result: all 4 mujoco
plugin `.so` files patched, `tauri build` produced a real
`okrobo-studio_0.1.0_amd64.AppImage` with no linuxdeploy failure, and
running it for real (`chmod +x`, execute) self-extracted and launched the
actual Tauri binary, which spawned the bundled sidecar from inside the
extraction using the bundle's own `runtime-dist/cpython/bin/python3` --
proof the bundled offline Python+mujoco stack works from the built
artifact itself, not just from source. The AppImage/linuxdeploy item is
no longer on the "remaining work" list below. Did **not** run an actual
`tauri build` on Windows or macOS here (no such machine available) -- the
CI matrix is what proves those two for real, the first time it runs. See
docs/decisions/desktop-cross-platform-build.md.

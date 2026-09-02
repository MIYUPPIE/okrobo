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

Not done here: pack signing (the manifest carries a content digest, not a publisher signature) — it needs a key-distribution decision for schools, so it is deliberately deferred rather than half-built.

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

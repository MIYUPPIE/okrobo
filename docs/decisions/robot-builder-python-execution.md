# Decision: Robot Builder — real Python execution (B1)

**Date:** 2026-09-09

## Scope

Closes half of `docs/decisions/robot-builder-programming.md`'s own "Non-goals" note: *"No Python/C++ execution... no `okrobo.BuiltRobot` package... Real execution needs its own RPC/worker plumbing... a future phase's work."* This is that phase, for Python only — a built robot's Python tab in Build mode's Test tab is now real, connected, sidecar-executed code, exactly like the Car/Arm/Drone Python tabs already are. C++ stays exactly as documented: a permanent non-goal, not deferred. A fixed compiled header can't represent per-student dynamic actuator/sensor ids the way a `RobotDef`'s own arbitrary shape allows — there is no analogous "future phase" for C++, and this doc doesn't change that.

## `okrobo.BuiltRobot` exists only as a remote proxy, never locally

Unlike `Robot`/`Arm`/`Drone` (each backed by a real, `_sim.py`-driven local implementation in `okrobo/__init__.py`, so a student's file can also run standalone outside the studio), `BuiltRobot` is added **only** to `runtime/python/okrobo/worker.py`'s remote-proxy module — never exported from `okrobo/__init__.py`, never given a local implementation. A built robot's shape is arbitrary and per-student; there is no fixed physics to mirror locally the way `_sim.py`'s `World`/`ArmWorld`/`DroneWorld` already do for the three fixed kinds. This means a built-robot Python program can never run standalone (`python3 program.py` outside the studio) — only through the sidecar, which is the only place its actual physics (the browser's `EngineBuiltRobot`, MuJoCo-backed) exists at all. A real, permanent, and correct capability gap versus Robot/Arm/Drone, not an oversight.

`worker.py`'s `BuiltRobot.set`/`.read` use two new RPC method names (`built_set`/`built_read`); `.wait`/`.stop` deliberately reuse the exact same generic `wait`/`stop` names Robot/Arm/Drone already use — harmless, since one worker subprocess only ever hosts one active robot class per run, and `sidecar.py`'s own `Session.pump_rpc` was already confirmed fully method-agnostic (relays opaque `{method, args}` JSONL with zero branching on robot kind) before writing any of this. **No changes to `sidecar.py` were needed.**

## `PythonBridge` made generic, not duplicated

`PythonBridge` was a concrete class hardwired to `RobotApi` (the Car/Arm/Drone vocabulary), with `executeRemoteRequest` as its own only dispatch function. A built robot's own `BuiltRobotApi` (`set`/`read` by string id) shares nothing structurally with `RobotApi` — extending `RobotApi` itself to also cover built robots was considered and rejected: `ProgramRunner`'s `move()`/`tick()` machinery is Car-wheel-specific, and stretching it to also carry built-robot state would tangle two genuinely different execution models (discrete step-count movements vs. continuous set-and-forget actuator control) into one class.

Instead, `PythonBridge<TRobot = RobotApi>` took one generic type parameter plus an injectable dispatch function (defaulting to `executeRemoteRequest`, so every existing 3-argument call site compiles unchanged). A second, narrow dispatcher, `executeBuiltRemoteRequest(robot: BuiltRobotApi, method, args)`, handles only `built_set`/`built_read`/`wait`/`stop`. Build mode's Test tab constructs its own `PythonBridge<BuiltRobotApi>` bound to `builtRunner.api` and this new dispatcher — the exact same class, connecting to the exact same `SIDECAR_URL`, just parameterized differently than Simulate mode's own instance.

## No hardware/serial chrome for a built robot

A built robot has no physical counterpart to flash firmware to or connect a real board over serial — Test mode's own Python wiring omits ports/hardware/flash entirely (unlike Simulate mode's Car, whose Python tab sits beside a Hardware panel). `PythonPanel`'s own built-in offline/connected footer already communicates sidecar status without any extra chrome needed here.

## Non-goals (B1 specifically)

- No C++ execution for built robots — permanent, not deferred (see Scope above).
- No built-robot content in Simulate mode yet — that's B2.
- No hardware/serial path for built robots (see above) — matches every other aspect of a built robot's physics-only nature.

## Verification

`apps/studio`: `npm run test` (792 passing; new `worker.py` tests, `PythonBridge.test.ts`'s new `executeBuiltRemoteRequest` suite, a real-spawned-sidecar case in `integration.test.ts`, `BuilderPanel.test.tsx` extended with a `PythonPanel` mock), `npm run typecheck`, `npm run build`. `runtime/python`: `pytest` (worker tests). `./scripts/check-studio-e2e.sh` — the previously-illustrative Python-tab check now asserts a real, sidecar-aware `PythonPanel`. Manually verified against a real running sidecar (`./scripts/run-python-sidecar.sh`) in a real headless-Chrome session: Build mode → New Robot → Simple Arm template → Test mode → Python tab shows "python: connected", writing and running a real `from okrobo import BuiltRobot` program actually moves the arm's actuator and the console shows real stdout.

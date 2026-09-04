# Decision: physics engine

**Date:** 2026-09-02 (Phase 5 start, per the open-decisions rule in build.md)
**Updated:** 2026-09-03 — integrated. See "Integration" below.

## Choice

**MuJoCo**, integrated when the first feature with contact dynamics lands
(objects to push/grasp, gravity-driven interaction). Until then the engine's
own kinematics stay the only sim math: the Phase 5 arm is joint-space motion
(rate-limited targets + forward kinematics) and needs no rigid-body solver.

## Why MuJoCo

- Robotics-first multibody engine, the de-facto standard for robot arms and
  RL; strong on multibody simulation where ODE-era engines are weaker.
- Apache-2.0 since the DeepMind acquisition; C API fits our C++ core.
- An active WebAssembly path exists (browser robotics simulators ship on
  MuJoCo WASM today), matching our engine-to-WASM architecture.
- Rejected **Jolt**: excellent modern engine but game/VR-oriented; joint
  motors and robotics workflows are not its center of gravity.
- Rejected **Bullet3**: the previous-generation robotics default; MuJoCo has
  the momentum, the docs, and the multibody strength.

## Why not integrate it now

Integrating a solver before any feature needs contacts adds megabytes to the
WASM bundle and a large build-system surface for zero user-visible gain.
Contract v1 is solver-agnostic (joint targets in, joint states out), so
MuJoCo can replace the kinematic arm backend later without touching any
consumer. The integration item is tracked in build.md Phase 6+.

Sources: [MuJoCo docs](https://mujoco.readthedocs.io/), [MuJoCo WASM browser simulator write-up](https://dev.to/googleai/building-a-gemini-powered-robotics-simulator-in-the-browser-with-mujoco-wasm-hjj), [SimBenchmark physics comparison](https://leggedrobotics.github.io/SimBenchmark/), [MDPI comparative study of physics engines](https://www.mdpi.com/2076-3417/13/2/680), [Bullet vs MuJoCo](https://www.libhunt.com/compare-bullet3-vs-mujoco)

## Integration (2026-09-03)

The Arm's pick-and-drop feature (contracts/robot-api/v3) is the trigger.
Two things worth recording that a reader of the original decision above
wouldn't expect:

- **Feasibility turned out much better than assumed.** A standalone spike
  (before any real engine work started) found MuJoCo 3.9.0 has first-class
  upstream Emscripten support — a `wasm/` build target, `if(EMSCRIPTEN)`
  branches throughout its own CMakeLists.txt — and compiled to WASM with
  zero source patches, correct physics (verified against the exact discrete
  solution, machine-precision agreement), no threading needed. The "browser
  robotics simulators ship on MuJoCo WASM today" line above undersold how
  supported this already is.
- **Scope turned out narrower than the original wording implied.** "MuJoCo
  replaces [the kinematic backend] behind these same messages" read as the
  arm's own joint motion migrating into an articulated physics model. What
  actually shipped: MuJoCo simulates one new graspable object (a free body:
  gravity, contact, settling); the arm's joints stay exactly the Phase 5
  kinematic model, unchanged and still gated by the same tests. This
  delivers the stated trigger ("objects to push/grasp, gravity-driven
  interaction") without the much larger, different project of migrating
  Phase 5's whole motion model — see contracts/robot-api/v3/contract.md's
  "Backends" section for the full reasoning.

Build recipe: `scripts/build-mujoco-native.sh` (host, for `engine/`'s own
ctest and the C++-track's compile-and-run gate test) and
`scripts/build-mujoco-wasm.sh` (WASM, for the studio's engine build).
`runtime/python/okrobo/physics.py` uses the official `mujoco` PyPI package,
version-pinned to the exact tag the C++/WASM side vendors, so both sides of
the parity gate (`engine/tests/parity/parity.mjs`) run the same solver, not
just "a" solver — and do, to 5.55e-17 (machine epsilon) on the scenario
that gate replays.
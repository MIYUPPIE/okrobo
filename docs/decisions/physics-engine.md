# Decision: physics engine

**Date:** 2026-09-02 (Phase 5 start, per the open-decisions rule in build.md)

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
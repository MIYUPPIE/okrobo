# Decision: robot builder templates (Robot Builder Phase 7)

**Date:** 2026-09-04

## Choice

Give Build mode's "New Robot" flow a small, fixed library of real, working starter robots (`apps/studio/src/builder/robotTemplates.ts`: Blank, Two-Wheeled Rover, Simple Arm) instead of always creating the same single hardcoded box, picked from a new modal (`apps/studio/src/builder/TemplateDialog.tsx`) that mirrors `apps/studio/src/dialogs.tsx`'s existing `OpenDialog` shape rather than inventing a new one.

## Two things this phase deliberately does not touch

- **Migrating Car/Arm/Drone onto `robot-def`.** `docs/decisions/robot-definition-schema.md:27` already calls this out as its own future decision. Car/Arm/Drone are hand-rolled, individually tuned, heavily tested systems with real Blocks/Python/C++ pipelines behind them — re-expressing them as `robot-def` documents would be a rewrite of shipped, working functionality, not a "templates" feature.
- **Joint-authoring in Build mode's UI.** Still the same Phase 2 non-goal it always was. A template can *ship* with joints already wired (the rover's wheels, the arm's shoulder/elbow) — the student edits body shapes/positions/materials and adds new (disconnected) bodies on top of a template exactly as they could before, they just can't yet restructure which joint connects which body through the UI.

## A real, previously-undiscovered engine bug, found and worked around (not fixed)

The rover template's wheels are driven by `velocity`-type actuators (MJCF `<velocity>`, a fixed `kv=1` gain — `built_robot.cpp` has no schema field to soften it, per its own comment). This is the **first time this actuator type has ever been exercised against real physics anywhere in this codebase** (grepped: only referenced in type definitions and `ActuatorPanel.tsx`'s slider-range display before this). The first template draft, with a physically-realistic solid-disc wheel inertia (~2e-5 for a 0.03 kg, 0.035 m radius wheel), crashed the instant any nonzero ctrl was applied.

The crash surfaced in the WASM/Node test environment as `TypeError: Cannot read properties of null (reading 'push')` inside `printChar`/`_fd_write` — a red herring. Reproduced natively instead (compiled `robot_def.cpp`/`built_robot.cpp` directly against native MuJoCo with a small scratch program, bypassing the `-sFILESYSTEM=0` WASM build's incomplete I/O shim, which was swallowing MuJoCo's own diagnostic text into an unrelated-looking crash), which revealed the real message: `WARNING: Nan, Inf or huge value in QACC at DOF 6. The simulation is unstable. Time = 0.0060.` A `<velocity>` actuator's fixed `kv=1` gain against a very small rotational inertia produces an enormous angular acceleration in the very first explicit-Euler substep (`torque/inertia`, with `built_robot.cpp`'s fixed 0.002s substep) — a textbook actuator/inertia stiffness mismatch, not a logic bug.

**Fix applied (template-scoped, not an engine change):** the wheels' rotational inertia was raised to 0.002 (about 100x the physically "realistic" value for their mass/radius) — verified natively to keep a real 3-second drive and a real turn both stable, then re-verified through the actual TypeScript/WASM path (`robotTemplates.physics.test.ts`, `EngineBuiltRobot` against the real compiled WASM module). This is an accepted, documented placeholder in the same spirit as Phase 3's `kp=5.0` position-actuator gain default — the schema has no field to soften MJCF's own `kv`, so the template's own physical parameters absorb the constraint instead.

**Left open, out of scope here:** any student who builds their own robot in Build mode and puts a `velocity`-type actuator on a low-inertia joint (fully reachable via `ActuatorPanel.tsx`'s existing slider today, no template involved) can hit the same instability. Whether that manifests as a hard crash depends on the runtime — the WASM/Node test harness's broken `fd_write` shim turns it into an opaque `TypeError`; a real browser tab, with a working console, would likely just print the MuJoCo warning and continue with numerically garbage (NaN) physics state, a confusing but non-fatal experience. Hardening this generally — e.g. clamping/rejecting NaN state in `wasm_api.cpp`, or switching `GenerateMjcf`'s integrator to something less stiffness-prone — is real engine work affecting every existing built robot, not a "templates" feature, and needs its own dedicated verification against every already-passing physics assertion in this repo. Flagged here for whoever next touches actuator handling, not silently worked around and forgotten.

## A second, smaller discovery: MuJoCo cylinder orientation

A MuJoCo `<geom type="cylinder">`'s own symmetry axis runs along its *local* Z by default. With no body-level rotation, the rover's wheel geometry lay flat like a puck (radius in the XY-plane) rather than standing on edge like a wheel — caught by an early physics test where the "settled" resting height came back at roughly half the cylinder's length instead of its radius. Fixed by rotating each wheel body 90° about local X (`rotation_rpy: [Math.PI/2, 0, 0]`), bringing the cylinder's axis to local Y — matching the wheel hinge joints' own `[0,1,0]` spin axis, so the wheel both looks and rolls correctly.

## Non-goals

- **No template sharing/download via packs.** Whether/how templates become pack content is a separate, later concern; these are a fixed, built-in TypeScript list.
- **No user-saved custom templates.** Only the fixed built-in set is pickable — the same "a minimal picker, not an authoring surface" scoping Phase 5's world picker already established.
- **No "start from an existing project's robot as a template."** The dialog only ever appears from the empty-project "+ New Robot" state (the only place a new robot document gets created today); it doesn't clone or branch off a robot already open.
- **No general fix for the velocity-actuator/low-inertia instability** described above, beyond this phase's own two templates.

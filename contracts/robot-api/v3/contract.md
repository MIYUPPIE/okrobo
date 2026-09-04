# Robot API v3

v3 = v2 (car, arm, lidar, drone, unchanged except where noted) plus:

## Arm: a graspable object

The arm's workspace now has one graspable box, resting on the floor within
reach of the default `ArmConfig` (reachability verified numerically, not
assumed — see build.md). Two new commands:

- `arm_grip` — grips the object if the tip is within `kGraspTolerance`
  (0.05 m) of it. No-op if already holding, or if out of reach; check the
  new `holding` state field to see whether it actually succeeded.
- `arm_release` — lets go. No-op if not holding.

Two new `arm_state` fields:

- `holding` (boolean) — true while gripped.
- `object` (`{x, y, z}`) — the object's position: pinned exactly to the tip
  while held, MuJoCo's real simulated position once released.

## Backends: a narrower reading than v1 anticipated

v1's contract note said "when contact dynamics arrive, MuJoCo replaces
[the arm's kinematic backend] behind these same messages" — implying the
arm's own joint motion itself would migrate to a physics solver. This
turned out to be more than the actual trigger needed:
`docs/decisions/physics-engine.md`'s stated trigger is "objects to
push/grasp, gravity-driven interaction," which v3 delivers by giving MuJoCo
just the object (a free body: real gravity, real contact, real settling),
while the arm's joints stay exactly the v1 kinematic model — rate-limited
motion toward a clamped target, unchanged, still gated by the same
`engine/tests/test_arm.cpp`. Migrating the arm's own joint motion into an
articulated MuJoCo model (motors, torque limits, self-collision) is a much
larger, different project — it would replace Phase 5's whole motion model,
not extend it — and nothing in the stated trigger asked for it. If a future
feature genuinely needs that (e.g. a arm that can be knocked off course by a
collision), it is a new, separate decision, not implied by this one.

## Reference dynamics

`runtime/python/okrobo/_sim.py` (`ArmWorld`) is the executable spec for the
arm's joint motion, unchanged from v1. The graspable object's physics is
real MuJoCo on both sides: `engine/src/physics_object.cpp` (C++/WASM) and
`runtime/python/okrobo/physics.py` (Python, via the `mujoco` package) build
the identical MJCF model and are locked together by a parity gate
(`engine/tests/parity/`), the same discipline as every other simulated
quantity in this project.

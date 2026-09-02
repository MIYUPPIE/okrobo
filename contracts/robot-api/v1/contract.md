# Robot API v1

v1 = v0 (car, unchanged, referenced by `$ref`) plus:

## Arm (4-DOF)

Joints in order: `base` (yaw about z), `shoulder`, `elbow`, `wrist`
(pitch from horizontal, up positive). Motion is joint-space kinematics:
each joint moves toward its clamped target at a fixed max speed. `moving`
is true while any joint is off target. `tip` is the forward-kinematics
end-effector position.

Defaults (engine `ArmConfig` / reference `okrobo._sim.ArmConfig`):
base height 0.12 m, links 0.22 / 0.18 / 0.10 m, speeds 90°/s,
limits base ±180°, shoulder −10°..100°, elbow ±120°, wrist ±90°,
start pose [0°, 60°, −30°, −30°].

Commands: `arm_target {joint, angle}`, `stop` (targets snap to current
angles), `reset`. State: see `arm_state` in [schema.json](schema.json).

## Lidar (car)

A read-only fan of the v0 distance sensor: distances along N rays spread
over a field of view centered on the heading, ordered left to right. At the
remote/Python level it is the method `lidar {rays, fov_degrees} -> number[]`;
the engine exposes the single-ray primitive (`world_ray(offset)` / `ray()`),
callers assemble the fan.

## Backends

The arm's kinematic backend is deliberately solver-agnostic; when contact
dynamics arrive, MuJoCo replaces it behind these same messages
(docs/decisions/physics-engine.md).

## Reference dynamics

`runtime/python/okrobo/_sim.py` (`ArmWorld`) is the executable spec;
`engine/src/arm_world.cpp` implements the same math and the parity gate
(`engine/tests/parity/`) locks them together, as with v0.

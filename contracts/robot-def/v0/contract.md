# Robot Definition v0

A structural, backend-agnostic description of an arbitrary robot: bodies, joints, actuators, sensors. Defined in [schema.json](schema.json), examples in [examples/](examples/), one fixture per validation rule in [invalid/](invalid/).

This is a different kind of contract than `contracts/robot-api/`: `robot-api` is the message protocol between a controller and a running robot backend (commands in, state out); `robot-def` is the static document describing what a robot *is* -- the same relationship `contracts/world/` (an arena document) already has to `robot-api` (the protocol that runs inside it).

## Model

- Units: meters, kilograms, radians, seconds. Rotation is roll-pitch-yaw (intrinsic XYZ Euler), matching URDF's convention and this repo's own `packs/core/robots/arm.urdf`.
- The kinematic tree is defined entirely by `joints[]` edges, not a `body.parent` field: a body with no incoming joint edge is a root, and rigid attachment is a `fixed` joint, not a second hierarchy mechanism. This mirrors URDF and `apps/studio/src/packs/urdf.ts`'s own idiom exactly, so there is never a second, possibly-disagreeing way to express the same tree.
- `bodies[]`: visual/collision geometry (box, sphere, cylinder, capsule, cone, plane, or a mesh path reference), mass, diagonal inertia, optional material color.
- `joints[]`: `fixed`, `hinge`, `slider`, `ball`, or `free`. `hinge`/`slider` carry an axis and optional limits/damping/friction.
- `actuators[]`: declares that a joint *can* be driven (type + effort/velocity limits). No gains, no PID, no target value -- that is a controller's concern, out of scope for v0.
- `sensors[]`: `camera`, `distance`, `lidar`, `imu`, `encoder`, `gps`, `touch`, `force_torque`, each attached to a body (encoders also reference a joint). Type-specific parameters live in a loose `params` object; the schema only guarantees the envelope, not per-type shape.

v0 scope cuts, each a deliberate deferral:
- Mesh geometry is a `path` string reference only, never opened or parsed in v0 -- asset loading is a runtime concern for a later phase.
- Inertia is diagonal only (`ixx`/`iyy`/`izz`); off-diagonal products add real complexity nothing needs yet.
- `ball`/`free` joints carry no limits -- a solver-specific modeling detail with no consumer yet.
- No `controllers[]`, no multi-robot world placement, no templates/assemblies.

## Reference implementation and validation

The executable spec is `runtime/python/okrobo/robot_def.py` (`parse_robot_def`, `validate_robot_def`) -- the same role `runtime/python/okrobo/_sim.py` plays for kinematics. `apps/studio/src/contracts/robotDef.ts` and `engine/src/robot_def.{hpp,cpp}` are hand-mirrored to match, matching this repo's established convention of hand-mirroring contracts across languages and locking them together with tests rather than codegen. `engine/tests/test_robot_def.cpp`, `runtime/python/tests/test_robot_def.py`, and `apps/studio/src/contracts/robotDef.test.ts` all read the same fixtures under `examples/` and `invalid/`, so a rule that drifts between languages fails in all three suites identically.

**This schema has no runtime behavior in v0** -- it is parsed and validated, never simulated. There is no MJCF generation, no engine wiring, no WASM export, and no UI. Car/Arm/Drone are unaffected and unconverted; nothing about how they work today changes.

Validation never throws: `validate_robot_def`/`validateRobotDef`/`ValidateRobotDef` always return a list of issues (`{rule, severity, element_kind?, element_id?, message}`), even an empty one, so a future builder UI can show every problem on a robot at once rather than one at a time. Parsing (`parse_robot_def`/`parseRobotDef`/`ParseRobotDef`) still throws on malformed JSON shape -- that is a file-corruption/programmer error, not a design-time issue for a student to fix.

## Versioning

This directory is frozen once all three language mirrors ship against it. Changes go to `v1/` with all three updated in the same commit.

# Robot Definition v1

A structural, backend-agnostic description of an arbitrary robot: bodies, joints, actuators, sensors. Defined in [schema.json](schema.json), examples in [examples/](examples/), one fixture per validation rule in [invalid/](invalid/).

This is a different kind of contract than `contracts/robot-api/`: `robot-api` is the message protocol between a controller and a running robot backend (commands in, state out); `robot-def` is the static document describing what a robot *is* -- the same relationship `contracts/world/` (an arena document) already has to `robot-api` (the protocol that runs inside it).

## What changed from v0

One new `Geometry` variant, `cad_mesh`: a triangulated mesh (`vertices`/`faces`, flat arrays) authored by the CAD kernel (`apps/studio/src/cad/`, see `docs/decisions/cad-kernel-foundation.md`). It carries **baked, frozen** mesh data -- the sketch-and-extrude (and, in later phases, revolve/loft/fillet/chamfer/shell/draft) steps that produced it are not stored in the document, the same way a hand-authored `box`/`cylinder` body's numbers don't retain "how the student arrived at them." A live, re-editable feature tree is explicitly future work, not part of v1.

Everything else is unchanged from v0 -- this is why v1 exists instead of a variant-only sibling contract: it's the same kind of document (`robot-def`, not a new family), just with one additive field, following `robot-api`'s own v0→v1→v2→v3 precedent (each version additive, frozen once superseded) rather than pack.json's different in-place-extension choice (which had no stated freeze policy to begin with -- this contract does).

## Model

- Units: meters, kilograms, radians, seconds. Rotation is roll-pitch-yaw (intrinsic XYZ Euler), matching URDF's convention and this repo's own `packs/core/robots/arm.urdf`.
- The kinematic tree is defined entirely by `joints[]` edges, not a `body.parent` field: a body with no incoming joint edge is a root, and rigid attachment is a `fixed` joint, not a second hierarchy mechanism.
- `bodies[]`: visual/collision geometry (box, sphere, cylinder, capsule, cone, plane, an external mesh path reference, or now a baked `cad_mesh`), mass, diagonal inertia, optional material color.
- `joints[]`: `fixed`, `hinge`, `slider`, `ball`, or `free`. `hinge`/`slider` carry an axis and optional limits/damping/friction.
- `actuators[]`: declares that a joint *can* be driven (type + effort/velocity limits). No gains, no PID, no target value -- that is a controller's concern.
- `sensors[]`: `camera`, `distance`, `lidar`, `imu`, `encoder`, `gps`, `touch`, `force_torque`, each attached to a body (encoders also reference a joint). Type-specific parameters live in a loose `params` object; the schema only guarantees the envelope, not per-type shape.

Scope cuts carried over from v0, each still a deliberate deferral:
- The external-file `mesh` geometry (a `path` string) is still never opened or parsed -- unrelated to `cad_mesh`, which carries its data inline and needs no file resolution at all.
- Inertia is diagonal only (`ixx`/`iyy`/`izz`); off-diagonal products add real complexity nothing needs yet.
- `ball`/`free` joints carry no limits -- a solver-specific modeling detail with no consumer yet.
- No `controllers[]`, no multi-robot world placement, no templates/assemblies.

New scope cut for v1 specifically:
- `cad_mesh` is write-once, read-many data. There is no in-app authoring UI yet (`apps/studio/src/cad/`'s `extrude.ts` + `scripts/generate-cad-examples.mjs` are the only producers this phase) and no schema field for "how this mesh was constructed" -- a future phase that adds a real sketch/feature-tree UI will need its own, separate persistence for that, layered on top of (not replacing) the baked `vertices`/`faces` a physics engine and a renderer actually consume.

## Reference implementation and validation

The executable spec is `runtime/python/okrobo/robot_def.py` (`parse_robot_def`, `validate_robot_def`). `apps/studio/src/contracts/robotDef.ts` and `engine/src/robot_def.{hpp,cpp}` are hand-mirrored to match, per this repo's established hand-mirroring convention. `engine/tests/test_robot_def.cpp`, `runtime/python/tests/test_robot_def.py`, and `apps/studio/src/contracts/robotDef.test.ts` all read the same fixtures under `examples/` and `invalid/`, so a rule that drifts between languages fails in all three suites identically.

Unlike v0, **this schema does have runtime behavior**: `GenerateMjcf`/`BuiltRobot` (`engine/src/built_robot.{hpp,cpp}`) compile a document into a real MuJoCo model (bodies, joints, actuators, seven of eight sensor types, and now `cad_mesh` bodies as real collision meshes via `mjs_addMesh`/`uservert`/`userface` -- see `docs/decisions/cad-kernel-foundation.md`), exposed through a WASM export family and consumed by Build mode's Test mode.

Validation never throws: `validate_robot_def`/`validateRobotDef`/`ValidateRobotDef` always return a list of issues (`{rule, severity, element_kind?, element_id?, message}`), even an empty one. Parsing (`parse_robot_def`/`parseRobotDef`/`ParseRobotDef`) still throws on malformed JSON shape.

## Versioning

This directory is frozen once all three language mirrors ship against it. Changes go to `v2/` with all three updated in the same commit. `v0/` stays exactly as it was -- a historical reference, not maintained further.

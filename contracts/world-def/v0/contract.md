# World Definition v0

A structural, backend-agnostic description of an arbitrary static environment: a flat list of placed objects. Defined in [schema.json](schema.json), examples in [examples/](examples/), one fixture per validation rule in [invalid/](invalid/).

This is a different contract than `contracts/world/` (the Car/Drone's arena): that family requires `robot_radius`/`wheel_base` as top-level fields and is consumed by `engine/src/world.hpp`'s hand-rolled 2D differential-drive kinematic model, where obstacles are non-colliding raycast targets a robot can drive straight through. `world-def` describes an environment for an arbitrary built robot (`contracts/robot-def/v0`), simulated with real MuJoCo physics -- objects here are real colliders, and the document carries no robot-shape assumptions at all. See `docs/decisions/robot-builder-world.md` for the full reasoning.

## Model

- Units: meters, radians, seconds. Rotation is roll-pitch-yaw (intrinsic XYZ Euler), matching `robot-def`'s own convention exactly -- the `vec3`/`transform`/`geometry`/`material` shapes in this schema are intentionally identical to `contracts/robot-def/v0`'s, since they describe the same underlying concepts (a position/rotation, a primitive shape, a color), not independently invented ones.
- `objects[]`: each a `{id, name, transform?, geometry, material?}`. `geometry` is required (unlike `robot-def`'s `Body`, there is no separate visual/collision split -- one geometry serves as both).
- **Every object is static in v0**: no joints, no actuators, no sensors, no mass, no kinematic tree. An object never moves once placed. This is the load-bearing scope decision that keeps this schema far simpler than `robot-def` -- there is no root/cycle/duplicate-child class of validation rule here, because there is no tree to have a cycle in.
- "Terrain" in v0 means shaped/rotated primitives (e.g. a rotated box as a ramp), not heightfield/procedural terrain authoring.

## Reference implementation and validation

The executable spec is `runtime/python/okrobo/world_def.py` (`parse_world_def`, `validate_world_def`), the same role `runtime/python/okrobo/robot_def.py` plays for robots. `apps/studio/src/contracts/worldDef.ts` and `engine/src/world_def.{hpp,cpp}` are hand-mirrored to match, following this repo's established no-codegen convention. All three deliberately reuse `robot-def`'s own `Transform`/`Geometry`/`Material` types and parsing/serialization logic where language mechanics allow it (TypeScript and Python export and import the shared helpers directly; C++ keeps one small, documented, unavoidable duplication -- `robot_def.cpp`'s own parsing helpers have internal linkage and are genuinely unreachable from another translation unit).

Validation never throws (`validate_world_def`/`validateWorldDef`/`ValidateWorldDef` always return a list of issues, matching `robot-def`'s `Issue` shape exactly: `{rule, severity, element_kind?, element_id?, message}`); parsing still throws on malformed shape. The rule set is short, since there is no tree: `object-duplicate-id` and `object-invalid-geometry` are the only two rules in v0.

**This schema has no runtime behavior on its own** -- a `world-def` document only does something once paired with a `robot-def` document and simulated together (`engine/src/built_robot.cpp`'s `GenerateMjcf(robot, world)`).

## Versioning

This directory is frozen once all three language mirrors ship against it. Changes go to `v1/` with all three updated in the same commit.

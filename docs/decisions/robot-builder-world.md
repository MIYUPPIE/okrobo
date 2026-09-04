# Decision: robot builder world (Robot Builder Phase 5)

**Date:** 2026-09-04

## Choice

A new contract family, `contracts/world-def/v0`, describing an arbitrary static environment for a built robot to be tested in: a flat list of placed objects, no kinematic tree. New `runtime/python/okrobo/world_def.py`, `apps/studio/src/contracts/worldDef.ts`, `engine/src/world_def.{hpp,cpp}`, wired into `GenerateMjcf`/`BuiltRobot` and rendered in `TestViewport.tsx`.

## A new family, not an extension of `contracts/world/`

The existing `contracts/world/v1` (the Car/Drone's arena) *requires* `robot_radius` and `wheel_base` as top-level fields -- a document cannot even be schema-valid without declaring a circular robot's radius and a differential-drive wheelbase. It is consumed by `engine/src/world.hpp`'s hand-rolled 2D analytic kinematic model, where "obstacles" are non-colliding raycast targets only (a robot can drive straight through one) -- not real physics colliders. Neither the schema nor the engine behind it generalizes to an arbitrary MuJoCo-simulated `BuiltRobot`. This is exactly the same situation `docs/decisions/robot-definition-schema.md` already reasoned through for `robot-def` vs `robot-api`: a genuinely different kind of document (and, here, a genuinely different physics backend) gets its own family rather than an awkward extension.

## World objects have no kinematic tree -- the scope-defining simplification

Every `world-def` object is independently placed and static: no joints, no actuators, no sensors, no mass or inertia (a static MJCF geom with no joint needs no `<inertial>` -- mass only matters for something that moves, and nothing here moves in v0). This is the single fact that keeps this schema far simpler than `robot-def`: there is no root/cycle/duplicate-child class of validation rule, because there is no tree to have a cycle in. The v0 rule set is exactly two rules: `object-duplicate-id` and `object-invalid-geometry`.

## Reusing `robot-def`'s `Transform`/`Geometry`/`Material`, not reinventing them

A position-and-rotation, a primitive shape, and a color are the same concepts here as they are for a robot body -- not independently invented ones that happen to look similar. `robot-def`'s versions of these types already have complete MJCF codegen (`built_robot.cpp`'s `MjcfGeomAttrs`/`MjcfPosEuler`) and three.js codegen (`robotThree.ts`'s `geometryFor`/`applyTransform`, both already exported), so `world-def` reuses them directly rather than redefining an equivalent shape a second time:

- **C++**: `world_def.hpp` `#include`s `robot_def.hpp` and uses `okrobo::Vec3`/`Transform`/`Geometry`/`GeometryType`/`Material` as-is -- these are the header's own public types, unaffected by the `PhysicsVec3` rename Phase 3 needed (that was about a genuinely different, physics-object-internal `Vec3`, not this one). One small, accepted, documented duplication follows from this reuse being incomplete: `robot_def.cpp`'s own JSON-parsing helpers (`ParseGeometry`, etc.) live in an anonymous namespace, which gives them internal linkage -- they are not merely unexported, they are genuinely unreachable from `world_def.cpp`, a different translation unit. `world_def.cpp` carries its own ~30-line copy of the equivalent parsing logic rather than trying to share code across a linkage boundary that doesn't allow it.
- **TypeScript and Python have no such boundary**, so the reuse is complete: `apps/studio/src/contracts/robotDef.ts`'s `parseTransform`/`parseGeometry`/`transformToJson`/`geometryToJson` and `runtime/python/okrobo/robot_def.py`'s equivalents (renamed from `_parse_transform` etc. to drop the leading underscore -- a private-by-convention-only distinction in Python, not a real access boundary, and zero change to either module's public API or the wire format) are exported and imported directly by `worldDef.ts`/`world_def.py`. This is a deliberate, small, backward-compatible touch-up to Phase 1's shipped files, not a reopening of the frozen contract itself (`schema.json` is untouched; only two files' internal helper visibility changed).

## MJCF emission: bare `<geom>`, no `<body>` wrapper, `world_` name prefix

A static object with no joint needs no enclosing `<body>` element -- it can be a plain `<geom>` directly under `<worldbody>`, exactly like the floor geom `GenerateMjcf` has always emitted. World object geom names are prefixed `world_{object.id}` specifically to avoid a namespace collision with a robot body/joint/sensor that happens to share the same id -- MJCF's geom names are a single flat namespace across the whole compiled model, and a robot-def document and a world-def document are authored independently, with no way to know about each other's ids in advance.

## "Terrain" means shaped primitives, not heightfield authoring

MuJoCo supports heightfield terrain (`<hfield>`), but authoring one needs its own UI (a heightmap painter or procedural generator) that this phase doesn't build. A rotated box already produces a real, physically correct ramp a robot can drive or roll up -- v0's "terrain" is exactly that: ordinary primitives placed and rotated, not a new terrain-specific mechanism.

## Deferred: a full World Builder authoring UI

This phase ships the schema and the physics/rendering pipeline -- a robot can genuinely be tested against real obstacles -- but not a drag-and-drop 3D authoring surface (hierarchy/inspector/gizmo, mirroring the robot builder's own `BuilderViewport`/`HierarchyList`/`BodyInspector`). `apps/studio/src/builder/worldExamples.ts` ships a small, fixed set of hand-written example worlds (empty / obstacle course / ramp) selectable from a plain dropdown in Test mode, the same way Phase 1's robot-def schema shipped without Phase 2's construction UI existing yet.

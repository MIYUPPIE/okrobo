# Decision: robot builder physics (Robot Builder Phase 3)

**Date:** 2026-09-04

## Choice

Given a `contracts/robot-def/v0` document, generate an MJCF model and simulate it with the same vendored MuJoCo 3.9.0 already used for the Arm's graspable object (`engine/src/physics_object.cpp`). New `engine/src/built_robot.{hpp,cpp}` (`GenerateMjcf`, `class BuiltRobot`) and `engine/src/robot_tree.{hpp,cpp}` (a kinematic-tree helper, ported from `apps/studio/src/builder/robotTree.ts`). No sensors (Phase 4), no Blockly/Python wiring (Phase 6).

Several sub-decisions here aren't spelled out anywhere else and are worth recording, since none of them were forced by the schema -- each is a real interpretive call.

## Reversing "no JSON in WASM"

Phase 1's `robot_def.cpp` was deliberately kept out of `scripts/build-engine-wasm.sh`'s source list so `nlohmann/json` could never reach the WASM bundle. Phase 3 needs to send an entire variable-shaped, string-keyed document (bodies/joints/actuators, arbitrary counts) from JS into the compiled engine -- exactly what JSON is for, and exactly what a scalar-call accumulation API (one WASM call per body/joint/actuator field, numeric indices standing in for string ids) would have to badly reinvent. Reusing `ParseRobotDef` directly is simpler, reuses an already-vendored and already-tested parser, and the WASM size cost is small next to the ~3.4MB MuJoCo-dominated bundle already shipped. `robot_def.cpp`, `robot_tree.cpp`, and `built_robot.cpp` are now part of the WASM build; the nlohmann/json single header is fetched into `tools/nlohmann_json/` by `scripts/build-engine-wasm.sh` itself (check-then-curl, mirroring `fetch-python-runtime.sh`'s idiom) since the WASM build is a standalone `em++` invocation, not something CMake's own `FetchContent` populates.

## Every root body gets a `<freejoint/>`

Robot-def has no "is this root fixed to the world" flag. Rather than leave root bodies welded to the world (MuJoCo's default for a body with no joint), every root body gets a `<freejoint/>` -- the whole assembly is a real, free-floating physical object from the start, landing on a floor and settling under gravity by default. This matches `physics_object.cpp`'s own precedent (its one object is a free body) and is the more broadly useful default for a Robot Builder demo -- a dropped chassis or a swinging arm is a compelling "this is real physics" proof; a permanently-fixed base is not, and would need its own flag this schema doesn't have. A future phase can add an explicit "anchor this root to the world" option if a stationary-arm-base use case needs it.

## A synthesized floor plane

Robot-def has no concept of a floor or world at all -- it describes a robot, not a scene. `GenerateMjcf` always emits a static ground plane in `<worldbody>`, exactly like `physics_object.cpp`'s own `<geom name="floor" type="plane" size="5 5 0.1"/>`. Without it, every free-jointed root body would fall forever and Test mode would prove nothing.

## `cone` and `mesh` geometry fallbacks

MuJoCo's native geom types are `plane, hfield, sphere, capsule, ellipsoid, cylinder, box, mesh, sdf` -- no `cone`. `GenerateMjcf` approximates a `cone` geometry as a `cylinder` of the same radius and length: not exact, but keeps real collision geometry rather than dropping it. `mesh` geometry (file loading is out of scope through v0) gets a small placeholder box, mirroring `apps/studio/src/builder/robotThree.ts`'s own `PLACEHOLDER_SIZE = 0.06` treatment of mesh bodies in the (non-physics) Edit-mode renderer -- so a mesh body's rough footprint is at least consistent between what a student sees while editing and what physically collides during a test run.

## `plane` geometry and non-root `free` joints are permanent v0 limitations

MJCF restricts plane geoms to the world body or *static* children of it, and restricts free joints to bodies that are children of the world body. Given every body in this system descends from a free-jointed, moving root (previous section), a body with `plane` collision geometry, or a `free`-type joint on a non-root body, can never compile. This isn't specially detected or given a friendly error in v0 -- `BuiltRobot`'s constructor just throws like it would for any other MJCF compile failure, and `EngineBuiltRobot.ts` surfaces that as "failed to build robot for physics." Worth remembering if a future contributor is tempted to "fix" this: it isn't a bug, it's a structural consequence of the freejoint-root decision above, and undoing it would mean giving robot-def a fixed-to-world concept it doesn't have.

## Actuators targeting `ball`/`free` joints are skipped

`validateRobotDef` only forbids an actuator targeting a `fixed` joint; targeting `ball` or `free` is schema-legal but has no MJCF scalar-transmission equivalent (`<motor>`/`<position>`/`<velocity>` all drive a single scalar DOF). `GenerateMjcf` silently omits the MJCF actuator for these, and `BuiltRobot::set_actuator_ctrl` returns `false` for an index that didn't get one, rather than throwing or misaligning indices.

## Default position-actuator gain

MJCF's `<position>` actuator needs a `kp` (proportional gain); the schema has no gain field for `servo`-type actuators. `kp="5.0"` is used unconditionally -- MuJoCo's own library default (`kp=1`) was empirically too weak to reach a target against even light resistance. Not calibrated per-robot; a reasonable, documented placeholder until the schema (if ever) grows a gain field.

## Open question, not resolved: `joint.axis`'s frame

`contracts/robot-def/v0/schema.json` describes `axis` as "in the parent frame," but URDF (which the schema's own `contract.md` says it mirrors) and MuJoCo's own `<joint axis>` both interpret a joint's axis in the *child/joint* frame (after `origin` is applied), not literally the parent's. No fixture in this repo currently rotates a `joint.origin`, so the two readings are indistinguishable in every existing test -- `GenerateMjcf` passes `axis` through unchanged (MuJoCo's native interpretation), which is right under the URDF/MuJoCo reading and only wrong under the schema's literal wording for a joint whose origin has nonzero rotation. Flagging this for whoever next touches `contracts/robot-def/`, rather than silently picking one and moving on: this needs either a schema wording fix or a genuine test with a rotated `joint.origin` before anyone should trust it either way.

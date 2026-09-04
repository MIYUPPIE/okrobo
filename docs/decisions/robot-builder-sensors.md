# Decision: robot builder sensors (Robot Builder Phase 4)

**Date:** 2026-09-04

## Choice

Give runtime behavior to seven of the eight `contracts/robot-def/v0` sensor types (`encoder`, `gps`, `distance`, `touch`, `force_torque`, `imu`, `lidar`) inside `BuiltRobot` (`engine/src/built_robot.{hpp,cpp}`). `camera` stays unimplemented -- see "Camera deferred" below.

## One MJCF `<site>` per sensor, except encoder and camera

Every MuJoCo sensor element except `<jointpos>`/`<jointvel>` mounts on a `<site>` (a zero-mass reference frame), not a body or geom directly -- confirmed against `tools/mujoco/doc/XMLreference.rst`'s own attribute lists for `<touch>`, `<accelerometer>`, `<gyro>`, `<force>`, `<torque>`, `<rangefinder>`. `GenerateMjcf` emits `<site name="{sensor.id}_site" pos="..." euler="..."/>` inside the mounting body at the sensor's own `transform`, for every in-scope type except `encoder` (attaches directly via `joint="..."`, no site) and `camera` (out of scope, no site, no sensor element). `gps` uses `<framepos objtype="site" objname="...">` rather than `objtype="body"` specifically so the sensor's `transform` mount-offset is actually honored -- a plain `objtype="body"` reports the body's own frame and would silently ignore it.

## Encoder skips a non-scalar target joint, same as Phase 3's actuator fix

`ValidateRobotDef` only checks that an encoder's `joint` field is set and resolves to a real joint -- nothing constrains it to `hinge`/`slide`. MJCF's `<jointpos>` requires exactly those two types. An encoder pointed at a `ball`, `free`, or `fixed` joint would produce a document `mj_compile` rejects outright, failing the *entire* robot over one bad sensor -- the same failure mode Phase 3 already solved once for actuators targeting `ball`/`free` joints. `GenerateMjcf` applies the identical fix: skip the `<jointpos>` element when the target joint doesn't resolve to a scalar joint type, and `BuiltRobot` reads that sensor back as zero rather than letting construction throw.

## Lidar: `rays`/`fov_degrees`, not invented parameter names

A lidar sensor's `params_json` is parsed for `{"rays": int, "fov_degrees": number}`, defaulting to `rays=9, fov_degrees=180.0` when absent or malformed -- matching, not inventing, the convention already established across this codebase (`contracts/robot-remote/v1/contract.md`, `runtime/python/okrobo/robot.py`'s `Robot.lidar(rays=9, fov=180.0)`, `apps/studio/src/program/ProgramRunner.ts`). No native MJCF sensor exists for a multi-ray scan, so `BuiltRobot::sync_sensor_data` calls `mj_multiRay` directly at read time, fanning `rays` directions across `fov_degrees` around the mounting site's local +Z axis (the same forward convention `<rangefinder>` itself uses), swept within the site's local XZ plane (rotation around local +Y). This is a real interpretive choice, not the only possible one -- there is no "up axis" concept in the schema to anchor a canonical sweep plane, so a lidar's actual scan plane in world space depends entirely on how a student orients the sensor's `transform`. `bodyexclude` is set to the mounting body's own id so a lidar never hits the robot's own geometry.

## `<force>`/`<torque>` measure a joint reaction, not "force at a point"

MuJoCo's own docs are explicit: these sensors report the interaction force/torque between a site's body and its *MJCF parent* body (a real wrist/ankle F-T sensor's actual physics), not a generic point-force reading in space. A `force_torque` sensor's number depends on which body it's mounted on and how that body is jointed to its parent -- e.g. one mounted on a free-floating root reports inertial reaction forces, which is correct and expected, not a bug, if a future reader is surprised by it.

## IMU gravity reading verified, not assumed

An accelerometer measures proper acceleration (coordinate acceleration minus gravitational acceleration), so a stationary body at rest should read approximately `(0, 0, +9.81)` m/s² -- the reaction force countering gravity, not zero. This is standard IMU physics and matches MuJoCo's own accelerometer convention, but per this project's "measure real numbers, don't assume tolerances" testing discipline (established in Phase 3), `test_built_robot.cpp`'s IMU test asserts this against the actual simulated value rather than trusting the convention on paper.

## Two things the tests found that weren't obvious in advance

`mj_multiRay`'s `cutoff` parameter is not a hard clamp on the returned distance -- it's a search-radius hint to the ray/geom culling. A near-horizontal test ray whose true floor intersection was 5.737m away, past a 5.0m cutoff, still came back with that real distance rather than `-1`. `BuiltRobot`'s `kLidarCutoff` comment documents this so a future reader doesn't assume every lidar reading is strictly bounded by it.

A box resting on a plane contacts near its four corners (box-plane collision generates one contact point per corner, not one at the center) -- a `touch` sensor site positioned at the center of a box's bottom face can sit measurably outside where any real contact point lands, reading zero even while genuinely resting on the floor. `test_built_robot.cpp`'s touch test uses a sphere specifically to get the single, centered contact point a touch zone can actually be aimed at. `GenerateMjcf` still emits every touch site at MuJoCo's own default size (a 5mm-radius sphere) -- a body-shape-aware "cover the whole footprint" touch zone is a real gap for boxes and other non-spherical shapes, deliberately not solved here (see build.md's Phase 4 entry for the explicit non-goal list).

## Camera deferred

Out of scope for this phase entirely -- a different subsystem, not a smaller version of the same one. The Car's existing `engine/src/camera.hpp` is a from-scratch deterministic 2D raycaster over `World`'s obstacle boxes; it has no notion of arbitrary 3D MJCF geometry and cannot be extended to one. No offscreen-rendering mechanism (a second three.js camera plus a `WebGLRenderTarget`, reading pixels back) exists anywhere in the frontend yet, and `apps/studio/src/builder/TestViewport.tsx`'s `scene`/`camera`/`renderer` are currently local variables trapped inside one `useEffect` closure with no external access point -- real refactoring work, not a drop-in addition. `camera`-type sensors still parse and validate fine (unchanged since Phase 1); `SensorPanel.tsx` shows an explicit "Camera preview isn't available yet" placeholder rather than silently omitting them.

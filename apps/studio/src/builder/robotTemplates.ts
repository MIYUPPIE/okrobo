// Hand-written RobotDef starter templates for Build mode's "New Robot" flow
// (Robot Builder Phase 7) -- not a runtime import of
// contracts/robot-def/v0/examples/*.json, mirroring worldExamples.ts's
// (Phase 5) and robotEdits.ts's own makeDefaultRobotDef precedent: that
// directory is a contract/test asset, not something the shipped app should
// pull in as a runtime dependency. A fixed, built-in list -- not user-saved
// custom templates, and not something a student can add to -- matching
// Phase 5's own "a minimal picker, not an authoring surface" scoping. See
// docs/decisions/robot-builder-templates.md.

import { makeDefaultRobotDef } from "./robotEdits";
import type { RobotDef } from "../contracts/robotDef";

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

/** Today's exact single-box starter, unchanged -- kept as the first,
 * default template for continuity with every project created before this
 * phase shipped. */
export function makeBlankTemplate(): RobotDef {
  return makeDefaultRobotDef();
}

/** A chassis plus two continuously-rotating wheels (hinge joints with no
 * `limits` -- built_robot.cpp only emits MJCF's `limited="true"` when
 * `joint.limits` is set, so omitting it is a genuine continuous-rotation
 * joint, exactly what a driven wheel needs), each driven by a `velocity`
 * actuator. A real mobile robot the student can drive from Test mode's
 * Program drawer (Phase 6) with robot.set("left_wheel", 2.0)-style calls. */
export function makeRoverTemplate(): RobotDef {
  const wheelGeometry = { type: "cylinder" as const, radius: 0.035, length: 0.015 };
  // A MuJoCo cylinder's own symmetry axis runs along its LOCAL Z by
  // default -- with no rotation it lies flat like a puck (radius in the
  // XY-plane), not upright like a wheel. Rotating the body 90 degrees
  // about X brings that axis to local Y, matching the hinge joints'
  // [0,1,0] spin axis below, so it looks and rolls like an actual wheel
  // rather than wobbling like a coin. Measured, not assumed: caught by an
  // early physics test where the "settled" wheel height came back at
  // roughly half the cylinder's length (lying flat) instead of its radius
  // (standing on edge).
  const wheelTransform = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [Math.PI / 2, 0, 0] as [number, number, number] };
  return {
    id: "two-wheeled-rover",
    name: "Two-Wheeled Rover",
    description: "A chassis on two driven wheels.",
    root_placement: { position: [0, 0, 0.08], rotation_rpy: [0, 0, 0] },
    bodies: [
      {
        id: "chassis",
        name: "Chassis",
        transform: identity,
        visual: { type: "box", size: [0.16, 0.12, 0.04] },
        collision: { type: "box", size: [0.16, 0.12, 0.04] },
        mass: 0.4,
        inertia: { ixx: 0.005, iyy: 0.006, izz: 0.008 },
        material: { color: [0.3, 0.5, 0.9] },
      },
      {
        id: "left_wheel",
        name: "Left Wheel",
        transform: wheelTransform,
        visual: wheelGeometry,
        collision: wheelGeometry,
        // A physically-realistic solid-disc inertia for this mass/radius
        // would be ~2e-5, but that makes a `velocity`-type actuator
        // (MJCF's <velocity>, a fixed kv=1 gain -- built_robot.cpp has no
        // schema field to soften it) numerically stiff enough to blow up
        // ("NaN, Inf or huge value in QACC") within the first couple of
        // explicit-Euler substeps the instant a nonzero ctrl is applied.
        // Verified natively (bypassing the WASM build's I/O shim, which
        // swallows MuJoCo's own diagnostic text into an unrelated-looking
        // crash) that 0.002 keeps a real 3-second drive and a real turn
        // both stable with real, measured motion -- see
        // docs/decisions/robot-builder-templates.md.
        mass: 0.05,
        inertia: { ixx: 0.002, iyy: 0.002, izz: 0.002 },
        material: { color: [0.2, 0.2, 0.2] },
      },
      {
        id: "right_wheel",
        name: "Right Wheel",
        transform: wheelTransform,
        visual: wheelGeometry,
        collision: wheelGeometry,
        // A physically-realistic solid-disc inertia for this mass/radius
        // would be ~2e-5, but that makes a `velocity`-type actuator
        // (MJCF's <velocity>, a fixed kv=1 gain -- built_robot.cpp has no
        // schema field to soften it) numerically stiff enough to blow up
        // ("NaN, Inf or huge value in QACC") within the first couple of
        // explicit-Euler substeps the instant a nonzero ctrl is applied.
        // Verified natively (bypassing the WASM build's I/O shim, which
        // swallows MuJoCo's own diagnostic text into an unrelated-looking
        // crash) that 0.002 keeps a real 3-second drive and a real turn
        // both stable with real, measured motion -- see
        // docs/decisions/robot-builder-templates.md.
        mass: 0.05,
        inertia: { ixx: 0.002, iyy: 0.002, izz: 0.002 },
        material: { color: [0.2, 0.2, 0.2] },
      },
    ],
    joints: [
      {
        id: "left_wheel_joint",
        name: "Left Wheel Joint",
        type: "hinge",
        parent: "chassis",
        child: "left_wheel",
        // y=0.105: clears the chassis box's own y=0.06 edge by 0.01 once the
        // wheel's 0.035 radius is accounted for (0.06 + 0.01 + 0.035),
        // rather than the wheel's collision geometry reaching back inside
        // the chassis's -- caught by a physics test that crashed once the
        // wheels actually spun fast (not at rest), consistent with unstable
        // contact forces from a genuine, if small, geometric overlap.
        origin: { position: [0, 0.105, -0.01], rotation_rpy: [0, 0, 0] },
        axis: [0, 1, 0],
        damping: 0.001,
      },
      {
        id: "right_wheel_joint",
        name: "Right Wheel Joint",
        type: "hinge",
        parent: "chassis",
        child: "right_wheel",
        origin: { position: [0, -0.105, -0.01], rotation_rpy: [0, 0, 0] },
        axis: [0, 1, 0],
        damping: 0.001,
      },
    ],
    actuators: [
      { id: "left_wheel", name: "Left Wheel", type: "velocity", target_joint: "left_wheel_joint", limits: { velocity: 10 } },
      { id: "right_wheel", name: "Right Wheel", type: "velocity", target_joint: "right_wheel_joint", limits: { velocity: 10 } },
    ],
    sensors: [],
  };
}

/** A base plus two hinge-jointed links, one servo actuator on the shoulder,
 * one encoder reading it -- the same shape as
 * contracts/robot-def/v0/examples/two-link-arm.json (already a proven,
 * physically sound fixture), hand-typed here rather than imported. Uses a
 * `servo` actuator (MJCF <position>, a target angle) rather than that
 * fixture's `motor`: more intuitive for a first Program-drawer program --
 * "set the shoulder to 45 degrees" reads naturally as
 * robot.set("shoulder_motor", 45). */
export function makeArmTemplate(): RobotDef {
  return {
    id: "simple-arm",
    name: "Simple Arm",
    description: "A base and two jointed links, with a motor and an encoder.",
    root_placement: identity,
    bodies: [
      {
        id: "base",
        name: "Base",
        transform: identity,
        visual: { type: "cylinder", radius: 0.05, length: 0.1 },
        collision: { type: "cylinder", radius: 0.05, length: 0.1 },
        mass: 0.5,
        inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
        material: { color: [0.2, 0.2, 0.2] },
      },
      {
        id: "link1",
        name: "Link 1",
        transform: { position: [0, 0, 0.1], rotation_rpy: [0, 0, 0] },
        visual: { type: "box", size: [0.04, 0.04, 0.2] },
        collision: { type: "box", size: [0.04, 0.04, 0.2] },
        mass: 0.3,
        inertia: { ixx: 0.0005, iyy: 0.0005, izz: 0.0002 },
        material: { color: [0.6, 0.6, 0.6] },
      },
      {
        id: "link2",
        name: "Link 2 (tip)",
        transform: { position: [0, 0, 0.2], rotation_rpy: [0, 0, 0] },
        visual: { type: "capsule", radius: 0.02, length: 0.15 },
        collision: { type: "capsule", radius: 0.02, length: 0.15 },
        mass: 0.15,
        inertia: { ixx: 0.0002, iyy: 0.0002, izz: 0.0001 },
        material: { color: [0.8, 0.2, 0.2] },
      },
    ],
    joints: [
      {
        id: "shoulder",
        name: "Shoulder",
        type: "hinge",
        parent: "base",
        child: "link1",
        origin: { position: [0, 0, 0.1], rotation_rpy: [0, 0, 0] },
        axis: [0, 1, 0],
        limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
        damping: 0.01,
        friction: 0.0,
      },
      {
        id: "elbow",
        name: "Elbow",
        type: "hinge",
        parent: "link1",
        child: "link2",
        origin: { position: [0, 0, 0.2], rotation_rpy: [0, 0, 0] },
        axis: [0, 1, 0],
        limits: { lower: -2 * (Math.PI / 3), upper: 2 * (Math.PI / 3) },
        damping: 0.01,
        friction: 0.0,
      },
    ],
    actuators: [{ id: "shoulder_motor", name: "Shoulder Motor", type: "servo", target_joint: "shoulder" }],
    sensors: [{ id: "shoulder_encoder", name: "Shoulder Encoder", type: "encoder", body: "link1", joint: "shoulder", transform: identity }],
  };
}

export interface RobotTemplate {
  id: string;
  label: string;
  description: string;
  make: () => RobotDef;
}

/** Listed in the New Robot dialog, in this order. */
export const TEMPLATE_OPTIONS: readonly RobotTemplate[] = [
  { id: "blank", label: "Blank", description: "A single box body -- start from nothing.", make: makeBlankTemplate },
  { id: "rover", label: "Two-Wheeled Rover", description: "A chassis on two driven wheels.", make: makeRoverTemplate },
  { id: "arm", label: "Simple Arm", description: "A base and two jointed links, with a motor and an encoder.", make: makeArmTemplate },
];

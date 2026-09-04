// Pure document-editing helpers for the Robot Builder: default starter
// content and cascading a body deletion through the joints/actuators/
// sensors that reference it. No React, no three.js.

import type { Body, RobotDef } from "../contracts/robotDef";

const DEFAULT_STARTER_COLOR: [number, number, number] = [0.3, 0.5, 0.9];
const DEFAULT_BODY_COLOR: [number, number, number] = [0.6, 0.6, 0.6];

/** A fresh single-box-body starter, mirroring the shape of
 * contracts/robot-def/v0/examples/single-body.json (not imported directly:
 * that directory is a contract/test asset, not something the shipped app
 * should pull in as a runtime dependency). */
export function makeDefaultRobotDef(): RobotDef {
  return {
    id: "new-robot",
    name: "New Robot",
    description: "",
    root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
    bodies: [
      {
        id: "chassis",
        name: "Chassis",
        transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
        visual: { type: "box", size: [0.2, 0.15, 0.08] },
        collision: { type: "box", size: [0.2, 0.15, 0.08] },
        mass: 1.0,
        inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
        material: { color: DEFAULT_STARTER_COLOR },
      },
    ],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

/** "body-N", bumped past any existing id collision. */
export function nextBodyId(robot: RobotDef): string {
  const existing = new Set(robot.bodies.map((b) => b.id));
  let n = robot.bodies.length + 1;
  while (existing.has(`body-${n}`)) n += 1;
  return `body-${n}`;
}

/** A small default box body, positioned 0.1m along x from `near` (or the
 * origin when there's no reference body yet), unattached (no joint) --
 * joint-creation is out of scope for this slice. */
export function makeDefaultBody(id: string, near: Body | null): Body {
  const base = near?.transform.position ?? [0, 0, 0];
  return {
    id,
    name: id,
    transform: { position: [base[0] + 0.1, base[1], base[2]], rotation_rpy: [0, 0, 0] },
    visual: { type: "box", size: [0.05, 0.05, 0.05] },
    collision: { type: "box", size: [0.05, 0.05, 0.05] },
    mass: 0.1,
    inertia: { ixx: 0.0005, iyy: 0.0005, izz: 0.0005 },
    material: { color: DEFAULT_BODY_COLOR },
  };
}

/** Removes a body and cascades: joints that reference it as parent or
 * child, then actuators targeting a removed joint, then sensors on the
 * removed body or a removed joint. */
export function removeBody(robot: RobotDef, bodyId: string): RobotDef {
  const bodies = robot.bodies.filter((b) => b.id !== bodyId);
  const removedJointIds = new Set(robot.joints.filter((j) => j.parent === bodyId || j.child === bodyId).map((j) => j.id));
  const joints = robot.joints.filter((j) => !removedJointIds.has(j.id));
  const actuators = robot.actuators.filter((a) => !removedJointIds.has(a.target_joint));
  const sensors = robot.sensors.filter((s) => s.body !== bodyId && !(s.joint !== undefined && removedJointIds.has(s.joint)));
  return { ...robot, bodies, joints, actuators, sensors };
}

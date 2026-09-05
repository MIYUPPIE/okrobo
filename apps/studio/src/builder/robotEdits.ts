// Pure document-editing helpers for the Robot Builder: default starter
// content, cascading a body deletion through the joints/actuators/sensors
// that reference it, and joint-authoring helpers (computing an origin,
// diffing validation issues). Uses three.js's Matrix4/Quaternion purely as
// numeric utilities (no scene graph, no rendering) -- still no React.

import * as THREE from "three";
import type { Body, Geometry, Issue, RobotDef, Transform } from "../contracts/robotDef";

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

const CAD_BODY_MASS = 0.05;
const CAD_BODY_INERTIA = { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 };

type CadMeshGeometry = Extract<Geometry, { type: "cad_mesh" }>;

/** Mirrors makeDefaultBody's exact positioning convention (0.1m along +x
 * from `near`, or the origin) for a CAD-kernel-authored mesh body (Robot
 * Builder CAD Kernel Phase 2) instead of a default box. Takes a structural
 * {vertices, faces} shape, not a cad/kernel.ts CadMesh -- this module stays
 * cad-kernel-agnostic, same as its own "pure... still no React" framing.
 * Mass/inertia default to the same values
 * scripts/generate-cad-examples.mjs's cad-l-bracket.json example uses --
 * a reasonable small-part default, still editable afterward via
 * BodyInspector's ordinary Mass & inertia fields (only Shape is locked for
 * a cad_mesh body). See docs/decisions/cad-kernel-sketch-ui.md. */
export function makeCadBody(id: string, near: Body | null, mesh: Pick<CadMeshGeometry, "vertices" | "faces">): Body {
  const base = near?.transform.position ?? [0, 0, 0];
  const geometry: Geometry = { type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces };
  return {
    id,
    name: id,
    transform: { position: [base[0] + 0.1, base[1], base[2]], rotation_rpy: [0, 0, 0] },
    visual: geometry,
    collision: geometry,
    mass: CAD_BODY_MASS,
    inertia: CAD_BODY_INERTIA,
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

/** "joint-N", bumped past any existing id collision -- mirrors nextBodyId. */
export function nextJointId(robot: RobotDef): string {
  const existing = new Set(robot.joints.map((j) => j.id));
  let n = robot.joints.length + 1;
  while (existing.has(`joint-${n}`)) n += 1;
  return `joint-${n}`;
}

function matrixFromTransform(transform: Transform): THREE.Matrix4 {
  const position = new THREE.Vector3(...transform.position);
  const euler = new THREE.Euler(transform.rotation_rpy[0], transform.rotation_rpy[1], transform.rotation_rpy[2], "XYZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
}

function transformFromMatrix(matrix: THREE.Matrix4): Transform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return { position: [position.x, position.y, position.z], rotation_rpy: [euler.x, euler.y, euler.z] };
}

/** The joint origin that keeps `child`'s current world pose unchanged once
 * it's attached to `parent`. Before this joint exists, both bodies are
 * independent roots and their own `transform` is root-relative; a joint's
 * `origin` instead means "child's pose expressed in parent's frame," so
 * this composes real 4x4 matrices (not a naive position subtraction, since
 * either body may already be rotated) to convert one into the other.
 * Callers reset the child's own `transform` to identity after applying
 * this, matching how the shipped templates author a jointed child's mount
 * point entirely through the joint's origin. */
export function computeJointOrigin(parent: Body, child: Body): Transform {
  const parentMatrix = matrixFromTransform(parent.transform);
  const childMatrix = matrixFromTransform(child.transform);
  const origin = new THREE.Matrix4().copy(parentMatrix).invert().multiply(childMatrix);
  return transformFromMatrix(origin);
}

function issueKey(issue: Issue): string {
  return `${issue.rule}:${issue.element_kind ?? ""}:${issue.element_id ?? ""}`;
}

/** Issues present in `after` that weren't already present in `before`,
 * matched by rule+element_kind+element_id. Lets an authoring UI (JointCreator)
 * show exactly what a proposed change would newly break without needing to
 * predict in advance which specific element a rule like robot-cycle will
 * attach its error to -- that's still validateRobotDef's own call, this
 * just isolates the delta. Generic, not joint-specific. */
export function issuesIntroducedBy(before: Issue[], after: Issue[]): Issue[] {
  const seen = new Set(before.map(issueKey));
  return after.filter((issue) => !seen.has(issueKey(issue)));
}

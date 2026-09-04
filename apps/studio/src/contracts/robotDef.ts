// TypeScript mirror of contracts/robot-def/v0. Change only together with the
// contract (version bump) and the other mirrors (runtime/python/okrobo/robot_def.py,
// engine/src/robot_def.{hpp,cpp}).
//
// A robot-def document is purely structural data -- bodies, joints,
// actuators, sensors -- with no simulation behavior in v0: parsed and
// validated here, never simulated. The kinematic tree is defined entirely by
// joints[] edges, not a body.parent field, mirroring URDF and this repo's own
// packs/urdf.ts idiom: a body with no incoming joint edge is a root, and
// rigid attachment is a `fixed` joint, not a second hierarchy mechanism.
//
// parseRobotDef throws on malformed shape (same posture as validateWorld.ts).
// validateRobotDef never throws: it always returns a (possibly empty) list of
// Issue, so a future builder UI can show every problem on a robot at once.

export type Vec3 = [number, number, number];

export interface Transform {
  position: Vec3;
  rotation_rpy: Vec3;
}

export type Geometry =
  | { type: "box"; size: Vec3 }
  | { type: "sphere"; radius: number }
  | { type: "cylinder"; radius: number; length: number }
  | { type: "capsule"; radius: number; length: number }
  | { type: "cone"; radius: number; length: number }
  | { type: "plane"; size: [number, number] }
  | { type: "mesh"; path: string; scale: Vec3 };

export interface Inertia {
  ixx: number;
  iyy: number;
  izz: number;
}

export interface Material {
  color?: number[];
}

export interface Body {
  id: string;
  name: string;
  transform: Transform;
  visual?: Geometry;
  collision?: Geometry;
  mass: number;
  inertia: Inertia;
  material?: Material;
}

export interface Limits {
  lower: number;
  upper: number;
}

interface JointCommon {
  id: string;
  name: string;
  parent: string;
  child: string;
  origin: Transform;
}

export type Joint =
  | (JointCommon & { type: "fixed" })
  | (JointCommon & { type: "hinge"; axis: Vec3; limits?: Limits; damping?: number; friction?: number })
  | (JointCommon & { type: "slider"; axis: Vec3; limits?: Limits; damping?: number; friction?: number })
  | (JointCommon & { type: "ball"; damping?: number })
  | (JointCommon & { type: "free" });

export type ActuatorType = "motor" | "servo" | "force" | "torque" | "velocity";

export interface ActuatorLimits {
  effort?: number;
  velocity?: number;
}

export interface Actuator {
  id: string;
  name: string;
  type: ActuatorType;
  target_joint: string;
  limits?: ActuatorLimits;
}

export type SensorType = "camera" | "distance" | "lidar" | "imu" | "encoder" | "gps" | "touch" | "force_torque";

export interface Sensor {
  id: string;
  name: string;
  type: SensorType;
  body: string;
  joint?: string;
  transform: Transform;
  params?: Record<string, unknown>;
}

export interface RobotDef {
  id: string;
  name: string;
  description: string;
  root_placement: Transform;
  bodies: Body[];
  joints: Joint[];
  actuators: Actuator[];
  sensors: Sensor[];
}

export interface Issue {
  rule: string;
  severity: "error" | "warning";
  element_kind?: "body" | "joint" | "actuator" | "sensor" | "robot";
  element_id?: string;
  message: string;
}

// ---- parsing ----

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("robot-def: expected an object");
  return value as Record<string, unknown>;
}

function asVec3(value: unknown, context: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new Error(`robot-def: ${context} must be three numbers`);
  }
  return [value[0], value[1], value[2]];
}

// parseTransform/parseGeometry/transformToJson/geometryToJson are exported
// (Robot Builder Phase 5) so apps/studio/src/contracts/worldDef.ts can reuse
// them directly rather than redefining an equivalent shape -- a position/
// rotation and a primitive shape are the same concepts for a world object
// as for a robot body. See docs/decisions/robot-builder-world.md.
export function parseTransform(value: unknown): Transform {
  if (value === undefined) return { position: [0, 0, 0], rotation_rpy: [0, 0, 0] };
  const t = asRecord(value);
  return {
    position: t.position === undefined ? [0, 0, 0] : asVec3(t.position, "transform.position"),
    rotation_rpy: t.rotation_rpy === undefined ? [0, 0, 0] : asVec3(t.rotation_rpy, "transform.rotation_rpy"),
  };
}

export function parseGeometry(value: unknown): Geometry | undefined {
  if (value === undefined) return undefined;
  const g = asRecord(value);
  switch (g.type) {
    case "box":
      return { type: "box", size: asVec3(g.size, "geometry.size") };
    case "sphere":
      if (!isFiniteNumber(g.radius)) throw new Error("robot-def: sphere geometry needs radius");
      return { type: "sphere", radius: g.radius };
    case "cylinder":
    case "capsule":
    case "cone":
      if (!isFiniteNumber(g.radius) || !isFiniteNumber(g.length)) {
        throw new Error(`robot-def: ${g.type} geometry needs radius and length`);
      }
      return { type: g.type, radius: g.radius, length: g.length };
    case "plane": {
      const size = g.size;
      if (!Array.isArray(size) || size.length !== 2 || !size.every(isFiniteNumber)) {
        throw new Error("robot-def: plane geometry needs a two-number size");
      }
      return { type: "plane", size: [size[0], size[1]] };
    }
    case "mesh":
      if (typeof g.path !== "string" || g.path.length === 0) throw new Error("robot-def: mesh geometry needs path");
      return { type: "mesh", path: g.path, scale: g.scale === undefined ? [1, 1, 1] : asVec3(g.scale, "geometry.scale") };
    default:
      throw new Error(`robot-def: unknown geometry type ${String(g.type)}`);
  }
}

function parseBody(value: unknown): Body {
  const b = asRecord(value);
  if (typeof b.id !== "string" || typeof b.name !== "string") throw new Error("robot-def: body needs id and name");
  if (!isFiniteNumber(b.mass)) throw new Error(`robot-def: body '${b.id}' needs mass`);
  const inertia = asRecord(b.inertia);
  if (!isFiniteNumber(inertia.ixx) || !isFiniteNumber(inertia.iyy) || !isFiniteNumber(inertia.izz)) {
    throw new Error(`robot-def: body '${b.id}' needs inertia {ixx, iyy, izz}`);
  }
  let material: Material | undefined;
  if (b.material !== undefined) {
    const m = asRecord(b.material);
    material = Array.isArray(m.color) ? { color: m.color.map(Number) } : {};
  }
  return {
    id: b.id,
    name: b.name,
    transform: parseTransform(b.transform),
    visual: parseGeometry(b.visual),
    collision: parseGeometry(b.collision),
    mass: b.mass,
    inertia: { ixx: inertia.ixx, iyy: inertia.iyy, izz: inertia.izz },
    material,
  };
}

function parseLimits(value: unknown): Limits | undefined {
  if (value === undefined) return undefined;
  const l = asRecord(value);
  if (!isFiniteNumber(l.lower) || !isFiniteNumber(l.upper)) throw new Error("robot-def: limits need lower and upper");
  return { lower: l.lower, upper: l.upper };
}

function parseJoint(value: unknown): Joint {
  const j = asRecord(value);
  if (typeof j.id !== "string" || typeof j.name !== "string") throw new Error("robot-def: joint needs id and name");
  if (typeof j.parent !== "string" || typeof j.child !== "string") {
    throw new Error(`robot-def: joint '${j.id}' needs parent and child`);
  }
  const common: JointCommon = { id: j.id, name: j.name, parent: j.parent, child: j.child, origin: parseTransform(j.origin) };
  const damping = isFiniteNumber(j.damping) ? j.damping : undefined;
  const friction = isFiniteNumber(j.friction) ? j.friction : undefined;
  switch (j.type) {
    case "fixed":
      return { ...common, type: "fixed" };
    case "hinge":
    case "slider":
      return { ...common, type: j.type, axis: asVec3(j.axis, `joint '${j.id}'.axis`), limits: parseLimits(j.limits), damping, friction };
    case "ball":
      return { ...common, type: "ball", damping };
    case "free":
      return { ...common, type: "free" };
    default:
      throw new Error(`robot-def: unknown joint type ${String(j.type)}`);
  }
}

function parseActuator(value: unknown): Actuator {
  const a = asRecord(value);
  if (typeof a.id !== "string" || typeof a.name !== "string") throw new Error("robot-def: actuator needs id and name");
  if (typeof a.target_joint !== "string") throw new Error(`robot-def: actuator '${a.id}' needs target_joint`);
  const type = a.type;
  if (type !== "motor" && type !== "servo" && type !== "force" && type !== "torque" && type !== "velocity") {
    throw new Error(`robot-def: actuator '${a.id}' has unknown type ${String(type)}`);
  }
  let limits: ActuatorLimits | undefined;
  if (a.limits !== undefined) {
    const l = asRecord(a.limits);
    limits = {
      effort: isFiniteNumber(l.effort) ? l.effort : undefined,
      velocity: isFiniteNumber(l.velocity) ? l.velocity : undefined,
    };
  }
  return { id: a.id, name: a.name, type, target_joint: a.target_joint, limits };
}

function parseSensor(value: unknown): Sensor {
  const s = asRecord(value);
  if (typeof s.id !== "string" || typeof s.name !== "string") throw new Error("robot-def: sensor needs id and name");
  if (typeof s.body !== "string") throw new Error(`robot-def: sensor '${s.id}' needs body`);
  const type = s.type;
  const knownTypes: SensorType[] = ["camera", "distance", "lidar", "imu", "encoder", "gps", "touch", "force_torque"];
  if (typeof type !== "string" || !knownTypes.includes(type as SensorType)) {
    throw new Error(`robot-def: sensor '${s.id}' has unknown type ${String(type)}`);
  }
  return {
    id: s.id,
    name: s.name,
    type: type as SensorType,
    body: s.body,
    joint: typeof s.joint === "string" ? s.joint : undefined,
    transform: parseTransform(s.transform),
    params: s.params === undefined ? undefined : asRecord(s.params),
  };
}

export function parseRobotDef(data: unknown): RobotDef {
  const d = asRecord(data);
  if (typeof d.id !== "string" || typeof d.name !== "string") throw new Error("robot-def: missing id or name");
  if (!Array.isArray(d.bodies)) throw new Error(`robot-def '${d.id}': missing bodies`);
  return {
    id: d.id,
    name: d.name,
    description: typeof d.description === "string" ? d.description : "",
    root_placement: parseTransform(d.root_placement),
    bodies: d.bodies.map(parseBody),
    joints: Array.isArray(d.joints) ? d.joints.map(parseJoint) : [],
    actuators: Array.isArray(d.actuators) ? d.actuators.map(parseActuator) : [],
    sensors: Array.isArray(d.sensors) ? d.sensors.map(parseSensor) : [],
  };
}

// ---- serialization (round-trip) ----

export function transformToJson(t: Transform): unknown {
  return { position: t.position, rotation_rpy: t.rotation_rpy };
}

export function geometryToJson(g: Geometry): unknown {
  switch (g.type) {
    case "box":
      return { type: "box", size: g.size };
    case "sphere":
      return { type: "sphere", radius: g.radius };
    case "cylinder":
    case "capsule":
    case "cone":
      return { type: g.type, radius: g.radius, length: g.length };
    case "plane":
      return { type: "plane", size: g.size };
    case "mesh":
      return { type: "mesh", path: g.path, scale: g.scale };
  }
}

function bodyToJson(b: Body): unknown {
  const out: Record<string, unknown> = {
    id: b.id,
    name: b.name,
    transform: transformToJson(b.transform),
    mass: b.mass,
    inertia: { ixx: b.inertia.ixx, iyy: b.inertia.iyy, izz: b.inertia.izz },
  };
  if (b.visual !== undefined) out.visual = geometryToJson(b.visual);
  if (b.collision !== undefined) out.collision = geometryToJson(b.collision);
  if (b.material?.color !== undefined) out.material = { color: b.material.color };
  return out;
}

function jointToJson(j: Joint): unknown {
  const out: Record<string, unknown> = { id: j.id, name: j.name, type: j.type, parent: j.parent, child: j.child, origin: transformToJson(j.origin) };
  if (j.type === "hinge" || j.type === "slider") {
    out.axis = j.axis;
    if (j.limits !== undefined) out.limits = { lower: j.limits.lower, upper: j.limits.upper };
    if (j.damping !== undefined) out.damping = j.damping;
    if (j.friction !== undefined) out.friction = j.friction;
  } else if (j.type === "ball" && j.damping !== undefined) {
    out.damping = j.damping;
  }
  return out;
}

function actuatorToJson(a: Actuator): unknown {
  const out: Record<string, unknown> = { id: a.id, name: a.name, type: a.type, target_joint: a.target_joint };
  if (a.limits !== undefined) {
    const limits: Record<string, unknown> = {};
    if (a.limits.effort !== undefined) limits.effort = a.limits.effort;
    if (a.limits.velocity !== undefined) limits.velocity = a.limits.velocity;
    if (Object.keys(limits).length > 0) out.limits = limits;
  }
  return out;
}

function sensorToJson(s: Sensor): unknown {
  const out: Record<string, unknown> = { id: s.id, name: s.name, type: s.type, body: s.body, transform: transformToJson(s.transform) };
  if (s.joint !== undefined) out.joint = s.joint;
  if (s.params !== undefined) out.params = s.params;
  return out;
}

export function robotDefToJson(robot: RobotDef): unknown {
  return {
    id: robot.id,
    name: robot.name,
    description: robot.description,
    root_placement: transformToJson(robot.root_placement),
    bodies: robot.bodies.map(bodyToJson),
    joints: robot.joints.map(jointToJson),
    actuators: robot.actuators.map(actuatorToJson),
    sensors: robot.sensors.map(sensorToJson),
  };
}

// ---- validation ----

const EPSILON = 1e-12;

function geometryIsValid(g: Geometry): boolean {
  switch (g.type) {
    case "box":
      return g.size.every((v) => v > 0);
    case "plane":
      return g.size.every((v) => v > 0);
    case "sphere":
      return g.radius > 0;
    case "cylinder":
    case "capsule":
    case "cone":
      return g.radius > 0 && g.length > 0;
    case "mesh":
      return g.path.length > 0;
  }
}

/** Follows parent_of chains (deduped: at most one parent per child) from
 * every body. A walk that revisits a node still in its own current path is a
 * cycle; `resolved` memoizes bodies already proven acyclic. */
function findCycle(bodyIds: string[], parentOf: Map<string, string>): string | undefined {
  const resolved = new Set<string>();
  for (const start of bodyIds) {
    if (resolved.has(start)) continue;
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && !resolved.has(current)) {
      if (path.includes(current)) return current;
      path.push(current);
      current = parentOf.get(current);
    }
    for (const id of path) resolved.add(id);
  }
  return undefined;
}

export function validateRobotDef(robot: RobotDef): Issue[] {
  const issues: Issue[] = [];

  // ---- bodies ----
  const bodyById = new Map<string, Body>();
  for (const body of robot.bodies) {
    if (bodyById.has(body.id)) {
      issues.push({ rule: "body-duplicate-id", severity: "error", element_kind: "body", element_id: body.id, message: `Duplicate body id '${body.id}'` });
    } else {
      bodyById.set(body.id, body);
    }

    for (const geometry of [body.visual, body.collision]) {
      if (geometry !== undefined && !geometryIsValid(geometry)) {
        issues.push({
          rule: "body-invalid-geometry",
          severity: "error",
          element_kind: "body",
          element_id: body.id,
          message: `Body '${body.id}': geometry size must be positive`,
        });
      }
    }
    if (!Number.isFinite(body.mass) || body.mass <= 0) {
      issues.push({ rule: "body-invalid-mass", severity: "error", element_kind: "body", element_id: body.id, message: `Body '${body.id}' has no valid mass` });
    }
    for (const [axisName, value] of [
      ["ixx", body.inertia.ixx],
      ["iyy", body.inertia.iyy],
      ["izz", body.inertia.izz],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        issues.push({
          rule: "body-invalid-inertia",
          severity: "error",
          element_kind: "body",
          element_id: body.id,
          message: `Body '${body.id}': inertia.${axisName} must be > 0`,
        });
      }
    }
  }

  // ---- joints: dedup by id (first occurrence wins) before any graph logic ----
  const jointById = new Map<string, Joint>();
  for (const joint of robot.joints) {
    if (jointById.has(joint.id)) {
      issues.push({ rule: "joint-duplicate-id", severity: "error", element_kind: "joint", element_id: joint.id, message: `Duplicate joint id '${joint.id}'` });
    } else {
      jointById.set(joint.id, joint);
    }
  }

  for (const joint of jointById.values()) {
    if (!bodyById.has(joint.parent)) {
      issues.push({
        rule: "joint-unknown-parent-body",
        severity: "error",
        element_kind: "joint",
        element_id: joint.id,
        message: `Joint '${joint.id}': parent body '${joint.parent}' does not exist`,
      });
    }
    if (!bodyById.has(joint.child)) {
      issues.push({
        rule: "joint-unknown-child-body",
        severity: "error",
        element_kind: "joint",
        element_id: joint.id,
        message: `Joint '${joint.id}': child body '${joint.child}' does not exist`,
      });
    }
    if (joint.parent === joint.child) {
      issues.push({
        rule: "joint-self-loop",
        severity: "error",
        element_kind: "joint",
        element_id: joint.id,
        message: `Joint '${joint.id}' connects '${joint.parent}' to itself`,
      });
    }
    if (joint.type === "hinge" || joint.type === "slider") {
      if (joint.axis.every((v) => Math.abs(v) < EPSILON)) {
        issues.push({ rule: "joint-missing-axis", severity: "error", element_kind: "joint", element_id: joint.id, message: `Joint '${joint.id}': axis must be non-zero` });
      }
      if (joint.limits !== undefined && joint.limits.lower >= joint.limits.upper) {
        issues.push({
          rule: "joint-invalid-limits",
          severity: "error",
          element_kind: "joint",
          element_id: joint.id,
          message: `Joint '${joint.id}': limits.lower must be less than limits.upper`,
        });
      }
      if (joint.damping !== undefined && joint.damping < 0) {
        issues.push({ rule: "joint-invalid-damping-friction", severity: "error", element_kind: "joint", element_id: joint.id, message: `Joint '${joint.id}': damping must be >= 0` });
      }
      if (joint.friction !== undefined && joint.friction < 0) {
        issues.push({ rule: "joint-invalid-damping-friction", severity: "error", element_kind: "joint", element_id: joint.id, message: `Joint '${joint.id}': friction must be >= 0` });
      }
    } else if (joint.type === "ball" && joint.damping !== undefined && joint.damping < 0) {
      issues.push({ rule: "joint-invalid-damping-friction", severity: "error", element_kind: "joint", element_id: joint.id, message: `Joint '${joint.id}': damping must be >= 0` });
    }
  }

  // ---- graph (see runtime/python/okrobo/robot_def.py's validate_robot_def
  // for the full reasoning: dedup collapses multi-edges and duplicate ids so
  // this stays a simple forest before root/cycle checks run) ----
  const childJoints = new Map<string, Joint[]>();
  for (const joint of jointById.values()) {
    if (joint.parent === joint.child) continue;
    if (!bodyById.has(joint.child)) continue;
    const list = childJoints.get(joint.child) ?? [];
    list.push(joint);
    childJoints.set(joint.child, list);
  }

  const parentOf = new Map<string, string>();
  for (const [childId, jointsHere] of childJoints) {
    if (jointsHere.length > 1) {
      const names = jointsHere.map((j) => `'${j.id}'`).join(", ");
      issues.push({
        rule: "joint-duplicate-child",
        severity: "error",
        element_kind: "body",
        element_id: childId,
        message: `Body '${childId}' is attached by more than one joint (${names})`,
      });
    }
    parentOf.set(childId, jointsHere[0].parent);
  }

  const roots = [...bodyById.keys()].filter((id) => !parentOf.has(id));

  if (roots.length === 0) {
    if (bodyById.size > 0) {
      issues.push({ rule: "robot-no-root-body", severity: "error", element_kind: "robot", element_id: robot.id, message: "Robot cannot simulate: no root body found" });
    }
  } else {
    for (const extraRoot of roots.slice(1)) {
      issues.push({
        rule: "robot-multiple-root-bodies",
        severity: "error",
        element_kind: "body",
        element_id: extraRoot,
        message: `Robot cannot simulate: '${extraRoot}' has no parent joint attaching it to the rest of the robot`,
      });
    }
    const cycleBody = findCycle([...bodyById.keys()], parentOf);
    if (cycleBody !== undefined) {
      issues.push({
        rule: "robot-cycle",
        severity: "error",
        element_kind: "body",
        element_id: cycleBody,
        message: `Robot cannot simulate: cycle detected in joints at body '${cycleBody}'`,
      });
    }
  }

  // ---- actuators ----
  const actuatorIds = new Set<string>();
  for (const actuator of robot.actuators) {
    if (actuatorIds.has(actuator.id)) {
      issues.push({ rule: "actuator-duplicate-id", severity: "error", element_kind: "actuator", element_id: actuator.id, message: `Duplicate actuator id '${actuator.id}'` });
    } else {
      actuatorIds.add(actuator.id);
    }

    const target = jointById.get(actuator.target_joint);
    if (target === undefined) {
      issues.push({
        rule: "actuator-unknown-target-joint",
        severity: "error",
        element_kind: "actuator",
        element_id: actuator.id,
        message: `Actuator '${actuator.id}': target joint '${actuator.target_joint}' does not exist`,
      });
    } else if (target.type === "fixed") {
      issues.push({
        rule: "actuator-fixed-joint-target",
        severity: "error",
        element_kind: "actuator",
        element_id: actuator.id,
        message: `Actuator '${actuator.id}': cannot actuate fixed joint '${target.id}'`,
      });
    }

    if (actuator.limits !== undefined) {
      if (actuator.limits.effort !== undefined && (!Number.isFinite(actuator.limits.effort) || actuator.limits.effort <= 0)) {
        issues.push({ rule: "actuator-invalid-limits", severity: "error", element_kind: "actuator", element_id: actuator.id, message: `Actuator '${actuator.id}': limits.effort must be > 0` });
      }
      if (actuator.limits.velocity !== undefined && (!Number.isFinite(actuator.limits.velocity) || actuator.limits.velocity <= 0)) {
        issues.push({ rule: "actuator-invalid-limits", severity: "error", element_kind: "actuator", element_id: actuator.id, message: `Actuator '${actuator.id}': limits.velocity must be > 0` });
      }
    }
  }

  // ---- sensors ----
  const sensorIds = new Set<string>();
  for (const sensor of robot.sensors) {
    if (sensorIds.has(sensor.id)) {
      issues.push({ rule: "sensor-duplicate-id", severity: "error", element_kind: "sensor", element_id: sensor.id, message: `Duplicate sensor id '${sensor.id}'` });
    } else {
      sensorIds.add(sensor.id);
    }

    if (!bodyById.has(sensor.body)) {
      issues.push({ rule: "sensor-unknown-body", severity: "error", element_kind: "sensor", element_id: sensor.id, message: `Sensor '${sensor.id}': body '${sensor.body}' does not exist` });
    }

    if (sensor.type === "encoder" && sensor.joint === undefined) {
      issues.push({ rule: "sensor-encoder-missing-joint", severity: "error", element_kind: "sensor", element_id: sensor.id, message: `Sensor '${sensor.id}': encoder sensors must set 'joint'` });
    }
    if (sensor.joint !== undefined && !jointById.has(sensor.joint)) {
      issues.push({ rule: "sensor-unknown-joint", severity: "error", element_kind: "sensor", element_id: sensor.id, message: `Sensor '${sensor.id}': joint '${sensor.joint}' does not exist` });
    }
  }

  return issues;
}

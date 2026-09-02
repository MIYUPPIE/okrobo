// URDF subset parser (contracts/pack/v0). Turns a robot description into the
// joint chain the engine's arm model uses: ordered revolute joints with
// limits, plus link lengths for forward kinematics and rendering.
//
// Unsupported URDF (materials, inertial, collision, meshes, other joint
// types) is ignored rather than rejected, so real-world files load with their
// extras dropped. Pack content is data: nothing here executes it.

export interface UrdfJoint {
  name: string;
  /** revolute and continuous become movable joints; fixed ones are folded in. */
  type: "revolute" | "continuous" | "fixed";
  parent: string;
  child: string;
  /** meters, offset of the child frame from the parent */
  origin: [number, number, number];
  /** rotation axis, unit vector */
  axis: [number, number, number];
  /** radians; continuous joints get ±pi */
  lower: number;
  upper: number;
  /** rad/s */
  velocity: number;
}

export interface UrdfRobot {
  name: string;
  links: string[];
  joints: UrdfJoint[];
}

/** The engine-facing view: an ordered chain from the root link. */
export interface JointChain {
  name: string;
  /** movable joints, root to tip */
  joints: UrdfJoint[];
  /** distance (m) from each joint to the next; last entry is the tip length */
  linkLengths: number[];
}

const DEFAULT_VELOCITY = Math.PI / 2;

function numbers(value: string | null, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

function parseXml(source: string): Document {
  // DOMParser exists in the browser and in Node 21+ (undici/jsdom-free).
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`invalid URDF: ${error.textContent?.trim() ?? "parse error"}`);
  return doc;
}

export function parseUrdf(source: string): UrdfRobot {
  const doc = parseXml(source);
  const robot = doc.querySelector("robot");
  if (!robot) throw new Error("invalid URDF: no <robot> element");

  const name = robot.getAttribute("name");
  if (!name) throw new Error("invalid URDF: <robot> has no name");

  const links = [...robot.querySelectorAll(":scope > link")]
    .map((link) => link.getAttribute("name"))
    .filter((n): n is string => Boolean(n));

  const joints: UrdfJoint[] = [];
  for (const element of robot.querySelectorAll(":scope > joint")) {
    const jointName = element.getAttribute("name");
    const rawType = element.getAttribute("type");
    const parent = element.querySelector(":scope > parent")?.getAttribute("link");
    const child = element.querySelector(":scope > child")?.getAttribute("link");
    if (!jointName || !parent || !child) continue;
    if (rawType !== "revolute" && rawType !== "continuous" && rawType !== "fixed") continue;

    const origin = numbers(
      element.querySelector(":scope > origin")?.getAttribute("xyz") ?? null,
      [0, 0, 0],
    );
    const axis = numbers(element.querySelector(":scope > axis")?.getAttribute("xyz") ?? null, [
      1, 0, 0,
    ]);
    const limit = element.querySelector(":scope > limit");
    const lower = rawType === "continuous" ? -Math.PI : Number(limit?.getAttribute("lower") ?? -Math.PI);
    const upper = rawType === "continuous" ? Math.PI : Number(limit?.getAttribute("upper") ?? Math.PI);
    const velocity = Number(limit?.getAttribute("velocity") ?? DEFAULT_VELOCITY);

    joints.push({
      name: jointName,
      type: rawType,
      parent,
      child,
      origin,
      axis,
      lower: Number.isFinite(lower) ? lower : -Math.PI,
      upper: Number.isFinite(upper) ? upper : Math.PI,
      velocity: Number.isFinite(velocity) && velocity > 0 ? velocity : DEFAULT_VELOCITY,
    });
  }

  if (links.length === 0) throw new Error(`URDF '${name}': no links`);
  return { name, links, joints };
}

const length = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

/** Walk parent->child from the root link and return the movable joint chain. */
export function jointChain(robot: UrdfRobot): JointChain {
  const childLinks = new Set(robot.joints.map((j) => j.child));
  const roots = robot.links.filter((link) => !childLinks.has(link));
  if (roots.length === 0) throw new Error(`URDF '${robot.name}': no root link (cycle?)`);

  const byParent = new Map<string, UrdfJoint[]>();
  for (const joint of robot.joints) {
    byParent.set(joint.parent, [...(byParent.get(joint.parent) ?? []), joint]);
  }

  const ordered: UrdfJoint[] = [];
  const seen = new Set<string>();
  let current = roots[0];
  while (current && !seen.has(current)) {
    seen.add(current);
    const next = byParent.get(current)?.[0];
    if (!next) break;
    ordered.push(next);
    current = next.child;
  }

  const movable = ordered.filter((joint) => joint.type !== "fixed");
  // Each joint's own origin is the length of the link that precedes it, so
  // link i spans joint i to joint i+1; the final entry is the tip stub.
  const linkLengths = movable.map((_, index) =>
    index + 1 < movable.length ? length(movable[index + 1].origin) : 0,
  );
  const tipJoint = ordered[ordered.length - 1];
  if (tipJoint && tipJoint.type === "fixed" && linkLengths.length > 0) {
    linkLengths[linkLengths.length - 1] = length(tipJoint.origin);
  }
  return { name: robot.name, joints: movable, linkLengths };
}

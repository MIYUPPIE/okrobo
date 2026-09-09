import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseRobotDef, validateRobotDef, type Feature, type Issue, type Sensor, type Transform } from "../contracts/robotDef";
import {
  applyActuator,
  applySensor,
  computeJointOrigin,
  deleteActuator,
  deleteSensor,
  issuesIntroducedBy,
  makeCadBody,
  makeDefaultBody,
  makeDefaultRobotDef,
  nextActuatorId,
  nextBodyId,
  nextJointId,
  nextSensorId,
  removeBody,
  replaceBodyGeometry,
} from "./robotEdits";

const EXAMPLES_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v2", "examples");
const loadTwoLinkArm = () => parseRobotDef(JSON.parse(readFileSync(join(EXAMPLES_DIR, "two-link-arm.json"), "utf8")));

describe("makeDefaultRobotDef", () => {
  it("produces a valid single-body document", () => {
    const robot = makeDefaultRobotDef();
    expect(robot.bodies).toHaveLength(1);
    expect(validateRobotDef(robot)).toEqual([]);
  });
});

describe("nextBodyId", () => {
  it("picks body-N past the current count", () => {
    const robot = makeDefaultRobotDef();
    expect(nextBodyId(robot)).toBe("body-2");
  });

  it("skips ids that already exist", () => {
    const robot = makeDefaultRobotDef();
    robot.bodies.push(makeDefaultBody("body-2", null));
    expect(nextBodyId(robot)).toBe("body-3");
  });
});

describe("makeDefaultBody", () => {
  it("positions 0.1m from a reference body", () => {
    const near = makeDefaultRobotDef().bodies[0];
    const body = makeDefaultBody("body-2", near);
    expect(body.transform.position).toEqual([near.transform.position[0] + 0.1, near.transform.position[1], near.transform.position[2]]);
  });

  it("positions at the origin offset when there's no reference body", () => {
    const body = makeDefaultBody("body-1", null);
    expect(body.transform.position).toEqual([0.1, 0, 0]);
  });

  it("is well-formed on its own -- the only issue once added is the expected extra-root warning, since a new body is never auto-attached by a joint (joint-creation is out of scope)", () => {
    const robot = makeDefaultRobotDef();
    const newId = nextBodyId(robot);
    robot.bodies.push(makeDefaultBody(newId, robot.bodies[0]));
    expect(validateRobotDef(robot)).toEqual([
      expect.objectContaining({ rule: "robot-multiple-root-bodies", element_id: newId }),
    ]);
  });
});

describe("makeCadBody", () => {
  const mesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };
  const extrudeFeature: Feature = { operation: "extrude", profile: { type: "rectangle", width: 0.05, height: 0.05 }, depth: 0.02 };

  it("positions 0.1m from a reference body, mirroring makeDefaultBody", () => {
    const near = makeDefaultRobotDef().bodies[0];
    const body = makeCadBody("body-2", near, mesh, [extrudeFeature]);
    expect(body.transform.position).toEqual([near.transform.position[0] + 0.1, near.transform.position[1], near.transform.position[2]]);
  });

  it("positions at the origin offset when there's no reference body", () => {
    const body = makeCadBody("body-1", null, mesh, [extrudeFeature]);
    expect(body.transform.position).toEqual([0.1, 0, 0]);
  });

  it("sets visual and collision to the given cad_mesh geometry with the expected mass/inertia defaults", () => {
    const body = makeCadBody("body-1", null, mesh, [extrudeFeature]);
    expect(body.visual).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
    expect(body.collision).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
    expect(body.mass).toBe(0.05);
    expect(body.inertia).toEqual({ ixx: 0.0001, iyy: 0.0001, izz: 0.0001 });
  });

  it("is well-formed on its own -- valid geometry, only the expected extra-root warning once added", () => {
    const robot = makeDefaultRobotDef();
    const newId = nextBodyId(robot);
    robot.bodies.push(makeCadBody(newId, robot.bodies[0], mesh, [extrudeFeature]));
    expect(validateRobotDef(robot)).toEqual([
      expect.objectContaining({ rule: "robot-multiple-root-bodies", element_id: newId }),
    ]);
  });

  it("sets features to exactly the given ordered list (CAD Kernel Phase 7.1)", () => {
    const filletFeature: Feature = {
      operation: "fillet_chamfer",
      picks: [{ source_step: 0, local_index: 0, point: [0.025, 0, 0], operation: "fillet", value: 0.005 }],
    };
    const body = makeCadBody("body-1", null, mesh, [extrudeFeature, filletFeature]);
    expect(body.features).toEqual([extrudeFeature, filletFeature]);
  });

  it("omits features from serialization-relevant validation when empty", () => {
    const body = makeCadBody("body-1", null, mesh, []);
    expect(body.features).toEqual([]);
  });
});

describe("replaceBodyGeometry", () => {
  const mesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };
  const cutFeature: Feature = {
    operation: "cut",
    tool: { operation: "extrude", profile: { type: "circle", radius: 0.01 }, depth: 0.2 },
    position: [0, 0, 0],
  };

  it("replaces the target body's visual and collision with the given cad_mesh geometry", () => {
    const robot = makeDefaultRobotDef();
    const targetId = robot.bodies[0].id;
    const next = replaceBodyGeometry(robot, targetId, mesh, [cutFeature]);
    const body = next.bodies.find((b) => b.id === targetId)!;
    expect(body.visual).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
    expect(body.collision).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
  });

  it("leaves id, name, transform, mass, inertia, and material untouched", () => {
    const robot = makeDefaultRobotDef();
    const before = robot.bodies[0];
    const next = replaceBodyGeometry(robot, before.id, mesh, [cutFeature]);
    const after = next.bodies.find((b) => b.id === before.id)!;
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.transform).toEqual(before.transform);
    expect(after.mass).toBe(before.mass);
    expect(after.inertia).toEqual(before.inertia);
    expect(after.material).toEqual(before.material);
  });

  it("leaves every other body untouched", () => {
    const robot = loadTwoLinkArm();
    const next = replaceBodyGeometry(robot, "link1", mesh, [cutFeature]);
    const base = next.bodies.find((b) => b.id === "base")!;
    const original = robot.bodies.find((b) => b.id === "base")!;
    expect(base).toEqual(original);
  });

  it("is a no-op when the target id doesn't exist", () => {
    const robot = makeDefaultRobotDef();
    expect(replaceBodyGeometry(robot, "ghost", mesh, [cutFeature])).toEqual(robot);
  });

  it("prepends a synthesized box root the first time a modifier touches a bare box body (CAD Kernel Phase 7.1)", () => {
    const robot = makeDefaultRobotDef(); // bodies[0] is a box, features absent
    const targetId = robot.bodies[0].id;
    const boxSize = (robot.bodies[0].visual as { type: "box"; size: [number, number, number] }).size;
    const next = replaceBodyGeometry(robot, targetId, mesh, [cutFeature]);
    const body = next.bodies.find((b) => b.id === targetId)!;
    expect(body.features).toEqual([{ operation: "box", size: boxSize }, cutFeature]);
  });

  it("prepends a synthesized cylinder root the first time a modifier touches a bare cylinder body", () => {
    const robot = makeDefaultRobotDef();
    robot.bodies[0] = { ...robot.bodies[0], visual: { type: "cylinder", radius: 0.03, length: 0.08 }, collision: { type: "cylinder", radius: 0.03, length: 0.08 } };
    const targetId = robot.bodies[0].id;
    const next = replaceBodyGeometry(robot, targetId, mesh, [cutFeature]);
    const body = next.bodies.find((b) => b.id === targetId)!;
    expect(body.features).toEqual([{ operation: "cylinder", radius: 0.03, length: 0.08 }, cutFeature]);
  });

  it("appends to an already-recorded history instead of re-synthesizing a root", () => {
    const robot = makeDefaultRobotDef();
    const existing: Feature = { operation: "box", size: [0.2, 0.15, 0.08] };
    robot.bodies[0] = { ...robot.bodies[0], features: [existing] };
    const targetId = robot.bodies[0].id;
    const next = replaceBodyGeometry(robot, targetId, mesh, [cutFeature]);
    const body = next.bodies.find((b) => b.id === targetId)!;
    expect(body.features).toEqual([existing, cutFeature]);
  });

  it("records no synthesized root for a primitive that has no exact Feature shape (e.g. sphere)", () => {
    const robot = makeDefaultRobotDef();
    robot.bodies[0] = { ...robot.bodies[0], visual: { type: "sphere", radius: 0.05 }, collision: { type: "sphere", radius: 0.05 } };
    const targetId = robot.bodies[0].id;
    const next = replaceBodyGeometry(robot, targetId, mesh, [cutFeature]);
    const body = next.bodies.find((b) => b.id === targetId)!;
    expect(body.features).toEqual([cutFeature]);
  });
});

describe("removeBody", () => {
  it("cascades through joints, actuators, and joint-referencing sensors, but spares an unrelated sensor", () => {
    const robot = loadTwoLinkArm();
    const next = removeBody(robot, "link1");

    expect(next.bodies.map((b) => b.id)).toEqual(["base", "link2"]);
    expect(next.joints).toEqual([]); // joint1 (child=link1) and joint2 (parent=link1) both go
    expect(next.actuators).toEqual([]); // shoulder_motor targeted joint1
    expect(next.sensors.map((s) => s.id)).toEqual(["tip_camera"]); // shoulder_encoder (joint=joint1) removed; tip_camera (body=link2, no joint) survives
  });

  it("leaves a document unchanged when the id doesn't exist", () => {
    const robot = loadTwoLinkArm();
    expect(removeBody(robot, "ghost")).toEqual(robot);
  });
});

describe("nextJointId", () => {
  it("picks joint-N past the current count", () => {
    expect(nextJointId(loadTwoLinkArm())).toBe("joint-3"); // joint1, joint2 already exist
  });

  it("starts at joint-1 for a document with no joints yet", () => {
    expect(nextJointId(makeDefaultRobotDef())).toBe("joint-1");
  });
});

describe("computeJointOrigin", () => {
  const pose = (position: Transform["position"], rotation_rpy: Transform["rotation_rpy"]): Transform => ({
    position,
    rotation_rpy,
  });
  const withPose = (id: string, transform: Transform) => ({ ...makeDefaultBody(id, null), transform });

  /** Composes a Transform into the same real 4x4 matrix computeJointOrigin
   * itself builds from -- an independent check via the actual invariant
   * (parent ∘ origin reconstructs child), not hardcoded literals that could
   * just as easily encode my own arithmetic mistake. */
  function worldMatrix(transform: Transform): THREE.Matrix4 {
    const euler = new THREE.Euler(transform.rotation_rpy[0], transform.rotation_rpy[1], transform.rotation_rpy[2], "XYZ");
    return new THREE.Matrix4().compose(
      new THREE.Vector3(...transform.position),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(1, 1, 1),
    );
  }

  function expectReconstructs(parent: Transform, child: Transform, origin: Transform): void {
    const reconstructed = new THREE.Matrix4().multiplyMatrices(worldMatrix(parent), worldMatrix(origin));
    const expected = worldMatrix(child);
    for (let i = 0; i < 16; i++) expect(reconstructed.elements[i]).toBeCloseTo(expected.elements[i], 9);
  }

  it("keeps the child's world pose unchanged for an unrotated, offset pair", () => {
    const parent = withPose("p", pose([1, 0, 0], [0, 0, 0]));
    const child = withPose("c", pose([3, 2, 0], [0, 0, 0]));
    const origin = computeJointOrigin(parent, child);
    expect(origin.position).toEqual([2, 2, 0]); // plain subtraction is correct here (no rotation)
    expectReconstructs(parent.transform, child.transform, origin);
  });

  it("accounts for the parent's own rotation, not a naive position subtraction", () => {
    // Parent rotated +90deg about Z maps its local (0,-1,0) to world (1,0,0)
    // -- hand-derived, then cross-checked against the reconstruction below.
    const parent = withPose("p", pose([0, 0, 0], [0, 0, Math.PI / 2]));
    const child = withPose("c", pose([1, 0, 0], [0, 0, 0]));
    const origin = computeJointOrigin(parent, child);
    expect(origin.position[0]).toBeCloseTo(0, 9);
    expect(origin.position[1]).toBeCloseTo(-1, 9);
    expect(origin.rotation_rpy[2]).toBeCloseTo(-Math.PI / 2, 9);
    expectReconstructs(parent.transform, child.transform, origin);
  });

  it("holds for the general case: both bodies offset and rotated", () => {
    const parent = withPose("p", pose([1, 2, 3], [0.3, -0.2, 0.5]));
    const child = withPose("c", pose([4, -1, 2], [0.1, 0.4, -0.3]));
    const origin = computeJointOrigin(parent, child);
    expectReconstructs(parent.transform, child.transform, origin);
  });
});

describe("issuesIntroducedBy", () => {
  const issue = (rule: string, element_id: string): Issue => ({
    rule,
    severity: "error",
    element_kind: "joint",
    element_id,
    message: rule,
  });

  it("returns only issues absent from the before list, matched by rule/kind/id", () => {
    const before = [issue("body-invalid-mass", "a")];
    const after = [issue("body-invalid-mass", "a"), issue("joint-self-loop", "joint-1")];
    expect(issuesIntroducedBy(before, after)).toEqual([issue("joint-self-loop", "joint-1")]);
  });

  it("returns an empty array when nothing new was introduced", () => {
    const issues = [issue("body-invalid-mass", "a")];
    expect(issuesIntroducedBy(issues, issues)).toEqual([]);
  });

  it("treats the same rule on a different element as newly introduced", () => {
    const before = [issue("robot-cycle", "a")];
    const after = [issue("robot-cycle", "b")];
    expect(issuesIntroducedBy(before, after)).toEqual([issue("robot-cycle", "b")]);
  });
});

describe("nextActuatorId", () => {
  it("picks actuator-N past the current count", () => {
    expect(nextActuatorId(loadTwoLinkArm())).toBe("actuator-2"); // shoulder_motor already exists
  });

  it("starts at actuator-1 for a document with no actuators yet", () => {
    expect(nextActuatorId(makeDefaultRobotDef())).toBe("actuator-1");
  });
});

describe("nextSensorId", () => {
  it("picks sensor-N past the current count", () => {
    expect(nextSensorId(loadTwoLinkArm())).toBe("sensor-3"); // shoulder_encoder, tip_camera already exist
  });

  it("starts at sensor-1 for a document with no sensors yet", () => {
    expect(nextSensorId(makeDefaultRobotDef())).toBe("sensor-1");
  });
});

describe("applyActuator", () => {
  it("appends a new actuator when no replacingId is given", () => {
    const robot = loadTwoLinkArm();
    const next = applyActuator(robot, { id: "actuator-2", name: "Elbow Motor", type: "motor", target_joint: "joint2" });
    expect(next.actuators.map((a) => a.id)).toEqual(["shoulder_motor", "actuator-2"]);
  });

  it("replaces the actuator matching replacingId, in place", () => {
    const robot = loadTwoLinkArm();
    const edited = { id: "shoulder_motor", name: "Shoulder Servo", type: "servo" as const, target_joint: "joint1" };
    const next = applyActuator(robot, edited, "shoulder_motor");
    expect(next.actuators).toEqual([edited]);
  });
});

describe("applySensor", () => {
  it("appends a new sensor when no replacingId is given", () => {
    const robot = loadTwoLinkArm();
    const next = applySensor(robot, { id: "sensor-3", name: "New Sensor", type: "distance", body: "base", transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] } });
    expect(next.sensors.map((s) => s.id)).toEqual(["shoulder_encoder", "tip_camera", "sensor-3"]);
  });

  it("replaces the sensor matching replacingId, in place", () => {
    const robot = loadTwoLinkArm();
    const edited: Sensor = { id: "tip_camera", name: "Renamed", type: "distance", body: "link2", transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] } };
    const next = applySensor(robot, edited, "tip_camera");
    expect(next.sensors.map((s) => s.id)).toEqual(["shoulder_encoder", "tip_camera"]);
    expect(next.sensors[1]).toEqual(edited);
  });
});

describe("deleteActuator / deleteSensor", () => {
  it("removes a single actuator by id, leaving everything else untouched", () => {
    const robot = loadTwoLinkArm();
    const next = deleteActuator(robot, "shoulder_motor");
    expect(next.actuators).toEqual([]);
    expect(next.joints).toEqual(robot.joints);
    expect(next.sensors).toEqual(robot.sensors);
  });

  it("removes a single sensor by id, leaving everything else untouched", () => {
    const robot = loadTwoLinkArm();
    const next = deleteSensor(robot, "shoulder_encoder");
    expect(next.sensors.map((s) => s.id)).toEqual(["tip_camera"]);
    expect(next.actuators).toEqual(robot.actuators);
  });

  it("agrees with removeBody's own cascade: deleting both entities removeBody would cascade produces the same result", () => {
    const robot = loadTwoLinkArm();
    // removeBody("link1") cascades away joint1/joint2 (both reference link1),
    // which in turn cascades away shoulder_motor (targets joint1) and
    // shoulder_encoder (joint=joint1) -- tip_camera survives (body=link2,
    // no joint). Reaching the same actuators/sensors via the new single-
    // entity delete functions alone (no joint removal) proves they agree.
    const viaCascade = removeBody(robot, "link1");
    const viaDirectDelete = deleteSensor(deleteActuator(robot, "shoulder_motor"), "shoulder_encoder");
    expect(viaDirectDelete.actuators).toEqual(viaCascade.actuators);
    expect(viaDirectDelete.sensors).toEqual(viaCascade.sensors);
  });
});

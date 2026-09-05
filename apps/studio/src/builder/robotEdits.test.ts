import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseRobotDef, validateRobotDef, type Issue, type Transform } from "../contracts/robotDef";
import {
  computeJointOrigin,
  issuesIntroducedBy,
  makeDefaultBody,
  makeDefaultRobotDef,
  nextBodyId,
  nextJointId,
  removeBody,
} from "./robotEdits";

const EXAMPLES_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v1", "examples");
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

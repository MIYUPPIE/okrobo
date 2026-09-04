import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, validateRobotDef } from "../contracts/robotDef";
import { makeDefaultBody, makeDefaultRobotDef, nextBodyId, removeBody } from "./robotEdits";

const EXAMPLES_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v0", "examples");
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

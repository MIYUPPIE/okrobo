// @vitest-environment jsdom
// The reciprocal of exportRobot.test.ts. No Tauri mocking needed -- reading
// a File the student picked works identically in the browser and inside
// the Tauri webview, no platform branch to test.

import { describe, expect, it } from "vitest";
import { importRobotDef } from "./importRobot";

function jsonFile(contents: string, name = "robot.robot-def.json"): File {
  return new File([contents], name, { type: "application/json" });
}

const validRobot = {
  id: "my-rover",
  name: "My Rover",
  description: "",
  root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
  bodies: [{ id: "chassis", name: "Chassis", transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
  joints: [],
  actuators: [],
  sensors: [],
};

describe("importRobotDef", () => {
  it("reads and parses a well-formed robot-def file", async () => {
    const robot = await importRobotDef(jsonFile(JSON.stringify(validRobot)));
    expect(robot.id).toBe("my-rover");
    expect(robot.bodies).toHaveLength(1);
    expect(robot.bodies[0].id).toBe("chassis");
  });

  it("rejects malformed JSON", async () => {
    await expect(importRobotDef(jsonFile("{not valid json"))).rejects.toThrow();
  });

  it("rejects well-formed JSON that isn't a valid robot-def (parseRobotDef's own error)", async () => {
    await expect(importRobotDef(jsonFile(JSON.stringify({ notARobot: true })))).rejects.toThrow("robot-def: missing id or name");
  });

  it("rejects a document missing bodies, with parseRobotDef's own message", async () => {
    const { bodies: _bodies, ...withoutBodies } = validRobot;
    await expect(importRobotDef(jsonFile(JSON.stringify(withoutBodies)))).rejects.toThrow("robot-def 'my-rover': missing bodies");
  });
});

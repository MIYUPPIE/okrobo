// Uses the real compiled WASM module (no mock), mirroring loader.test.ts's
// own approach and engine/tests/test_built_robot.cpp's numeric expectations
// -- scripts/test-all.sh runs build-engine-wasm.sh before `npm run test`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, type RobotDef } from "../contracts/robotDef";
import { EngineBuiltRobot } from "./EngineBuiltRobot";
import { loadEngine } from "./loader";

const EXAMPLES_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v0", "examples");
const loadExample = (name: string): RobotDef =>
  parseRobotDef(JSON.parse(readFileSync(join(EXAMPLES_DIR, `${name}.json`), "utf8")));

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

function run(robot: EngineBuiltRobot, seconds: number, dt = 0.01): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) robot.step(dt);
}

describe("EngineBuiltRobot", () => {
  it("drops and settles a single-body example at its floor-contact height", async () => {
    const module = await loadEngine();
    const robot = new EngineBuiltRobot(module, {
      ...loadExample("single-body"),
      root_placement: { position: [0, 0, 0.5], rotation_rpy: [0, 0, 0] },
    });
    run(robot, 2.0);
    const [pose] = robot.bodyPoses();
    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.y).toBeCloseTo(0, 5);
    expect(pose.z).toBeCloseTo(0.04, 2); // half the chassis box's z extent (0.08/2)
    robot.destroy();
  });

  it("moves a servo-actuated joint measurably from its un-actuated rest pose", async () => {
    const module = await loadEngine();
    const doc: RobotDef = {
      id: "actuator-test",
      name: "Actuator Test",
      description: "",
      root_placement: { position: [0, 0, 0.05], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "base",
          name: "Base",
          transform: identity,
          mass: 0.5,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          visual: { type: "box", size: [0.1, 0.1, 0.05] },
          collision: { type: "box", size: [0.1, 0.1, 0.05] },
        },
        {
          id: "link1",
          name: "Link 1",
          transform: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] },
          mass: 0.1,
          inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
          visual: { type: "box", size: [0.2, 0.04, 0.04] },
          collision: { type: "box", size: [0.2, 0.04, 0.04] },
        },
      ],
      joints: [
        {
          id: "joint1",
          name: "Joint 1",
          type: "hinge",
          parent: "base",
          child: "link1",
          origin: identity,
          axis: [0, 1, 0],
          limits: { lower: -3.14, upper: 3.14 },
          damping: 0.5,
        },
      ],
      actuators: [{ id: "shoulder", name: "Shoulder", type: "servo", target_joint: "joint1" }],
      sensors: [],
    };

    const robot = new EngineBuiltRobot(module, doc);
    expect(robot.actuatorCount()).toBe(1);

    run(robot, 1.5); // settle onto the floor, damp the un-actuated joint to rest
    const before = robot.bodyPoses()[1];

    expect(robot.setActuatorCtrl(0, 1.5)).toBe(true);
    run(robot, 2.0);
    const after = robot.bodyPoses()[1];

    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    expect(moved).toBeGreaterThan(0.03);

    // Out-of-range index: a documented no-op, not a throw.
    expect(robot.setActuatorCtrl(5, 1.0)).toBe(false);
    robot.destroy();
  });

  it("throws for a document that can never compile (plane geometry on a free-jointed root)", async () => {
    const module = await loadEngine();
    const doc: RobotDef = {
      id: "impossible",
      name: "Impossible",
      description: "",
      root_placement: identity,
      bodies: [
        {
          id: "floor_body",
          name: "Floor Body",
          transform: identity,
          mass: 1,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "plane", size: [1, 1] },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
    expect(() => new EngineBuiltRobot(module, doc)).toThrow();
  });
});

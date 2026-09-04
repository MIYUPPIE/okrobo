// Every template's actual physics is measured against the real compiled
// WASM module, not assumed -- this project's standing discipline since
// Phase 3 (see docs/decisions/robot-builder-physics.md and
// EngineBuiltRobot.test.ts's own idiom, mirrored here).

import { describe, expect, it } from "vitest";
import { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { loadEngine } from "../engine/loader";
import { makeArmTemplate, makeRoverTemplate } from "./robotTemplates";

function run(robot: EngineBuiltRobot, seconds: number, dt = 0.01): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) robot.step(dt);
}

describe("makeRoverTemplate physics", () => {
  it("settles onto the floor, then drives forward measurably when both wheel actuators spin", async () => {
    const module = await loadEngine();
    const robot = new EngineBuiltRobot(module, makeRoverTemplate());

    run(robot, 1.0); // drop and settle
    const before = robot.bodyPoses()[0]; // chassis (bodies[0])
    expect(before.z).toBeGreaterThan(0); // resting on the wheels, not sunk through the floor

    expect(robot.actuatorCount()).toBe(2);
    robot.setActuatorCtrl(0, 6); // left_wheel
    robot.setActuatorCtrl(1, 6); // right_wheel
    run(robot, 2.0);
    const after = robot.bodyPoses()[0];

    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    expect(moved).toBeGreaterThan(0.05);
    robot.destroy();
  });

  it("turns when the wheels spin in opposite directions", async () => {
    const module = await loadEngine();
    const robot = new EngineBuiltRobot(module, makeRoverTemplate());

    run(robot, 1.0);
    const before = robot.bodyPoses()[0];

    robot.setActuatorCtrl(0, -4); // left_wheel backward
    robot.setActuatorCtrl(1, 4); // right_wheel forward -> should yaw in place-ish
    run(robot, 2.0);
    const after = robot.bodyPoses()[0];

    // A real quaternion change (not just position) is the honest signal of
    // turning -- a straight drive would also move x/y, but only a turn
    // changes orientation this much this fast.
    const dot = before.qw * after.qw + before.qx * after.qx + before.qy * after.qy + before.qz * after.qz;
    expect(Math.abs(dot)).toBeLessThan(0.99);
    robot.destroy();
  });
});

describe("makeArmTemplate physics", () => {
  it("moves the shoulder-actuated link measurably, matching the encoder reading", async () => {
    const module = await loadEngine();
    const doc = makeArmTemplate();
    const robot = new EngineBuiltRobot(module, doc);
    expect(robot.actuatorCount()).toBe(1);

    run(robot, 1.0); // settle
    const before = robot.bodyPoses()[1]; // link1

    expect(robot.setActuatorCtrl(0, 1.0)).toBe(true); // shoulder_motor -> 1 rad target
    run(robot, 2.0);
    const after = robot.bodyPoses()[1];

    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    expect(moved).toBeGreaterThan(0.03);

    const encoder = robot.sensorReadings().find((r) => r.id === "shoulder_encoder");
    expect(encoder?.values[0]).toBeCloseTo(1.0, 1);
    robot.destroy();
  });
});

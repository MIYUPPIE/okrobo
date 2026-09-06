// Uses the real compiled WASM module (no mock), mirroring loader.test.ts's
// own approach and engine/tests/test_built_robot.cpp's numeric expectations
// -- scripts/test-all.sh runs build-engine-wasm.sh before `npm run test`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, type RobotDef } from "../contracts/robotDef";
import type { WorldDef } from "../contracts/worldDef";
import { EngineBuiltRobot } from "./EngineBuiltRobot";
import { loadEngine } from "./loader";

const EXAMPLES_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v2", "examples");
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

  // Robot Builder Phase 4 (sensors). Same physical scenarios and measured
  // numbers as engine/tests/test_built_robot.cpp's sensor cases -- the
  // point is cross-language agreement between the native C++ tests and
  // this same document run through the real compiled WASM module.

  function hingeArmDoc(): RobotDef {
    return {
      id: "sensor-test",
      name: "Sensor Test",
      description: "",
      root_placement: { position: [0, 0, 0.05], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "base",
          name: "Base",
          transform: identity,
          mass: 0.5,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "box", size: [0.1, 0.1, 0.05] },
        },
        {
          id: "link1",
          name: "Link 1",
          transform: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] },
          mass: 0.1,
          inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
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
  }

  it("encoder reads back the settled angle a servo drove its joint to", async () => {
    const module = await loadEngine();
    const doc = hingeArmDoc();
    doc.sensors = [{ id: "axle_encoder", name: "Axle Encoder", type: "encoder", body: "link1", joint: "joint1", transform: identity }];

    const robot = new EngineBuiltRobot(module, doc);
    expect(robot.setActuatorCtrl(0, 1.0)).toBe(true);
    run(robot, 3.0);

    const [reading] = robot.sensorReadings();
    expect(reading.values).toHaveLength(1);
    expect(reading.values[0]).toBeCloseTo(1.0, 1);
    robot.destroy();
  });

  it("gps reading matches the mounting body's own world position", async () => {
    const module = await loadEngine();
    const doc: RobotDef = {
      id: "gps-test",
      name: "GPS Test",
      description: "",
      root_placement: { position: [0.3, -0.2, 0.5], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "box",
          name: "Box",
          transform: identity,
          mass: 1,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "box", size: [0.2, 0.15, 0.08] },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [{ id: "position", name: "Position", type: "gps", body: "box", transform: identity }],
    };

    const robot = new EngineBuiltRobot(module, doc);
    run(robot, 2.0);

    const [pose] = robot.bodyPoses();
    const [reading] = robot.sensorReadings();
    expect(reading.values).toHaveLength(3);
    expect(reading.values[0]).toBeCloseTo(pose.x, 6);
    expect(reading.values[1]).toBeCloseTo(pose.y, 6);
    expect(reading.values[2]).toBeCloseTo(pose.z, 6);
    robot.destroy();
  });

  it("a downward rangefinder reads the body's starting height above the floor", async () => {
    const module = await loadEngine();
    const doc: RobotDef = {
      id: "distance-test",
      name: "Distance Test",
      description: "",
      root_placement: { position: [0, 0, 0.5], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "box",
          name: "Box",
          transform: identity,
          mass: 1,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "box", size: [0.1, 0.1, 0.08] },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [
        {
          id: "down_range",
          name: "Down Range",
          type: "distance",
          body: "box",
          transform: { position: [0, 0, 0], rotation_rpy: [0, Math.PI, 0] },
        },
      ],
    };

    const robot = new EngineBuiltRobot(module, doc); // read immediately: nothing has fallen yet
    const [reading] = robot.sensorReadings();
    expect(reading.values[0]).toBeCloseTo(0.5, 1);
    robot.destroy();
  });

  it("imu accelerometer reads the gravity reaction force at rest", async () => {
    const module = await loadEngine();
    const doc: RobotDef = {
      id: "imu-test",
      name: "IMU Test",
      description: "",
      root_placement: { position: [0, 0, 0.5], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "box",
          name: "Box",
          transform: identity,
          mass: 1,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "box", size: [0.2, 0.15, 0.08] },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [{ id: "imu", name: "IMU", type: "imu", body: "box", transform: identity }],
    };

    const robot = new EngineBuiltRobot(module, doc);
    run(robot, 2.0); // settle onto the floor first

    const [reading] = robot.sensorReadings();
    expect(reading.values).toHaveLength(6);
    const [ax, ay, az] = reading.values;
    const mag = Math.hypot(ax, ay, az);
    expect(mag).toBeCloseTo(9.81, 0);
    expect(az).toBeGreaterThan(0); // the reaction force countering gravity, pointing up
    robot.destroy();
  });

  it("camera sensors read no numeric values (Phase 4 non-goal)", async () => {
    const module = await loadEngine();
    const doc = hingeArmDoc();
    doc.sensors = [{ id: "eye", name: "Eye", type: "camera", body: "base", transform: identity }];

    const robot = new EngineBuiltRobot(module, doc);
    const [reading] = robot.sensorReadings();
    expect(reading.values).toEqual([]);
    robot.destroy();
  });

  // Robot Builder Phase 5 (world objects). Same physical scenario and
  // measured numbers as engine/tests/test_built_robot.cpp's
  // TestRobotSettlesOnWorldObject -- proof a world object is a real MuJoCo
  // collider, not just a rendered decoration, through the real WASM boundary.
  it("a robot body settles on a world-def obstacle instead of falling through to the floor", async () => {
    const module = await loadEngine();
    const robotHalfZ = 0.04;
    const robot: RobotDef = {
      id: "world-collision-test",
      name: "World Collision Test",
      description: "",
      root_placement: { position: [0, 0, 0.6], rotation_rpy: [0, 0, 0] },
      bodies: [
        {
          id: "box",
          name: "Box",
          transform: identity,
          mass: 1,
          inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
          collision: { type: "box", size: [0.1, 0.1, robotHalfZ * 2] },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const obstacleHalfZ = 0.05;
    const world: WorldDef = {
      id: "world-collision-test-world",
      name: "World Collision Test World",
      description: "",
      objects: [
        {
          id: "platform",
          name: "Platform",
          transform: { position: [0, 0, obstacleHalfZ], rotation_rpy: [0, 0, 0] },
          geometry: { type: "box", size: [0.3, 0.3, obstacleHalfZ * 2] },
        },
      ],
    };

    const built = new EngineBuiltRobot(module, robot, world);
    run(built, 2.0);

    const [pose] = built.bodyPoses();
    const platformTop = obstacleHalfZ * 2;
    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.y).toBeCloseTo(0, 5);
    expect(pose.z).toBeCloseTo(platformTop + robotHalfZ, 2);
    expect(pose.z).toBeGreaterThan(obstacleHalfZ); // nowhere near the floor -- landed on the platform, not through it
    built.destroy();
  });
});

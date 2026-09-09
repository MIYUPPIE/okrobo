import { describe, expect, it } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { loadEngine } from "../engine/loader";
import { BuiltProgramRunner } from "../program/BuiltProgramRunner";
import { ProgramStoppedError } from "../program/ProgramRunner";
import { makeRunner } from "../program/testEngine";
import { executeBuiltRemoteRequest, executeRemoteRequest } from "./PythonBridge";

describe("executeRemoteRequest (real WASM engine)", () => {
  it("maps movement methods with args", async () => {
    const { engine, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "forward", { meters: 0.25 });
    runner.tick(200);
    await request;
    expect(engine.state().pose.x).toBeCloseTo(1.25, 9);
    engine.destroy();
  });

  it("maps snake_case turns to the runner API", async () => {
    const { engine, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "turn_left", { degrees: 45 });
    runner.tick(100);
    await request;
    expect(runner.api.heading()).toBeCloseTo(45, 9);
    engine.destroy();
  });

  it("returns sensor readings and position", async () => {
    const { engine, runner } = await makeRunner();
    // The red box in the shipped arena sits 0.5 m ahead.
    await expect(executeRemoteRequest(runner.api, "distance", {})).resolves.toBeCloseTo(0.5, 9);
    await expect(executeRemoteRequest(runner.api, "position", {})).resolves.toEqual([1.0, 1.0]);
    engine.destroy();
  });

  it("applies defaults for missing args", async () => {
    const { engine, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "forward", {});
    runner.tick(100);
    await request;
    expect(engine.state().pose.x).toBeCloseTo(1.1, 9); // default 0.1 m
    engine.destroy();
  });

  it("maps arm methods (v1)", async () => {
    const { engine, arm, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "arm_move", {
      joint: "shoulder",
      degrees: 85,
    });
    runner.tick(200);
    await request;
    await expect(executeRemoteRequest(runner.api, "arm_angles", {})).resolves.toBeInstanceOf(Array);
    const angles = (await executeRemoteRequest(runner.api, "arm_angles", {})) as number[];
    expect(angles[1]).toBeCloseTo(85, 6);
    const tip = (await executeRemoteRequest(runner.api, "arm_tip", {})) as number[];
    expect(tip).toHaveLength(3);
    arm.destroy();
    engine.destroy();
  });

  it("maps arm_move_all and lidar (v1)", async () => {
    const { engine, arm, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "arm_move_all", { angles: [0, 90, 0, 0] });
    runner.tick(400);
    await request;
    const tip = (await executeRemoteRequest(runner.api, "arm_tip", {})) as number[];
    expect(tip[2]).toBeCloseTo(0.62, 6);

    const fan = (await executeRemoteRequest(runner.api, "lidar", {
      rays: 3,
      fov_degrees: 180,
    })) as number[];
    expect(fan).toHaveLength(3);
    expect(fan[1]).toBeCloseTo(0.5, 9);
    arm.destroy();
    engine.destroy();
  });

  it("maps drone methods (v2)", async () => {
    const { engine, drone, runner } = await makeRunner();
    const takeoff = executeRemoteRequest(runner.api, "drone_takeoff", { height: 0.5 });
    runner.tick(600);
    await takeoff;
    await expect(executeRemoteRequest(runner.api, "drone_altitude", {})).resolves.toBeCloseTo(0.5, 6);

    const forward = executeRemoteRequest(runner.api, "drone_forward", { meters: 0.2 });
    runner.tick(200);
    await forward;
    const position = (await executeRemoteRequest(runner.api, "drone_position", {})) as number[];
    expect(position[0]).toBeCloseTo(1.2, 6);

    const turn = executeRemoteRequest(runner.api, "drone_turn_right", { degrees: 90 });
    runner.tick(400);
    await turn;
    await expect(executeRemoteRequest(runner.api, "drone_heading", {})).resolves.toBeCloseTo(-90, 6);

    drone.destroy();
    engine.destroy();
  });

  it("applies defaults for drone args, matching the local Drone API", async () => {
    const { engine, drone, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "drone_takeoff", {});
    runner.tick(450);
    await request;
    expect(drone.state().pose.z).toBeCloseTo(0.4, 6); // default hover height
    drone.destroy();
    engine.destroy();
  });

  it("rejects unknown methods", async () => {
    const { engine, runner } = await makeRunner();
    await expect(executeRemoteRequest(runner.api, "fly", {})).rejects.toThrow("unknown method");
    engine.destroy();
  });

  it("propagates Stop as a rejection the sidecar can relay", async () => {
    const { engine, runner } = await makeRunner();
    const request = executeRemoteRequest(runner.api, "forward", { meters: 1 });
    runner.tick(10);
    runner.abort();
    await expect(request).rejects.toBeInstanceOf(ProgramStoppedError);
    engine.destroy();
  });
});

const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

/** A base + one hinge-jointed link, one servo actuator, one encoder sensor
 * on the same joint -- mirrors BuiltProgramRunner.test.ts's own fixture. */
function makeHingeArmDoc(): RobotDef {
  return {
    id: "bridge-test",
    name: "Bridge Test",
    description: "",
    root_placement: { position: [0, 0, 0.05], rotation_rpy: [0, 0, 0] },
    bodies: [
      {
        id: "base",
        name: "Base",
        transform: IDENTITY,
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
        origin: IDENTITY,
        axis: [0, 1, 0],
        limits: { lower: -3.14, upper: 3.14 },
        damping: 0.5,
      },
    ],
    actuators: [{ id: "shoulder", name: "Shoulder", type: "servo", target_joint: "joint1" }],
    sensors: [{ id: "shoulder_encoder", name: "Shoulder Encoder", type: "encoder", body: "link1", joint: "joint1", transform: IDENTITY }],
  };
}

describe("executeBuiltRemoteRequest (real WASM engine)", () => {
  it("built_set moves the target actuator", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    await executeBuiltRemoteRequest(runner.api, "built_set", { actuator_id: "shoulder", value: 1.2 });
    for (let i = 0; i < 200; i++) runner.tick(0.01);
    const reading = built.sensorReadings().find((r) => r.id === "shoulder_encoder");
    expect(reading?.values[0]).toBeCloseTo(1.2, 1);
    built.destroy();
  });

  it("built_read returns the named sensor's reading", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    const result = await executeBuiltRemoteRequest(runner.api, "built_read", { sensor_id: "shoulder_encoder" });
    expect(result).toEqual([0]);
    built.destroy();
  });

  it("wait/stop reuse the same generic dispatch as car/arm/drone", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    await executeBuiltRemoteRequest(runner.api, "built_set", { actuator_id: "shoulder", value: 1.0 });
    const wait = executeBuiltRemoteRequest(runner.api, "wait", { seconds: 0.05 });
    for (let i = 0; i < 10; i++) runner.tick(0.01);
    await wait;
    await executeBuiltRemoteRequest(runner.api, "stop", {});
    expect(() => runner.api.set("shoulder", 0)).not.toThrow();
    built.destroy();
  });

  it("rejects an unknown method", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);
    await expect(executeBuiltRemoteRequest(runner.api, "fly", {})).rejects.toThrow("unknown method");
    built.destroy();
  });
});

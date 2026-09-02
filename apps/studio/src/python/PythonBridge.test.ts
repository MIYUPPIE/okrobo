import { describe, expect, it } from "vitest";
import { ProgramStoppedError } from "../program/ProgramRunner";
import { makeRunner } from "../program/testEngine";
import { executeRemoteRequest } from "./PythonBridge";

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
    await expect(executeRemoteRequest(runner.api, "distance", {})).resolves.toBeCloseTo(0.9, 9);
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
    expect(fan[1]).toBeCloseTo(0.9, 9);
    arm.destroy();
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

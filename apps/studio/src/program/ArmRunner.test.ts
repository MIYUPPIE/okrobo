import { describe, expect, it } from "vitest";
import { ProgramStoppedError } from "./ProgramRunner";
import { makeRunner } from "./testEngine";

describe("ProgramRunner arm methods (real WASM engine)", () => {
  it("armMove blocks until the joint arrives, in degrees", async () => {
    const { engine, arm, runner } = await makeRunner();
    const move = runner.api.armMove("base", 90);
    runner.tick(200); // 90deg at 90deg/s -> 1 s = 100 steps
    await move;
    expect(runner.api.armAngles()[0]).toBeCloseTo(90, 9);
    const [x, y] = runner.api.armTip();
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeGreaterThan(0.3);
    arm.destroy();
    engine.destroy();
  });

  it("armMoveAll moves joints simultaneously", async () => {
    const { engine, arm, runner } = await makeRunner();
    const move = runner.api.armMoveAll([0, 90, 0, 0]); // straight up
    runner.tick(400);
    await move;
    const tip = runner.api.armTip();
    expect(tip[2]).toBeCloseTo(0.12 + 0.22 + 0.18 + 0.1, 6);
    arm.destroy();
    engine.destroy();
  });

  it("resolves immediately when already at the target", async () => {
    const { engine, arm, runner } = await makeRunner();
    await expect(runner.api.armMove("elbow", -30)).resolves.toBeUndefined();
    arm.destroy();
    engine.destroy();
  });

  it("rejects unknown joints", async () => {
    const { engine, arm, runner } = await makeRunner();
    await expect(runner.api.armMove("knee", 10)).rejects.toThrow("unknown joint");
    arm.destroy();
    engine.destroy();
  });

  it("abort stops the arm mid-motion", async () => {
    const { engine, arm, runner } = await makeRunner();
    const move = runner.api.armMove("base", 180);
    runner.tick(20);
    runner.abort();
    await expect(move).rejects.toBeInstanceOf(ProgramStoppedError);
    const held = runner.api.armAngles()[0];
    runner.tick(100);
    expect(runner.api.armAngles()[0]).toBeCloseTo(held, 9);
    arm.destroy();
    engine.destroy();
  });

  it("lidar fan matches the reference geometry", async () => {
    const { engine, arm, runner } = await makeRunner();
    const distances = runner.api.lidar(5, 180);
    expect(distances).toHaveLength(5);
    expect(distances[2]).toBeCloseTo(0.9, 9); // center ray at arena center
    expect(distances[0]).toBeCloseTo(0.9, 9); // +90deg
    expect(distances[1]).toBeGreaterThan(distances[2]); // diagonal is longer
    arm.destroy();
    engine.destroy();
  });
});

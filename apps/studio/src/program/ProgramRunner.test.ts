import { describe, expect, it } from "vitest";
import { ProgramStoppedError } from "./ProgramRunner";
import { makeRunner } from "./testEngine";

describe("ProgramRunner movements (real WASM engine)", () => {
  it("forward moves the exact distance, matching the Python API", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(0.1);
    runner.tick(100);
    await move;
    const state = engine.state();
    expect(state.pose.x).toBeCloseTo(1.1, 9);
    expect(state.pose.y).toBeCloseTo(1.0, 9);
    engine.destroy();
  });

  it("turnLeft lands exactly on the angle via the partial end step", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.turnLeft(90);
    runner.tick(100);
    await move;
    expect(runner.api.heading()).toBeCloseTo(90, 9);
    expect(engine.state().pose.x).toBeCloseTo(1.0, 9);
    engine.destroy();
  });

  it("forward stops early at the wall", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(5.0);
    runner.tick(3000);
    await move;
    expect(engine.state().pose.x).toBeCloseTo(1.9, 9);
    expect(runner.api.distance()).toBeCloseTo(0.0, 9);
    engine.destroy();
  });

  it("wait passes simulation time without moving", async () => {
    const { engine, runner } = await makeRunner();
    const before = engine.state();
    const move = runner.api.wait(0.5);
    runner.tick(60);
    await move;
    const after = engine.state();
    expect(after.tick).toBeGreaterThan(before.tick);
    expect(after.pose.x).toBeCloseTo(before.pose.x, 12);
    engine.destroy();
  });

  it("abort rejects the active movement and stops the wheels", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(1.0);
    runner.tick(10);
    runner.abort();
    await expect(move).rejects.toBeInstanceOf(ProgramStoppedError);
    const stoppedAt = engine.state().pose.x;
    runner.tick(100);
    expect(engine.state().pose.x).toBeCloseTo(stoppedAt, 12);
    engine.destroy();
  });

  it("rejects new movements after abort until re-armed", async () => {
    const { engine, runner } = await makeRunner();
    runner.abort();
    await expect(runner.api.forward(0.1)).rejects.toBeInstanceOf(ProgramStoppedError);
    runner.arm();
    const move = runner.api.forward(0.1);
    runner.tick(100);
    await expect(move).resolves.toBeUndefined();
    engine.destroy();
  });
});

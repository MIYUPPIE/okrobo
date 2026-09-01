import * as Blockly from "blockly/core";
import { describe, expect, it } from "vitest";
import { generateJavaScript, STARTER_WORKSPACE } from "../blocks/okroboBlocks";
import { runProgram } from "./execute";
import { ProgramStoppedError } from "./ProgramRunner";
import { driveUntil, makeRunner } from "./testEngine";

describe("program execution (real WASM engine)", () => {
  it("runs a straight-line script to the expected pose", async () => {
    const { engine, runner } = await makeRunner();
    const code = [
      "await robot.forward(0.2);",
      "await robot.turnLeft(90);",
      "await robot.forward(0.2);",
    ].join("\n");
    const done = { value: false };
    const program = runProgram(code, runner.api).finally(() => {
      done.value = true;
    });
    await driveUntil(runner, done);
    await program;
    const state = engine.state();
    expect(state.pose.x).toBeCloseTo(1.2, 9);
    expect(state.pose.y).toBeCloseTo(1.2, 9);
    expect(runner.api.heading()).toBeCloseTo(90, 9);
    engine.destroy();
  });

  it("phase 2 acceptance: the Blockly wall avoider turns at the wall", async () => {
    const { engine, runner } = await makeRunner();
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(STARTER_WORKSPACE, workspace);
    const code = generateJavaScript(workspace);
    workspace.dispose();

    const done = { value: false };
    let stoppedError: unknown = null;
    const program = runProgram(code, runner.api)
      .catch((error) => {
        stoppedError = error;
      })
      .finally(() => {
        done.value = true;
      });

    // The program loops forever; give it plenty of simulated time, then stop.
    let maxY = 0;
    let iterations = 0;
    const sampler = () => {
      maxY = Math.max(maxY, engine.state().pose.y);
      if (++iterations >= 400) runner.abort();
    };
    await driveUntil(runner, done, sampler);
    await program;

    // It drove east, turned left at the wall, and drove north to the far wall.
    expect(maxY).toBeGreaterThan(1.5);
    expect(stoppedError).toBeInstanceOf(ProgramStoppedError);
    engine.destroy();
  });

  it("stop interrupts a running program safely", async () => {
    const { engine, runner } = await makeRunner();
    const done = { value: false };
    let caught: unknown = null;
    const program = runProgram("while (true) { await robot._checkpoint(); await robot.forward(0.05); }", runner.api)
      .catch((error) => {
        caught = error;
      })
      .finally(() => {
        done.value = true;
      });

    let iterations = 0;
    await driveUntil(runner, done, () => {
      if (++iterations === 20) runner.abort();
    });
    await program;
    expect(caught).toBeInstanceOf(ProgramStoppedError);

    const stoppedAt = engine.state().pose.x;
    runner.tick(200);
    expect(engine.state().pose.x).toBeCloseTo(stoppedAt, 12);
    engine.destroy();
  });
});

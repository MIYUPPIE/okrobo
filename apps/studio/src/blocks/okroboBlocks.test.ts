import * as Blockly from "blockly/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARM_STARTER_WORKSPACE,
  generateJavaScript,
  generatePython,
  STARTER_WORKSPACE,
} from "./okroboBlocks";

// Headless workspace: no DOM needed for loading and code generation.
let workspace: Blockly.Workspace;

const load = (state: object) => {
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(state, workspace);
  return workspace;
};

const loadStarter = () => load(STARTER_WORKSPACE);

afterEach(() => workspace?.dispose());

describe("block code generation", () => {
  it("generates the executable JavaScript wall avoider", () => {
    const js = generateJavaScript(loadStarter());
    expect(js).toContain("while (true) {");
    expect(js).toContain("await robot._checkpoint();");
    expect(js).toContain("await robot.forward(0.05);");
    expect(js).toContain("robot.distance() < 0.2");
    expect(js).toContain("await robot.turnLeft(90);");
  });

  it("generates the matching Python preview against the okrobo package API", () => {
    const py = generatePython(loadStarter());
    expect(py).toContain("from okrobo import Robot");
    expect(py).toContain("robot = Robot()");
    expect(py).toContain("while True:");
    expect(py).toContain("robot.forward(0.05)");
    expect(py).toContain("robot.distance() < 0.2");
    expect(py).toContain("robot.turn_left(90)");
    expect(py).not.toContain("await");
  });

  it("generates the arm wave in JavaScript against the runner API", () => {
    const js = generateJavaScript(load(ARM_STARTER_WORKSPACE));
    expect(js).toContain('await robot.armMove("shoulder", 85);');
    expect(js).toContain('await robot.armMove("base", 45);');
    expect(js).toContain("for (");
  });

  it("generates the arm wave in Python against the okrobo Arm API", () => {
    const py = generatePython(load(ARM_STARTER_WORKSPACE), "arm");
    expect(py).toContain("from okrobo import Arm");
    expect(py).toContain("arm = Arm()");
    expect(py).toContain('arm.move("shoulder", 85)');
    expect(py).not.toContain("robot.");
  });

  it("wait targets the right receiver per robot", () => {
    const waitOnly = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "okrobo_wait", x: 0, y: 0, fields: { SECONDS: 2 } }],
      },
    };
    expect(generatePython(load(waitOnly), "arm")).toContain("arm.wait(2)");
    workspace.dispose();
    expect(generatePython(load(waitOnly), "car")).toContain("robot.wait(2)");
  });
});

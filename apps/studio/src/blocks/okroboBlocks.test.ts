import * as Blockly from "blockly/core";
import { afterEach, describe, expect, it } from "vitest";
import { generateJavaScript, generatePython, STARTER_WORKSPACE } from "./okroboBlocks";

// Headless workspace: no DOM needed for loading and code generation.
let workspace: Blockly.Workspace;

const loadStarter = () => {
  workspace = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(STARTER_WORKSPACE, workspace);
  return workspace;
};

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
});

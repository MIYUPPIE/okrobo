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

  const sensorWorkspaceState = {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: "okrobo_lidar_min", x: 0, y: 0 },
        { type: "okrobo_see_color", x: 0, y: 40, fields: { COLOR: "red" } },
        { type: "okrobo_color_bearing", x: 0, y: 80, fields: { COLOR: "blue" } },
      ],
    },
  };

  it("generates lidar and vision blocks in JavaScript against the runner API", () => {
    const js = generateJavaScript(load(sensorWorkspaceState));
    expect(js).toContain("Math.min(...robot.lidar())");
    expect(js).toContain('robot.findColor("red") !== null');
    expect(js).toContain('(robot.findColor("blue")?.bearing ?? 0)');
  });

  it("generates lidar and vision blocks in Python against the okrobo vision API", () => {
    const py = generatePython(load(sensorWorkspaceState));
    expect(py).toContain("min(robot.lidar())");
    expect(py).toContain('find_color(robot.camera(), "red") is not None');
    expect(py).toContain('(d.bearing if (d := find_color(robot.camera(), "blue")) else 0)');
  });

  it("only imports find_color when a vision block is actually used", () => {
    expect(generatePython(loadStarter())).not.toContain("find_color");

    const py = generatePython(
      load({
        blocks: {
          languageVersion: 0,
          blocks: [{ type: "okrobo_see_color", x: 0, y: 0, fields: { COLOR: "red" } }],
        },
      }),
    );
    expect(py).toContain("from okrobo.vision import find_color");
    expect(py).toContain("from okrobo import Robot");
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

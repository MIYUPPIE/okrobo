import * as Blockly from "blockly/core";
import "blockly/blocks";
import * as en from "blockly/msg/en";
import { javascriptGenerator, Order as JsOrder } from "blockly/javascript";
import { Order as PyOrder, pythonGenerator } from "blockly/python";

// OKROBO's Blockly vocabulary. Each block generates two languages:
// JavaScript for execution now (async calls into ProgramRunner.api) and
// Python for the read-only Monaco preview, matching the okrobo package API
// exactly so the same program runs unchanged in Phase 3's real Python.

Blockly.setLocale(en as unknown as { [key: string]: string });

if (!Blockly.Blocks["okrobo_forward"]) {
  Blockly.defineBlocksWithJsonArray([
    {
      type: "okrobo_forward",
      message0: "move forward %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.05, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Drive straight ahead, stopping early at a wall",
    },
    {
      type: "okrobo_backward",
      message0: "move backward %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.05, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Drive straight back, stopping early at a wall",
    },
    {
      type: "okrobo_turn_left",
      message0: "turn left %1 °",
      args0: [{ type: "field_number", name: "DEGREES", value: 90, min: 1, max: 360, precision: 1 }],
      previousStatement: null,
      nextStatement: null,
      colour: 205,
      tooltip: "Rotate in place, counter-clockwise",
    },
    {
      type: "okrobo_turn_right",
      message0: "turn right %1 °",
      args0: [{ type: "field_number", name: "DEGREES", value: 90, min: 1, max: 360, precision: 1 }],
      previousStatement: null,
      nextStatement: null,
      colour: 205,
      tooltip: "Rotate in place, clockwise",
    },
    {
      type: "okrobo_wait",
      message0: "wait %1 s",
      args0: [{ type: "field_number", name: "SECONDS", value: 1, min: 0.1, precision: 0.1 }],
      previousStatement: null,
      nextStatement: null,
      colour: 60,
      tooltip: "Do nothing while simulation time passes",
    },
    {
      type: "okrobo_distance",
      message0: "distance to wall (m)",
      output: "Number",
      colour: 25,
      tooltip: "Meters from the robot's front edge to the wall it is facing",
    },
  ]);
}

javascriptGenerator.forBlock["okrobo_forward"] = (block) =>
  `await robot.forward(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_backward"] = (block) =>
  `await robot.backward(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_turn_left"] = (block) =>
  `await robot.turnLeft(${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_turn_right"] = (block) =>
  `await robot.turnRight(${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_wait"] = (block) =>
  `await robot.wait(${block.getFieldValue("SECONDS")});\n`;
javascriptGenerator.forBlock["okrobo_distance"] = () => ["robot.distance()", JsOrder.FUNCTION_CALL];

pythonGenerator.forBlock["okrobo_forward"] = (block) =>
  `robot.forward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_backward"] = (block) =>
  `robot.backward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_turn_left"] = (block) =>
  `robot.turn_left(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_turn_right"] = (block) =>
  `robot.turn_right(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_wait"] = (block) =>
  `robot.wait(${block.getFieldValue("SECONDS")})\n`;
pythonGenerator.forBlock["okrobo_distance"] = () => ["robot.distance()", PyOrder.FUNCTION_CALL];

export const TOOLBOX = {
  kind: "flyoutToolbox",
  contents: [
    { kind: "block", type: "okrobo_forward" },
    { kind: "block", type: "okrobo_backward" },
    { kind: "block", type: "okrobo_turn_left" },
    { kind: "block", type: "okrobo_turn_right" },
    { kind: "block", type: "okrobo_wait" },
    { kind: "block", type: "okrobo_distance" },
    { kind: "block", type: "controls_if" },
    {
      kind: "block",
      type: "controls_repeat_ext",
      inputs: { TIMES: { shadow: { type: "math_number", fields: { NUM: 4 } } } },
    },
    { kind: "block", type: "controls_whileUntil" },
    { kind: "block", type: "logic_compare" },
    { kind: "block", type: "logic_boolean" },
    { kind: "block", type: "math_number" },
  ],
};

/** The wall avoider from docs/vision.md, preloaded so Run works on first open. */
export const STARTER_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "controls_whileUntil",
        x: 24,
        y: 24,
        fields: { MODE: "WHILE" },
        inputs: {
          BOOL: { block: { type: "logic_boolean", fields: { BOOL: "TRUE" } } },
          DO: {
            block: {
              type: "okrobo_forward",
              fields: { METERS: 0.05 },
              next: {
                block: {
                  type: "controls_if",
                  inputs: {
                    IF0: {
                      block: {
                        type: "logic_compare",
                        fields: { OP: "LT" },
                        inputs: {
                          A: { block: { type: "okrobo_distance" } },
                          B: { block: { type: "math_number", fields: { NUM: 0.2 } } },
                        },
                      },
                    },
                    DO0: { block: { type: "okrobo_turn_left", fields: { DEGREES: 90 } } },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};

export function generateJavaScript(workspace: Blockly.Workspace): string {
  // Every loop iteration awaits a checkpoint: Stop can always interrupt and
  // `while (true)` can never freeze the UI.
  javascriptGenerator.INFINITE_LOOP_TRAP = "await robot._checkpoint();\n";
  return javascriptGenerator.workspaceToCode(workspace);
}

const PYTHON_HEADER = "from okrobo import Robot\n\nrobot = Robot()\n\n";

export function generatePython(workspace: Blockly.Workspace): string {
  return PYTHON_HEADER + pythonGenerator.workspaceToCode(workspace);
}

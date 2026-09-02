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
    {
      type: "okrobo_arm_move",
      message0: "move %1 to %2 °",
      args0: [
        {
          type: "field_dropdown",
          name: "JOINT",
          options: [
            ["base", "base"],
            ["shoulder", "shoulder"],
            ["elbow", "elbow"],
            ["wrist", "wrist"],
          ],
        },
        { type: "field_number", name: "DEGREES", value: 45, min: -180, max: 180, precision: 1 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 290,
      tooltip: "Move one arm joint to an absolute angle and wait until it arrives",
    },
    {
      type: "okrobo_arm_tip_height",
      message0: "tip height (m)",
      output: "Number",
      colour: 25,
      tooltip: "How high the arm's tip is above the ground",
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
javascriptGenerator.forBlock["okrobo_arm_move"] = (block) =>
  `await robot.armMove("${block.getFieldValue("JOINT")}", ${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_arm_tip_height"] = () => [
  "robot.armTip()[2]",
  JsOrder.MEMBER,
];

pythonGenerator.forBlock["okrobo_forward"] = (block) =>
  `robot.forward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_backward"] = (block) =>
  `robot.backward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_turn_left"] = (block) =>
  `robot.turn_left(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_turn_right"] = (block) =>
  `robot.turn_right(${block.getFieldValue("DEGREES")})\n`;
// The wait block is shared between robots; its Python receiver depends on
// which program is being generated (set by generatePython).
let pythonReceiver = "robot";
pythonGenerator.forBlock["okrobo_wait"] = (block) =>
  `${pythonReceiver}.wait(${block.getFieldValue("SECONDS")})\n`;
pythonGenerator.forBlock["okrobo_distance"] = () => ["robot.distance()", PyOrder.FUNCTION_CALL];
pythonGenerator.forBlock["okrobo_arm_move"] = (block) =>
  `arm.move("${block.getFieldValue("JOINT")}", ${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_arm_tip_height"] = () => ["arm.tip()[2]", PyOrder.MEMBER];

export type RobotKind = "car" | "arm";

const COMMON_TOOLBOX_TAIL = [
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
];

export const TOOLBOX = {
  kind: "flyoutToolbox",
  contents: [
    { kind: "block", type: "okrobo_forward" },
    { kind: "block", type: "okrobo_backward" },
    { kind: "block", type: "okrobo_turn_left" },
    { kind: "block", type: "okrobo_turn_right" },
    { kind: "block", type: "okrobo_wait" },
    { kind: "block", type: "okrobo_distance" },
    ...COMMON_TOOLBOX_TAIL,
  ],
};

export const ARM_TOOLBOX = {
  kind: "flyoutToolbox",
  contents: [
    { kind: "block", type: "okrobo_arm_move" },
    { kind: "block", type: "okrobo_wait" },
    { kind: "block", type: "okrobo_arm_tip_height" },
    ...COMMON_TOOLBOX_TAIL,
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

/** A little wave: the arm sweeps its shoulder up and down three times. */
export const ARM_STARTER_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "controls_repeat_ext",
        x: 24,
        y: 24,
        inputs: {
          TIMES: { shadow: { type: "math_number", fields: { NUM: 3 } } },
          DO: {
            block: {
              type: "okrobo_arm_move",
              fields: { JOINT: "shoulder", DEGREES: 85 },
              next: {
                block: {
                  type: "okrobo_arm_move",
                  fields: { JOINT: "shoulder", DEGREES: 35 },
                  next: {
                    block: { type: "okrobo_arm_move", fields: { JOINT: "base", DEGREES: 45 } },
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

export function starterWorkspace(robot: RobotKind): object {
  return robot === "arm" ? ARM_STARTER_WORKSPACE : STARTER_WORKSPACE;
}

export function toolboxFor(robot: RobotKind): Blockly.utils.toolbox.ToolboxDefinition {
  return (robot === "arm" ? ARM_TOOLBOX : TOOLBOX) as Blockly.utils.toolbox.ToolboxDefinition;
}

export function generateJavaScript(workspace: Blockly.Workspace): string {
  // Every loop iteration awaits a checkpoint: Stop can always interrupt and
  // `while (true)` can never freeze the UI.
  javascriptGenerator.INFINITE_LOOP_TRAP = "await robot._checkpoint();\n";
  return javascriptGenerator.workspaceToCode(workspace);
}

const PYTHON_HEADERS: Record<RobotKind, string> = {
  car: "from okrobo import Robot\n\nrobot = Robot()\n\n",
  arm: "from okrobo import Arm\n\narm = Arm()\n\n",
};

export function generatePython(workspace: Blockly.Workspace, robot: RobotKind = "car"): string {
  pythonReceiver = robot === "arm" ? "arm" : "robot";
  const body = pythonGenerator.workspaceToCode(workspace);
  pythonReceiver = "robot";
  return PYTHON_HEADERS[robot] + body;
}

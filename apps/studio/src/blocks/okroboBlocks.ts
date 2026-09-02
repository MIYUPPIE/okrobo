import * as Blockly from "blockly/core";
import "blockly/blocks";
import * as en from "blockly/msg/en";
import { javascriptGenerator, JavascriptGenerator, Order as JsOrder } from "blockly/javascript";
import { Order as PyOrder, pythonGenerator } from "blockly/python";
import { COLORS } from "../lib/vision";

// OKROBO's Blockly vocabulary. Each block generates up to three languages:
// JavaScript for execution now (async calls into ProgramRunner.api), Python
// for the read-only Monaco preview (matching the okrobo package API exactly
// so the same program runs unchanged in Phase 3's real Python), and for the
// Car, C++ for the read-only preview against engine/api/robot.hpp — real,
// compilable code (see its README), just not runnable in-browser.

Blockly.setLocale(en as unknown as { [key: string]: string });

// One source of truth for the colours a vision block can ask for — the same
// names okrobo.vision.COLORS and lib/vision.ts's COLORS recognize.
const COLOR_DROPDOWN_OPTIONS: Array<[string, string]> = Object.keys(COLORS).map((name) => [name, name]);

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
      type: "okrobo_lidar_min",
      message0: "closest object anywhere (m)",
      output: "Number",
      colour: 25,
      tooltip: "Shortest distance to anything in the 9-ray, 180° lidar scan ahead",
    },
    {
      type: "okrobo_see_color",
      message0: "sees %1 object?",
      args0: [{ type: "field_dropdown", name: "COLOR", options: COLOR_DROPDOWN_OPTIONS }],
      output: "Boolean",
      colour: 300,
      tooltip: "Whether the camera currently sees that colour",
    },
    {
      type: "okrobo_color_bearing",
      message0: "bearing to %1 object (°)",
      args0: [{ type: "field_dropdown", name: "COLOR", options: COLOR_DROPDOWN_OPTIONS }],
      output: "Number",
      colour: 300,
      tooltip: "Degrees from straight ahead to that colour; negative is left, positive is right. 0 if not seen",
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
    {
      type: "okrobo_drone_takeoff",
      message0: "takeoff to %1 m",
      args0: [{ type: "field_number", name: "HEIGHT", value: 0.4, min: 0.1, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Rise straight up to this altitude",
    },
    {
      type: "okrobo_drone_land",
      message0: "land",
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Descend straight down to the ground",
    },
    {
      type: "okrobo_drone_forward",
      message0: "fly forward %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.1, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Fly straight ahead, stopping early at a wall",
    },
    {
      type: "okrobo_drone_backward",
      message0: "fly backward %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.1, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Fly straight back, stopping early at a wall",
    },
    {
      type: "okrobo_drone_up",
      message0: "rise %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.1, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Rise, stopping early at the altitude ceiling",
    },
    {
      type: "okrobo_drone_down",
      message0: "descend %1 m",
      args0: [{ type: "field_number", name: "METERS", value: 0.1, min: 0.01, precision: 0.01 }],
      previousStatement: null,
      nextStatement: null,
      colour: 140,
      tooltip: "Descend, stopping early at the ground",
    },
    {
      type: "okrobo_drone_turn_left",
      message0: "turn left %1 °",
      args0: [{ type: "field_number", name: "DEGREES", value: 90, min: 1, max: 360, precision: 1 }],
      previousStatement: null,
      nextStatement: null,
      colour: 205,
      tooltip: "Rotate in place, counter-clockwise",
    },
    {
      type: "okrobo_drone_turn_right",
      message0: "turn right %1 °",
      args0: [{ type: "field_number", name: "DEGREES", value: 90, min: 1, max: 360, precision: 1 }],
      previousStatement: null,
      nextStatement: null,
      colour: 205,
      tooltip: "Rotate in place, clockwise",
    },
    {
      type: "okrobo_drone_altitude",
      message0: "altitude (m)",
      output: "Number",
      colour: 25,
      tooltip: "Meters above the ground",
    },
    {
      type: "okrobo_drone_distance",
      message0: "distance to wall (m)",
      output: "Number",
      colour: 25,
      tooltip: "Meters from the drone to the wall it is facing (it flies above obstacles)",
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
javascriptGenerator.forBlock["okrobo_lidar_min"] = () => ["Math.min(...robot.lidar())", JsOrder.FUNCTION_CALL];
javascriptGenerator.forBlock["okrobo_see_color"] = (block) => [
  `robot.findColor(${JSON.stringify(block.getFieldValue("COLOR"))}) !== null`,
  JsOrder.EQUALITY,
];
javascriptGenerator.forBlock["okrobo_color_bearing"] = (block) => [
  `(robot.findColor(${JSON.stringify(block.getFieldValue("COLOR"))})?.bearing ?? 0)`,
  JsOrder.FUNCTION_CALL,
];
javascriptGenerator.forBlock["okrobo_arm_move"] = (block) =>
  `await robot.armMove("${block.getFieldValue("JOINT")}", ${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_arm_tip_height"] = () => [
  "robot.armTip()[2]",
  JsOrder.MEMBER,
];
javascriptGenerator.forBlock["okrobo_drone_takeoff"] = (block) =>
  `await robot.droneTakeoff(${block.getFieldValue("HEIGHT")});\n`;
javascriptGenerator.forBlock["okrobo_drone_land"] = () => `await robot.droneLand();\n`;
javascriptGenerator.forBlock["okrobo_drone_forward"] = (block) =>
  `await robot.droneForward(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_drone_backward"] = (block) =>
  `await robot.droneBackward(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_drone_up"] = (block) =>
  `await robot.droneUp(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_drone_down"] = (block) =>
  `await robot.droneDown(${block.getFieldValue("METERS")});\n`;
javascriptGenerator.forBlock["okrobo_drone_turn_left"] = (block) =>
  `await robot.droneTurnLeft(${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_drone_turn_right"] = (block) =>
  `await robot.droneTurnRight(${block.getFieldValue("DEGREES")});\n`;
javascriptGenerator.forBlock["okrobo_drone_altitude"] = () => ["robot.droneAltitude()", JsOrder.FUNCTION_CALL];
javascriptGenerator.forBlock["okrobo_drone_distance"] = () => ["robot.droneDistance()", JsOrder.FUNCTION_CALL];

pythonGenerator.forBlock["okrobo_forward"] = (block) =>
  `robot.forward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_backward"] = (block) =>
  `robot.backward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_turn_left"] = (block) =>
  `robot.turn_left(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_turn_right"] = (block) =>
  `robot.turn_right(${block.getFieldValue("DEGREES")})\n`;
// okrobo_wait is shared across all three robots; each generator's receiver
// depends on which program is being generated (set by generatePython /
// generateCpp). Car's student-facing variable is named "robot", not "car" --
// the one place this map isn't just the identity function.
const RECEIVER_BY_ROBOT: Record<RobotKind, string> = { car: "robot", arm: "arm", drone: "drone" };

let pythonReceiver = "robot";
pythonGenerator.forBlock["okrobo_wait"] = (block) =>
  `${pythonReceiver}.wait(${block.getFieldValue("SECONDS")})\n`;
pythonGenerator.forBlock["okrobo_distance"] = () => ["robot.distance()", PyOrder.FUNCTION_CALL];
pythonGenerator.forBlock["okrobo_lidar_min"] = () => ["min(robot.lidar())", PyOrder.FUNCTION_CALL];
pythonGenerator.forBlock["okrobo_see_color"] = (block) => [
  `find_color(robot.camera(), "${block.getFieldValue("COLOR")}") is not None`,
  PyOrder.RELATIONAL,
];
pythonGenerator.forBlock["okrobo_color_bearing"] = (block) => [
  `(d.bearing if (d := find_color(robot.camera(), "${block.getFieldValue("COLOR")}")) else 0)`,
  PyOrder.CONDITIONAL,
];
pythonGenerator.forBlock["okrobo_arm_move"] = (block) =>
  `arm.move("${block.getFieldValue("JOINT")}", ${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_arm_tip_height"] = () => ["arm.tip()[2]", PyOrder.MEMBER];
pythonGenerator.forBlock["okrobo_drone_takeoff"] = (block) =>
  `drone.takeoff(${block.getFieldValue("HEIGHT")})\n`;
pythonGenerator.forBlock["okrobo_drone_land"] = () => `drone.land()\n`;
pythonGenerator.forBlock["okrobo_drone_forward"] = (block) =>
  `drone.forward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_drone_backward"] = (block) =>
  `drone.backward(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_drone_up"] = (block) => `drone.up(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_drone_down"] = (block) => `drone.down(${block.getFieldValue("METERS")})\n`;
pythonGenerator.forBlock["okrobo_drone_turn_left"] = (block) =>
  `drone.turn_left(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_drone_turn_right"] = (block) =>
  `drone.turn_right(${block.getFieldValue("DEGREES")})\n`;
pythonGenerator.forBlock["okrobo_drone_altitude"] = () => ["drone.altitude()", PyOrder.FUNCTION_CALL];
pythonGenerator.forBlock["okrobo_drone_distance"] = () => ["drone.distance()", PyOrder.FUNCTION_CALL];

// ---- C++: real code against engine/api/{robot,arm,drone}.hpp ------------
//
// Blockly ships no C++ generator, but its JavaScript one already emits
// valid C++ for every control/logic/math block the toolbox uses --
// `if (a < b) { }`, `while (true) { }`, comparisons, booleans, numeric
// literals are identical in both languages. controls_repeat_ext is the one
// exception (`for (var count = ...`, and C++ has no `var`), overridden
// below by patching the borrowed output rather than reimplementing
// Blockly's own collision-safe loop-variable naming. Verified against the
// real generator's output, not assumed from the languages' similarity.
const cppGenerator = new JavascriptGenerator("Cpp");
for (const type of ["controls_if", "controls_whileUntil", "logic_compare", "logic_boolean", "math_number"]) {
  cppGenerator.forBlock[type] = javascriptGenerator.forBlock[type];
}
cppGenerator.forBlock["controls_repeat_ext"] = (block, generator) => {
  const code = javascriptGenerator.forBlock["controls_repeat_ext"](block, generator);
  return (code as string).replace(/^for \(var /, "for (int ");
};

cppGenerator.forBlock["okrobo_forward"] = (block) =>
  `robot.forward(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_backward"] = (block) =>
  `robot.backward(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_turn_left"] = (block) =>
  `robot.turn_left(${block.getFieldValue("DEGREES")});\n`;
cppGenerator.forBlock["okrobo_turn_right"] = (block) =>
  `robot.turn_right(${block.getFieldValue("DEGREES")});\n`;
// okrobo_wait is shared across all three robots; its C++ receiver depends on
// which program is being generated (set by generateCpp), the same pattern
// pythonReceiver already uses for the Python generator.
let cppReceiver = "robot";
cppGenerator.forBlock["okrobo_wait"] = (block) =>
  `${cppReceiver}.wait(${block.getFieldValue("SECONDS")});\n`;
cppGenerator.forBlock["okrobo_distance"] = () => ["robot.distance()", JsOrder.FUNCTION_CALL];
// lidar() has been on Robot since robot.hpp shipped; find_color() is new
// (engine/api/vision.hpp). generateCpp adds the extra #includes these two
// need (<algorithm>, "vision.hpp") only when the workspace actually uses them.
cppGenerator.forBlock["okrobo_lidar_min"] = () => [
  "*std::min_element(robot.lidar().begin(), robot.lidar().end())",
  JsOrder.FUNCTION_CALL,
];
cppGenerator.forBlock["okrobo_see_color"] = (block) => [
  `okrobo::find_color(robot.camera(), ${JSON.stringify(block.getFieldValue("COLOR"))}).has_value()`,
  JsOrder.FUNCTION_CALL,
];
cppGenerator.forBlock["okrobo_color_bearing"] = (block) => [
  `okrobo::find_color(robot.camera(), ${JSON.stringify(block.getFieldValue("COLOR"))}).value_or(okrobo::Detection{}).bearing`,
  JsOrder.MEMBER,
];
cppGenerator.forBlock["okrobo_arm_move"] = (block) =>
  `arm.move("${block.getFieldValue("JOINT")}", ${block.getFieldValue("DEGREES")});\n`;
cppGenerator.forBlock["okrobo_arm_tip_height"] = () => ["std::get<2>(arm.tip())", JsOrder.FUNCTION_CALL];
cppGenerator.forBlock["okrobo_drone_takeoff"] = (block) =>
  `drone.takeoff(${block.getFieldValue("HEIGHT")});\n`;
cppGenerator.forBlock["okrobo_drone_land"] = () => `drone.land();\n`;
cppGenerator.forBlock["okrobo_drone_forward"] = (block) =>
  `drone.forward(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_drone_backward"] = (block) =>
  `drone.backward(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_drone_up"] = (block) => `drone.up(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_drone_down"] = (block) => `drone.down(${block.getFieldValue("METERS")});\n`;
cppGenerator.forBlock["okrobo_drone_turn_left"] = (block) =>
  `drone.turn_left(${block.getFieldValue("DEGREES")});\n`;
cppGenerator.forBlock["okrobo_drone_turn_right"] = (block) =>
  `drone.turn_right(${block.getFieldValue("DEGREES")});\n`;
cppGenerator.forBlock["okrobo_drone_altitude"] = () => ["drone.altitude()", JsOrder.FUNCTION_CALL];
cppGenerator.forBlock["okrobo_drone_distance"] = () => ["drone.distance()", JsOrder.FUNCTION_CALL];

const CPP_INCLUDE_BY_ROBOT: Record<RobotKind, string> = {
  car: '#include "robot.hpp"\n',
  arm: '#include "arm.hpp"\n',
  drone: '#include "drone.hpp"\n',
};
const CPP_MAIN_BY_ROBOT: Record<RobotKind, string> = {
  car: "int main() {\n  okrobo::Robot robot;\n\n",
  arm: "int main() {\n  okrobo::Arm arm;\n\n",
  drone: "int main() {\n  okrobo::Drone drone;\n\n",
};
const LIDAR_BLOCK_TYPES = ["okrobo_lidar_min"];

export function generateCpp(workspace: Blockly.Workspace, robot: RobotKind = "car"): string {
  cppReceiver = RECEIVER_BY_ROBOT[robot];
  const body = cppGenerator.workspaceToCode(workspace);
  cppReceiver = "robot";
  // 2 spaces, matching the borrowed JS generator's own internal indent width
  // (Blockly's default), so nested block bodies stay evenly stepped.
  const indented = body
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n")
    .replace(/\n+$/, "\n");

  const usesBlock = (types: string[]) =>
    types.some((type) => workspace.getBlocksByType(type, false).length > 0);
  // <algorithm> and vision.hpp are only pulled in when the workspace
  // actually uses lidar/vision (Car only), so a plain move/turn program's
  // preview doesn't grow unused includes.
  let includes = CPP_INCLUDE_BY_ROBOT[robot];
  if (robot === "car" && usesBlock(LIDAR_BLOCK_TYPES)) includes += "#include <algorithm>\n";
  if (robot === "car" && usesBlock(VISION_BLOCK_TYPES)) includes += '#include "vision.hpp"\n';

  return `${includes}\n${CPP_MAIN_BY_ROBOT[robot]}${indented}\n  return 0;\n}\n`;
}

export type RobotKind = "car" | "arm" | "drone";

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
    { kind: "block", type: "okrobo_lidar_min" },
    { kind: "block", type: "okrobo_see_color" },
    { kind: "block", type: "okrobo_color_bearing" },
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

export const DRONE_TOOLBOX = {
  kind: "flyoutToolbox",
  contents: [
    { kind: "block", type: "okrobo_drone_takeoff" },
    { kind: "block", type: "okrobo_drone_land" },
    { kind: "block", type: "okrobo_drone_forward" },
    { kind: "block", type: "okrobo_drone_backward" },
    { kind: "block", type: "okrobo_drone_up" },
    { kind: "block", type: "okrobo_drone_down" },
    { kind: "block", type: "okrobo_drone_turn_left" },
    { kind: "block", type: "okrobo_drone_turn_right" },
    { kind: "block", type: "okrobo_wait" },
    { kind: "block", type: "okrobo_drone_altitude" },
    { kind: "block", type: "okrobo_drone_distance" },
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

/** Takeoff, fly a 0.3 m square (four forward-and-turn legs), land. Traces
 * back to its start point, well inside the shared 2x2 m arena. */
export const DRONE_STARTER_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "okrobo_drone_takeoff",
        x: 24,
        y: 24,
        fields: { HEIGHT: 0.4 },
        next: {
          block: {
            type: "controls_repeat_ext",
            inputs: {
              TIMES: { shadow: { type: "math_number", fields: { NUM: 4 } } },
              DO: {
                block: {
                  type: "okrobo_drone_forward",
                  fields: { METERS: 0.3 },
                  next: {
                    block: { type: "okrobo_drone_turn_right", fields: { DEGREES: 90 } },
                  },
                },
              },
            },
            next: { block: { type: "okrobo_drone_land" } },
          },
        },
      },
    ],
  },
};

export function starterWorkspace(robot: RobotKind): object {
  if (robot === "arm") return ARM_STARTER_WORKSPACE;
  if (robot === "drone") return DRONE_STARTER_WORKSPACE;
  return STARTER_WORKSPACE;
}

export function toolboxFor(robot: RobotKind): Blockly.utils.toolbox.ToolboxDefinition {
  const toolbox = robot === "arm" ? ARM_TOOLBOX : robot === "drone" ? DRONE_TOOLBOX : TOOLBOX;
  return toolbox as Blockly.utils.toolbox.ToolboxDefinition;
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
  drone: "from okrobo import Drone\n\ndrone = Drone()\n\n",
};

const VISION_BLOCK_TYPES = ["okrobo_see_color", "okrobo_color_bearing"];

export function generatePython(workspace: Blockly.Workspace, robot: RobotKind = "car"): string {
  pythonReceiver = RECEIVER_BY_ROBOT[robot];
  const body = pythonGenerator.workspaceToCode(workspace);
  pythonReceiver = "robot";
  // Only import find_color when a vision block is actually on the workspace,
  // so a plain move/turn program's preview doesn't grow an unused import.
  const usesVision = VISION_BLOCK_TYPES.some(
    (type) => workspace.getBlocksByType(type, false).length > 0,
  );
  if (robot === "car" && usesVision) {
    return PYTHON_HEADERS.car.replace(
      "from okrobo import Robot\n",
      "from okrobo import Robot\nfrom okrobo.vision import find_color\n",
    ) + body;
  }
  return PYTHON_HEADERS[robot] + body;
}

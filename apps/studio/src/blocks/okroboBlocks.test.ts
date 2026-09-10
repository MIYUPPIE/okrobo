import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Blockly from "blockly/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARM_STARTER_WORKSPACE,
  ARM_TOOLBOX,
  BUILT_STARTER_WORKSPACE,
  BUILT_TOOLBOX,
  DRONE_STARTER_WORKSPACE,
  DRONE_TOOLBOX,
  generateCpp,
  generateJavaScript,
  generatePython,
  setBuiltRobotFields,
  STARTER_WORKSPACE,
  starterWorkspace,
  TOOLBOX,
  toolboxFor,
} from "./okroboBlocks";

const ENGINE_DIR = join(process.cwd(), "..", "..", "engine");
// Arm.grip()/release() needs PhysicsObject, which needs MuJoCo (real
// gravity/contact once released) — see scripts/build-mujoco-native.sh.
const MUJOCO_DIR = join(process.cwd(), "..", "..", "tools", "mujoco");
const MUJOCO_LIBS = ["-lmujoco", "-lccd", "-lqhullstatic_r", "-llodepng", "-ltinyxml2", "-ltinyobjloader"];

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

  it("generates the matching C++ preview against engine/api/robot.hpp", () => {
    const cpp = generateCpp(loadStarter());
    expect(cpp).toContain('#include "robot.hpp"');
    expect(cpp).toContain("okrobo::Robot robot;");
    expect(cpp).toContain("while (true) {");
    expect(cpp).toContain("robot.forward(0.05);");
    expect(cpp).toContain("if (robot.distance() < 0.2) {");
    expect(cpp).toContain("robot.turn_left(90);");
    expect(cpp).not.toContain("await");
    expect(cpp).not.toContain("var ");
  });

  it("C++ preview generates real lidar/vision code against engine/api/vision.hpp", () => {
    const cpp = generateCpp(
      load({
        blocks: {
          languageVersion: 0,
          blocks: [
            { type: "okrobo_lidar_min", x: 0, y: 0 },
            { type: "okrobo_see_color", x: 0, y: 40, fields: { COLOR: "red" } },
            { type: "okrobo_color_bearing", x: 0, y: 80, fields: { COLOR: "blue" } },
          ],
        },
      }),
    );
    expect(cpp).toContain("#include <algorithm>");
    expect(cpp).toContain('#include "vision.hpp"');
    expect(cpp).toContain("*std::min_element(robot.lidar().begin(), robot.lidar().end())");
    expect(cpp).toContain('okrobo::find_color(robot.camera(), "red").has_value()');
    expect(cpp).toContain('okrobo::find_color(robot.camera(), "blue").value_or(okrobo::Detection{}).bearing');
  });

  it("C++ preview omits <algorithm>/vision.hpp when the workspace doesn't use lidar or vision", () => {
    const cpp = generateCpp(load(STARTER_WORKSPACE));
    expect(cpp).not.toContain("<algorithm>");
    expect(cpp).not.toContain("vision.hpp");
  });

  it(
    "the generated vision C++ actually compiles, runs, and finds a real obstacle",
    () => {
      // "if sees red, back up" -- a lone see_color/color_bearing block can't
      // be a top-level statement (they're value blocks with no
      // previousStatement), so nest them the same way the wall avoider
      // nests okrobo_distance inside logic_compare inside controls_if.
      const cpp = generateCpp(
        load({
          blocks: {
            languageVersion: 0,
            blocks: [
              {
                type: "controls_if",
                x: 0,
                y: 0,
                inputs: {
                  IF0: { block: { type: "okrobo_see_color", fields: { COLOR: "red" } } },
                  DO0: { block: { type: "okrobo_backward", fields: { METERS: 0.1 } } },
                },
              },
            ],
          },
        }),
      );
      expect(cpp).toContain('if (okrobo::find_color(robot.camera(), "red").has_value()) {');

      const dir = mkdtempSync(join(tmpdir(), "okrobo-cpp-"));
      const source = join(dir, "program.cpp");
      const binary = join(dir, "program");
      writeFileSync(
        source,
        cpp
          .replace('#include "robot.hpp"', '#include <cstdio>\n#include "robot.hpp"')
          .replace(
            "okrobo::Robot robot;",
            "okrobo::Robot robot;\n" +
              "  okrobo::Obstacle box;\n" +
              "  box.x = 1.6; box.y = 1.0; box.width = 0.2; box.height = 0.2;\n" +
              "  box.r = 220; box.g = 40; box.b = 40;\n" +
              "  robot.engine().add_obstacle(box);\n" +
              "  auto target = okrobo::find_color(robot.camera(), \"red\");\n" +
              '  std::printf("bearing=%.2f area=%d\\n", target->bearing, target->area);',
          )
          .replace(
            "return 0;",
            'auto [x, y] = robot.position(); std::printf("x=%.2f\\n", x); return 0;',
          ),
      );
      execFileSync("g++", [
        "-std=c++17",
        "-I",
        join(ENGINE_DIR, "src"),
        "-I",
        join(ENGINE_DIR, "api"),
        source,
        join(ENGINE_DIR, "src", "world.cpp"),
        "-o",
        binary,
      ]);
      const output = execFileSync(binary, { encoding: "utf8", timeout: 5000 }).trim().split("\n");
      // Matches test_vision_api.cpp's world_with_box() numbers exactly: a
      // box at (1.6, 1.0) from a robot at (1.0, 1.0) is dead ahead.
      expect(output[0]).toBe("bearing=0.00 area=1152");
      // The block program saw it and backed up 0.1 m, as its `if` said to.
      expect(output[1]).toBe("x=0.90");
    },
    20000,
  );

  it(
    "the generated C++ actually compiles and runs correctly, matching the sim",
    () => {
      const cpp = generateCpp(
        load({
          blocks: {
            languageVersion: 0,
            blocks: [
              {
                type: "okrobo_forward",
                x: 0,
                y: 0,
                fields: { METERS: 0.3 },
                next: { block: { type: "okrobo_turn_left", fields: { DEGREES: 90 } } },
              },
            ],
          },
        }),
      );
      const dir = mkdtempSync(join(tmpdir(), "okrobo-cpp-"));
      const source = join(dir, "program.cpp");
      const binary = join(dir, "program");
      writeFileSync(
        source,
        cpp
          .replace('#include "robot.hpp"', '#include <cstdio>\n#include "robot.hpp"')
          .replace(
            "return 0;",
            'auto [x, y] = robot.position(); ' +
              'std::printf("%.2f %.2f %.0f\\n", x, y, robot.heading()); return 0;',
          ),
      );
      execFileSync("g++", [
        "-std=c++17",
        "-I",
        join(ENGINE_DIR, "src"),
        "-I",
        join(ENGINE_DIR, "api"),
        source,
        join(ENGINE_DIR, "src", "world.cpp"),
        "-o",
        binary,
      ]);
      const output = execFileSync(binary, { encoding: "utf8", timeout: 5000 }).trim();
      // Forward 0.3m from arena centre (1.0, 1.0) reaches (1.3, 1.0), then
      // turning left 90 degrees changes heading only: matches
      // test_robot.py/test_robot_api.cpp's numbers for the same sequence.
      expect(output).toBe("1.30 1.00 90");
    },
    20000,
  );

  it("generates the arm wave and pick-and-place in JavaScript against the runner API", () => {
    const js = generateJavaScript(load(ARM_STARTER_WORKSPACE));
    expect(js).toContain('await robot.armMove("shoulder", 85);');
    expect(js).toContain('await robot.armMove("base", 45);');
    expect(js).toContain("for (");
    expect(js).toContain("robot.armGrip();");
    expect(js).toContain("robot.armRelease();");
  });

  it("generates the arm wave and pick-and-place in Python against the okrobo Arm API", () => {
    const py = generatePython(load(ARM_STARTER_WORKSPACE), "arm");
    expect(py).toContain("from okrobo import Arm");
    expect(py).toContain("arm = Arm()");
    expect(py).toContain('arm.move("shoulder", 85)');
    expect(py).toContain("arm.grip()");
    expect(py).toContain("arm.release()");
    expect(py).not.toContain("robot.");
  });

  it("generates the arm wave and pick-and-place in C++ against engine/api/arm.hpp", () => {
    const cpp = generateCpp(load(ARM_STARTER_WORKSPACE), "arm");
    expect(cpp).toContain('#include "arm.hpp"');
    expect(cpp).toContain("okrobo::Arm arm;");
    expect(cpp).toContain('arm.move("shoulder", 85);');
    expect(cpp).toContain('arm.move("base", 45);');
    expect(cpp).toContain("for (int count = 0; count < 3; count++) {");
    expect(cpp).toContain("arm.grip();");
    expect(cpp).toContain("arm.release();");
    expect(cpp).not.toContain("robot.");
    expect(cpp).not.toContain("var ");
  });

  it(
    "the generated arm C++ actually compiles and runs the wave AND the pick-and-place, matching the sim",
    () => {
      const cpp = generateCpp(load(ARM_STARTER_WORKSPACE), "arm");
      const dir = mkdtempSync(join(tmpdir(), "okrobo-cpp-"));
      const source = join(dir, "program.cpp");
      const binary = join(dir, "program");
      writeFileSync(
        source,
        cpp
          .replace('#include "arm.hpp"', '#include <cstdio>\n#include "arm.hpp"')
          .replace(
            "return 0;",
            'auto [tx, ty, tz] = arm.tip(); auto [ox, oy, oz] = arm.object(); ' +
              'std::printf("%.2f %.2f %.2f %.2f %.2f %.2f\\n", tx, ty, tz, ox, oy, oz); return 0;',
          ),
      );
      execFileSync("g++", [
        "-std=c++20",
        "-I",
        join(ENGINE_DIR, "src"),
        "-I",
        join(ENGINE_DIR, "api"),
        "-I",
        join(MUJOCO_DIR, "include"),
        source,
        join(ENGINE_DIR, "src", "arm_world.cpp"),
        join(ENGINE_DIR, "src", "physics_object.cpp"),
        "-L",
        join(MUJOCO_DIR, "build-native", "lib"),
        ...MUJOCO_LIBS,
        `-Wl,-rpath,${join(MUJOCO_DIR, "build-native", "lib")}`,
        "-o",
        binary,
      ]);
      const output = execFileSync(binary, { encoding: "utf8", timeout: 5000 }).trim();
      // Tip ends where the pick-and-place sequence left it (base swung to
      // 90 after gripping); object ends where it was set down -- released
      // from the tip's position, fell, and settled on the floor.
      expect(output).toBe("0.00 0.30 0.06 0.00 0.30 0.03");
    },
    20000,
  );

  const GRIP_RELEASE_WORKSPACE = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "okrobo_arm_move",
          x: 24,
          y: 24,
          fields: { JOINT: "shoulder", DEGREES: 50 },
          next: {
            block: {
              type: "okrobo_arm_move",
              fields: { JOINT: "elbow", DEGREES: -104 },
              next: {
                block: {
                  type: "okrobo_arm_move",
                  fields: { JOINT: "wrist", DEGREES: -2 },
                  next: {
                    block: {
                      type: "okrobo_arm_grip",
                      next: { block: { type: "okrobo_arm_release" } },
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

  it("generates grip/release in C++ against engine/api/arm.hpp", () => {
    const cpp = generateCpp(load(GRIP_RELEASE_WORKSPACE), "arm");
    expect(cpp).toContain("arm.move(\"shoulder\", 50);");
    expect(cpp).toContain("arm.grip();");
    expect(cpp).toContain("arm.release();");
  });

  it(
    "the generated grip/release C++ actually compiles and drops the object, which really falls",
    () => {
      const cpp = generateCpp(load(GRIP_RELEASE_WORKSPACE), "arm");
      const dir = mkdtempSync(join(tmpdir(), "okrobo-cpp-"));
      const source = join(dir, "program.cpp");
      const binary = join(dir, "program");
      writeFileSync(
        source,
        cpp
          .replace('#include "arm.hpp"', '#include <cstdio>\n#include "arm.hpp"')
          .replace(
            "return 0;",
            'arm.wait(1.5); auto [x, y, z] = arm.object(); ' +
              'std::printf("%.2f %.2f %.2f\\n", x, y, z); return 0;',
          ),
      );
      execFileSync("g++", [
        "-std=c++20",
        "-I",
        join(ENGINE_DIR, "src"),
        "-I",
        join(ENGINE_DIR, "api"),
        "-I",
        join(MUJOCO_DIR, "include"),
        source,
        join(ENGINE_DIR, "src", "arm_world.cpp"),
        join(ENGINE_DIR, "src", "physics_object.cpp"),
        "-L",
        join(MUJOCO_DIR, "build-native", "lib"),
        ...MUJOCO_LIBS,
        `-Wl,-rpath,${join(MUJOCO_DIR, "build-native", "lib")}`,
        "-o",
        binary,
      ]);
      const output = execFileSync(binary, { encoding: "utf8", timeout: 5000 }).trim();
      // Gripped at the tip (~0.30, 0, 0.06), released, and settled on the
      // floor at the box's half-extent -- a real fall under real gravity.
      expect(output).toBe("0.30 0.00 0.03");
    },
    20000,
  );

  it("generates the drone square flight in JavaScript against the runner API", () => {
    const js = generateJavaScript(load(DRONE_STARTER_WORKSPACE));
    expect(js).toContain("await robot.droneTakeoff(0.4);");
    expect(js).toContain("for (");
    expect(js).toContain("await robot.droneForward(0.3);");
    expect(js).toContain("await robot.droneTurnRight(90);");
    expect(js).toContain("await robot.droneLand();");
  });

  it("generates the drone square flight in Python against the okrobo Drone API", () => {
    const py = generatePython(load(DRONE_STARTER_WORKSPACE), "drone");
    expect(py).toContain("from okrobo import Drone");
    expect(py).toContain("drone = Drone()");
    expect(py).toContain("drone.takeoff(0.4)");
    expect(py).toContain("for ");
    expect(py).toContain("drone.forward(0.3)");
    expect(py).toContain("drone.turn_right(90)");
    expect(py).toContain("drone.land()");
    expect(py).not.toContain("robot.");
    expect(py).not.toContain("arm.");
  });

  it("generates the drone square flight in C++ against engine/api/drone.hpp", () => {
    const cpp = generateCpp(load(DRONE_STARTER_WORKSPACE), "drone");
    expect(cpp).toContain('#include "drone.hpp"');
    expect(cpp).toContain("okrobo::Drone drone;");
    expect(cpp).toContain("drone.takeoff(0.4);");
    expect(cpp).toContain("for (int count = 0; count < 4; count++) {");
    expect(cpp).toContain("drone.forward(0.3);");
    expect(cpp).toContain("drone.turn_right(90);");
    expect(cpp).toContain("drone.land();");
    expect(cpp).not.toContain("robot.");
    expect(cpp).not.toContain("arm.");
    expect(cpp).not.toContain("var ");
  });

  it(
    "the generated drone C++ actually compiles and runs, landing back at the start",
    () => {
      const cpp = generateCpp(load(DRONE_STARTER_WORKSPACE), "drone");
      const dir = mkdtempSync(join(tmpdir(), "okrobo-cpp-"));
      const source = join(dir, "program.cpp");
      const binary = join(dir, "program");
      writeFileSync(
        source,
        cpp
          .replace('#include "drone.hpp"', '#include <cstdio>\n#include "drone.hpp"')
          .replace(
            "return 0;",
            'auto [x, y, z] = drone.position(); std::printf("%.2f %.2f %.2f\\n", x, y, z); return 0;',
          ),
      );
      execFileSync("g++", [
        "-std=c++17",
        "-I",
        join(ENGINE_DIR, "src"),
        "-I",
        join(ENGINE_DIR, "api"),
        source,
        join(ENGINE_DIR, "src", "drone_world.cpp"),
        "-o",
        binary,
      ]);
      const output = execFileSync(binary, { encoding: "utf8", timeout: 5000 }).trim();
      // A square flight returns to its start point (1.0, 1.0), landed (z=0):
      // matches the browser E2E check's live result for the same program.
      expect(output).toBe("1.00 1.00 0.00");
    },
    20000,
  );

  it("drone distance and altitude blocks target the drone API, not the car's", () => {
    const sensors = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: "okrobo_drone_altitude", x: 0, y: 0 },
          { type: "okrobo_drone_distance", x: 0, y: 40 },
        ],
      },
    };
    const js = generateJavaScript(load(sensors));
    expect(js).toContain("robot.droneAltitude()");
    expect(js).toContain("robot.droneDistance()");
    expect(js).not.toContain("robot.distance()"); // the car's sensor, not the drone's

    const py = generatePython(load(sensors), "drone");
    expect(py).toContain("drone.altitude()");
    expect(py).toContain("drone.distance()");
  });

  it("wait targets the drone too, sharing the same block as car and arm", () => {
    const waitOnly = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "okrobo_wait", x: 0, y: 0, fields: { SECONDS: 3 } }],
      },
    };
    expect(generatePython(load(waitOnly), "drone")).toContain("drone.wait(3)");
    expect(generateCpp(load(waitOnly), "drone")).toContain("drone.wait(3);");
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
    workspace.dispose();
    expect(generateCpp(load(waitOnly), "arm")).toContain("arm.wait(2);");
    workspace.dispose();
    expect(generateCpp(load(waitOnly), "car")).toContain("robot.wait(2);");
  });
});

describe("built-robot blocks (Robot Builder Phase 6)", () => {
  afterEach(() => setBuiltRobotFields([], []));

  it("falls back to a placeholder, empty-id option when the document has no actuators/sensors", () => {
    setBuiltRobotFields([], []);
    const js = generateJavaScript(
      load({
        blocks: {
          languageVersion: 0,
          blocks: [
            { type: "okrobo_built_set_actuator", x: 0, y: 0, fields: { VALUE: 5 } },
            { type: "okrobo_built_read_sensor", x: 0, y: 40 },
          ],
        },
      }),
    );
    // An empty id (nothing to choose from) is a documented no-op/0, not a
    // runtime error -- see okroboBlocks.ts's forBlock comment.
    expect(js).not.toContain("robot.set(");
    expect(js).toContain("0");
  });

  it("generates JS that calls robot.set(id, value) for a resolved actuator id", () => {
    setBuiltRobotFields([{ id: "wheel_motor", name: "Wheel Motor" }], []);
    const js = generateJavaScript(
      load({
        blocks: {
          languageVersion: 0,
          blocks: [{ type: "okrobo_built_set_actuator", x: 0, y: 0, fields: { ACTUATOR: "wheel_motor", VALUE: 0.5 } }],
        },
      }),
    );
    expect(js).toContain('robot.set("wheel_motor", 0.5);');
  });

  it("generates JS that calls robot.read(id)[0] for a resolved sensor id", () => {
    setBuiltRobotFields([], [{ id: "front_lidar", name: "Front Lidar" }]);
    const js = generateJavaScript(
      load({
        blocks: {
          languageVersion: 0,
          blocks: [{ type: "okrobo_built_read_sensor", x: 0, y: 0, fields: { SENSOR: "front_lidar" } }],
        },
      }),
    );
    expect(js).toContain('robot.read("front_lidar")[0]');
  });

  it("Python is real (okrobo.BuiltRobot), C++ stays an illustrative-only preview", () => {
    setBuiltRobotFields([{ id: "wheel_motor", name: "Wheel Motor" }], [{ id: "front_lidar", name: "Front Lidar" }]);
    const ws = () =>
      load({
        blocks: {
          languageVersion: 0,
          blocks: [{ type: "okrobo_built_set_actuator", x: 0, y: 0, fields: { ACTUATOR: "wheel_motor", VALUE: 1 } }],
        },
      });

    const py = generatePython(ws(), "built");
    expect(py).toContain("from okrobo import BuiltRobot");
    expect(py).toContain('robot.set("wheel_motor", 1)');
    expect(py).not.toContain("Illustrative only");
    workspace.dispose();

    const cpp = generateCpp(ws(), "built");
    expect(cpp).toContain("Illustrative only");
    expect(cpp).toContain('robot.set("wheel_motor", 1);');
    expect(cpp).not.toContain("#include");
  });

  it("toolboxFor/starterWorkspace resolve the built-robot variants", () => {
    expect(toolboxFor("built")).toBe(BUILT_TOOLBOX);
    expect(starterWorkspace("built")).toBe(BUILT_STARTER_WORKSPACE);
  });

  it("the built starter workspace is a single wait block, not seeded with any actuator/sensor id", () => {
    const js = generateJavaScript(load(BUILT_STARTER_WORKSPACE));
    expect(js).toContain("await robot.wait(1);");
    expect(js).not.toContain("robot.set(");
    expect(js).not.toContain("robot.read(");
  });
});

// A real usability report ("can't use else if at all") traced to the
// controls_if mutator's own small drag target being especially hard to use
// -- see docs/decisions/blocks-editor-usability.md. Fixed with three
// ready-made toolbox shapes of the same stock block (seeded via Blockly's
// own extraState mechanism, no custom block code), so a student can drag
// the shape they need directly rather than fighting the mutator popup.
describe("if/else toolbox shapes (Blocks editor usability)", () => {
  const controlsIfEntries = (toolbox: { contents: Array<{ type?: string; extraState?: unknown }> }) =>
    toolbox.contents.filter((entry) => entry.type === "controls_if");

  it("every robot's toolbox offers plain if, if/else, and if/else-if/else, not just plain if", () => {
    for (const toolbox of [TOOLBOX, ARM_TOOLBOX, DRONE_TOOLBOX, BUILT_TOOLBOX]) {
      const entries = controlsIfEntries(toolbox);
      expect(entries).toHaveLength(3);
      expect(entries[0].extraState).toBeUndefined();
      expect(entries[1].extraState).toEqual({ hasElse: true });
      expect(entries[2].extraState).toEqual({ elseIfCount: 1, hasElse: true });
    }
  });

  it("an extraState-seeded if/else block loads with a real ELSE input, not just plain if", () => {
    const ws = load({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: "controls_if",
            extraState: { hasElse: true },
            x: 0,
            y: 0,
            inputs: {
              DO0: { block: { type: "okrobo_forward", fields: { METERS: 0.05 } } },
              ELSE: { block: { type: "okrobo_backward", fields: { METERS: 0.05 } } },
            },
          },
        ],
      },
    });
    const block = ws.getAllBlocks(false)[0];
    expect(block.type).toBe("controls_if");
    expect(block.getInput("ELSE")).not.toBeNull();
    expect(Blockly.serialization.blocks.save(block)).toMatchObject({ extraState: { hasElse: true } });
  });

  it("all three extraState-seeded shapes generate correct JavaScript/Python/C++, not just plain if", () => {
    const shapes: Array<{ extraState?: { elseIfCount?: number; hasElse?: boolean }; expectJs: string[]; rejectJs?: string[] }> = [
      { extraState: undefined, expectJs: ["if ("], rejectJs: ["else"] },
      { extraState: { hasElse: true }, expectJs: ["if (", "} else {"], rejectJs: ["else if"] },
      { extraState: { elseIfCount: 1, hasElse: true }, expectJs: ["if (", "} else if (", "} else {"] },
    ];
    for (const { extraState, expectJs, rejectJs } of shapes) {
      const blockJson: Record<string, unknown> = {
        type: "controls_if",
        x: 0,
        y: 0,
        inputs: {
          IF0: { block: { type: "logic_boolean", fields: { BOOL: "TRUE" } } },
          DO0: { block: { type: "okrobo_forward", fields: { METERS: 0.05 } } },
          ...(extraState?.hasElse ? { ELSE: { block: { type: "okrobo_backward", fields: { METERS: 0.05 } } } } : {}),
          ...(extraState?.elseIfCount ? { IF1: { block: { type: "logic_boolean", fields: { BOOL: "FALSE" } } } } : {}),
        },
      };
      if (extraState) blockJson.extraState = extraState;

      const ws = () => load({ blocks: { languageVersion: 0, blocks: [blockJson] } });
      const js = generateJavaScript(ws());
      for (const fragment of expectJs) expect(js).toContain(fragment);
      for (const fragment of rejectJs ?? []) expect(js).not.toContain(fragment);
      expect(() => generatePython(ws(), "car")).not.toThrow();
      expect(() => generateCpp(ws(), "car")).not.toThrow();
    }
  });
});

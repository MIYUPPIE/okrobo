import { describe, expect, it } from "vitest";
import { validateRobotDef } from "../contracts/robotDef";
import { makeArmTemplate, makeBlankTemplate, makeRoverTemplate, TEMPLATE_OPTIONS } from "./robotTemplates";

describe("TEMPLATE_OPTIONS", () => {
  it("every option's make() produces a valid, no-issue robot-def document", () => {
    for (const option of TEMPLATE_OPTIONS) {
      const robot = option.make();
      expect(validateRobotDef(robot)).toEqual([]);
    }
  });

  it("has unique ids and labels", () => {
    const ids = TEMPLATE_OPTIONS.map((o) => o.id);
    const labels = TEMPLATE_OPTIONS.map((o) => o.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("includes Blank, Two-Wheeled Rover, and Simple Arm", () => {
    expect(TEMPLATE_OPTIONS.map((o) => o.label)).toEqual(["Blank", "Two-Wheeled Rover", "Simple Arm"]);
  });
});

describe("makeBlankTemplate", () => {
  it("is a single-body document", () => {
    expect(makeBlankTemplate().bodies).toHaveLength(1);
  });
});

describe("makeRoverTemplate", () => {
  it("has a chassis plus two wheels on continuous (unlimited) hinge joints", () => {
    const robot = makeRoverTemplate();
    expect(robot.bodies.map((b) => b.id)).toEqual(["chassis", "left_wheel", "right_wheel"]);
    expect(robot.joints).toHaveLength(2);
    for (const joint of robot.joints) {
      expect(joint.type).toBe("hinge");
      if (joint.type === "hinge") expect(joint.limits).toBeUndefined();
    }
  });

  it("has one velocity actuator per wheel joint", () => {
    const robot = makeRoverTemplate();
    expect(robot.actuators).toHaveLength(2);
    for (const actuator of robot.actuators) {
      expect(actuator.type).toBe("velocity");
      expect(robot.joints.some((j) => j.id === actuator.target_joint)).toBe(true);
    }
  });
});

describe("makeArmTemplate", () => {
  it("has a base and two hinge-jointed links", () => {
    const robot = makeArmTemplate();
    expect(robot.bodies.map((b) => b.id)).toEqual(["base", "link1", "link2"]);
    expect(robot.joints).toHaveLength(2);
  });

  it("has a servo actuator on the shoulder and an encoder reading it", () => {
    const robot = makeArmTemplate();
    expect(robot.actuators).toHaveLength(1);
    expect(robot.actuators[0].type).toBe("servo");
    expect(robot.actuators[0].target_joint).toBe("shoulder");
    expect(robot.sensors).toHaveLength(1);
    expect(robot.sensors[0].type).toBe("encoder");
    expect(robot.sensors[0].joint).toBe("shoulder");
  });
});

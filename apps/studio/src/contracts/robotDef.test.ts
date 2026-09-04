// Gate tests for the robot-def v0 TypeScript mirror. Mirrors
// engine/tests/test_robot_def.cpp and runtime/python/tests/test_robot_def.py:
// all three read the same fixtures under contracts/robot-def/v0/.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, robotDefToJson, validateRobotDef, type Issue } from "./robotDef";

const CONTRACT_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v0");
const EXAMPLES_DIR = join(CONTRACT_DIR, "examples");
const INVALID_DIR = join(CONTRACT_DIR, "invalid");

const load = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const fixtureNames = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

describe("robot-def v0 examples", () => {
  const names = fixtureNames(EXAMPLES_DIR);

  it("has at least one example", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s is valid and round-trips", (name) => {
    const robot = parseRobotDef(load(EXAMPLES_DIR, name));
    expect(validateRobotDef(robot)).toEqual([]);

    const reparsed = parseRobotDef(robotDefToJson(robot));
    expect(reparsed).toEqual(robot);
  });
});

describe("robot-def v0 invalid fixtures", () => {
  const rules = fixtureNames(INVALID_DIR);

  it("has at least one fixture", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(rules)("%s triggers exactly its own rule", (rule) => {
    const robot = parseRobotDef(load(INVALID_DIR, rule));
    const issues = validateRobotDef(robot);
    expect(issues.map((i) => i.rule)).toEqual([rule]);
  });

  // One direct assertion per rule, pinning the exact message wording -- the
  // contract wants actionable messages (contracts/robot-def/v0/contract.md);
  // worth locking literally, not just asserting a rule id fired.
  const expectedMessages: Record<string, string> = {
    "body-duplicate-id": "Duplicate body id 'base'",
    "body-invalid-geometry": "Body 'link1': geometry size must be positive",
    "body-invalid-mass": "Body 'link1' has no valid mass",
    "body-invalid-inertia": "Body 'link1': inertia.izz must be > 0",
    "joint-duplicate-id": "Duplicate joint id 'joint1'",
    "joint-unknown-parent-body": "Joint 'joint1': parent body 'ghost' does not exist",
    "joint-unknown-child-body": "Joint 'joint1': child body 'ghost' does not exist",
    "joint-self-loop": "Joint 'joint1' connects 'base' to itself",
    "joint-duplicate-child": "Body 'link1' is attached by more than one joint ('joint1', 'joint2')",
    "joint-missing-axis": "Joint 'joint1': axis must be non-zero",
    "joint-invalid-limits": "Joint 'joint1': limits.lower must be less than limits.upper",
    "joint-invalid-damping-friction": "Joint 'joint1': damping must be >= 0",
    "robot-no-root-body": "Robot cannot simulate: no root body found",
    "robot-multiple-root-bodies": "Robot cannot simulate: 'extra' has no parent joint attaching it to the rest of the robot",
    "robot-cycle": "Robot cannot simulate: cycle detected in joints at body 'p'",
    "actuator-duplicate-id": "Duplicate actuator id 'a1'",
    "actuator-unknown-target-joint": "Actuator 'a1': target joint 'ghost' does not exist",
    "actuator-fixed-joint-target": "Actuator 'a1': cannot actuate fixed joint 'joint1'",
    "actuator-invalid-limits": "Actuator 'a1': limits.effort must be > 0",
    "sensor-duplicate-id": "Duplicate sensor id 's1'",
    "sensor-unknown-body": "Sensor 's1': body 'ghost' does not exist",
    "sensor-encoder-missing-joint": "Sensor 's1': encoder sensors must set 'joint'",
    "sensor-unknown-joint": "Sensor 's1': joint 'ghost' does not exist",
  };

  it("expected-message map covers every fixture", () => {
    expect(Object.keys(expectedMessages).sort()).toEqual(rules);
  });

  it.each(rules)("%s has the expected message wording", (rule) => {
    const robot = parseRobotDef(load(INVALID_DIR, rule));
    const issues: Issue[] = validateRobotDef(robot);
    expect(issues[0]?.message).toBe(expectedMessages[rule]);
  });
});

describe("robot-def v0 parsing", () => {
  it("throws on malformed shape", () => {
    expect(() => parseRobotDef({ id: "x", name: "X" })).toThrow();
  });
});

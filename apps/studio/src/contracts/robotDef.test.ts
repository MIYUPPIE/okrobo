// Gate tests for the robot-def v2 TypeScript mirror. Mirrors
// engine/tests/test_robot_def.cpp and runtime/python/tests/test_robot_def.py:
// all three read the same fixtures under contracts/robot-def/v2/ (v2's own
// examples/invalid include v1's fixtures verbatim, since v2 is a strict
// additive superset -- see docs/decisions/cad-kernel-feature-tree-data-model.md).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, robotDefToJson, validateRobotDef, type Issue } from "./robotDef";

const CONTRACT_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v2");
const EXAMPLES_DIR = join(CONTRACT_DIR, "examples");
const INVALID_DIR = join(CONTRACT_DIR, "invalid");

const load = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const fixtureNames = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

describe("robot-def v2 examples", () => {
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

describe("robot-def v2 invalid fixtures", () => {
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
  // contract wants actionable messages (contracts/robot-def/v1/contract.md);
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
    "body-features-without-cad-mesh": "Body 'base': features is only meaningful alongside a cad_mesh visual/collision",
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

describe("robot-def v2 parsing", () => {
  it("throws on malformed shape", () => {
    expect(() => parseRobotDef({ id: "x", name: "X" })).toThrow();
  });
});

// CAD Kernel Phase 1: the new cad_mesh geometry variant. See
// docs/decisions/cad-kernel-foundation.md.
describe("cad_mesh geometry (v2)", () => {
  const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
  // A tetrahedron: 4 vertices, 4 triangular faces.
  const tetrahedron = {
    vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1],
    faces: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
  };

  function makeRobotWith(visual: unknown, collision?: unknown) {
    const body: Record<string, unknown> = {
      id: "part",
      name: "Part",
      transform: identity,
      visual,
      mass: 0.1,
      inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
    };
    // Only set `collision` at all when a caller actually wants one -- an
    // explicit `undefined` argument still triggers a JS default-parameter
    // fallback, so omitting the key entirely (not defaulting collision to
    // visual) is the only way to test a single geometry field in isolation.
    if (collision !== undefined) body.collision = collision;
    return {
      id: "cad-test",
      name: "CAD Test",
      description: "",
      root_placement: identity,
      bodies: [body],
      joints: [],
      actuators: [],
      sensors: [],
    };
  }

  it("parses, validates cleanly, and round-trips", () => {
    const geometry = { type: "cad_mesh", ...tetrahedron };
    const robot = parseRobotDef(makeRobotWith(geometry, geometry));
    expect(validateRobotDef(robot)).toEqual([]);
    const reparsed = parseRobotDef(robotDefToJson(robot));
    expect(reparsed).toEqual(robot);
  });

  it("rejects a non-multiple-of-3 vertices array", () => {
    // Parsing itself only checks types (an array of numbers) -- structural
    // shape (multiple-of-3, in-range indices) is validateRobotDef's job.
    // Only `visual` is set (not collision too) so exactly one issue fires,
    // matching how the shared body-invalid-geometry fixture is built.
    const bad = { type: "cad_mesh", vertices: [0, 0], faces: [0, 0, 0] };
    expect(() => parseRobotDef(makeRobotWith(bad))).not.toThrow();
    const robot = parseRobotDef(makeRobotWith(bad));
    expect(validateRobotDef(robot)).toEqual([
      expect.objectContaining({ rule: "body-invalid-geometry", element_id: "part" }),
    ]);
  });

  it("rejects a face index out of range", () => {
    const bad = { type: "cad_mesh", vertices: tetrahedron.vertices, faces: [0, 1, 99] };
    const robot = parseRobotDef(makeRobotWith(bad));
    expect(validateRobotDef(robot)).toEqual([
      expect.objectContaining({ rule: "body-invalid-geometry", element_id: "part" }),
    ]);
  });

  it("throws on a non-numeric vertices array", () => {
    expect(() => parseRobotDef(makeRobotWith({ type: "cad_mesh", vertices: ["x"], faces: [0, 0, 0] }))).toThrow();
  });
});

// CAD Kernel Phase 7.1 (v2): the new Body.features construction history.
// See docs/decisions/cad-kernel-feature-tree-data-model.md.
describe("body.features (v2)", () => {
  const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
  const cadMesh = { type: "cad_mesh", vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1], faces: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3] };

  function makeRobotWithFeatures(features: unknown[]) {
    return {
      id: "cad-test",
      name: "CAD Test",
      description: "",
      root_placement: identity,
      bodies: [
        {
          id: "part",
          name: "Part",
          transform: identity,
          visual: cadMesh,
          collision: cadMesh,
          features,
          mass: 0.1,
          inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
        },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
  }

  const pick = { source_step: 0, local_index: 0, point: [0.05, 0, 0] };

  it.each([
    ["extrude", { operation: "extrude", profile: { type: "rectangle", width: 0.1, height: 0.06 }, depth: 0.04 }],
    ["revolve", { operation: "revolve", profile: { type: "circle", radius: 0.02 }, offset: 0.05, angle_deg: 360 }],
    ["loft", { operation: "loft", start_profile: { type: "circle", radius: 0.03 }, end_profile: { type: "rectangle", width: 0.05, height: 0.05 }, height: 0.08 }],
    ["box", { operation: "box", size: [0.1, 0.06, 0.04] }],
    ["cylinder", { operation: "cylinder", radius: 0.03, length: 0.08 }],
    ["cut", { operation: "cut", tool: { operation: "extrude", profile: { type: "circle", radius: 0.01 }, depth: 0.2 }, position: [0, 0, 0] }],
    ["fillet_chamfer", { operation: "fillet_chamfer", picks: [{ ...pick, operation: "fillet", value: 0.005 }] }],
    ["shell", { operation: "shell", picks: [pick], thickness: 0.005 }],
    ["draft", { operation: "draft", picks: [pick], angle_deg: 5 }],
  ] as const)("%s feature parses, validates cleanly, and round-trips", (_kind, feature) => {
    const robot = parseRobotDef(makeRobotWithFeatures([feature]));
    expect(validateRobotDef(robot)).toEqual([]);
    expect(robot.bodies[0].features).toEqual([feature]);
    const reparsed = parseRobotDef(robotDefToJson(robot));
    expect(reparsed).toEqual(robot);
  });

  it("preserves a multi-step ordered history", () => {
    const features = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "shell", picks: [pick], thickness: 0.005 },
      { operation: "draft", picks: [pick], angle_deg: 5 },
    ];
    const robot = parseRobotDef(makeRobotWithFeatures(features));
    expect(robot.bodies[0].features).toEqual(features);
  });

  it("throws on an unknown feature operation", () => {
    expect(() => parseRobotDef(makeRobotWithFeatures([{ operation: "bogus" }]))).toThrow();
  });

  it("throws on a fillet_chamfer feature with no picks", () => {
    expect(() => parseRobotDef(makeRobotWithFeatures([{ operation: "fillet_chamfer", picks: [] }]))).toThrow();
  });

  it("omits an empty/absent features array from serialization", () => {
    const robot = parseRobotDef(makeRobotWithFeatures([]));
    expect(robot.bodies[0].features).toEqual([]);
    const json = robotDefToJson(robot) as { bodies: Record<string, unknown>[] };
    expect(json.bodies[0]).not.toHaveProperty("features");
  });
});

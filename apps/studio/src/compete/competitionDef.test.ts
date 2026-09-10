// Gate tests for contracts/competition/v1's own (and only) TypeScript
// mirror. Mirrors apps/studio/src/contracts/robotDef.test.ts's own harness
// shape exactly: glob examples/ (parse, validate clean, round-trip),
// glob invalid/ (each fixture triggers exactly its own rule, with a pinned
// message), plus a few direct parse-throw assertions for STRUCTURAL
// problems that never reach validateCompetitionDef at all (missing
// fields, an unknown objective type, too many obstacles -- reused straight
// from validateWorld's own throwing behavior).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCompetitionDef, competitionDefToJson, validateCompetitionDef, type Issue } from "./competitionDef";

const CONTRACT_DIR = join(process.cwd(), "..", "..", "contracts", "competition", "v1");
const EXAMPLES_DIR = join(CONTRACT_DIR, "examples");
const INVALID_DIR = join(CONTRACT_DIR, "invalid");

const load = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const fixtureNames = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

describe("competition-def v1 examples", () => {
  const names = fixtureNames(EXAMPLES_DIR);

  it("has at least one example", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)("%s is valid and round-trips", (name) => {
    const competition = parseCompetitionDef(load(EXAMPLES_DIR, name));
    expect(validateCompetitionDef(competition)).toEqual([]);

    const reparsed = parseCompetitionDef(competitionDefToJson(competition));
    expect(reparsed).toEqual(competition);
  });
});

describe("competition-def v1 invalid fixtures", () => {
  const rules = fixtureNames(INVALID_DIR);

  it("has at least one fixture", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(rules)("%s triggers exactly its own rule", (rule) => {
    const competition = parseCompetitionDef(load(INVALID_DIR, rule));
    const issues = validateCompetitionDef(competition);
    expect(issues.map((i) => i.rule)).toEqual([rule]);
  });

  const expectedMessages: Record<string, string> = {
    "objective-avoid-obstacle-negative-penalty": "Objective 0 (avoid_obstacle_collision): penalty_per_hit must be >= 0",
    "objective-duplicate-time-limit": "At most one time_limit objective is allowed",
    "objective-reach-zone-invalid-points": "Objective 0 (reach_zone): points must be > 0",
    "objective-reach-zone-invalid-radius": "Objective 0 (reach_zone): radius must be > 0",
    "objective-reach-zone-invalid-sequence": "Objective 0 (reach_zone): sequence must be a non-negative integer",
    "objective-time-limit-invalid-seconds": "Objective 0 (time_limit): seconds must be > 0",
  };

  it("expected-message map covers every fixture", () => {
    expect(Object.keys(expectedMessages).sort()).toEqual(rules);
  });

  it.each(rules)("%s has the expected message wording", (rule) => {
    const competition = parseCompetitionDef(load(INVALID_DIR, rule));
    const issues: Issue[] = validateCompetitionDef(competition);
    expect(issues[0]?.message).toBe(expectedMessages[rule]);
  });
});

describe("competition-def v1 parsing", () => {
  const base = {
    id: "test",
    name: "Test",
    robot: "car",
    arena: {
      name: "Arena",
      arena_width: 2,
      arena_height: 2,
      robot_radius: 0.1,
      wheel_base: 0.15,
      start: { x: 0.5, y: 0.5, theta: 0 },
      obstacles: [],
    },
    objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10 }],
  };

  it("throws on malformed shape", () => {
    expect(() => parseCompetitionDef({ id: "x", name: "X" })).toThrow();
  });

  it("throws on a missing id", () => {
    expect(() => parseCompetitionDef({ ...base, id: undefined })).toThrow(/missing id/);
  });

  it("throws when robot is not 'car'", () => {
    expect(() => parseCompetitionDef({ ...base, robot: "arm" })).toThrow(/robot must be "car"/);
  });

  it("throws on an unknown objective type", () => {
    expect(() => parseCompetitionDef({ ...base, objectives: [{ type: "bogus" }] })).toThrow(/unknown type/);
  });

  it("throws with no objectives", () => {
    expect(() => parseCompetitionDef({ ...base, objectives: [] })).toThrow(/needs at least one objective/);
  });

  it("throws on a missing arena field (reused from validateWorld)", () => {
    const { wheel_base: _unused, ...arenaMissingWheelBase } = base.arena;
    expect(() => parseCompetitionDef({ ...base, arena: arenaMissingWheelBase })).toThrow();
  });

  it("throws on too many obstacles (reused from validateWorld's own MAX_OBSTACLES)", () => {
    const obstacles = Array.from({ length: 17 }, (_, i) => ({ x: i, y: 0, width: 0.1, height: 0.1 }));
    expect(() => parseCompetitionDef({ ...base, arena: { ...base.arena, obstacles } })).toThrow(/at most 16 obstacles/);
  });
});

// Competition Arena C4: v1's own new fields.
describe("competition-def v1 sequence/label (reach_zone)", () => {
  const base = {
    id: "test",
    name: "Test",
    robot: "car",
    arena: {
      name: "Arena",
      arena_width: 4,
      arena_height: 2,
      robot_radius: 0.1,
      wheel_base: 0.15,
      start: { x: 0.5, y: 0.5, theta: 0 },
      obstacles: [],
    },
  };

  it("parses sequence and label when present, and round-trips them", () => {
    const competition = parseCompetitionDef({
      ...base,
      objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, sequence: 1, label: "Delivery zone" }],
    });
    const objective = competition.objectives[0];
    expect(objective).toMatchObject({ sequence: 1, label: "Delivery zone" });
    expect(validateCompetitionDef(competition)).toEqual([]);

    const reparsed = parseCompetitionDef(competitionDefToJson(competition));
    expect(reparsed).toEqual(competition);
  });

  it("omitting sequence/label parses exactly as v0 always did (both undefined)", () => {
    const competition = parseCompetitionDef({
      ...base,
      objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10 }],
    });
    expect(competition.objectives[0]).toMatchObject({ sequence: undefined, label: undefined });
  });

  it("throws on a non-numeric sequence (structural, not validate-time)", () => {
    expect(() =>
      parseCompetitionDef({ ...base, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, sequence: "first" }] }),
    ).toThrow(/sequence must be numeric/);
  });

  it("throws on a non-string label", () => {
    expect(() =>
      parseCompetitionDef({ ...base, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, label: 5 }] }),
    ).toThrow(/label must be a string/);
  });

  it("validate-time: a negative or non-integer sequence is rejected, a valid one is not", () => {
    const negative = parseCompetitionDef({ ...base, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, sequence: -1 }] });
    expect(validateCompetitionDef(negative).map((i) => i.rule)).toEqual(["objective-reach-zone-invalid-sequence"]);

    const fractional = parseCompetitionDef({ ...base, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, sequence: 1.5 }] });
    expect(validateCompetitionDef(fractional).map((i) => i.rule)).toEqual(["objective-reach-zone-invalid-sequence"]);

    const valid = parseCompetitionDef({ ...base, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 10, sequence: 0 }] });
    expect(validateCompetitionDef(valid)).toEqual([]);
  });
});

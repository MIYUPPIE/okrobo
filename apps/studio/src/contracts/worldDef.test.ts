import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorldDef, validateWorldDef, worldDefToJson } from "./worldDef";

const CONTRACT_DIR = join(process.cwd(), "..", "..", "contracts", "world-def", "v0");
const EXAMPLES_DIR = join(CONTRACT_DIR, "examples");
const INVALID_DIR = join(CONTRACT_DIR, "invalid");

const load = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

describe("world-def v0 examples", () => {
  it.each(["empty", "obstacle-course", "ramp"])("%s is valid and round-trips", (name) => {
    const world = parseWorldDef(load(EXAMPLES_DIR, name));
    expect(validateWorldDef(world)).toEqual([]);

    const reparsed = parseWorldDef(worldDefToJson(world));
    expect(reparsed).toEqual(world);
  });
});

describe("world-def v0 invalid fixtures", () => {
  const expectedMessages: Record<string, string> = {
    "object-duplicate-id": "Duplicate object id 'box1'",
    "object-invalid-geometry": "Object 'box1': geometry size must be positive",
  };

  it.each(Object.keys(expectedMessages))("%s triggers exactly its own rule and message", (rule) => {
    const world = parseWorldDef(load(INVALID_DIR, rule));
    const issues = validateWorldDef(world);
    expect(issues.map((i) => i.rule)).toEqual([rule]);
    expect(issues[0].message).toBe(expectedMessages[rule]);
  });
});

describe("world-def v0 parsing", () => {
  it("throws on malformed shape", () => {
    expect(() => parseWorldDef({ id: "x", name: "X" })).toThrow();
  });

  it("throws when an object has no geometry", () => {
    expect(() => parseWorldDef({ id: "x", name: "X", objects: [{ id: "o1", name: "O1" }] })).toThrow();
  });
});

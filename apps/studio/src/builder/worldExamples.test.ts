import { describe, expect, it } from "vitest";
import { validateWorldDef } from "../contracts/worldDef";
import { makeEmptyWorld, makeObstacleCourseWorld, makeRampWorld, WORLD_OPTIONS } from "./worldExamples";

describe("WORLD_OPTIONS", () => {
  it("every option's make() produces a valid, no-issue world-def document", () => {
    for (const option of WORLD_OPTIONS) {
      const world = option.make();
      expect(world.id).toBe(option.id);
      expect(validateWorldDef(world)).toEqual([]);
    }
  });

  it("has unique ids", () => {
    const ids = WORLD_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("makeEmptyWorld", () => {
  it("has no objects", () => {
    expect(makeEmptyWorld().objects).toEqual([]);
  });
});

describe("makeObstacleCourseWorld", () => {
  it("has three distinctly-shaped objects", () => {
    const world = makeObstacleCourseWorld();
    expect(world.objects).toHaveLength(3);
    expect(new Set(world.objects.map((o) => o.geometry.type))).toEqual(new Set(["box", "cylinder"]));
  });
});

describe("makeRampWorld", () => {
  it("has one box rotated about Y", () => {
    const world = makeRampWorld();
    expect(world.objects).toHaveLength(1);
    expect(world.objects[0].transform.rotation_rpy[1]).not.toBe(0);
  });
});

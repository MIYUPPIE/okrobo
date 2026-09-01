import { describe, expect, it } from "vitest";
import arena from "@packs/core/worlds/arena.json";
import { validateWorld } from "./validateWorld";

const valid = () => JSON.parse(JSON.stringify(arena)) as Record<string, unknown>;

describe("validateWorld", () => {
  it("accepts the shipped core arena", () => {
    const world = validateWorld(arena);
    expect(world.name).toBe("Arena");
    expect(world.arena_width).toBe(2.0);
  });

  it("rejects non-objects", () => {
    expect(() => validateWorld(null)).toThrow("not an object");
    expect(() => validateWorld("arena")).toThrow("not an object");
  });

  it("rejects a missing name", () => {
    const w = valid();
    delete w.name;
    expect(() => validateWorld(w)).toThrow("missing name");
  });

  it("rejects non-positive dimensions", () => {
    const w = valid();
    w.arena_width = 0;
    expect(() => validateWorld(w)).toThrow("arena_width");
  });

  it("rejects a robot larger than the arena", () => {
    const w = valid();
    w.robot_radius = 1.5;
    expect(() => validateWorld(w)).toThrow("does not fit");
  });

  it("rejects a start pose outside the arena", () => {
    const w = valid();
    (w.start as Record<string, number>).x = 5;
    expect(() => validateWorld(w)).toThrow("outside the arena");
  });

  it("rejects a malformed start pose", () => {
    const w = valid();
    w.start = { x: 1, y: 1 };
    expect(() => validateWorld(w)).toThrow("start must be");
  });
});

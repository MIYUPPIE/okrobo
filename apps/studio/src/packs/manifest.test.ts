import { describe, expect, it } from "vitest";
import { canInstall, compareVersions, validateIndex, validateManifest } from "./manifest";

const valid = () => ({
  id: "robotics-pack",
  name: "Robotics Pack",
  version: "1.2.0",
  sha256: "a".repeat(64),
  size_bytes: 1024,
  contents: { worlds: ["worlds/maze.json"], robots: ["robots/arm.urdf"], lessons: [] },
});

describe("pack manifest validation", () => {
  it("accepts a well-formed manifest", () => {
    const manifest = validateManifest(valid());
    expect(manifest.id).toBe("robotics-pack");
    expect(manifest.contents.worlds).toEqual(["worlds/maze.json"]);
    expect(manifest.contents.lessons).toEqual([]);
  });

  it("defaults missing content lists to empty", () => {
    const manifest = validateManifest({ ...valid(), contents: {} });
    expect(manifest.contents).toEqual({ worlds: [], robots: [], lessons: [], robot_defs: [], world_defs: [], competitions: [] });
  });

  // Robot Builder Phase 8: additive fields on the same v0 manifest (see
  // docs/decisions/robot-builder-packs.md for why this isn't a v1 fork) --
  // an old pack.json with neither field (the case above) must keep
  // validating exactly as it always did. `competitions` (Competition
  // Arena) was added the same additive way.
  it("parses robot_defs, world_defs and competitions when present", () => {
    const manifest = validateManifest({
      ...valid(),
      contents: {
        ...valid().contents,
        robot_defs: ["robot_defs/rover.json"],
        world_defs: ["world_defs/arena.json"],
        competitions: ["competitions/sprint.json"],
      },
    });
    expect(manifest.contents.robot_defs).toEqual(["robot_defs/rover.json"]);
    expect(manifest.contents.world_defs).toEqual(["world_defs/arena.json"]);
    expect(manifest.contents.competitions).toEqual(["competitions/sprint.json"]);
  });

  it("rejects bad ids and versions", () => {
    expect(() => validateManifest({ ...valid(), id: "Robotics Pack" })).toThrow("invalid id");
    expect(() => validateManifest({ ...valid(), version: "1.2" })).toThrow("major.minor.patch");
  });

  it("rejects a malformed digest", () => {
    expect(() => validateManifest({ ...valid(), sha256: "abc" })).toThrow("64 hex");
  });

  it("rejects path escapes in content lists", () => {
    const escaped = { ...valid(), contents: { worlds: ["../../etc/passwd"] } };
    expect(() => validateManifest(escaped)).toThrow("unsafe path");
    const absolute = { ...valid(), contents: { robots: ["/etc/shadow"] } };
    expect(() => validateManifest(absolute)).toThrow("unsafe path");
  });

  it("accepts and preserves signature fields", () => {
    const signed = validateManifest({
      ...valid(),
      signature: "d".repeat(128),
      key_id: "e".repeat(16),
    });
    expect(signed.signature).toHaveLength(128);
    expect(signed.key_id).toHaveLength(16);
    // Unsigned packs stay valid: signing is a trust signal, not a requirement.
    expect(validateManifest(valid()).signature).toBeUndefined();
  });

  it("rejects malformed signature fields", () => {
    expect(() => validateManifest({ ...valid(), signature: "abc" })).toThrow("128 hex");
    expect(() => validateManifest({ ...valid(), key_id: "xyz" })).toThrow("16 hex");
  });

  it("validates a store index and rejects duplicate ids", () => {
    expect(validateIndex({ packs: [valid()] })).toHaveLength(1);
    expect(() => validateIndex({ packs: [valid(), valid()] })).toThrow("duplicate pack id");
    expect(() => validateIndex({ packs: "nope" })).toThrow("must be an array");
  });
});

describe("versions and install rules", () => {
  it("orders semantic versions", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("allows first installs and upgrades only", () => {
    const installed = validateManifest(valid());
    expect(canInstall(installed, undefined).ok).toBe(true);

    const newer = validateManifest({ ...valid(), version: "1.3.0" });
    expect(canInstall(newer, installed).ok).toBe(true);

    const same = canInstall(installed, installed);
    expect(same.ok).toBe(false);
    expect(same.ok === false && same.reason).toContain("already installed");

    const older = validateManifest({ ...valid(), version: "1.0.0" });
    const result = canInstall(older, installed);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("older than");
  });
});

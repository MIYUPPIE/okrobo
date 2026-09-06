import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRobotDef, validateRobotDef } from "../contracts/robotDef";
import { buildKinematicTree } from "./robotTree";

const CONTRACT_DIR = join(process.cwd(), "..", "..", "contracts", "robot-def", "v2");
const load = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

describe("buildKinematicTree", () => {
  it("single-body.json: one root, no children", () => {
    const robot = parseRobotDef(load(join(CONTRACT_DIR, "examples"), "single-body"));
    const tree = buildKinematicTree(robot);
    expect(tree.rootIds).toEqual(["chassis"]);
    expect(tree.parentOf.size).toBe(0);
    expect(tree.unreachableIds).toEqual([]);
  });

  it("two-link-arm.json: base -> link1 -> link2 chain", () => {
    const robot = parseRobotDef(load(join(CONTRACT_DIR, "examples"), "two-link-arm"));
    const tree = buildKinematicTree(robot);
    expect(tree.rootIds).toEqual(["base"]);
    expect(tree.parentOf.get("link1")).toBe("base");
    expect(tree.parentOf.get("link2")).toBe("link1");
    expect(tree.parentJointOf.get("link1")?.id).toBe("joint1");
    expect(tree.childrenOf.get("base")).toEqual(["link1"]);
    expect(tree.childrenOf.get("link1")).toEqual(["link2"]);
    expect(tree.unreachableIds).toEqual([]);
  });

  // Cross-checks against validateRobotDef's independent implementation of
  // the same graph rules on the same fixtures, so the two can't silently
  // drift apart (see this file's module comment).
  it("agrees with validateRobotDef on a cyclic document (robot-cycle fixture)", () => {
    const robot = parseRobotDef(load(join(CONTRACT_DIR, "invalid"), "robot-cycle"));
    expect(validateRobotDef(robot).map((i) => i.rule)).toEqual(["robot-cycle"]);

    const tree = buildKinematicTree(robot);
    expect(tree.rootIds).toEqual(["root"]);
    expect([...tree.unreachableIds].sort()).toEqual(["p", "q", "r"]);
  });

  it("agrees with validateRobotDef on a duplicate-child document (joint-duplicate-child fixture)", () => {
    const robot = parseRobotDef(load(join(CONTRACT_DIR, "invalid"), "joint-duplicate-child"));
    expect(validateRobotDef(robot).map((i) => i.rule)).toEqual(["joint-duplicate-child"]);

    const tree = buildKinematicTree(robot);
    // Both joint1 and joint2 attach base->link1; the first (declaration
    // order) wins the tree edge, exactly like validateRobotDef's parentOf.
    expect(tree.parentOf.get("link1")).toBe("base");
    expect(tree.parentJointOf.get("link1")?.id).toBe("joint1");
    expect(tree.rootIds).toEqual(["base"]);
    expect(tree.unreachableIds).toEqual([]);
  });

  it("agrees with validateRobotDef when a joint's parent id doesn't resolve", () => {
    const robot = parseRobotDef(load(join(CONTRACT_DIR, "invalid"), "joint-unknown-parent-body"));
    expect(validateRobotDef(robot).map((i) => i.rule)).toEqual(["joint-unknown-parent-body"]);

    const tree = buildKinematicTree(robot);
    // link1 is still "attached" (not a root) even though its recorded
    // parent ("ghost") doesn't resolve to a real body -- same posture as
    // validateRobotDef's root-counting.
    expect(tree.rootIds).toEqual(["base"]);
    expect(tree.parentOf.get("link1")).toBe("ghost");
    expect(tree.unreachableIds).toEqual(["link1"]);
  });
});

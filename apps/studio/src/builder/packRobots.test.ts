import { afterEach, describe, expect, it, vi } from "vitest";
import { listPackRobots } from "./packRobots";

vi.mock("../projects/api", () => ({
  listPacks: vi.fn(),
  readPackFile: vi.fn(),
}));

const encode = (text: string): number[] => Array.from(new TextEncoder().encode(text));

const identity = { position: [0, 0, 0], rotation_rpy: [0, 0, 0] };

function robotDefJson(id: string, name: string): string {
  return JSON.stringify({
    id,
    name,
    description: "",
    root_placement: identity,
    bodies: [{ id: "chassis", name: "Chassis", transform: identity, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
    joints: [],
    actuators: [],
    sensors: [],
  });
}

afterEach(() => vi.clearAllMocks());

describe("listPackRobots", () => {
  it("returns nothing when no packs are installed", async () => {
    const { listPacks } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([]);
    expect(await listPackRobots()).toEqual([]);
  });

  it("omits a pack that carries no robot_defs (the common case today)", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "core", name: "Core Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockResolvedValue(
      encode(JSON.stringify({ id: "core", name: "Core Pack", version: "1.0.0", contents: {} })),
    );
    expect(await listPackRobots()).toEqual([]);
  });

  it("surfaces a real robot_defs entry, with a make() that returns a fresh, correctly-parsed document each call", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "robotics", name: "Robotics Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockImplementation(async (id, path) => {
      if (path === "pack.json") {
        return encode(
          JSON.stringify({
            id: "robotics",
            name: "Robotics Pack",
            version: "1.0.0",
            contents: { robot_defs: ["robot_defs/rover.json"] },
          }),
        );
      }
      if (path === "robot_defs/rover.json") return encode(robotDefJson("rover", "Rover"));
      throw new Error(`unexpected path: ${id}/${path}`);
    });

    const result = await listPackRobots();
    expect(result).toHaveLength(1);
    expect(result[0].pack.id).toBe("robotics");
    expect(result[0].robots).toHaveLength(1);
    expect(result[0].robots[0].label).toBe("Rover");

    const first = result[0].robots[0].make();
    const second = result[0].robots[0].make();
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // fresh object each call
    expect(first.id).toBe("rover");
  });

  it("skips a pack whose manifest fails to parse, without throwing", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "broken", name: "Broken", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockRejectedValue(new Error("no such file"));

    await expect(listPackRobots()).resolves.toEqual([]);
  });

  it("skips one corrupt robot-def file but keeps the pack's other valid ones", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "robotics", name: "Robotics Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockImplementation(async (_id, path) => {
      if (path === "pack.json") {
        return encode(
          JSON.stringify({
            id: "robotics",
            name: "Robotics Pack",
            version: "1.0.0",
            contents: { robot_defs: ["robot_defs/good.json", "robot_defs/bad.json"] },
          }),
        );
      }
      if (path === "robot_defs/good.json") return encode(robotDefJson("good", "Good Robot"));
      if (path === "robot_defs/bad.json") return encode("{not valid json");
      throw new Error("unexpected path");
    });

    const result = await listPackRobots();
    expect(result).toHaveLength(1);
    expect(result[0].robots).toHaveLength(1);
    expect(result[0].robots[0].label).toBe("Good Robot");
  });
});

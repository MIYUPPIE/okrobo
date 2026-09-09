import { afterEach, describe, expect, it, vi } from "vitest";
import { listPackCompetitions } from "./packCompetitions";

vi.mock("../projects/api", () => ({
  listPacks: vi.fn(),
  readPackFile: vi.fn(),
}));

const encode = (text: string): number[] => Array.from(new TextEncoder().encode(text));

function competitionDefJson(id: string, name: string): string {
  return JSON.stringify({
    id,
    name,
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
    objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 50 }],
  });
}

afterEach(() => vi.clearAllMocks());

describe("listPackCompetitions", () => {
  it("returns nothing when no packs are installed", async () => {
    const { listPacks } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([]);
    expect(await listPackCompetitions()).toEqual([]);
  });

  it("omits a pack that carries no competitions (the common case)", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "core", name: "Core Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockResolvedValue(
      encode(JSON.stringify({ id: "core", name: "Core Pack", version: "1.0.0", contents: {} })),
    );
    expect(await listPackCompetitions()).toEqual([]);
  });

  it("surfaces a real competitions entry, with a make() that returns a fresh, correctly-parsed document each call", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "arena-pack", name: "Arena Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockImplementation(async (id, path) => {
      if (path === "pack.json") {
        return encode(
          JSON.stringify({
            id: "arena-pack",
            name: "Arena Pack",
            version: "1.0.0",
            contents: { competitions: ["competitions/sprint.json"] },
          }),
        );
      }
      if (path === "competitions/sprint.json") return encode(competitionDefJson("sprint", "Sprint"));
      throw new Error(`unexpected path: ${id}/${path}`);
    });

    const result = await listPackCompetitions();
    expect(result).toHaveLength(1);
    expect(result[0].pack.id).toBe("arena-pack");
    expect(result[0].competitions).toHaveLength(1);
    expect(result[0].competitions[0].label).toBe("Sprint");

    const first = result[0].competitions[0].make();
    const second = result[0].competitions[0].make();
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // fresh object each call
    expect(first.id).toBe("sprint");
  });

  it("skips a pack whose manifest fails to parse, without throwing", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "broken", name: "Broken", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockRejectedValue(new Error("no such file"));

    await expect(listPackCompetitions()).resolves.toEqual([]);
  });

  it("skips one corrupt competition file but keeps the pack's other valid ones", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([{ id: "arena-pack", name: "Arena Pack", version: "1.0.0" }]);
    vi.mocked(readPackFile).mockImplementation(async (_id, path) => {
      if (path === "pack.json") {
        return encode(
          JSON.stringify({
            id: "arena-pack",
            name: "Arena Pack",
            version: "1.0.0",
            contents: { competitions: ["competitions/good.json", "competitions/bad.json"] },
          }),
        );
      }
      if (path === "competitions/good.json") return encode(competitionDefJson("good", "Good Competition"));
      if (path === "competitions/bad.json") return encode("{not valid json");
      throw new Error("unexpected path");
    });

    const result = await listPackCompetitions();
    expect(result).toHaveLength(1);
    expect(result[0].competitions).toHaveLength(1);
    expect(result[0].competitions[0].label).toBe("Good Competition");
  });

  it("lists competitions from multiple packs", async () => {
    const { listPacks, readPackFile } = await import("../projects/api");
    vi.mocked(listPacks).mockResolvedValue([
      { id: "pack-a", name: "Pack A", version: "1.0.0" },
      { id: "pack-b", name: "Pack B", version: "1.0.0" },
    ]);
    vi.mocked(readPackFile).mockImplementation(async (id, path) => {
      if (path === "pack.json") {
        return encode(JSON.stringify({ id, name: id, version: "1.0.0", contents: { competitions: ["competitions/one.json"] } }));
      }
      if (path === "competitions/one.json") return encode(competitionDefJson(`${id}-comp`, `${id} Competition`));
      throw new Error("unexpected path");
    });

    const result = await listPackCompetitions();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.pack.id).sort()).toEqual(["pack-a", "pack-b"]);
  });
});

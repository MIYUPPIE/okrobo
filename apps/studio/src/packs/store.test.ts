import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogue, discoverSource, fetchIndex } from "./store";

const manifest = (id: string, version: string) => ({
  id,
  name: id,
  version,
  contents: { worlds: [], robots: [], lessons: [], robot_defs: [], world_defs: [] },
  url: `${id}-${version}.tar.gz`,
});

function mockFetch(responses: Record<string, unknown | Error>) {
  return vi.fn(async (input: URL | string) => {
    const url = String(input);
    const key = Object.keys(responses).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unreachable: ${url}`);
    const value = responses[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value } as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("store index fetching", () => {
  it("validates the index and makes archive urls absolute", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "http://school:8480/": { packs: [manifest("robotics", "1.0.0")] } }),
    );
    const source = await fetchIndex("http://school:8480");
    expect(source.url).toBe("http://school:8480/");
    expect(source.packs[0].url).toBe("http://school:8480/robotics-1.0.0.tar.gz");
  });

  it("rejects an invalid index", async () => {
    vi.stubGlobal("fetch", mockFetch({ "http://bad/": { packs: [{ id: "NOPE" }] } }));
    await expect(fetchIndex("http://bad/")).rejects.toThrow("invalid id");
  });
});

describe("source discovery", () => {
  it("prefers the first reachable source (the school server)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "http://lan:8480/": { packs: [manifest("robotics", "1.0.0")] },
        "http://internet/": { packs: [manifest("robotics", "2.0.0")] },
      }),
    );
    const source = await discoverSource(["http://lan:8480/", "http://internet/"]);
    expect(source?.url).toBe("http://lan:8480/");
  });

  it("falls through to the next source when one is down", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "http://lan:8480/": new Error("offline"),
        "http://internet/": { packs: [manifest("robotics", "2.0.0")] },
      }),
    );
    const source = await discoverSource(["http://lan:8480/", "http://internet/"]);
    expect(source?.url).toBe("http://internet/");
  });

  it("returns null when nothing answers, which is not an error", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    await expect(discoverSource(["http://nowhere/"])).resolves.toBeNull();
  });
});

describe("catalogue merge", () => {
  it("labels packs as available, installed, or upgradable", () => {
    const entries = catalogue(
      [manifest("core", "1.0.0"), manifest("robotics", "2.1.0"), manifest("ai", "1.0.0")],
      [
        { id: "core", version: "1.0.0" },
        { id: "robotics", version: "2.0.0" },
      ],
    );
    expect(entries.map((e) => e.state)).toEqual(["installed", "upgradable", "available"]);
    expect(entries[1].installedVersion).toBe("2.0.0");
  });
});

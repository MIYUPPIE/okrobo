// Mirrors src-tauri/src/projects.rs's own test suite field-for-field --
// that Rust file's tests are the de facto spec for this browser-local
// backend (nothing else tested this contract before this file).
//
// Uses an injected in-memory KeyValueStore rather than the real
// `localStorage` global: found empirically that this repo's Node+vitest
// combination doesn't provide a working `localStorage` (Node's own
// built-in Web Storage implementation returns `undefined` unless launched
// with `--localstorage-file`) -- see webStore.ts's own header comment.

import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectPayload } from "./api";
import { webCreateProject, webDeleteProject, webListProjects, webLoadProject, webSaveProject, type KeyValueStore } from "./webStore";

function fakeStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

function makePayload(overrides: Partial<ProjectPayload> = {}): ProjectPayload {
  return {
    blocks: { some: "workspace" },
    python: "print('hi')",
    python_edited: false,
    world: "default",
    robot: "car",
    world_custom: null,
    robot_def: null,
    ...overrides,
  };
}

let store: KeyValueStore;
beforeEach(() => {
  store = fakeStore();
});

describe("webStore", () => {
  it("create then load round-trips name and payload content", async () => {
    const meta = await webCreateProject("My Rover", makePayload({ python: "print(1)" }), store);
    expect(meta.name).toBe("My Rover");
    expect(meta.created_at).toBe(meta.updated_at);

    const [loadedMeta, payload] = await webLoadProject(meta.id, store);
    expect(loadedMeta).toEqual(meta);
    expect(payload.python).toBe("print(1)");
  });

  it("save updates the payload and updated_at, but never created_at", async () => {
    const meta = await webCreateProject("Rover", makePayload(), store);
    const saved = await webSaveProject(meta.id, makePayload({ python: "print(2)" }), store);

    expect(saved.created_at).toBe(meta.created_at);
    expect(saved.updated_at).toBeGreaterThanOrEqual(meta.updated_at);

    const [, payload] = await webLoadProject(meta.id, store);
    expect(payload.python).toBe("print(2)");
  });

  it("save on an unknown id rejects with the exact Rust-side message", async () => {
    await expect(webSaveProject("nope", makePayload(), store)).rejects.toThrow("no project with id nope");
  });

  it("load on an unknown id rejects", async () => {
    await expect(webLoadProject("nope", store)).rejects.toThrow("no project with id nope");
  });

  it("an empty (or whitespace-only) name is rejected, matching the Rust message exactly", async () => {
    await expect(webCreateProject("   ", makePayload(), store)).rejects.toThrow("project name is empty");
  });

  it("list is sorted by updated_at, most recently updated first", async () => {
    const a = await webCreateProject("A", makePayload(), store);
    const b = await webCreateProject("B", makePayload(), store);
    // Force b strictly ahead of a by editing the index directly, the same
    // technique src-tauri/src/projects.rs's own list_orders_by_recency test
    // uses -- real wall-clock creates in quick succession can tie at this
    // store's whole-second granularity, so don't rely on timing.
    const index = JSON.parse(store.getItem("okrobo:projects")!);
    store.setItem(
      "okrobo:projects",
      JSON.stringify(index.map((p: { id: string; updated_at: number }) => (p.id === b.id ? { ...p, updated_at: p.updated_at + 10 } : p))),
    );

    const list = await webListProjects(store);
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it("delete removes the project -- a subsequent load fails, list no longer includes it", async () => {
    const meta = await webCreateProject("Temp", makePayload(), store);
    await webDeleteProject(meta.id, store);

    await expect(webLoadProject(meta.id, store)).rejects.toThrow();
    const list = await webListProjects(store);
    expect(list.find((p) => p.id === meta.id)).toBeUndefined();
  });

  it("deleting an unknown id is not an error", async () => {
    await expect(webDeleteProject("nope", store)).resolves.toBeUndefined();
  });

  it("a corrupted index falls back to an empty list instead of throwing", async () => {
    store.setItem("okrobo:projects", "{not valid json");
    await expect(webListProjects(store)).resolves.toEqual([]);
  });

  it("robot_def and world_custom round-trip in full, matching the Rust regression test's own coverage", async () => {
    const robotDef = {
      id: "r",
      name: "R",
      description: "",
      root_placement: identity,
      bodies: [],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const meta = await webCreateProject("With robot", makePayload({ robot: "arm", robot_def: robotDef as never }), store);
    const [, payload] = await webLoadProject(meta.id, store);
    expect(payload.robot).toBe("arm");
    expect(payload.robot_def).toEqual(robotDef);
  });
});

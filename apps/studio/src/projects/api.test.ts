// Proves the inDesktop branch itself -- each of the 5 project functions
// must call Tauri's invoke() on desktop and the webStore fallback
// everywhere else. The individual behaviors of each backend are tested in
// isolation (src-tauri/src/projects.rs's own suite; webStore.test.ts) --
// this file only proves the routing.

import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const isTauri = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => isTauri(),
}));

const webListProjects = vi.hoisted(() => vi.fn());
const webCreateProject = vi.hoisted(() => vi.fn());
const webSaveProject = vi.hoisted(() => vi.fn());
const webLoadProject = vi.hoisted(() => vi.fn());
const webDeleteProject = vi.hoisted(() => vi.fn());
vi.mock("./webStore", () => ({ webListProjects, webCreateProject, webSaveProject, webLoadProject, webDeleteProject }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

const payload = {
  blocks: {},
  python: "",
  python_edited: false,
  world: "default",
  robot: "car",
  world_custom: null,
  robot_def: null,
};

async function loadApi() {
  return import("./api");
}

describe("projects/api routing", () => {
  it("on desktop, every function calls Tauri's invoke, never the web store", async () => {
    isTauri.mockReturnValue(true);
    const api = await loadApi();
    expect(api.inDesktop).toBe(true);

    await api.listProjects();
    await api.createProject("Name", payload);
    await api.saveProject("id-1", payload);
    await api.loadProject("id-1");
    await api.deleteProject("id-1");

    expect(invoke).toHaveBeenCalledWith("list_projects");
    expect(invoke).toHaveBeenCalledWith("create_project", { name: "Name", payload });
    expect(invoke).toHaveBeenCalledWith("save_project", { id: "id-1", payload });
    expect(invoke).toHaveBeenCalledWith("load_project", { id: "id-1" });
    expect(invoke).toHaveBeenCalledWith("delete_project", { id: "id-1" });
    expect(webListProjects).not.toHaveBeenCalled();
    expect(webCreateProject).not.toHaveBeenCalled();
    expect(webSaveProject).not.toHaveBeenCalled();
    expect(webLoadProject).not.toHaveBeenCalled();
    expect(webDeleteProject).not.toHaveBeenCalled();
  });

  it("off desktop (plain web), every function calls the web store, never Tauri", async () => {
    isTauri.mockReturnValue(false);
    const api = await loadApi();
    expect(api.inDesktop).toBe(false);

    await api.listProjects();
    await api.createProject("Name", payload);
    await api.saveProject("id-1", payload);
    await api.loadProject("id-1");
    await api.deleteProject("id-1");

    expect(webListProjects).toHaveBeenCalledTimes(1);
    expect(webCreateProject).toHaveBeenCalledWith("Name", payload);
    expect(webSaveProject).toHaveBeenCalledWith("id-1", payload);
    expect(webLoadProject).toHaveBeenCalledWith("id-1");
    expect(webDeleteProject).toHaveBeenCalledWith("id-1");
    expect(invoke).not.toHaveBeenCalled();
  });
});

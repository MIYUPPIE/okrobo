import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import type { ProjectPayload } from "../projects/api";
import { listProjectRobots } from "./projectRobots";

vi.mock("../projects/api", () => ({
  listProjects: vi.fn(),
  loadProject: vi.fn(),
}));

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

function robotDef(id: string, name: string): RobotDef {
  return {
    id,
    name,
    description: "",
    root_placement: identity,
    bodies: [{ id: "chassis", name: "Chassis", transform: identity, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

function emptyPayload(): ProjectPayload {
  return { blocks: {}, python: "", python_edited: false, world: "arena", robot: "car", world_custom: null, robot_def: null };
}

afterEach(() => vi.clearAllMocks());

describe("listProjectRobots", () => {
  it("returns nothing when there are no saved projects", async () => {
    const { listProjects } = await import("../projects/api");
    vi.mocked(listProjects).mockResolvedValue([]);
    expect(await listProjectRobots()).toEqual([]);
  });

  it("omits a project that carries no robot_def (the common case)", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const meta = { id: "p1", name: "Project One", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([meta]);
    vi.mocked(loadProject).mockResolvedValue([meta, emptyPayload()]);
    expect(await listProjectRobots()).toEqual([]);
  });

  it("surfaces a project with a real robot_def", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const meta = { id: "p1", name: "My Rover", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([meta]);
    vi.mocked(loadProject).mockResolvedValue([meta, { ...emptyPayload(), robot_def: robotDef("rover", "Rover") }]);

    const result = await listProjectRobots();
    expect(result).toHaveLength(1);
    expect(result[0].project.name).toBe("My Rover");
    expect(result[0].label).toBe("Rover");

    const first = result[0].make();
    const second = result[0].make();
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // fresh object each call
    expect(first.id).toBe("rover");
  });

  it("excludes the currently-open project (already covered by the 'current robot' row)", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const current = { id: "current", name: "Current", created_at: 0, updated_at: 0 };
    const other = { id: "other", name: "Other", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([current, other]);
    vi.mocked(loadProject).mockImplementation(async (id) => {
      const meta = id === "current" ? current : other;
      return [meta, { ...emptyPayload(), robot_def: robotDef(id, id) }];
    });

    const result = await listProjectRobots("current");
    expect(result).toHaveLength(1);
    expect(result[0].project.id).toBe("other");
  });

  it("returns a fresh object per make() call, never a shared reference", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const meta = { id: "p1", name: "P", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([meta]);
    vi.mocked(loadProject).mockResolvedValue([meta, { ...emptyPayload(), robot_def: robotDef("rover", "Rover") }]);

    const [entry] = await listProjectRobots();
    const first = entry.make();
    first.name = "Mutated";
    const second = entry.make();
    expect(second.name).toBe("Rover");
  });

  it("skips one project that fails to load, without blanking the rest", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const good = { id: "good", name: "Good", created_at: 0, updated_at: 0 };
    const bad = { id: "bad", name: "Bad", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([bad, good]);
    vi.mocked(loadProject).mockImplementation(async (id) => {
      if (id === "bad") throw new Error("corrupt project file");
      return [good, { ...emptyPayload(), robot_def: robotDef("good-robot", "Good Robot") }];
    });

    const result = await listProjectRobots();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Good Robot");
  });

  it("skips a project whose robot_def fails to parse, without blanking the rest", async () => {
    const { listProjects, loadProject } = await import("../projects/api");
    const good = { id: "good", name: "Good", created_at: 0, updated_at: 0 };
    const bad = { id: "bad", name: "Bad", created_at: 0, updated_at: 0 };
    vi.mocked(listProjects).mockResolvedValue([bad, good]);
    vi.mocked(loadProject).mockImplementation(async (id) => {
      if (id === "bad") return [bad, { ...emptyPayload(), robot_def: { not: "a real robot-def" } as never }];
      return [good, { ...emptyPayload(), robot_def: robotDef("good-robot", "Good Robot") }];
    });

    const result = await listProjectRobots();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Good Robot");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Feature, RobotDef } from "../contracts/robotDef";

const replayFeaturesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  replayFeatures: (...args: unknown[]) => replayFeaturesMock(...args),
}));

const { recomputeFeatureStep, deleteFeatureStep, moveFeatureStep, insertFeatureStep } = await import("./recomputeFeatureStep");

// No beforeEach here, deliberately: calling mockReset()/mockClear() on
// replayFeaturesMock from a beforeEach hook was empirically found to trip
// a real Vitest quirk once a LATER test's own mockImplementation returns a
// rejected promise -- it reports a spurious "unhandled rejection" test
// failure even though the rejection is genuinely caught (verified
// directly: recomputeFeatureStep's own catch block runs and returns
// correctly regardless; the same rejected-mock setup passes cleanly when
// nothing calls a mock-reset method from a beforeEach hook first). Each
// test below sets its own mockResolvedValue/mockImplementation before use
// anyway; the two tests checking not.toHaveBeenCalled() clear the mock
// themselves, right at their own start, instead.

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.001, iyy: 0.001, izz: 0.001 };
const cadMesh = { type: "cad_mesh" as const, vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

const boxFeature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
const shellFeature: Feature = { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 };

function makeRobot(features: Feature[]): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [{ id: "part", name: "Part", transform: identity, visual: cadMesh, collision: cadMesh, features, mass: 0.05, inertia }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("recomputeFeatureStep", () => {
  it("replaces the target step and rebuilds visual/collision/features from the executor's own result", async () => {
    const resultMesh = { vertices: [9, 9, 9, 8, 8, 8, 7, 7, 7], faces: [0, 1, 2] };
    replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });

    const robot = makeRobot([boxFeature, shellFeature]);
    const editedShell: Feature = { ...shellFeature, thickness: 0.01 };
    const result = await recomputeFeatureStep(robot, "part", 1, editedShell);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, editedShell]);
    const body = result.robot.bodies[0];
    expect(body.features).toEqual([boxFeature, editedShell]);
    expect(body.visual).toEqual({ type: "cad_mesh", vertices: resultMesh.vertices, faces: resultMesh.faces });
    expect(body.collision).toEqual({ type: "cad_mesh", vertices: resultMesh.vertices, faces: resultMesh.faces });
  });

  it("replacing the root (step 0) leaves downstream steps recorded verbatim, still passed through to the executor", async () => {
    replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [1, 2, 3], faces: [0, 0, 0] }, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature]);
    const biggerBox: Feature = { operation: "box", size: [0.2, 0.12, 0.08] };

    const result = await recomputeFeatureStep(robot, "part", 0, biggerBox);

    expect(result.ok).toBe(true);
    expect(replayFeaturesMock).toHaveBeenCalledWith([biggerBox, shellFeature]);
  });

  it("leaves every other body untouched", async () => {
    replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [1, 2, 3], faces: [0, 0, 0] }, steps: [] });
    const robot = makeRobot([boxFeature]);
    robot.bodies.push({ id: "other", name: "Other", transform: identity, visual: { type: "box", size: [0.1, 0.1, 0.1] }, mass: 1, inertia });

    const result = await recomputeFeatureStep(robot, "part", 0, { operation: "box", size: [0.2, 0.2, 0.2] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.robot.bodies[1]).toEqual(robot.bodies[1]);
  });

  it("returns a readable error instead of throwing when the executor rejects (a real rebuild error)", async () => {
    replayFeaturesMock.mockImplementation(() => Promise.reject(new Error("cad executor: step 1 (shell) failed to rebuild: no face found near [99, 99, 99]")));
    const robot = makeRobot([boxFeature, shellFeature]);

    const result = await recomputeFeatureStep(robot, "part", 0, { operation: "box", size: [0.01, 0.01, 0.01] });

    expect(result).toEqual({ ok: false, message: "cad executor: step 1 (shell) failed to rebuild: no face found near [99, 99, 99]" });
  });

  it("returns a readable error for an unknown body id, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature]);
    const result = await recomputeFeatureStep(robot, "ghost", 0, boxFeature);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("ghost") });
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("returns a readable error for an out-of-range step index, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature]);
    const result = await recomputeFeatureStep(robot, "part", 5, boxFeature);
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });
});

// CAD Kernel Phase 7.4 (reorder/insert/delete).
const draftFeature: Feature = { operation: "draft", picks: [{ source_step: 1, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 5 };

describe("deleteFeatureStep", () => {
  it("removes the target step and rebuilds visual/collision/features from what remains", async () => {
    const resultMesh = { vertices: [1, 1, 1, 2, 2, 2, 3, 3, 3], faces: [0, 1, 2] };
    replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);

    const result = await deleteFeatureStep(robot, "part", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, draftFeature]);
    expect(result.robot.bodies[0].features).toEqual([boxFeature, draftFeature]);
  });

  it("refuses to delete the root (step 0), without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature, shellFeature]);
    const result = await deleteFeatureStep(robot, "part", 0);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("part") });
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("returns a readable error for an out-of-range step index, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature, shellFeature]);
    const result = await deleteFeatureStep(robot, "part", 5);
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("returns a real rebuild-error message instead of throwing when a downstream pick no longer resolves", async () => {
    replayFeaturesMock.mockImplementation(() => Promise.reject(new Error("cad executor: step 1 (draft) failed to rebuild: no face found near [1, 1, 1]")));
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);

    const result = await deleteFeatureStep(robot, "part", 1);

    expect(result).toEqual({ ok: false, message: "cad executor: step 1 (draft) failed to rebuild: no face found near [1, 1, 1]" });
  });
});

describe("moveFeatureStep", () => {
  it("swaps a step with its predecessor moving up and rebuilds", async () => {
    const resultMesh = { vertices: [4, 4, 4], faces: [0, 0, 0] };
    replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);

    const result = await moveFeatureStep(robot, "part", 2, "up");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, draftFeature, shellFeature]);
    expect(result.robot.bodies[0].features).toEqual([boxFeature, draftFeature, shellFeature]);
  });

  it("swaps a step with its successor moving down and rebuilds", async () => {
    replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [5, 5, 5], faces: [0, 0, 0] }, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);

    const result = await moveFeatureStep(robot, "part", 1, "down");

    expect(result.ok).toBe(true);
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, draftFeature, shellFeature]);
  });

  it("refuses to move the root, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);
    const result = await moveFeatureStep(robot, "part", 0, "down");
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("refuses to move a step up past the root, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);
    const result = await moveFeatureStep(robot, "part", 1, "up");
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("refuses to move the last step down past the tail, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);
    const result = await moveFeatureStep(robot, "part", 2, "down");
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("returns a real rebuild-error message instead of throwing when the new order breaks a pick", async () => {
    replayFeaturesMock.mockImplementation(() => Promise.reject(new Error("cad executor: step 2 (draft) failed to rebuild: no face found near [9, 9, 9]")));
    const robot = makeRobot([boxFeature, shellFeature, draftFeature]);

    const result = await moveFeatureStep(robot, "part", 1, "down");

    expect(result).toEqual({ ok: false, message: "cad executor: step 2 (draft) failed to rebuild: no face found near [9, 9, 9]" });
  });
});

describe("insertFeatureStep", () => {
  it("splices a brand-new step in right after afterIndex and rebuilds the whole chain", async () => {
    const resultMesh = { vertices: [6, 6, 6], faces: [0, 0, 0] };
    replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature]);
    const newDraft: Feature = { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 3 };

    const result = await insertFeatureStep(robot, "part", 0, newDraft);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, newDraft, shellFeature]);
    expect(result.robot.bodies[0].features).toEqual([boxFeature, newDraft, shellFeature]);
  });

  it("appends at the tail when afterIndex is the last existing step", async () => {
    replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [7, 7, 7], faces: [0, 0, 0] }, steps: [] });
    const robot = makeRobot([boxFeature, shellFeature]);
    const newDraft: Feature = { operation: "draft", picks: [{ source_step: 1, local_index: 0, point: [0, 0, 0] }], angle_deg: 3 };

    const result = await insertFeatureStep(robot, "part", 1, newDraft);

    expect(result.ok).toBe(true);
    expect(replayFeaturesMock).toHaveBeenCalledWith([boxFeature, shellFeature, newDraft]);
  });

  it("returns a readable error for an out-of-range afterIndex, without calling the executor", async () => {
    replayFeaturesMock.mockClear();
    const robot = makeRobot([boxFeature]);
    const result = await insertFeatureStep(robot, "part", 5, boxFeature);
    expect(result.ok).toBe(false);
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("returns a real rebuild-error message instead of throwing when the new step's own picks don't resolve", async () => {
    replayFeaturesMock.mockImplementation(() => Promise.reject(new Error("cad executor: step 1 (draft) failed to rebuild: no face found near [8, 8, 8]")));
    const robot = makeRobot([boxFeature, shellFeature]);
    const newDraft: Feature = { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [8, 8, 8] }], angle_deg: 3 };

    const result = await insertFeatureStep(robot, "part", 0, newDraft);

    expect(result).toEqual({ ok: false, message: "cad executor: step 1 (draft) failed to rebuild: no face found near [8, 8, 8]" });
  });
});

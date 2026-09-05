// @vitest-environment jsdom
//
// Same fireEvent + fake-timer technique CadExtrudeCreator.test.tsx already
// proved (see its own header comment for why, not userEvent). computeMesh
// is passed in as a prop directly (Shell vs Draft's own kernel call), so
// only previewFaces needs mocking from cadClient itself.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadFacePickEditor } from "./CadFacePickEditor";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const previewFacesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  previewFaces: (...args: unknown[]) => previewFacesMock(...args),
}));

const faces = {
  mesh: { vertices: [], triangles: [], normals: [], faceGroups: [{ start: 0, count: 3, faceId: 1 }, { start: 3, count: 3, faceId: 2 }] },
  centers: [
    [0.05, 0, 0] as [number, number, number],
    [0, 0.03, 0] as [number, number, number],
  ],
};

beforeEach(() => previewFacesMock.mockReset().mockResolvedValue(faces));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(visual: RobotDef["bodies"][number]["visual"]): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
    bodies: [{ id: "chassis", name: "Chassis", transform: { position: [0.2, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 1, inertia, visual }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

const resultMesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

function positiveNumber(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: "Value must be greater than 0" };
  return { ok: true, value };
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderShellEditor(overrides: Partial<Parameters<typeof CadFacePickEditor>[0]> = {}) {
  const computeMesh = vi.fn().mockResolvedValue(resultMesh);
  const props = {
    title: "Shell",
    valueLabel: "Thickness (m)",
    ariaLabel: "shell thickness",
    defaultValue: "0.005",
    validateValue: positiveNumber,
    computeMesh,
    robot: makeRobot({ type: "box" as const, size: [0.1, 0.06, 0.04] as [number, number, number] }),
    targetBodyId: "chassis",
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onPreviewChange: vi.fn(),
    facePicks: [],
    onFacePicksChange: vi.fn(),
    onFaceOverlayChange: vi.fn(),
    ...overrides,
  };
  const view = render(<CadFacePickEditor {...props} />);
  return { ...view, computeMesh, props };
}

describe("CadFacePickEditor", () => {
  it("shows an unsupported-type message (with only a Cancel button) for a sphere body", () => {
    const onCancel = vi.fn();
    renderShellEditor({ robot: makeRobot({ type: "sphere", radius: 0.05 }), onCancel });
    expect(screen.getByText(/Shell only supports box and cylinder bodies/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a Faces section once the target's own face preview settles", async () => {
    vi.useFakeTimers();
    renderShellEditor();
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(previewFacesMock).toHaveBeenCalledWith({ operation: "box", size: [0.1, 0.06, 0.04] });
    expect(screen.getByText("Face 1")).toBeInTheDocument();
    expect(screen.getByText("Face 2")).toBeInTheDocument();
  });

  it("calls computeMesh with the shape, picked faces, and the parsed value once ready", async () => {
    vi.useFakeTimers();
    const { computeMesh } = renderShellEditor({ facePicks: [[0.05, 0, 0]] });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(computeMesh).toHaveBeenCalledWith({ operation: "box", size: [0.1, 0.06, 0.04] }, [[0.05, 0, 0]], 0.005);
  });

  it("rejects a non-positive value locally, without calling computeMesh", async () => {
    vi.useFakeTimers();
    const { computeMesh } = renderShellEditor();
    fireEvent.change(screen.getByLabelText("shell thickness"), { target: { value: "0" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Value must be greater than 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(computeMesh).not.toHaveBeenCalled();
  });

  it("reports the face overlay (with exact centers, not a mesh approximation) at the target's own position and rotation", async () => {
    vi.useFakeTimers();
    const onFaceOverlayChange = vi.fn();
    renderShellEditor({ onFaceOverlayChange });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onFaceOverlayChange).toHaveBeenLastCalledWith({
      faceMesh: faces.mesh,
      centers: faces.centers,
      position: [0.2, 0, 0],
      rotation: [0, 0, 0],
    });
  });

  it("Select on a face row adds it to the picks via onFacePicksChange", async () => {
    vi.useFakeTimers();
    const onFacePicksChange = vi.fn();
    renderShellEditor({ onFacePicksChange });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
    expect(onFacePicksChange).toHaveBeenCalledWith([[0.05, 0, 0]]);
  });

  it("Apply calls onApply with the target body's own geometry replaced in place", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    const robot = makeRobot({ type: "box", size: [0.1, 0.06, 0.04] });
    renderShellEditor({ robot, onApply, facePicks: [[0.05, 0, 0]] });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies).toHaveLength(1);
    expect(nextRobot.bodies[0].id).toBe("chassis");
    expect(nextRobot.bodies[0].visual).toEqual({ type: "cad_mesh", vertices: resultMesh.vertices, faces: resultMesh.faces });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    renderShellEditor({ onApply, onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows a real error message when computeMesh rejects (e.g. the draft-parallel-face limitation)", async () => {
    vi.useFakeTimers();
    const computeMesh = vi.fn().mockRejectedValue(new Error("Could not draft, face is parallel to neutral plane"));
    renderShellEditor({ computeMesh });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Could not draft, face is parallel to neutral plane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("supports a cylinder body too, deriving the shape from its own radius/length", async () => {
    vi.useFakeTimers();
    renderShellEditor({ robot: makeRobot({ type: "cylinder", radius: 0.03, length: 0.08 }) });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(previewFacesMock).toHaveBeenCalledWith({ operation: "cylinder", radius: 0.03, length: 0.08 });
  });
});

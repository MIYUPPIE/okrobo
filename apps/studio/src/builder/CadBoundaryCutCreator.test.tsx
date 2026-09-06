// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadBoundaryCutCreator } from "./CadBoundaryCutCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const cutMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  cut: (...args: unknown[]) => cutMock(...args),
}));

beforeEach(() => cutMock.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [{ id: "chassis", name: "Chassis", transform: identity, mass: 1, inertia, visual: { type: "box", size: [0.1, 0.1, 0.1] } }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

const cutMesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CadBoundaryCutCreator", () => {
  it("shows which body is being cut, with independent Start/End profile fields", () => {
    render(<CadBoundaryCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByText("Cutting into Chassis")).toBeInTheDocument();
    expect(screen.getByLabelText("cad start radius")).toHaveValue(0.02);
    expect(screen.getByLabelText("cad end radius")).toHaveValue(0.01);
    expect(screen.getByLabelText("cad loft height")).toHaveValue(0.2);
  });

  it("shows loading then ready once the worker resolves, calling cut with a loft tool and the target's own converted mesh", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    render(<CadBoundaryCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    const [args] = cutMock.mock.calls[0] as [{ tool: unknown; targetMesh: { vertices: number[] } }];
    expect(args.tool).toEqual({
      operation: "loft",
      startProfile: { type: "circle", radius: 0.02 },
      endProfile: { type: "circle", radius: 0.01 },
      height: 0.2,
    });
    expect(args.targetMesh.vertices.length).toBeGreaterThan(0);
  });

  it("rejects a zero Start radius locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadBoundaryCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad start radius"), { target: { value: "0" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Start radius must be greater than 0")).toBeInTheDocument();
    expect(cutMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with the target body's own geometry replaced", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    const onApply = vi.fn();
    render(<CadBoundaryCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies[0].id).toBe("chassis");
    expect(nextRobot.bodies[0].visual).toEqual({ type: "cad_mesh", vertices: cutMesh.vertices, faces: cutMesh.faces });
    expect(nextRobot.bodies[0].features).toEqual([
      { operation: "box", size: [0.1, 0.1, 0.1] },
      {
        operation: "cut",
        tool: { operation: "loft", start_profile: { type: "circle", radius: 0.02 }, end_profile: { type: "circle", radius: 0.01 }, height: 0.2 },
        position: [0, 0, 0],
      },
    ]);
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadBoundaryCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadBoundaryCreator } from "./CadBoundaryCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const loftMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  loft: (...args: unknown[]) => loftMock(...args),
}));

beforeEach(() => loftMock.mockReset());
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

const mesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CadBoundaryCreator", () => {
  it("defaults to a circle Start profile and a rectangle End profile", () => {
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByLabelText("cad start shape")).toHaveValue("circle");
    expect(screen.getByLabelText("cad start radius")).toHaveValue(0.03);
    expect(screen.getByLabelText("cad end shape")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad end width")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad end height")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad loft height")).toHaveValue(0.08);
  });

  it("switching the Start profile to rectangle swaps its own fields, independently of End", () => {
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad start shape"), { target: { value: "rectangle" } });
    expect(screen.getByLabelText("cad start width")).toBeInTheDocument();
    expect(screen.queryByLabelText("cad start radius")).not.toBeInTheDocument();
    // End is untouched.
    expect(screen.getByLabelText("cad end shape")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad end width")).toBeInTheDocument();
  });

  it("shows loading then ready once the worker resolves, enabling Apply, calling loft with both profiles and height", async () => {
    vi.useFakeTimers();
    loftMock.mockResolvedValue(mesh);
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(loftMock).toHaveBeenCalledWith({
      startProfile: { type: "circle", radius: 0.03 },
      endProfile: { type: "rectangle", width: 0.05, height: 0.05 },
      height: 0.08,
    });
  });

  it("rejects a zero Start radius locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad start radius"), { target: { value: "0" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Start radius must be greater than 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(loftMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with a robot grown by one cad_mesh body and the new body id", async () => {
    vi.useFakeTimers();
    loftMock.mockResolvedValue(mesh);
    const onApply = vi.fn();
    const robot = makeRobot();
    render(<CadBoundaryCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot, newBodyId] = onApply.mock.calls[0] as [RobotDef, string];
    expect(newBodyId).toBe("body-2");
    expect(nextRobot.bodies[1].visual).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// Uses fireEvent (not userEvent) for every field change: this component's
// live preview is debounced behind a real setTimeout, and userEvent v14's
// own internal delays are known to fight vi.useFakeTimers() -- fireEvent's
// direct, synchronous DOM events sidestep that combination entirely rather
// than needing userEvent.setup({advanceTimers}) plumbing. vi.advanceTimersByTimeAsync
// (not the sync advanceTimersByTime) is what actually flushes the mocked
// promise's own .then/.catch continuation after the fake timer fires.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadExtrudeCreator, CAD_PREVIEW_DEBOUNCE_MS } from "./CadExtrudeCreator";

const extrudeRectangleMock = vi.fn();
const extrudeCircleMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  extrudeRectangle: (...args: unknown[]) => extrudeRectangleMock(...args),
  extrudeCircle: (...args: unknown[]) => extrudeCircleMock(...args),
}));

beforeEach(() => {
  extrudeRectangleMock.mockReset();
  extrudeCircleMock.mockReset();
});

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

/** The state updates that land once the debounced worker call's own
 * .then/.catch fires happen outside any act() scope render()/fireEvent()
 * already provide -- wrapping the fake-timer advance itself in act() is
 * what makes React actually flush them before the next assertion runs. */
async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CadExtrudeCreator", () => {
  it("defaults to a rectangle profile with width/height/depth fields", () => {
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByLabelText("cad profile")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad width")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad height")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad depth")).toHaveValue(0.02);
    expect(screen.queryByLabelText("cad radius")).not.toBeInTheDocument();
  });

  it("switching to circle swaps width/height for radius", () => {
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad profile"), { target: { value: "circle" } });
    expect(screen.getByLabelText("cad radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("cad width")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("cad height")).not.toBeInTheDocument();
  });

  it("shows loading then ready once the worker resolves, enabling Apply", async () => {
    vi.useFakeTimers();
    let resolveCall: (result: typeof mesh) => void = () => {};
    extrudeRectangleMock.mockReturnValue(new Promise((resolve) => { resolveCall = resolve; }));
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("computing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    resolveCall(mesh);
    await advanceTimers(0);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(screen.queryByText("computing…")).not.toBeInTheDocument();
  });

  it("shows the error message and keeps Apply disabled when the worker rejects", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockRejectedValue(new Error("degenerate profile"));
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("degenerate profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("rejects a zero width locally without ever calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad width"), { target: { value: "0" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Width must be greater than 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(extrudeRectangleMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with a robot grown by one cad_mesh body and the new body id", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    const onApply = vi.fn();
    const robot = makeRobot();
    render(<CadExtrudeCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot, newBodyId] = onApply.mock.calls[0] as [RobotDef, string];
    expect(newBodyId).toBe("body-2");
    expect(nextRobot.bodies).toHaveLength(2);
    const newBody = nextRobot.bodies[1];
    expect(newBody.id).toBe("body-2");
    expect(newBody.visual).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
    expect(newBody.transform.position).toEqual([0.1, 0, 0]); // 0.1m from `near` (chassis at origin)
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("onPreviewChange receives the mesh+position once ready, and null while invalid or erroring", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    const onPreviewChange = vi.fn();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={onPreviewChange} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh, position: [0.1, 0, 0] });

    fireEvent.change(screen.getByLabelText("cad width"), { target: { value: "0" } });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  });
});

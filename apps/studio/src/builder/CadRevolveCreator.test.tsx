// @vitest-environment jsdom
//
// Same fireEvent + fake-timer technique CadExtrudeCreator.test.tsx already
// proved (see its own header comment for why, not userEvent).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadRevolveCreator } from "./CadRevolveCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const revolveMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  revolve: (...args: unknown[]) => revolveMock(...args),
}));

beforeEach(() => revolveMock.mockReset());
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

describe("CadRevolveCreator", () => {
  it("defaults to a rectangle profile with width/height/offset/angle fields", () => {
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByLabelText("cad profile")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad width")).toHaveValue(0.02);
    expect(screen.getByLabelText("cad height")).toHaveValue(0.03);
    expect(screen.getByLabelText("cad offset")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad angle")).toHaveValue(360);
    expect(screen.queryByLabelText("cad radius")).not.toBeInTheDocument();
  });

  it("switching to circle swaps width/height for radius", () => {
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad profile"), { target: { value: "circle" } });
    expect(screen.getByLabelText("cad radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("cad width")).not.toBeInTheDocument();
  });

  it("shows loading then ready once the worker resolves, enabling Apply", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(revolveMock).toHaveBeenCalledWith({ profile: { type: "rectangle", width: 0.02, height: 0.03 }, offset: 0.05, angleDeg: 360 });
  });

  it("rejects an offset smaller than the profile's own half-extent locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad offset"), { target: { value: "0.005" } }); // < width/2 (0.01)

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Offset must be at least half the width")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(revolveMock).not.toHaveBeenCalled();
  });

  it("rejects an angle outside (0, 360] locally", async () => {
    vi.useFakeTimers();
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad angle"), { target: { value: "400" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Angle must be between 0 and 360")).toBeInTheDocument();
    expect(revolveMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with a robot grown by one cad_mesh body and the new body id", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    const onApply = vi.fn();
    const robot = makeRobot();
    render(<CadRevolveCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

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
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

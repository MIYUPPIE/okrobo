// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadRevolvedCutCreator } from "./CadRevolvedCutCreator";
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

describe("CadRevolvedCutCreator", () => {
  it("shows which body is being cut, defaults to a circle profile with offset/angle fields", () => {
    render(<CadRevolvedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByText("Cutting into Chassis")).toBeInTheDocument();
    expect(screen.getByLabelText("cad offset")).toHaveValue(0.03);
    expect(screen.getByLabelText("cad angle")).toHaveValue(360);
  });

  it("rejects an offset smaller than the profile's own half-extent locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadRevolvedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad offset"), { target: { value: "0.001" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Offset must be at least the radius")).toBeInTheDocument();
    expect(cutMock).not.toHaveBeenCalled();
  });

  it("shows loading then ready once the worker resolves, calling cut with a revolve tool and the target's own converted mesh", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    render(<CadRevolvedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    const [args] = cutMock.mock.calls[0] as [{ tool: unknown; targetMesh: { vertices: number[] } }];
    expect(args.tool).toEqual({ operation: "revolve", profile: { type: "circle", radius: 0.01 }, offset: 0.03, angleDeg: 360 });
    expect(args.targetMesh.vertices.length).toBeGreaterThan(0);
  });

  it("Apply calls onApply with the target body's own geometry replaced", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    const onApply = vi.fn();
    render(<CadRevolvedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies[0].id).toBe("chassis");
    expect(nextRobot.bodies[0].visual).toEqual({ type: "cad_mesh", vertices: cutMesh.vertices, faces: cutMesh.faces });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadRevolvedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

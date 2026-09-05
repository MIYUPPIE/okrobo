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
const previewEdgesMock = vi.fn();
const filletMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  revolve: (...args: unknown[]) => revolveMock(...args),
  previewEdges: (...args: unknown[]) => previewEdgesMock(...args),
  fillet: (...args: unknown[]) => filletMock(...args),
}));

const noEdges = { lines: [] as number[], edgeGroups: [] as { start: number; count: number; edgeId: number }[] };

beforeEach(() => {
  revolveMock.mockReset();
  previewEdgesMock.mockReset().mockResolvedValue(noEdges);
  filletMock.mockReset();
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

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CadRevolveCreator", () => {
  it("defaults to a rectangle profile with width/height/offset/angle fields", () => {
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    expect(screen.getByLabelText("cad profile")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad width")).toHaveValue(0.02);
    expect(screen.getByLabelText("cad height")).toHaveValue(0.03);
    expect(screen.getByLabelText("cad offset")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad angle")).toHaveValue(360);
    expect(screen.queryByLabelText("cad radius")).not.toBeInTheDocument();
  });

  it("switching to circle swaps width/height for radius", () => {
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad profile"), { target: { value: "circle" } });
    expect(screen.getByLabelText("cad radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("cad width")).not.toBeInTheDocument();
  });

  it("shows loading then ready once the worker resolves, enabling Apply", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(revolveMock).toHaveBeenCalledWith({ profile: { type: "rectangle", width: 0.02, height: 0.03 }, offset: 0.05, angleDeg: 360 });
  });

  it("rejects an offset smaller than the profile's own half-extent locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad offset"), { target: { value: "0.005" } }); // < width/2 (0.01)

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Offset must be at least half the width")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(revolveMock).not.toHaveBeenCalled();
  });

  it("rejects an angle outside (0, 360] locally", async () => {
    vi.useFakeTimers();
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
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
    render(<CadRevolveCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

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
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  // CAD Kernel Phase 5 (Fillet + Chamfer).
  const edges = { lines: [0, 0, 0, 10, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };

  it("shows an Edges section once the base shape's own edge preview settles", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    render(<CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Edge 1")).toBeInTheDocument();
  });

  it("once edges are picked, calls fillet (not revolve) with the shape and parsed picks", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    filletMock.mockResolvedValue({ vertices: [9, 9, 9], faces: [0, 0, 0] });
    const { rerender } = render(
      <CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    revolveMock.mockClear();

    const picked = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.005" }];
    rerender(
      <CadRevolveCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={picked} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(filletMock).toHaveBeenCalledWith(
      { operation: "revolve", profile: { type: "rectangle", width: 0.02, height: 0.03 }, offset: 0.05, angleDeg: 360 },
      [{ point: [5, 0, 0], operation: "fillet", value: 0.005 }],
    );
    expect(revolveMock).not.toHaveBeenCalled();
  });

  it("changing a dimension clears the picks and the edge overlay", async () => {
    vi.useFakeTimers();
    revolveMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    const onEdgePicksChange = vi.fn();
    const onEdgeOverlayChange = vi.fn();
    render(
      <CadRevolveCreator
        robot={makeRobot()}
        near={null}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
        onEdgePicksChange={onEdgePicksChange}
        onEdgeOverlayChange={onEdgeOverlayChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("cad angle"), { target: { value: "180" } });
    expect(onEdgePicksChange).toHaveBeenCalledWith([]);
    expect(onEdgeOverlayChange).toHaveBeenCalledWith(null);
  });
});

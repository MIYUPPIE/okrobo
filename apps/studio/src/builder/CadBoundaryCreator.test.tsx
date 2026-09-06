// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadBoundaryCreator } from "./CadBoundaryCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const loftMock = vi.fn();
const previewEdgesMock = vi.fn();
const filletMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  loft: (...args: unknown[]) => loftMock(...args),
  previewEdges: (...args: unknown[]) => previewEdgesMock(...args),
  fillet: (...args: unknown[]) => filletMock(...args),
}));

const noEdges = { lines: [] as number[], edgeGroups: [] as { start: number; count: number; edgeId: number }[] };

beforeEach(() => {
  loftMock.mockReset();
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

describe("CadBoundaryCreator", () => {
  it("defaults to a circle Start profile and a rectangle End profile", () => {
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    expect(screen.getByLabelText("cad start shape")).toHaveValue("circle");
    expect(screen.getByLabelText("cad start radius")).toHaveValue(0.03);
    expect(screen.getByLabelText("cad end shape")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad end width")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad end height")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad loft height")).toHaveValue(0.08);
  });

  it("switching the Start profile to rectangle swaps its own fields, independently of End", () => {
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
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
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

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
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
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
    render(<CadBoundaryCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot, newBodyId] = onApply.mock.calls[0] as [RobotDef, string];
    expect(newBodyId).toBe("body-2");
    expect(nextRobot.bodies[1].visual).toEqual({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });
    expect(nextRobot.bodies[1].features).toEqual([
      { operation: "loft", start_profile: { type: "circle", radius: 0.03 }, end_profile: { type: "rectangle", width: 0.05, height: 0.05 }, height: 0.08 },
    ]);
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  // CAD Kernel Phase 5 (Fillet + Chamfer).
  const edges = { lines: [0, 0, 0, 10, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };

  it("shows an Edges section once the base shape's own edge preview settles", async () => {
    vi.useFakeTimers();
    loftMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    render(<CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Edge 1")).toBeInTheDocument();
  });

  it("once edges are picked, calls fillet (not loft) with the shape and parsed picks", async () => {
    vi.useFakeTimers();
    loftMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    filletMock.mockResolvedValue({ vertices: [9, 9, 9], faces: [0, 0, 0] });
    const { rerender } = render(
      <CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    loftMock.mockClear();

    const picked = [{ point: [5, 0, 0] as [number, number, number], operation: "chamfer" as const, value: "0.005" }];
    rerender(
      <CadBoundaryCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={picked} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(filletMock).toHaveBeenCalledWith(
      {
        operation: "loft",
        startProfile: { type: "circle", radius: 0.03 },
        endProfile: { type: "rectangle", width: 0.05, height: 0.05 },
        height: 0.08,
      },
      [{ point: [5, 0, 0], operation: "chamfer", value: 0.005 }],
    );
    expect(loftMock).not.toHaveBeenCalled();
  });

  it("changing a dimension clears the picks and the edge overlay", async () => {
    vi.useFakeTimers();
    loftMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    const onEdgePicksChange = vi.fn();
    const onEdgeOverlayChange = vi.fn();
    render(
      <CadBoundaryCreator
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

    fireEvent.change(screen.getByLabelText("cad loft height"), { target: { value: "0.1" } });
    expect(onEdgePicksChange).toHaveBeenCalledWith([]);
    expect(onEdgeOverlayChange).toHaveBeenCalledWith(null);
  });
});

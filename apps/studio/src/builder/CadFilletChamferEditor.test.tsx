// @vitest-environment jsdom
//
// Same fireEvent + fake-timer technique CadExtrudeCreator.test.tsx already
// proved (see its own header comment for why, not userEvent).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadFilletChamferEditor } from "./CadFilletChamferEditor";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const previewEdgesMock = vi.fn();
const filletMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  previewEdges: (...args: unknown[]) => previewEdgesMock(...args),
  fillet: (...args: unknown[]) => filletMock(...args),
}));

const edges = { lines: [0, 0, 0, 10, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };
const resultMesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

beforeEach(() => {
  previewEdgesMock.mockReset().mockResolvedValue(edges);
  filletMock.mockReset().mockResolvedValue(resultMesh);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(visual: RobotDef["bodies"][number]["visual"], rotation_rpy: [number, number, number] = [0, 0, 0]): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
    bodies: [{ id: "chassis", name: "Chassis", transform: { position: [0.2, 0, 0], rotation_rpy }, mass: 1, inertia, visual }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CadFilletChamferEditor", () => {
  it("shows an unsupported-type message (with only a Cancel button) for a sphere body", () => {
    const onCancel = vi.fn();
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "sphere", radius: 0.05 })}
        targetBodyId="chassis"
        onApply={() => {}}
        onCancel={onCancel}
        onPreviewChange={() => {}}
        edgePicks={[]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    expect(screen.getByText(/only supports box and cylinder bodies/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows an Edges section for a box body once the edge preview settles", async () => {
    vi.useFakeTimers();
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "box", size: [0.1, 0.06, 0.04] })}
        targetBodyId="chassis"
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(previewEdgesMock).toHaveBeenCalledWith({ operation: "box", size: [0.1, 0.06, 0.04] });
    expect(screen.getByText("Edge 1")).toBeInTheDocument();
  });

  it("supports a cylinder body too, deriving the shape from its own radius/length", async () => {
    vi.useFakeTimers();
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "cylinder", radius: 0.03, length: 0.08 })}
        targetBodyId="chassis"
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(previewEdgesMock).toHaveBeenCalledWith({ operation: "cylinder", radius: 0.03, length: 0.08 });
  });

  it("reports the edge overlay and preview at the target body's own position and rotation", async () => {
    vi.useFakeTimers();
    filletMock.mockResolvedValue(resultMesh);
    const onPreviewChange = vi.fn();
    const onEdgeOverlayChange = vi.fn();
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "box", size: [0.1, 0.06, 0.04] }, [0, 1.2, 0])}
        targetBodyId="chassis"
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={onPreviewChange}
        edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={onEdgeOverlayChange}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh: resultMesh, position: [0.2, 0, 0], rotation: [0, 1.2, 0] });
    expect(onEdgeOverlayChange).toHaveBeenLastCalledWith({ edgeMesh: edges, position: [0.2, 0, 0], rotation: [0, 1.2, 0] });
  });

  it("calls fillet with the shape derived from the target's own geometry and the parsed picks", async () => {
    vi.useFakeTimers();
    filletMock.mockResolvedValue(resultMesh);
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "box", size: [0.1, 0.06, 0.04] })}
        targetBodyId="chassis"
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[{ point: [5, 0, 0], operation: "chamfer", value: "0.01" }]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(filletMock).toHaveBeenCalledWith({ operation: "box", size: [0.1, 0.06, 0.04] }, [{ point: [5, 0, 0], operation: "chamfer", value: 0.01 }]);
  });

  it("Apply calls onApply with the target body's own geometry replaced in place, id/name/transform unchanged", async () => {
    vi.useFakeTimers();
    filletMock.mockResolvedValue(resultMesh);
    const onApply = vi.fn();
    const robot = makeRobot({ type: "box", size: [0.1, 0.06, 0.04] });
    render(
      <CadFilletChamferEditor
        robot={robot}
        targetBodyId="chassis"
        onApply={onApply}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies).toHaveLength(1);
    const body = nextRobot.bodies[0];
    expect(body.id).toBe("chassis");
    expect(body.transform).toEqual(robot.bodies[0].transform);
    expect(body.visual).toEqual({ type: "cad_mesh", vertices: resultMesh.vertices, faces: resultMesh.faces });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "box", size: [0.1, 0.06, 0.04] })}
        targetBodyId="chassis"
        onApply={onApply}
        onCancel={onCancel}
        onPreviewChange={() => {}}
        edgePicks={[]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("renders nothing for a target id that doesn't match any body", () => {
    const { container } = render(
      <CadFilletChamferEditor
        robot={makeRobot({ type: "box", size: [0.1, 0.06, 0.04] })}
        targetBodyId="does-not-exist"
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
        edgePicks={[]}
        onEdgePicksChange={() => {}}
        onEdgeOverlayChange={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

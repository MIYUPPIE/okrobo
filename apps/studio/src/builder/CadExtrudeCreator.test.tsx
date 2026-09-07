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
import { CadExtrudeCreator } from "./CadExtrudeCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const extrudeRectangleMock = vi.fn();
const extrudeCircleMock = vi.fn();
const previewEdgesMock = vi.fn();
const filletMock = vi.fn();
const replayFeaturesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  extrudeRectangle: (...args: unknown[]) => extrudeRectangleMock(...args),
  extrudeCircle: (...args: unknown[]) => extrudeCircleMock(...args),
  previewEdges: (...args: unknown[]) => previewEdgesMock(...args),
  fillet: (...args: unknown[]) => filletMock(...args),
  replayFeatures: (...args: unknown[]) => replayFeaturesMock(...args),
}));

const noEdges = { lines: [] as number[], edgeGroups: [] as { start: number; count: number; edgeId: number }[] };

beforeEach(() => {
  extrudeRectangleMock.mockReset();
  extrudeCircleMock.mockReset();
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
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    expect(screen.getByLabelText("cad profile")).toHaveValue("rectangle");
    expect(screen.getByLabelText("cad width")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad height")).toHaveValue(0.05);
    expect(screen.getByLabelText("cad depth")).toHaveValue(0.02);
    expect(screen.queryByLabelText("cad radius")).not.toBeInTheDocument();
  });

  it("switching to circle swaps width/height for radius", () => {
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad profile"), { target: { value: "circle" } });
    expect(screen.getByLabelText("cad radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("cad width")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("cad height")).not.toBeInTheDocument();
  });

  it("shows loading then ready once the worker resolves, enabling Apply", async () => {
    vi.useFakeTimers();
    let resolveCall: (result: typeof mesh) => void = () => {};
    extrudeRectangleMock.mockReturnValue(new Promise((resolve) => { resolveCall = resolve; }));
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

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
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("degenerate profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("rejects a zero width locally without ever calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);
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
    render(<CadExtrudeCreator robot={robot} near={robot.bodies[0]} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

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
    expect(newBody.features).toEqual([{ operation: "extrude", profile: { type: "rectangle", width: 0.05, height: 0.05 }, depth: 0.02 }]);
  });

  // CAD Kernel Phase 7.1: the new body's own construction history.
  it("Apply records an extrude root plus a fillet_chamfer step when edges were picked", async () => {
    vi.useFakeTimers();
    const edges = { lines: [0, 0, 0, 10, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };
    previewEdgesMock.mockResolvedValue(edges);
    filletMock.mockResolvedValue(mesh);
    const onApply = vi.fn();
    const picked = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.005" }];
    render(
      <CadExtrudeCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={picked} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies[1].features).toEqual([
      { operation: "extrude", profile: { type: "rectangle", width: 0.05, height: 0.05 }, depth: 0.02 },
      { operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [5, 0, 0], operation: "fillet", value: 0.005 }] },
    ]);
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("onPreviewChange receives the mesh+position once ready, and null while invalid or erroring", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    const onPreviewChange = vi.fn();
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={onPreviewChange} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh, position: [0.1, 0, 0] });

    fireEvent.change(screen.getByLabelText("cad width"), { target: { value: "0" } });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  });

  // CAD Kernel Phase 5 (Fillet + Chamfer).
  const edges = { lines: [0, 0, 0, 10, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };

  it("shows an Edges section with a real edge once the base shape's own edge preview settles", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    render(<CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Edge 1")).toBeInTheDocument();
    expect(previewEdgesMock).toHaveBeenCalledWith({ operation: "extrude", profile: { type: "rectangle", width: 0.05, height: 0.05 }, depth: 0.02 });
  });

  it("reports the edge overlay positioned exactly where the ghost preview lands", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    const onEdgeOverlayChange = vi.fn();
    const robot = makeRobot();
    render(
      <CadExtrudeCreator robot={robot} near={robot.bodies[0]} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={onEdgeOverlayChange} />,
    );

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onEdgeOverlayChange).toHaveBeenLastCalledWith({ edgeMesh: edges, position: [0.1, 0, 0], rotation: [0, 0, 0] });
  });

  it("once edges are picked, calls fillet (not extrudeRectangle) with the shape and parsed picks", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    filletMock.mockResolvedValue({ vertices: [9, 9, 9], faces: [0, 0, 0] });
    const { rerender } = render(
      <CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={[]} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    extrudeRectangleMock.mockClear();

    const picked = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.005" }];
    rerender(
      <CadExtrudeCreator robot={makeRobot()} near={null} onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} edgePicks={picked} onEdgePicksChange={() => {}} onEdgeOverlayChange={() => {}} />,
    );

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(filletMock).toHaveBeenCalledWith(
      { operation: "extrude", profile: { type: "rectangle", width: 0.05, height: 0.05 }, depth: 0.02 },
      [{ point: [5, 0, 0], operation: "fillet", value: 0.005 }],
    );
    expect(extrudeRectangleMock).not.toHaveBeenCalled();
  });

  it("changing a dimension clears the picks and the edge overlay", async () => {
    vi.useFakeTimers();
    extrudeRectangleMock.mockResolvedValue(mesh);
    previewEdgesMock.mockResolvedValue(edges);
    const onEdgePicksChange = vi.fn();
    const onEdgeOverlayChange = vi.fn();
    render(
      <CadExtrudeCreator
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

    fireEvent.change(screen.getByLabelText("cad width"), { target: { value: "0.07" } });
    expect(onEdgePicksChange).toHaveBeenCalledWith([]);
    expect(onEdgeOverlayChange).toHaveBeenCalledWith(null);
  });

  // CAD Kernel Phase 7.3 (edit-any-step).
  describe("editing", () => {
    const editFeature = { operation: "extrude" as const, profile: { type: "rectangle" as const, width: 0.1, height: 0.06 }, depth: 0.04 };
    const shellFeature = { operation: "shell" as const, picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] as [number, number, number] }], thickness: 0.005 };

    it("seeds the form from the edited feature's own params, not initialDraft", () => {
      render(
        <CadExtrudeCreator
          robot={makeRobot()}
          near={null}
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 0, allFeatures: [editFeature], targetBodyId: "chassis", onApply: () => {} }}
        />,
      );
      expect(screen.getByText("Edit Extrude")).toBeInTheDocument();
      expect(screen.getByLabelText("cad width")).toHaveValue(0.1);
      expect(screen.getByLabelText("cad height")).toHaveValue(0.06);
      expect(screen.getByLabelText("cad depth")).toHaveValue(0.04);
      expect(screen.queryByText("Edges")).not.toBeInTheDocument();
    });

    it("previews the WHOLE chain via replayFeatures (this step replaced), not just this step in isolation", async () => {
      vi.useFakeTimers();
      replayFeaturesMock.mockResolvedValue({ mesh, steps: [] });
      render(
        <CadExtrudeCreator
          robot={makeRobot()}
          near={null}
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 0, allFeatures: [editFeature, shellFeature], targetBodyId: "chassis", onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(replayFeaturesMock).toHaveBeenCalledWith([editFeature, shellFeature]);
      expect(extrudeRectangleMock).not.toHaveBeenCalled();
    });

    it("Apply calls editing.onApply with the freshly parsed Feature, not the normal makeCadBody/onApply path", async () => {
      vi.useFakeTimers();
      replayFeaturesMock.mockResolvedValue({ mesh, steps: [] });
      const editApply = vi.fn();
      const onApply = vi.fn();
      render(
        <CadExtrudeCreator
          robot={makeRobot()}
          near={null}
          onApply={onApply}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 0, allFeatures: [editFeature], targetBodyId: "chassis", onApply: editApply }}
        />,
      );
      fireEvent.change(screen.getByLabelText("cad depth"), { target: { value: "0.08" } });
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(editApply).toHaveBeenCalledWith({ operation: "extrude", profile: { type: "rectangle", width: 0.1, height: 0.06 }, depth: 0.08 });
      expect(onApply).not.toHaveBeenCalled();
    });

    it("previews at the target body's own position and rotation, not a near-relative placement", async () => {
      vi.useFakeTimers();
      replayFeaturesMock.mockResolvedValue({ mesh, steps: [] });
      const onPreviewChange = vi.fn();
      const robot = makeRobot();
      robot.bodies[0].transform = { position: [0.3, 0.1, 0], rotation_rpy: [0, 0.5, 0] };
      render(
        <CadExtrudeCreator
          robot={robot}
          near={null}
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={onPreviewChange}
          edgePicks={[]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 0, allFeatures: [editFeature], targetBodyId: "chassis", onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh, position: [0.3, 0.1, 0], rotation: [0, 0.5, 0] });
    });
  });
});

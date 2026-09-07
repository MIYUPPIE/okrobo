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
const previewEdgesAtStepMock = vi.fn();
const replayFeaturesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  previewEdges: (...args: unknown[]) => previewEdgesMock(...args),
  fillet: (...args: unknown[]) => filletMock(...args),
  previewEdgesAtStep: (...args: unknown[]) => previewEdgesAtStepMock(...args),
  replayFeatures: (...args: unknown[]) => replayFeaturesMock(...args),
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
    // CAD Kernel Phase 7.1: the target's own bare box has no prior features,
    // so a synthesized box root is prepended ahead of this fillet_chamfer step.
    expect(body.features).toEqual([
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [5, 0, 0], operation: "fillet", value: 0.005 }] },
    ]);
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

  // CAD Kernel Phase 7.3 (edit-any-step).
  describe("editing", () => {
    const rootFeature = { operation: "box" as const, size: [0.1, 0.06, 0.04] as [number, number, number] };
    const editFeature = {
      operation: "fillet_chamfer" as const,
      picks: [{ source_step: 0, local_index: 0, point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: 0.005 }],
    };

    it("shows an Edges section from previewEdgesAtStep(allFeatures, stepIndex), not the target's own (already-baked) current geometry", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 1, allFeatures: [rootFeature, editFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(previewEdgesAtStepMock).toHaveBeenCalledWith([rootFeature, editFeature], 1);
      expect(previewEdgesMock).not.toHaveBeenCalled();
      expect(screen.getByText("Edge 1")).toBeInTheDocument();
    });

    it("previews the whole chain via replayFeatures (this step's picks replaced), not fillet() against a reconstructed shape", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.01" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 1, allFeatures: [rootFeature, editFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(replayFeaturesMock).toHaveBeenCalledWith([
        rootFeature,
        { operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [5, 0, 0], operation: "fillet", value: 0.01 }] },
      ]);
      expect(filletMock).not.toHaveBeenCalled();
    });

    it("Apply calls editing.onApply with the freshly parsed Feature, not replaceBodyGeometry", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      const editApply = vi.fn();
      const onApply = vi.fn();
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={onApply}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 1, allFeatures: [rootFeature, editFeature], onApply: editApply }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(editApply).toHaveBeenCalledWith(editFeature);
      expect(onApply).not.toHaveBeenCalled();
    });
  });

  // CAD Kernel Phase 7.4 (reorder/insert/delete).
  describe("inserting", () => {
    const rootFeature = { operation: "box" as const, size: [0.1, 0.06, 0.04] as [number, number, number] };
    const insertedFeature = {
      operation: "fillet_chamfer" as const,
      picks: [{ source_step: 0, local_index: 0, point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: 0.005 }],
    };

    it("shows an Edges section from previewEdgesAtStep(allFeatures, afterIndex + 1), the state right AFTER the insertion point", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          inserting={{ afterIndex: 0, allFeatures: [rootFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(previewEdgesAtStepMock).toHaveBeenCalledWith([rootFeature], 1);
      expect(previewEdgesMock).not.toHaveBeenCalled();
      expect(screen.getByText("Edge 1")).toBeInTheDocument();
    });

    it("previews the whole chain via replayFeatures with the new step spliced in after afterIndex, not fillet() against a reconstructed shape", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          inserting={{ afterIndex: 0, allFeatures: [rootFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(replayFeaturesMock).toHaveBeenCalledWith([rootFeature, insertedFeature]);
      expect(filletMock).not.toHaveBeenCalled();
    });

    it("Apply calls inserting.onApply with the freshly built Feature, not replaceBodyGeometry", async () => {
      vi.useFakeTimers();
      previewEdgesAtStepMock.mockResolvedValue(edges);
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      const insertApply = vi.fn();
      const onApply = vi.fn();
      render(
        <CadFilletChamferEditor
          robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] })}
          targetBodyId="chassis"
          onApply={onApply}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          edgePicks={[{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]}
          onEdgePicksChange={() => {}}
          onEdgeOverlayChange={() => {}}
          inserting={{ afterIndex: 0, allFeatures: [rootFeature], onApply: insertApply }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      expect(insertApply).toHaveBeenCalledWith(insertedFeature);
      expect(onApply).not.toHaveBeenCalled();
    });
  });
});

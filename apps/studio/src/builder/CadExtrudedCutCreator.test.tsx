// @vitest-environment jsdom
//
// Same fireEvent + fake-timer technique CadExtrudeCreator.test.tsx already
// proved (see its own header comment for why, not userEvent).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { CadExtrudedCutCreator } from "./CadExtrudedCutCreator";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const cutMock = vi.fn();
const replayFeaturesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  cut: (...args: unknown[]) => cutMock(...args),
  replayFeatures: (...args: unknown[]) => replayFeaturesMock(...args),
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
    bodies: [
      {
        id: "chassis",
        name: "Chassis",
        transform: { position: [0.2, 0, 0], rotation_rpy: [0, 0, 0] },
        mass: 1,
        inertia,
        visual: { type: "box", size: [0.1, 0.1, 0.1] },
      },
    ],
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

describe("CadExtrudedCutCreator", () => {
  it("shows which body is being cut, defaults to a circle tool profile", () => {
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    expect(screen.getByText("Cutting into Chassis")).toBeInTheDocument();
    expect(screen.getByLabelText("cad profile")).toHaveValue("circle");
    expect(screen.getByLabelText("cad radius")).toHaveValue(0.015);
    expect(screen.getByLabelText("cad depth")).toHaveValue(0.2);
    expect(screen.getByLabelText("cad position x")).toHaveValue(0);
    expect(screen.getByLabelText("cad position y")).toHaveValue(0);
    expect(screen.getByLabelText("cad position z")).toHaveValue(0);
  });

  it("shows loading then ready once the worker resolves, enabling Apply, calling cut with the target's own converted mesh", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(cutMock).toHaveBeenCalledTimes(1);
    const [args] = cutMock.mock.calls[0] as [{ targetMesh: { vertices: number[]; faces: number[] }; tool: unknown; position: [number, number, number] }];
    expect(args.tool).toEqual({ operation: "extrude", profile: { type: "circle", radius: 0.015 }, depth: 0.2 });
    expect(args.position).toEqual([0, 0, 0]);
    expect(args.targetMesh.vertices.length).toBeGreaterThan(0); // a real converted box mesh, not empty
  });

  it("allows a negative position offset (drilling from the other side), unlike the always-positive dimension fields", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad position x"), { target: { value: "-0.03" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    const [args] = cutMock.mock.calls.at(-1) as [{ position: [number, number, number] }];
    expect(args.position).toEqual([-0.03, 0, 0]);
  });

  it("rejects a zero depth locally, without calling the worker", async () => {
    vi.useFakeTimers();
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("cad depth"), { target: { value: "0" } });

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Depth must be greater than 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(cutMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with the target body's own geometry replaced, id/name/transform unchanged", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    const onApply = vi.fn();
    const robot = makeRobot();
    render(<CadExtrudedCutCreator robot={robot} targetBodyId="chassis" onApply={onApply} onCancel={() => {}} onPreviewChange={() => {}} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [nextRobot] = onApply.mock.calls[0] as [RobotDef];
    expect(nextRobot.bodies).toHaveLength(1);
    const body = nextRobot.bodies[0];
    expect(body.id).toBe("chassis");
    expect(body.transform).toEqual(robot.bodies[0].transform);
    expect(body.visual).toEqual({ type: "cad_mesh", vertices: cutMesh.vertices, faces: cutMesh.faces });
    expect(body.collision).toEqual({ type: "cad_mesh", vertices: cutMesh.vertices, faces: cutMesh.faces });
    // CAD Kernel Phase 7.1: a synthesized box root (the target had no prior
    // features), then this cut's own feature.
    expect(body.features).toEqual([
      { operation: "box", size: [0.1, 0.1, 0.1] },
      { operation: "cut", tool: { operation: "extrude", profile: { type: "circle", radius: 0.015 }, depth: 0.2 }, position: [0, 0, 0] },
    ]);
  });

  it("onPreviewChange receives the mesh at the target body's own world position once ready", async () => {
    vi.useFakeTimers();
    cutMock.mockResolvedValue(cutMesh);
    const onPreviewChange = vi.fn();
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={() => {}} onCancel={() => {}} onPreviewChange={onPreviewChange} />);

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh: cutMesh, position: [0.2, 0, 0] });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CadExtrudedCutCreator robot={makeRobot()} targetBodyId="chassis" onApply={onApply} onCancel={onCancel} onPreviewChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  // CAD Kernel Phase 7.3 (edit-any-step).
  describe("editing", () => {
    const editFeature = {
      operation: "cut" as const,
      tool: { operation: "extrude" as const, profile: { type: "circle" as const, radius: 0.02 }, depth: 0.15 },
      position: [0.01, 0.02, 0.03] as [number, number, number],
    };

    it("seeds the form from the edited feature's own tool/position", () => {
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 1, allFeatures: [{ operation: "box", size: [0.1, 0.1, 0.1] }, editFeature], onApply: () => {} }}
        />,
      );
      expect(screen.getByText("Edit Cut (Extruded)")).toBeInTheDocument();
      expect(screen.getByLabelText("cad radius")).toHaveValue(0.02);
      expect(screen.getByLabelText("cad depth")).toHaveValue(0.15);
      expect(screen.getByLabelText("cad position x")).toHaveValue(0.01);
      expect(screen.getByLabelText("cad position y")).toHaveValue(0.02);
      expect(screen.getByLabelText("cad position z")).toHaveValue(0.03);
    });

    it("previews the whole chain via replayFeatures, not cut() against the target's own current mesh", async () => {
      vi.useFakeTimers();
      const resultMesh = { vertices: [1, 2, 3], faces: [0, 0, 0] };
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      const rootFeature = { operation: "box" as const, size: [0.1, 0.1, 0.1] as [number, number, number] };
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          editing={{ feature: editFeature, stepIndex: 1, allFeatures: [rootFeature, editFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(replayFeaturesMock).toHaveBeenCalledWith([rootFeature, editFeature]);
      expect(cutMock).not.toHaveBeenCalled();
    });

    it("Apply calls editing.onApply with the freshly parsed Feature, not replaceBodyGeometry", async () => {
      vi.useFakeTimers();
      replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [1, 2, 3], faces: [0, 0, 0] }, steps: [] });
      const editApply = vi.fn();
      const onApply = vi.fn();
      const rootFeature = { operation: "box" as const, size: [0.1, 0.1, 0.1] as [number, number, number] };
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={onApply}
          onCancel={() => {}}
          onPreviewChange={() => {}}
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
    const rootFeature = { operation: "box" as const, size: [0.1, 0.1, 0.1] as [number, number, number] };
    const insertedFeature = {
      operation: "cut" as const,
      tool: { operation: "extrude" as const, profile: { type: "circle" as const, radius: 0.015 }, depth: 0.2 },
      position: [0, 0, 0] as [number, number, number],
    };

    it("shows the Insert title, seeded from the default draft, not any existing feature", () => {
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          inserting={{ afterIndex: 0, allFeatures: [rootFeature], onApply: () => {} }}
        />,
      );
      expect(screen.getByText("Insert Cut (Extruded)")).toBeInTheDocument();
      expect(screen.getByLabelText("cad radius")).toHaveValue(0.015);
      expect(screen.getByLabelText("cad depth")).toHaveValue(0.2);
    });

    it("previews the whole chain via replayFeatures with the new step spliced in after afterIndex, not cut() against the target's own current mesh", async () => {
      vi.useFakeTimers();
      const resultMesh = { vertices: [1, 2, 3], faces: [0, 0, 0] };
      replayFeaturesMock.mockResolvedValue({ mesh: resultMesh, steps: [] });
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={() => {}}
          onCancel={() => {}}
          onPreviewChange={() => {}}
          inserting={{ afterIndex: 0, allFeatures: [rootFeature], onApply: () => {} }}
        />,
      );
      await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
      expect(replayFeaturesMock).toHaveBeenCalledWith([rootFeature, insertedFeature]);
      expect(cutMock).not.toHaveBeenCalled();
    });

    it("Apply calls inserting.onApply with the freshly built Feature, not replaceBodyGeometry", async () => {
      vi.useFakeTimers();
      replayFeaturesMock.mockResolvedValue({ mesh: { vertices: [1, 2, 3], faces: [0, 0, 0] }, steps: [] });
      const insertApply = vi.fn();
      const onApply = vi.fn();
      render(
        <CadExtrudedCutCreator
          robot={makeRobot()}
          targetBodyId="chassis"
          onApply={onApply}
          onCancel={() => {}}
          onPreviewChange={() => {}}
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

// @vitest-environment jsdom
//
// Same fireEvent + fake-timer technique CadExtrudeCreator.test.tsx already
// proved (see its own header comment for why, not userEvent).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, RobotDef } from "../contracts/robotDef";
import { CadPrimitiveRootEditor } from "./CadPrimitiveRootEditor";
import { CAD_PREVIEW_DEBOUNCE_MS } from "./useCadPreview";

const replayFeaturesMock = vi.fn();
vi.mock("../cad/cadClient", () => ({
  replayFeatures: (...args: unknown[]) => replayFeaturesMock(...args),
}));

const mesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

beforeEach(() => replayFeaturesMock.mockReset().mockResolvedValue({ mesh, steps: [] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeRobot(visual: RobotDef["bodies"][number]["visual"], features: Feature[]): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
    bodies: [{ id: "chassis", name: "Chassis", transform: { position: [0.2, 0, 0], rotation_rpy: [0, 1.1, 0] }, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 }, visual, features }],
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

describe("CadPrimitiveRootEditor", () => {
  it("seeds the form from the box feature's own current size", () => {
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    expect(screen.getByText("Edit Box")).toBeInTheDocument();
    expect(screen.getByLabelText("root size x")).toHaveValue(0.1);
    expect(screen.getByLabelText("root size y")).toHaveValue(0.06);
    expect(screen.getByLabelText("root size z")).toHaveValue(0.04);
  });

  it("seeds the form from the cylinder feature's own current radius/length", () => {
    const feature: Feature = { operation: "cylinder", radius: 0.03, length: 0.08 };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    expect(screen.getByText("Edit Cylinder")).toBeInTheDocument();
    expect(screen.getByLabelText("root radius")).toHaveValue(0.03);
    expect(screen.getByLabelText("root length")).toHaveValue(0.08);
  });

  it("computes a live preview via replayFeatures with the parsed box at index 0, enabling Apply", async () => {
    vi.useFakeTimers();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(replayFeaturesMock).toHaveBeenCalledWith([{ operation: "box", size: [0.1, 0.06, 0.04] }]);
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
  });

  it("previews the WHOLE chain (downstream steps replayed on top), not the isolated primitive alone", async () => {
    vi.useFakeTimers();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    const shellFeature: Feature = { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature, shellFeature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature, shellFeature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(replayFeaturesMock).toHaveBeenCalledWith([feature, shellFeature]);
  });

  it("rejects a zero size locally, without calling the worker", async () => {
    vi.useFakeTimers();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("root size x"), { target: { value: "0" } });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(screen.getByText("Size X must be greater than 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(replayFeaturesMock).not.toHaveBeenCalled();
  });

  it("Apply calls onApply with the freshly parsed box Feature, not the body's own document", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={onApply}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("root size x"), { target: { value: "0.2" } });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ operation: "box", size: [0.2, 0.06, 0.04] });
  });

  it("Apply calls onApply with a parsed cylinder Feature", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn();
    const feature: Feature = { operation: "cylinder", radius: 0.03, length: 0.08 };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={onApply}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ operation: "cylinder", radius: 0.03, length: 0.08 });
  });

  it("reports the preview at the target body's own position and rotation", async () => {
    vi.useFakeTimers();
    const onPreviewChange = vi.fn();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={onPreviewChange}
      />,
    );
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(onPreviewChange).toHaveBeenLastCalledWith({ mesh, position: [0.2, 0, 0], rotation: [0, 1.1, 0] });
  });

  it("Cancel calls onCancel without calling onApply", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="chassis"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={onApply}
        onCancel={onCancel}
        onPreviewChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("renders nothing for a target id that doesn't match any body", () => {
    const feature: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
    const { container } = render(
      <CadPrimitiveRootEditor
        feature={feature}
        allFeatures={[feature]}
        targetBodyId="does-not-exist"
        robot={makeRobot({ type: "cad_mesh", vertices: [], faces: [] }, [feature])}
        onApply={() => {}}
        onCancel={() => {}}
        onPreviewChange={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

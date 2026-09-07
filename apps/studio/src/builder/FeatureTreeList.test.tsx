// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Feature } from "../contracts/robotDef";
import { FeatureTreeList } from "./FeatureTreeList";

afterEach(() => cleanup());

describe("FeatureTreeList", () => {
  it("renders nothing for an absent features list", () => {
    const { container } = render(<FeatureTreeList features={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty features list", () => {
    const { container } = render(<FeatureTreeList features={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per feature, in order", () => {
    const features: Feature[] = [
      { operation: "extrude", profile: { type: "rectangle", width: 0.1, height: 0.06 }, depth: 0.04 },
      { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
      { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 5 },
    ];
    render(<FeatureTreeList features={features} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Extrude (0.1×0.06m rect, depth 0.04m)");
    expect(rows[1]).toHaveTextContent("Shell (1 face, thickness 0.005m)");
    expect(rows[2]).toHaveTextContent("Draft (1 face, angle 5°)");
  });

  it("labels every feature kind with a short human line", () => {
    const cases: [Feature, string][] = [
      [{ operation: "extrude", profile: { type: "circle", radius: 0.02 }, depth: 0.04 }, "Extrude (0.02m radius circle, depth 0.04m)"],
      [{ operation: "revolve", profile: { type: "circle", radius: 0.02 }, offset: 0.05, angle_deg: 360 }, "Revolve (0.02m radius circle, offset 0.05m, 360°)"],
      [
        { operation: "loft", start_profile: { type: "circle", radius: 0.03 }, end_profile: { type: "rectangle", width: 0.05, height: 0.05 }, height: 0.08 },
        "Boundary (0.03m radius circle → 0.05×0.05m rect, height 0.08m)",
      ],
      [{ operation: "box", size: [0.1, 0.06, 0.04] }, "Box (0.1 × 0.06 × 0.04 m)"],
      [{ operation: "cylinder", radius: 0.03, length: 0.08 }, "Cylinder (radius 0.03m, length 0.08m)"],
      [
        { operation: "cut", tool: { operation: "extrude", profile: { type: "circle", radius: 0.01 }, depth: 0.2 }, position: [0, 0, 0] },
        "Cut (Extruded)",
      ],
      [
        {
          operation: "fillet_chamfer",
          picks: [
            { source_step: 0, local_index: 0, point: [0.05, 0, 0], operation: "fillet", value: 0.005 },
            { source_step: 0, local_index: 1, point: [0, 0.05, 0], operation: "chamfer", value: 0.003 },
          ],
        },
        "Fillet/Chamfer (1 fillet, 1 chamfer)",
      ],
    ];
    for (const [feature, expected] of cases) {
      const { unmount } = render(<FeatureTreeList features={[feature]} />);
      expect(screen.getByRole("listitem")).toHaveTextContent(expected);
      unmount();
    }
  });

  it("distinguishes each cut tool kind", () => {
    const revolvedCut: Feature = { operation: "cut", tool: { operation: "revolve", profile: { type: "circle", radius: 0.01 }, offset: 0.03, angle_deg: 360 }, position: [0, 0, 0] };
    const boundaryCut: Feature = {
      operation: "cut",
      tool: { operation: "loft", start_profile: { type: "circle", radius: 0.02 }, end_profile: { type: "circle", radius: 0.01 }, height: 0.2 },
      position: [0, 0, 0],
    };
    const { unmount: unmountRevolved } = render(<FeatureTreeList features={[revolvedCut]} />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Cut (Revolved)");
    unmountRevolved();

    render(<FeatureTreeList features={[boundaryCut]} />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Cut (Boundary)");
  });

  // CAD Kernel Phase 7.3 (edit-any-step).
  describe("onSelectStep", () => {
    const features: Feature[] = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
    ];

    it("renders each row as a real button when onSelectStep is given", () => {
      render(<FeatureTreeList features={features} onSelectStep={() => {}} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toHaveTextContent("Box (0.1 × 0.06 × 0.04 m)");
      expect(buttons[1]).toHaveTextContent("Shell (1 face, thickness 0.005m)");
    });

    it("clicking a row calls onSelectStep with that row's own index", () => {
      const onSelectStep = vi.fn();
      render(<FeatureTreeList features={features} onSelectStep={onSelectStep} />);
      fireEvent.click(screen.getAllByRole("button")[1]);
      expect(onSelectStep).toHaveBeenCalledWith(1);
    });

    it("renders plain (non-button) rows when onSelectStep is omitted", () => {
      render(<FeatureTreeList features={features} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
  });

  // CAD Kernel Phase 7.4 (reorder/insert/delete).
  describe("onMoveStep / onDeleteStep", () => {
    const features: Feature[] = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
      { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 5 },
    ];

    it("shows no move/delete buttons for the root row, only for modifier rows", () => {
      render(<FeatureTreeList features={features} onMoveStep={() => {}} onDeleteStep={() => {}} />);
      expect(screen.queryByLabelText("move step 0 up")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("delete step 0")).not.toBeInTheDocument();
      expect(screen.getByLabelText("move step 1 down")).toBeInTheDocument();
      expect(screen.getByLabelText("delete step 1")).toBeInTheDocument();
    });

    it("disables move-up for the first modifier row and move-down for the last row", () => {
      render(<FeatureTreeList features={features} onMoveStep={() => {}} />);
      expect(screen.getByLabelText("move step 1 up")).toBeDisabled();
      expect(screen.getByLabelText("move step 1 down")).toBeEnabled();
      expect(screen.getByLabelText("move step 2 up")).toBeEnabled();
      expect(screen.getByLabelText("move step 2 down")).toBeDisabled();
    });

    it("clicking move up/down calls onMoveStep with that row's own index and direction", () => {
      const onMoveStep = vi.fn();
      render(<FeatureTreeList features={features} onMoveStep={onMoveStep} />);
      fireEvent.click(screen.getByLabelText("move step 2 up"));
      expect(onMoveStep).toHaveBeenCalledWith(2, "up");
      fireEvent.click(screen.getByLabelText("move step 1 down"));
      expect(onMoveStep).toHaveBeenCalledWith(1, "down");
    });

    it("deletes only after a second confirming click, per row", () => {
      const onDeleteStep = vi.fn();
      render(<FeatureTreeList features={features} onDeleteStep={onDeleteStep} />);
      const deleteBtn = screen.getByLabelText("delete step 1");
      fireEvent.click(deleteBtn);
      expect(onDeleteStep).not.toHaveBeenCalled();
      expect(screen.getByLabelText("delete step 1")).toHaveTextContent("delete?");
      fireEvent.click(screen.getByLabelText("delete step 1"));
      expect(onDeleteStep).toHaveBeenCalledWith(1);
    });

    it("disables every move/delete button while actionPending", () => {
      render(<FeatureTreeList features={features} onMoveStep={() => {}} onDeleteStep={() => {}} actionPending />);
      expect(screen.getByLabelText("move step 2 up")).toBeDisabled();
      expect(screen.getByLabelText("delete step 1")).toBeDisabled();
    });

    it("shows actionError near the top of the list", () => {
      render(<FeatureTreeList features={features} actionError="cad executor: step 1 (shell) failed to rebuild: no face found near [1, 1, 1]" />);
      expect(screen.getByText(/no face found near/)).toBeInTheDocument();
    });
  });

  describe("onInsertStep", () => {
    const features: Feature[] = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
    ];

    it("shows an Insert step affordance on every row, root included", () => {
      render(<FeatureTreeList features={features} onInsertStep={() => {}} />);
      expect(screen.getAllByText("+ Insert step")).toHaveLength(2);
    });

    it("clicking Insert step opens a kind menu with every insertable operation", () => {
      render(<FeatureTreeList features={features} onInsertStep={() => {}} />);
      fireEvent.click(screen.getAllByText("+ Insert step")[0]);
      for (const label of ["Fillet/Chamfer", "Shell", "Draft", "Extruded Cut", "Revolved Cut", "Boundary Cut"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });

    it("choosing a kind calls onInsertStep with that row's own index and the chosen kind", () => {
      const onInsertStep = vi.fn();
      render(<FeatureTreeList features={features} onInsertStep={onInsertStep} />);
      fireEvent.click(screen.getAllByText("+ Insert step")[1]);
      fireEvent.click(screen.getByText("Draft"));
      expect(onInsertStep).toHaveBeenCalledWith(1, "draft");
    });

    it("Cancel closes the menu without calling onInsertStep", () => {
      const onInsertStep = vi.fn();
      render(<FeatureTreeList features={features} onInsertStep={onInsertStep} />);
      fireEvent.click(screen.getAllByText("+ Insert step")[0]);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onInsertStep).not.toHaveBeenCalled();
      expect(screen.getAllByText("+ Insert step")).toHaveLength(2);
    });
  });
});

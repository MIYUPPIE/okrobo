// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShapeEdgeMesh } from "../cad/cadClient";
import { FilletEdgeList } from "./FilletEdgeList";

afterEach(() => cleanup());

const edgeMesh: ShapeEdgeMesh = {
  lines: [
    0, 0, 0, 10, 0, 0, // Edge 1: a straight 2-point group, midpoint [5,0,0]
    0, 5, 0, 0, 7, 0, // Edge 2: a straight 2-point group, midpoint [0,6,0]
  ],
  edgeGroups: [
    { start: 0, count: 2, edgeId: 1 },
    { start: 2, count: 2, edgeId: 2 },
  ],
};

describe("FilletEdgeList", () => {
  it("renders null (no section at all) when there's no edge mesh yet", () => {
    const { container } = render(<FilletEdgeList edgeMesh={null} picks={[]} onChange={vi.fn()} />);
    expect(container.querySelector(".fillet-edge-list")).toBeNull();
  });

  it("renders one row per edge group with an Add button when nothing is picked yet", () => {
    render(<FilletEdgeList edgeMesh={edgeMesh} picks={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Edge 1")).toBeTruthy();
    expect(screen.getByText("Edge 2")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(2);
  });

  it("Add records that edge's own descriptor point with a default fillet operation and value", () => {
    const onChange = vi.fn();
    render(<FilletEdgeList edgeMesh={edgeMesh} picks={[]} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(onChange).toHaveBeenCalledWith([{ point: [5, 0, 0], operation: "fillet", value: "0.005" }]);
  });

  it("shows Operation/Value/Remove controls for an already-picked edge, matched by its descriptor point", () => {
    const picks = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.01" }];
    render(<FilletEdgeList edgeMesh={edgeMesh} picks={picks} onChange={vi.fn()} />);
    expect(screen.getByLabelText("edge 1 operation")).toBeTruthy();
    expect((screen.getByLabelText("edge 1 value") as HTMLInputElement).value).toBe("0.01");
    // Edge 2 is untouched -- still shows its own Add button.
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("Remove drops exactly the picked row", () => {
    const picks = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.01" }];
    const onChange = vi.fn();
    render(<FilletEdgeList edgeMesh={edgeMesh} picks={picks} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("changing Operation/Value updates only that pick", () => {
    const picks = [{ point: [5, 0, 0] as [number, number, number], operation: "fillet" as const, value: "0.01" }];
    const onChange = vi.fn();
    render(<FilletEdgeList edgeMesh={edgeMesh} picks={picks} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("edge 1 operation"), { target: { value: "chamfer" } });
    expect(onChange).toHaveBeenCalledWith([{ point: [5, 0, 0], operation: "chamfer", value: "0.01" }]);

    fireEvent.change(screen.getByLabelText("edge 1 value"), { target: { value: "0.02" } });
    expect(onChange).toHaveBeenCalledWith([{ point: [5, 0, 0], operation: "fillet", value: "0.02" }]);
  });
});

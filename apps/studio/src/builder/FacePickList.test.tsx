// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FacePreview } from "../cad/cadClient";
import { FacePickList } from "./FacePickList";

afterEach(() => cleanup());

const facePreview: FacePreview = {
  mesh: { vertices: [], triangles: [], normals: [], faceGroups: [{ start: 0, count: 3, faceId: 1 }, { start: 3, count: 3, faceId: 2 }] },
  centers: [
    [5, 0, 0],
    [0, 3, 0],
  ],
};

describe("FacePickList", () => {
  it("renders null (no section at all) when there's no face preview yet", () => {
    const { container } = render(<FacePickList facePreview={null} picks={[]} onChange={vi.fn()} />);
    expect(container.querySelector(".face-pick-list")).toBeNull();
  });

  it("renders one row per face with a Select button when nothing is picked yet", () => {
    render(<FacePickList facePreview={facePreview} picks={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Face 1")).toBeTruthy();
    expect(screen.getByText("Face 2")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Select" })).toHaveLength(2);
  });

  it("Select adds that face's own center to the picks", () => {
    const onChange = vi.fn();
    render(<FacePickList facePreview={facePreview} picks={[]} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
    expect(onChange).toHaveBeenCalledWith([[5, 0, 0]]);
  });

  it("shows Deselect for an already-picked face, matched by its own center", () => {
    render(<FacePickList facePreview={facePreview} picks={[[5, 0, 0]]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Deselect" })).toBeTruthy();
    // Face 2 is untouched -- still shows its own Select button.
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
  });

  it("Deselect drops exactly the picked face", () => {
    const onChange = vi.fn();
    render(<FacePickList facePreview={facePreview} picks={[[5, 0, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("supports multiple picks at once", () => {
    const onChange = vi.fn();
    render(<FacePickList facePreview={facePreview} picks={[[5, 0, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith([
      [5, 0, 0],
      [0, 3, 0],
    ]);
  });
});

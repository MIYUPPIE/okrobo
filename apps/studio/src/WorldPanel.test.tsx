// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_OBSTACLES, type WorldDef } from "./lib/validateWorld";
import { WorldPanel } from "./WorldPanel";

afterEach(() => cleanup());

const world: WorldDef = {
  name: "Arena",
  arena_width: 2,
  arena_height: 2,
  robot_radius: 0.1,
  wheel_base: 0.12,
  start: { x: 1, y: 1, theta: 0 },
  obstacles: [
    { x: 1.7, y: 1, width: 0.2, height: 0.2, color: [220, 40, 40], label: "red box" },
  ],
};

const defaultWorld: WorldDef = { ...world, obstacles: [] };

describe("WorldPanel", () => {
  it("seeds the form from the world prop", () => {
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={() => {}} />);
    expect(screen.getByLabelText(/width \(m\)/i)).toHaveValue(2);
    expect(screen.getByDisplayValue("red box")).toBeInTheDocument();
    expect(screen.getByText("1 / 16")).toBeInTheDocument();
  });

  it("adds an object, which is not applied until Apply changes is clicked", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /add object/i }));
    expect(screen.getByText("2 / 16")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /apply changes/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].obstacles).toHaveLength(2);
  });

  it("deletes an object", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /delete object 1/i }));
    expect(screen.getByText("0 / 16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply changes/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ obstacles: [] }));
  });

  it("edits an object's position and color and applies the change", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    const xField = screen.getByLabelText("object 1 x");
    await user.clear(xField);
    await user.type(xField, "0.5");
    await user.click(screen.getByRole("button", { name: /apply changes/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied: WorldDef = onApply.mock.calls[0][0];
    expect(applied.obstacles[0].x).toBe(0.5);
    expect(applied.obstacles[0].color).toEqual([220, 40, 40]); // unchanged
  });

  it("shows a validation error and disables Apply for an out-of-bounds start pose, without discarding the typed value", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    const startX = screen.getByLabelText(/^x \(m\)$/i);
    await user.clear(startX);
    await user.type(startX, "99");

    expect(screen.getByText(/outside the arena/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
    expect(startX).toHaveValue(99);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("rejects a zero-width object instead of silently applying it", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    const widthField = screen.getByLabelText("object 1 width");
    await user.clear(widthField);
    await user.type(widthField, "0");

    expect(screen.getByText(/width must be positive/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply changes/i })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("caps additions at MAX_OBSTACLES", async () => {
    const many: WorldDef = {
      ...world,
      obstacles: Array.from({ length: MAX_OBSTACLES }, (_, i) => ({
        x: 0.2 + i * 0.05,
        y: 0.2,
        width: 0.05,
        height: 0.05,
        color: [100, 100, 100] as [number, number, number],
      })),
    };
    const user = userEvent.setup();
    render(<WorldPanel world={many} defaultWorld={defaultWorld} onApply={() => {}} />);

    expect(screen.getByText(`${MAX_OBSTACLES} / ${MAX_OBSTACLES}`)).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: /add object/i });
    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(screen.getByText(`${MAX_OBSTACLES} / ${MAX_OBSTACLES}`)).toBeInTheDocument();
  });

  it("reset to pack default applies immediately, bypassing the Apply button", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<WorldPanel world={world} defaultWorld={defaultWorld} onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /reset to pack default/i }));
    expect(onApply).toHaveBeenCalledWith(defaultWorld);
    expect(screen.getByText("0 / 16")).toBeInTheDocument();
  });
});

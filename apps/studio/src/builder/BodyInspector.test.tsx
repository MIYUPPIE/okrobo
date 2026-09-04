// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { BodyInspector } from "./BodyInspector";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

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
        transform: identity,
        visual: { type: "box", size: [0.2, 0.15, 0.08] },
        collision: { type: "box", size: [0.2, 0.15, 0.08] },
        mass: 1,
        inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
        material: { color: [0.3, 0.5, 0.9] },
      },
    ],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("BodyInspector", () => {
  it("seeds the form from the selected body", () => {
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);
    expect(screen.getByLabelText("body name")).toHaveValue("Chassis");
    expect(screen.getByLabelText("body size x")).toHaveValue(0.2);
    expect(screen.getByLabelText("body mass")).toHaveValue(1);
  });

  it("edits name, position, and mass, applying only on Apply", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={onApply} onRequestDelete={() => {}} />);

    await user.clear(screen.getByLabelText("body name"));
    await user.type(screen.getByLabelText("body name"), "Frame");
    await user.clear(screen.getByLabelText("body position x"));
    await user.type(screen.getByLabelText("body position x"), "0.5");
    await user.clear(screen.getByLabelText("body mass"));
    await user.type(screen.getByLabelText("body mass"), "2.5");
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied: RobotDef = onApply.mock.calls[0][0];
    const body = applied.bodies.find((b) => b.id === "chassis")!;
    expect(body.name).toBe("Frame");
    expect(body.transform.position[0]).toBe(0.5);
    expect(body.mass).toBe(2.5);
  });

  it("shows an inline issue and disables Apply for invalid mass, without discarding the typed value", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={onApply} onRequestDelete={() => {}} />);

    await user.clear(screen.getByLabelText("body mass"));
    await user.type(screen.getByLabelText("body mass"), "0");

    expect(screen.getByLabelText("body mass")).toHaveValue(0);
    expect(screen.getByText(/has no valid mass/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("switching geometry type swaps the visible dimension fields", async () => {
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);

    expect(screen.getByLabelText("body size x")).toBeInTheDocument();
    expect(screen.queryByLabelText("body radius")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("body geometry type"), "sphere");
    expect(screen.queryByLabelText("body size x")).not.toBeInTheDocument();
    expect(screen.getByLabelText("body radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("body length")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("body geometry type"), "cylinder");
    expect(screen.getByLabelText("body radius")).toBeInTheDocument();
    expect(screen.getByLabelText("body length")).toBeInTheDocument();
  });

  it("deletes only after a second confirming click", async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={onRequestDelete} />);

    const deleteBtn = screen.getByRole("button", { name: "Delete body" });
    await user.click(deleteBtn);
    expect(onRequestDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "delete?" }));
    expect(onRequestDelete).toHaveBeenCalledWith("chassis");
  });
});

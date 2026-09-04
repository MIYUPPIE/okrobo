// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { BuilderPanel } from "./BuilderPanel";

afterEach(() => cleanup());

// jsdom can't construct a real WebGLRenderer -- mock the one component that
// needs it, not the canvas, and test everything else (hierarchy/inspector
// sync, add/delete cascading through real shared state) for real.
vi.mock("./BuilderViewport", () => ({
  BuilderViewport: (props: { robot: RobotDef; selectedBodyId: string | null }) => (
    <div data-testid="builder-viewport-stub" data-selected={props.selectedBodyId ?? ""} data-body-count={props.robot.bodies.length} />
  ),
}));

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "My Robot",
    description: "",
    root_placement: identity,
    bodies: [{ id: "base", name: "Base", transform: identity, mass: 1, inertia, visual: { type: "box", size: [0.1, 0.1, 0.1] } }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("BuilderPanel", () => {
  it("auto-selects the first body and shows its inspector", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Base" })).toHaveClass("active");
    expect(screen.getByLabelText("body name")).toHaveValue("Base");
  });

  it("shows the issue count from validateRobotDef", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByText("0 issues")).toBeInTheDocument();
  });

  it("Add body appends a new body, selects it, and passes the update to onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "+ Add body" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(2);
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", next.bodies[1].id);
  });

  it("selecting a hierarchy row updates the inspector and the viewport's selection prop", async () => {
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "second", name: "Second", transform: identity, mass: 1, inertia }] };
    const user = userEvent.setup();
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getByLabelText("body name")).toHaveValue("Second");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", "second");
  });

  it("Delete body (two-click confirm) cascades correctly and clears selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Delete body" }));
    await user.click(screen.getByRole("button", { name: "delete?" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(0);
    expect(screen.getByText("Select a body to edit it.")).toBeInTheDocument();
  });
});

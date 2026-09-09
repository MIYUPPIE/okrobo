// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { ActuatorCreator } from "./ActuatorCreator";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [
      { id: "base", name: "Base", transform: identity, mass: 1, inertia },
      { id: "link1", name: "Link 1", transform: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 0.1, inertia },
    ],
    joints: [
      { id: "joint1", name: "Joint 1", type: "hinge", parent: "base", child: "link1", origin: identity, axis: [0, 1, 0], limits: { lower: -1, upper: 1 } },
      { id: "fixed1", name: "Fixed 1", type: "fixed", parent: "base", child: "link1", origin: identity },
    ],
    actuators: [],
    sensors: [],
  };
}

describe("ActuatorCreator", () => {
  it("seeds the form with a generated name, servo type, and the first non-fixed joint", () => {
    render(<ActuatorCreator robot={makeRobot()} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("actuator name")).toHaveValue("actuator-1");
    expect(screen.getByLabelText("actuator type")).toHaveValue("servo");
    expect(screen.getByLabelText("actuator target joint")).toHaveValue("joint1");
  });

  it("only lists non-fixed joints as targets", () => {
    render(<ActuatorCreator robot={makeRobot()} onApply={() => {}} onCancel={() => {}} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.some((t) => t?.includes("Joint 1"))).toBe(true);
    expect(options.some((t) => t?.includes("Fixed 1"))).toBe(false);
  });

  it("shows a description for the selected actuator type that updates live", async () => {
    const user = userEvent.setup();
    render(<ActuatorCreator robot={makeRobot()} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/Holds a target angle/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("actuator type"), "velocity");
    expect(screen.getByText(/Spins at a target speed/)).toBeInTheDocument();
  });

  it("warns when the target joint is ball/free (no matching MuJoCo actuator)", async () => {
    const robot: RobotDef = {
      ...makeRobot(),
      joints: [...makeRobot().joints, { id: "ball1", name: "Ball 1", type: "ball", parent: "base", child: "link1", origin: identity }],
    };
    const user = userEvent.setup();
    render(<ActuatorCreator robot={robot} onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("actuator target joint"), "ball1");
    expect(screen.getByText(/no matching MuJoCo actuator/)).toBeInTheDocument();
  });

  it("Apply is enabled and produces a robot with the new actuator", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorCreator robot={makeRobot()} onApply={onApply} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const next: RobotDef = onApply.mock.calls[0][0];
    expect(next.actuators).toHaveLength(1);
    expect(next.actuators[0]).toMatchObject({ id: "actuator-1", type: "servo", target_joint: "joint1" });
  });

  it("prefills from an existing actuator when editing, and Apply replaces it in place", async () => {
    const robot: RobotDef = { ...makeRobot(), actuators: [{ id: "actuator-1", name: "Shoulder Motor", type: "motor", target_joint: "joint1" }] };
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorCreator robot={robot} existing={robot.actuators[0]} onApply={onApply} onCancel={() => {}} />);

    expect(screen.getByLabelText("actuator name")).toHaveValue("Shoulder Motor");
    expect(screen.getByLabelText("actuator type")).toHaveValue("motor");
    expect(screen.getByText("Edit actuator")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    const next: RobotDef = onApply.mock.calls[0][0];
    expect(next.actuators).toHaveLength(1);
    expect(next.actuators[0].name).toBe("Shoulder Motor");
  });

  it("shows a guidance message instead of a form when the robot has no targetable joint", () => {
    const robot: RobotDef = { ...makeRobot(), joints: [makeRobot().joints[1]] }; // only the fixed joint
    render(<ActuatorCreator robot={robot} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/add one with "Add Joint" first/)).toBeInTheDocument();
    expect(screen.queryByLabelText("actuator name")).not.toBeInTheDocument();
  });

  it("Cancel calls onCancel without applying anything", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorCreator robot={makeRobot()} onApply={onApply} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { ActuatorPanel } from "./ActuatorPanel";

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
      { id: "link1", name: "Link 1", transform: identity, mass: 0.5, inertia },
    ],
    joints: [
      {
        id: "joint1",
        name: "Joint 1",
        type: "hinge",
        parent: "base",
        child: "link1",
        origin: identity,
        axis: [0, 1, 0],
        limits: { lower: -1, upper: 2 },
      },
    ],
    actuators: [
      { id: "a1", name: "Shoulder Servo", type: "servo", target_joint: "joint1" },
      { id: "a2", name: "Generic Motor", type: "motor", target_joint: "joint1", limits: { effort: 5 } },
      { id: "a3", name: "No Limits Motor", type: "motor", target_joint: "joint1" },
    ],
    sensors: [],
  };
}

describe("ActuatorPanel", () => {
  it("shows a placeholder when the robot has no actuators", () => {
    const robot = { ...makeRobot(), actuators: [] };
    render(<ActuatorPanel robot={robot} control={{ setActuatorCtrl: vi.fn() }} />);
    expect(screen.getByText(/no actuators/i)).toBeInTheDocument();
  });

  it("renders one slider per actuator, with the right ranges", () => {
    render(<ActuatorPanel robot={makeRobot()} control={{ setActuatorCtrl: vi.fn() }} />);

    // servo: range comes from the target joint's own limits, not the actuator.
    const servo = screen.getByLabelText("actuator Shoulder Servo");
    expect(servo).toHaveAttribute("min", "-1");
    expect(servo).toHaveAttribute("max", "2");

    // motor with an explicit effort limit: symmetric range from that limit.
    const motor = screen.getByLabelText("actuator Generic Motor");
    expect(motor).toHaveAttribute("min", "-5");
    expect(motor).toHaveAttribute("max", "5");

    // motor with no limits at all: documented fallback range.
    const unlimited = screen.getByLabelText("actuator No Limits Motor");
    expect(unlimited).toHaveAttribute("min", "-1");
    expect(unlimited).toHaveAttribute("max", "1");
  });

  it("calls setActuatorCtrl with the right index and value when a slider moves", () => {
    const setActuatorCtrl = vi.fn().mockReturnValue(true);
    render(<ActuatorPanel robot={makeRobot()} control={{ setActuatorCtrl }} />);

    const motor = screen.getByLabelText("actuator Generic Motor"); // index 1
    fireEvent.change(motor, { target: { value: "3" } });

    expect(setActuatorCtrl).toHaveBeenCalledWith(1, 3);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { ActuatorSensorList } from "./ActuatorSensorList";

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
      { id: "link1", name: "Link 1", transform: identity, mass: 0.1, inertia },
    ],
    joints: [{ id: "joint1", name: "Joint 1", type: "hinge", parent: "base", child: "link1", origin: identity, axis: [0, 1, 0] }],
    actuators: [{ id: "actuator-1", name: "Shoulder Motor", type: "servo", target_joint: "joint1" }],
    sensors: [{ id: "sensor-1", name: "Front Lidar", type: "lidar", body: "link1", transform: identity }],
  };
}

describe("ActuatorSensorList", () => {
  it("shows an empty state when the robot has neither", () => {
    const robot: RobotDef = { ...makeRobot(), actuators: [], sensors: [] };
    render(<ActuatorSensorList robot={robot} onEditActuator={() => {}} onEditSensor={() => {}} onDeleteActuator={() => {}} onDeleteSensor={() => {}} />);
    expect(screen.getByText(/use "Add Actuator" above/)).toBeInTheDocument();
    expect(screen.getByText(/use "Add Sensor" above/)).toBeInTheDocument();
  });

  it("lists each actuator and sensor by name and target", () => {
    render(<ActuatorSensorList robot={makeRobot()} onEditActuator={() => {}} onEditSensor={() => {}} onDeleteActuator={() => {}} onDeleteSensor={() => {}} />);
    expect(screen.getByText("Shoulder Motor", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Joint 1/)).toBeInTheDocument();
    expect(screen.getByText("Front Lidar", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Link 1/)).toBeInTheDocument();
  });

  it("clicking a row's own label calls the matching onEdit with its id", async () => {
    const onEditActuator = vi.fn();
    const onEditSensor = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorSensorList robot={makeRobot()} onEditActuator={onEditActuator} onEditSensor={onEditSensor} onDeleteActuator={() => {}} onDeleteSensor={() => {}} />);

    await user.click(screen.getByText("Shoulder Motor", { exact: false }));
    expect(onEditActuator).toHaveBeenCalledWith("actuator-1");

    await user.click(screen.getByText("Front Lidar", { exact: false }));
    expect(onEditSensor).toHaveBeenCalledWith("sensor-1");
  });

  it("deleting an actuator needs a first click to confirm, a second to actually delete", async () => {
    const onDeleteActuator = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorSensorList robot={makeRobot()} onEditActuator={() => {}} onEditSensor={() => {}} onDeleteActuator={onDeleteActuator} onDeleteSensor={() => {}} />);

    const deleteButton = screen.getByRole("button", { name: "delete actuator Shoulder Motor" });
    await user.click(deleteButton);
    expect(onDeleteActuator).not.toHaveBeenCalled();
    expect(deleteButton).toHaveTextContent("delete?");

    await user.click(deleteButton);
    expect(onDeleteActuator).toHaveBeenCalledWith("actuator-1");
  });

  it("deleting a sensor needs a first click to confirm, a second to actually delete", async () => {
    const onDeleteSensor = vi.fn();
    const user = userEvent.setup();
    render(<ActuatorSensorList robot={makeRobot()} onEditActuator={() => {}} onEditSensor={() => {}} onDeleteActuator={() => {}} onDeleteSensor={onDeleteSensor} />);

    const deleteButton = screen.getByRole("button", { name: "delete sensor Front Lidar" });
    await user.click(deleteButton);
    expect(onDeleteSensor).not.toHaveBeenCalled();
    await user.click(deleteButton);
    expect(onDeleteSensor).toHaveBeenCalledWith("sensor-1");
  });
});

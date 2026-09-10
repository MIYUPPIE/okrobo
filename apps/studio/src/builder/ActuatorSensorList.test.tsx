// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { ActuatorSensorList, type ActuatorSensorListProps } from "./ActuatorSensorList";

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

/** Every test only cares about a subset of the callbacks -- this fills in
 * no-op defaults for the rest so each test only overrides what it checks. */
function renderList(robot: RobotDef, overrides: Partial<ActuatorSensorListProps> = {}) {
  return render(
    <ActuatorSensorList
      robot={robot}
      onEditJoint={() => {}}
      onEditActuator={() => {}}
      onEditSensor={() => {}}
      onDeleteJoint={() => {}}
      onDeleteActuator={() => {}}
      onDeleteSensor={() => {}}
      {...overrides}
    />,
  );
}

describe("ActuatorSensorList", () => {
  it("shows an empty state when the robot has none of the three", () => {
    const robot: RobotDef = { ...makeRobot(), joints: [], actuators: [], sensors: [] };
    renderList(robot);
    expect(screen.getByText(/use "Add Joint" above/)).toBeInTheDocument();
    expect(screen.getByText(/use "Add Actuator" above/)).toBeInTheDocument();
    expect(screen.getByText(/use "Add Sensor" above/)).toBeInTheDocument();
  });

  it("lists each joint, actuator, and sensor by name and target", () => {
    renderList(makeRobot());
    expect(screen.getByRole("button", { name: /^Joint 1/ })).toBeInTheDocument();
    expect(screen.getByText(/Base → Link 1 \(hinge\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Shoulder Motor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Front Lidar/ })).toBeInTheDocument();
    expect(screen.getByText(/on Link 1/)).toBeInTheDocument();
  });

  it("clicking a row's own label calls the matching onEdit with its id", async () => {
    const onEditJoint = vi.fn();
    const onEditActuator = vi.fn();
    const onEditSensor = vi.fn();
    const user = userEvent.setup();
    renderList(makeRobot(), { onEditJoint, onEditActuator, onEditSensor });

    await user.click(screen.getByRole("button", { name: /^Joint 1/ }));
    expect(onEditJoint).toHaveBeenCalledWith("joint1");

    await user.click(screen.getByRole("button", { name: /^Shoulder Motor/ }));
    expect(onEditActuator).toHaveBeenCalledWith("actuator-1");

    await user.click(screen.getByRole("button", { name: /^Front Lidar/ }));
    expect(onEditSensor).toHaveBeenCalledWith("sensor-1");
  });

  it("deleting a joint needs a first click to confirm, a second to actually delete", async () => {
    const onDeleteJoint = vi.fn();
    const user = userEvent.setup();
    renderList(makeRobot(), { onDeleteJoint });

    const deleteButton = screen.getByRole("button", { name: "delete joint Joint 1" });
    await user.click(deleteButton);
    expect(onDeleteJoint).not.toHaveBeenCalled();
    expect(deleteButton).toHaveTextContent("delete?");

    await user.click(deleteButton);
    expect(onDeleteJoint).toHaveBeenCalledWith("joint1");
  });

  it("deleting an actuator needs a first click to confirm, a second to actually delete", async () => {
    const onDeleteActuator = vi.fn();
    const user = userEvent.setup();
    renderList(makeRobot(), { onDeleteActuator });

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
    renderList(makeRobot(), { onDeleteSensor });

    const deleteButton = screen.getByRole("button", { name: "delete sensor Front Lidar" });
    await user.click(deleteButton);
    expect(onDeleteSensor).not.toHaveBeenCalled();
    await user.click(deleteButton);
    expect(onDeleteSensor).toHaveBeenCalledWith("sensor-1");
  });
});

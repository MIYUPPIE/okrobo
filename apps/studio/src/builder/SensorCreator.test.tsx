// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { SensorCreator } from "./SensorCreator";

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
    joints: [{ id: "joint1", name: "Joint 1", type: "hinge", parent: "base", child: "link1", origin: identity, axis: [0, 1, 0] }],
    actuators: [],
    sensors: [],
  };
}

describe("SensorCreator", () => {
  it("seeds the form with a generated name, distance type, and shows the mount transform", () => {
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("sensor name")).toHaveValue("sensor-1");
    expect(screen.getByLabelText("sensor type")).toHaveValue("distance");
    expect(screen.getByText("On Link 1")).toBeInTheDocument();
    expect(screen.getByLabelText("sensor position x")).toBeInTheDocument();
  });

  it("switching to encoder hides the transform fields and shows a joint picker instead", async () => {
    const user = userEvent.setup();
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("sensor type"), "encoder");
    expect(screen.queryByLabelText("sensor position x")).not.toBeInTheDocument();
    expect(screen.getByLabelText("sensor joint")).toBeInTheDocument();
  });

  it("switching to lidar shows the rays/fov params with sensible defaults", async () => {
    const user = userEvent.setup();
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("sensor type"), "lidar");
    expect(screen.getByLabelText("sensor lidar rays")).toHaveValue(9);
    expect(screen.getByLabelText("sensor lidar fov")).toHaveValue(180);
  });

  it("Apply is disabled for encoder until a joint is chosen (sensor-encoder-missing-joint)", async () => {
    const user = userEvent.setup();
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("sensor type"), "encoder");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("sensor joint"), "joint1");
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
  });

  it("Apply is enabled for a plain distance sensor and produces a robot with the new sensor", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={onApply} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const next: RobotDef = onApply.mock.calls[0][0];
    expect(next.sensors).toHaveLength(1);
    expect(next.sensors[0]).toMatchObject({ id: "sensor-1", type: "distance", body: "link1" });
  });

  it("prefills from an existing sensor when editing, and Apply replaces it in place", async () => {
    const robot: RobotDef = {
      ...makeRobot(),
      sensors: [{ id: "sensor-1", name: "Front Lidar", type: "lidar", body: "link1", transform: identity, params: { rays: 5, fov_degrees: 90 } }],
    };
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SensorCreator robot={robot} bodyId="link1" existing={robot.sensors[0]} onApply={onApply} onCancel={() => {}} />);

    expect(screen.getByLabelText("sensor name")).toHaveValue("Front Lidar");
    expect(screen.getByLabelText("sensor lidar rays")).toHaveValue(5);
    expect(screen.getByText("Edit sensor")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    const next: RobotDef = onApply.mock.calls[0][0];
    expect(next.sensors).toHaveLength(1);
    expect(next.sensors[0].name).toBe("Front Lidar");
  });

  it("shows a guidance message for encoder when the mount body has no connected joint", async () => {
    const robot: RobotDef = { ...makeRobot(), joints: [] };
    const user = userEvent.setup();
    render(<SensorCreator robot={robot} bodyId="link1" onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("sensor type"), "encoder");
    expect(screen.getByText(/isn't connected to a movable joint/)).toBeInTheDocument();
  });

  it("Cancel calls onCancel without applying anything", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<SensorCreator robot={makeRobot()} bodyId="link1" onApply={onApply} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

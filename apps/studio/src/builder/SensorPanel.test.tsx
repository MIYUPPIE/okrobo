// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { SensorPanel, type SensorReading } from "./SensorPanel";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [{ id: "base", name: "Base", transform: identity, mass: 1, inertia }],
    joints: [],
    actuators: [],
    sensors: [
      { id: "s1", name: "Front Distance", type: "distance", body: "base", transform: identity },
      { id: "s2", name: "Eye", type: "camera", body: "base", transform: identity },
    ],
  };
}

describe("SensorPanel", () => {
  it("shows a placeholder when the robot has no sensors", () => {
    const robot = { ...makeRobot(), sensors: [] };
    render(<SensorPanel robot={robot} source={{ sensorReadings: () => [] }} />);
    expect(screen.getByText(/no sensors/i)).toBeInTheDocument();
  });

  it("renders each sensor's formatted reading", () => {
    const readings: SensorReading[] = [
      { id: "s1", type: "distance", values: [1.234] },
      { id: "s2", type: "camera", values: [] },
    ];
    render(<SensorPanel robot={makeRobot()} source={{ sensorReadings: () => readings }} />);

    expect(screen.getByText("1.234 m")).toBeInTheDocument();
    expect(screen.getByText("Camera preview isn't available yet")).toBeInTheDocument();
  });

  it("formats a distance miss (-1) as 'no target', not '-1.000 m'", () => {
    const readings: SensorReading[] = [
      { id: "s1", type: "distance", values: [-1] },
      { id: "s2", type: "camera", values: [] },
    ];
    render(<SensorPanel robot={makeRobot()} source={{ sensorReadings: () => readings }} />);
    expect(screen.getByText("no target")).toBeInTheDocument();
  });

  it("formats a lidar reading as a list of per-ray distances", () => {
    const robot: RobotDef = {
      ...makeRobot(),
      sensors: [{ id: "s1", name: "Scan", type: "lidar", body: "base", transform: identity }],
    };
    const readings: SensorReading[] = [{ id: "s1", type: "lidar", values: [0.5, -1, 1.25] }];
    render(<SensorPanel robot={robot} source={{ sensorReadings: () => readings }} />);
    expect(screen.getByText("0.50, —, 1.25 m")).toBeInTheDocument();
  });
});

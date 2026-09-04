import { useEffect, useState } from "react";
import type { RobotDef, SensorType } from "../contracts/robotDef";

/** The slice of EngineBuiltRobot's public API this panel needs -- kept
 * narrow (not importing the class itself) so a plain fake object satisfies
 * it in tests without touching WASM, mirroring ActuatorPanel.tsx's
 * ActuatorControl idiom. */
export interface SensorReading {
  id: string;
  type: SensorType;
  values: number[];
}

export interface SensorSource {
  sensorReadings(): SensorReading[];
}

export interface SensorPanelProps {
  robot: RobotDef;
  source: SensorSource;
}

const POLL_MS = 100; // matches CameraView.tsx's existing polling cadence

function n(value: number | undefined, digits = 3): string {
  return value === undefined ? "--" : value.toFixed(digits);
}

function formatValues(type: SensorType, values: number[]): string {
  switch (type) {
    case "encoder":
      return `${n(values[0])} rad`;
    case "distance":
      return values[0] === -1 ? "no target" : `${n(values[0])} m`;
    case "touch":
      return `${n(values[0], 2)} N`;
    case "gps":
      return `x=${n(values[0])} y=${n(values[1])} z=${n(values[2])} m`;
    case "imu":
      return `accel (${n(values[0])}, ${n(values[1])}, ${n(values[2])}) m/s² · gyro (${n(values[3])}, ${n(values[4])}, ${n(values[5])}) rad/s`;
    case "force_torque":
      return `force (${n(values[0])}, ${n(values[1])}, ${n(values[2])}) N · torque (${n(values[3])}, ${n(values[4])}, ${n(values[5])}) N·m`;
    case "lidar":
      return values.map((v) => (v === -1 ? "—" : v.toFixed(2))).join(", ") + " m";
    case "camera":
      return "";
  }
}

/** Live sensor readouts for Test mode: polls EngineBuiltRobot.sensorReadings()
 * on an interval and displays each sensor's current value, formatted per
 * type. `camera` sensors show an explicit "not available yet" placeholder
 * (docs/decisions/robot-builder-sensors.md) rather than being silently
 * dropped. */
export function SensorPanel({ robot, source }: SensorPanelProps) {
  const [readings, setReadings] = useState<SensorReading[]>(() => source.sensorReadings());

  useEffect(() => {
    const timer = window.setInterval(() => setReadings(source.sensorReadings()), POLL_MS);
    return () => window.clearInterval(timer);
  }, [source]);

  if (robot.sensors.length === 0) {
    return <p className="sensor-empty">This robot has no sensors to read.</p>;
  }

  return (
    <div className="sensor-panel">
      <h4>Sensors</h4>
      {robot.sensors.map((sensor, index) => (
        <div key={sensor.id} className="sensor-reading">
          <span className="sensor-reading-name">{sensor.name}</span>
          <span className="sensor-reading-value">
            {sensor.type === "camera" ? "Camera preview isn't available yet" : formatValues(sensor.type, readings[index]?.values ?? [])}
          </span>
        </div>
      ))}
    </div>
  );
}

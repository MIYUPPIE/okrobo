import { useState } from "react";
import type { RobotDef } from "../contracts/robotDef";

// Build mode's own list of existing actuators/sensors (Robot Builder D1) --
// neither has a tree position the way bodies do (HierarchyList.tsx), so
// this is a flat, separate list rather than an extension of that
// component. Row shape mirrors FeatureTreeList.tsx's own "click to edit,
// separate two-click delete" idiom exactly, reusing its
// .feature-tree-row/.feature-tree-step/.feature-tree-delete CSS -- no new
// classes needed.

export interface ActuatorSensorListProps {
  robot: RobotDef;
  onEditActuator: (id: string) => void;
  onEditSensor: (id: string) => void;
  onDeleteActuator: (id: string) => void;
  onDeleteSensor: (id: string) => void;
}

export function ActuatorSensorList({ robot, onEditActuator, onEditSensor, onDeleteActuator, onDeleteSensor }: ActuatorSensorListProps) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const jointById = new Map(robot.joints.map((j) => [j.id, j] as const));
  const bodyById = new Map(robot.bodies.map((b) => [b.id, b] as const));

  const requestDelete = (id: string, onDelete: (id: string) => void) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      return;
    }
    setConfirmingDeleteId(null);
    onDelete(id);
  };

  return (
    <div className="actuator-sensor-list">
      <h5 className="hierarchy-section">Actuators</h5>
      {robot.actuators.length === 0 ? (
        <p className="inspector-note">None yet -- use "Add Actuator" above.</p>
      ) : (
        <ul>
          {robot.actuators.map((actuator) => (
            <li key={actuator.id}>
              <div className="feature-tree-row">
                <button type="button" className="feature-tree-step" onClick={() => onEditActuator(actuator.id)}>
                  {actuator.name} <span className="feature-tree-step-label">→ {jointById.get(actuator.target_joint)?.name ?? actuator.target_joint}</span>
                </button>
                <button
                  type="button"
                  className={confirmingDeleteId === actuator.id ? "feature-tree-delete confirm" : "feature-tree-delete"}
                  aria-label={`delete actuator ${actuator.name}`}
                  onClick={() => requestDelete(actuator.id, onDeleteActuator)}
                >
                  {confirmingDeleteId === actuator.id ? "delete?" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h5 className="hierarchy-section">Sensors</h5>
      {robot.sensors.length === 0 ? (
        <p className="inspector-note">None yet -- use "Add Sensor" above.</p>
      ) : (
        <ul>
          {robot.sensors.map((sensor) => (
            <li key={sensor.id}>
              <div className="feature-tree-row">
                <button type="button" className="feature-tree-step" onClick={() => onEditSensor(sensor.id)}>
                  {sensor.name} <span className="feature-tree-step-label">on {bodyById.get(sensor.body)?.name ?? sensor.body}</span>
                </button>
                <button
                  type="button"
                  className={confirmingDeleteId === sensor.id ? "feature-tree-delete confirm" : "feature-tree-delete"}
                  aria-label={`delete sensor ${sensor.name}`}
                  onClick={() => requestDelete(sensor.id, onDeleteSensor)}
                >
                  {confirmingDeleteId === sensor.id ? "delete?" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

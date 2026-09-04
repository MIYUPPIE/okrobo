import type { Actuator, RobotDef } from "../contracts/robotDef";

/** The slice of EngineBuiltRobot's public API this panel needs -- kept
 * narrow (not importing the class itself) so a plain fake object satisfies
 * it in tests without touching WASM. */
export interface ActuatorControl {
  setActuatorCtrl(index: number, value: number): boolean;
}

export interface ActuatorPanelProps {
  robot: RobotDef;
  control: ActuatorControl;
}

const DEFAULT_RANGE = 1;

/** Slider range: a servo's target is the joint's own angle, so its range
 * comes from the target joint's limits (not the actuator's own fields,
 * which servos don't set); motor/force/torque/velocity use the actuator's
 * own effort/velocity limit as a symmetric range; a documented fallback
 * when neither exists. */
function rangeFor(actuator: Actuator, robot: RobotDef): { min: number; max: number } {
  if (actuator.type === "servo") {
    const joint = robot.joints.find((j) => j.id === actuator.target_joint);
    if (joint && (joint.type === "hinge" || joint.type === "slider") && joint.limits) {
      return { min: joint.limits.lower, max: joint.limits.upper };
    }
    return { min: -Math.PI, max: Math.PI };
  }
  if (actuator.type === "velocity") {
    const v = actuator.limits?.velocity;
    return v !== undefined ? { min: -v, max: v } : { min: -DEFAULT_RANGE, max: DEFAULT_RANGE };
  }
  // motor | force | torque
  const effort = actuator.limits?.effort;
  return effort !== undefined ? { min: -effort, max: effort } : { min: -DEFAULT_RANGE, max: DEFAULT_RANGE };
}

/** Live actuator control for Test mode: one slider per robot.actuators
 * entry, calling control.setActuatorCtrl immediately on change -- no
 * draft/Apply, this drives a running simulation rather than editing the
 * document. */
export function ActuatorPanel({ robot, control }: ActuatorPanelProps) {
  if (robot.actuators.length === 0) {
    return <p className="actuator-empty">This robot has no actuators to drive.</p>;
  }
  return (
    <div className="actuator-panel">
      <h4>Actuators</h4>
      {robot.actuators.map((actuator, index) => {
        const { min, max } = rangeFor(actuator, robot);
        const step = (max - min) / 200 || 0.01;
        return (
          <label key={actuator.id} className="actuator-slider">
            {actuator.name}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              defaultValue={0}
              aria-label={`actuator ${actuator.name}`}
              onChange={(e) => control.setActuatorCtrl(index, Number.parseFloat(e.target.value))}
            />
          </label>
        );
      })}
    </div>
  );
}

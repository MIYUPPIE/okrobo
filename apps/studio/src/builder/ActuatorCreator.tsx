import { useMemo, useState } from "react";
import type { Actuator, ActuatorType, RobotDef } from "../contracts/robotDef";
import { validateRobotDef } from "../contracts/robotDef";
import { applyActuator, issuesIntroducedBy, nextActuatorId } from "./robotEdits";

// Build mode's actuator-creation panel (Robot Builder D1) -- shown in the
// inspector slot in place of BodyInspector while the "Add Actuator" tool is
// active, or when editing an existing actuator from the hierarchy's own
// Actuators list. No viewport picking: an actuator's "target" is a joint
// chosen from a short named list, not a spatial point, so a <select> is the
// right UI here (unlike JointCreator/SensorCreator, which pick a body in
// the 3D view). Same draft/live-validate/Apply idiom JointCreator.tsx
// established, gated by issuesIntroducedBy since a bad actuator's error can
// land on the actuator itself for more than one reason. See
// docs/decisions/robot-builder-actuator-sensor-authoring.md.

export const ACTUATOR_TYPE_DESCRIPTIONS: Record<ActuatorType, string> = {
  motor: "Applies a raw force or torque directly -- simple, but can overshoot or oscillate for large loads.",
  servo: "Holds a target angle, like a hobby servo -- good for arm joints and steering.",
  force: "Applies a constant linear force along the joint's own axis.",
  torque: "Applies a constant rotational torque around the joint's own axis.",
  velocity: "Spins at a target speed -- good for continuously-rotating wheels.",
};

const ACTUATOR_TYPES: ActuatorType[] = ["motor", "servo", "force", "torque", "velocity"];

interface Draft {
  name: string;
  type: ActuatorType;
  targetJoint: string;
  /** Blank means "unset", the same convention JointCreator's damping/
   * friction fields use. */
  limitsEffort: string;
  limitsVelocity: string;
}

const num = (s: string) => Number.parseFloat(s);

function initialDraft(name: string, targetJoint: string, existing?: Actuator): Draft {
  return {
    name: existing?.name ?? name,
    type: existing?.type ?? "servo",
    targetJoint: existing?.target_joint ?? targetJoint,
    limitsEffort: existing?.limits?.effort !== undefined ? String(existing.limits.effort) : "",
    limitsVelocity: existing?.limits?.velocity !== undefined ? String(existing.limits.velocity) : "",
  };
}

function draftToActuator(draft: Draft, id: string): Actuator {
  const effort = draft.limitsEffort.trim() === "" ? undefined : num(draft.limitsEffort);
  const velocity = draft.limitsVelocity.trim() === "" ? undefined : num(draft.limitsVelocity);
  const limits = effort !== undefined || velocity !== undefined ? { effort, velocity } : undefined;
  return { id, name: draft.name, type: draft.type, target_joint: draft.targetJoint, limits };
}

export interface ActuatorCreatorProps {
  robot: RobotDef;
  /** Set when editing an existing actuator (prefills the draft; Apply
   * replaces it in place instead of appending a new one). */
  existing?: Actuator;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
}

export function ActuatorCreator({ robot, existing, onApply, onCancel }: ActuatorCreatorProps) {
  // A fixed joint never moves -- actuating one is meaningless and
  // validateRobotDef rejects it (actuator-fixed-joint-target), so it's
  // filtered out of the choices entirely rather than offered and rejected.
  const targetableJoints = useMemo(() => robot.joints.filter((j) => j.type !== "fixed"), [robot.joints]);
  const actuatorId = useMemo(() => existing?.id ?? nextActuatorId(robot), [robot, existing]);

  const [draft, setDraft] = useState<Draft>(() => initialDraft(actuatorId, targetableJoints[0]?.id ?? "", existing));

  const { candidateRobot, newIssues } = useMemo(() => {
    const actuator = draftToActuator(draft, actuatorId);
    const candidate = applyActuator(robot, actuator, existing?.id);
    const issues = issuesIntroducedBy(validateRobotDef(robot), validateRobotDef(candidate));
    return { candidateRobot: candidate, newIssues: issues };
  }, [robot, draft, actuatorId, existing]);

  if (targetableJoints.length === 0) {
    return (
      <div className="body-inspector">
        <h4>New actuator</h4>
        <p className="inspector-note">
          This robot has no hinge, slider, ball, or free joint yet -- add one with "Add Joint" first, then come back
          to attach an actuator to it.
        </p>
        <div className="inspector-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const targetJoint = robot.joints.find((j) => j.id === draft.targetJoint);
  const targetIsUnpowered = targetJoint !== undefined && (targetJoint.type === "ball" || targetJoint.type === "free");
  const hasError = newIssues.some((i) => i.severity === "error");

  const apply = () => {
    if (hasError) return;
    onApply(candidateRobot);
  };

  return (
    <div className="body-inspector">
      <h4>{existing ? "Edit actuator" : "New actuator"}</h4>

      <label>
        Name
        <input aria-label="actuator name" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
      </label>

      <section className="inspector-section">
        <h5>Type</h5>
        <label>
          Actuator type
          <select aria-label="actuator type" value={draft.type} onChange={(e) => setField("type", e.target.value as ActuatorType)}>
            {ACTUATOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <p className="inspector-note">{ACTUATOR_TYPE_DESCRIPTIONS[draft.type]}</p>
      </section>

      <section className="inspector-section">
        <h5>Target joint</h5>
        <label>
          Joint
          <select aria-label="actuator target joint" value={draft.targetJoint} onChange={(e) => setField("targetJoint", e.target.value)}>
            {targetableJoints.map((joint) => (
              <option key={joint.id} value={joint.id}>
                {joint.name} ({joint.type})
              </option>
            ))}
          </select>
        </label>
        {targetIsUnpowered && (
          <p className="body-issue warning">
            This joint type has no matching MuJoCo actuator -- this control will do nothing in Test mode.
          </p>
        )}
      </section>

      <section className="inspector-section">
        <h5>Limits (blank = unlimited)</h5>
        <div className="inspector-grid">
          <label>
            Effort
            <input
              aria-label="actuator limits effort"
              type="number"
              step="0.1"
              min="0"
              value={draft.limitsEffort}
              onChange={(e) => setField("limitsEffort", e.target.value)}
            />
          </label>
          <label>
            Velocity
            <input
              aria-label="actuator limits velocity"
              type="number"
              step="0.1"
              min="0"
              value={draft.limitsVelocity}
              onChange={(e) => setField("limitsVelocity", e.target.value)}
            />
          </label>
        </div>
      </section>

      {newIssues.length > 0 && (
        <ul className="body-issues">
          {newIssues.map((issue, index) => (
            <li key={index} className={issue.severity === "error" ? "body-issue error" : "body-issue warning"}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="inspector-actions">
        <button type="button" className="primary" onClick={apply} disabled={hasError}>
          Apply
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

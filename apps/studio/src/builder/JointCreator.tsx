import { useMemo, useState } from "react";
import type { Joint, JointType, RobotDef, Transform } from "../contracts/robotDef";
import { validateRobotDef } from "../contracts/robotDef";
import { computeJointOrigin, issuesIntroducedBy, nextJointId } from "./robotEdits";

// Build mode's joint-creation panel (parent and child are picked in the 3D
// viewport -- see BuilderPanel.tsx/BuilderViewport.tsx's "Add Joint" tool),
// shown in the inspector slot in place of BodyInspector once both are
// picked. Same draft/live-validate/Apply idiom BodyInspector.tsx already
// established, keyed to a joint draft instead of a body draft. Unlike
// BodyInspector (which only cares about issues on its own body), Apply here
// is gated by issuesIntroducedBy -- the delta of validateRobotDef's output
// before vs. after adding the draft joint -- since a bad joint can surface
// its error on either body, the joint itself, or the whole robot (a cycle),
// not reliably on one predictable element_id. See
// docs/decisions/robot-builder-joints.md.

const HAS_AXIS: ReadonlySet<JointType> = new Set(["hinge", "slider"]);
const HAS_DAMPING: ReadonlySet<JointType> = new Set(["hinge", "slider", "ball"]);
const HAS_FRICTION: ReadonlySet<JointType> = new Set(["hinge", "slider"]);

interface Draft {
  name: string;
  type: JointType;
  originPosX: string;
  originPosY: string;
  originPosZ: string;
  originRotXDeg: string;
  originRotYDeg: string;
  originRotZDeg: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  /** Blank means "no limits" -- both must be filled to include one, the
   * same blank-means-unset convention damping/friction use below. */
  limitsLower: string;
  limitsUpper: string;
  damping: string;
  friction: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const radToDeg = (r: number) => (r * 180) / Math.PI;
const degToRad = (d: number) => (d * Math.PI) / 180;
const num = (s: string) => Number.parseFloat(s);

function initialDraft(name: string, origin: Transform): Draft {
  return {
    name,
    type: "fixed",
    originPosX: String(origin.position[0]),
    originPosY: String(origin.position[1]),
    originPosZ: String(origin.position[2]),
    originRotXDeg: String(round2(radToDeg(origin.rotation_rpy[0]))),
    originRotYDeg: String(round2(radToDeg(origin.rotation_rpy[1]))),
    originRotZDeg: String(round2(radToDeg(origin.rotation_rpy[2]))),
    axisX: "0",
    axisY: "1",
    axisZ: "0",
    limitsLower: "",
    limitsUpper: "",
    damping: "",
    friction: "",
  };
}

function draftToJoint(draft: Draft, id: string, parent: string, child: string): Joint {
  const origin: Transform = {
    position: [num(draft.originPosX), num(draft.originPosY), num(draft.originPosZ)],
    rotation_rpy: [degToRad(num(draft.originRotXDeg)), degToRad(num(draft.originRotYDeg)), degToRad(num(draft.originRotZDeg))],
  };
  const common = { id, name: draft.name, parent, child, origin };
  const damping = draft.damping.trim() === "" ? undefined : num(draft.damping);
  const friction = draft.friction.trim() === "" ? undefined : num(draft.friction);
  const limits =
    draft.limitsLower.trim() === "" || draft.limitsUpper.trim() === ""
      ? undefined
      : { lower: num(draft.limitsLower), upper: num(draft.limitsUpper) };

  switch (draft.type) {
    case "fixed":
      return { ...common, type: "fixed" };
    case "hinge":
    case "slider":
      return { ...common, type: draft.type, axis: [num(draft.axisX), num(draft.axisY), num(draft.axisZ)], limits, damping, friction };
    case "ball":
      return { ...common, type: "ball", damping };
    case "free":
      return { ...common, type: "free" };
  }
}

const IDENTITY: Transform = { position: [0, 0, 0], rotation_rpy: [0, 0, 0] };

export interface JointCreatorProps {
  robot: RobotDef;
  parentId: string;
  childId: string;
  /** Called only with a document that introduces no new error-severity issue. */
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
}

export function JointCreator({ robot, parentId, childId, onApply, onCancel }: JointCreatorProps) {
  const parentBody = robot.bodies.find((b) => b.id === parentId);
  const childBody = robot.bodies.find((b) => b.id === childId);
  const jointId = useMemo(() => nextJointId(robot), [robot]);

  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(jointId, parentBody && childBody ? computeJointOrigin(parentBody, childBody) : IDENTITY),
  );

  const { candidateRobot, newIssues } = useMemo(() => {
    if (!parentBody || !childBody) return { candidateRobot: null, newIssues: [] };
    const joint = draftToJoint(draft, jointId, parentId, childId);
    // The origin above already carries whatever offset childBody's own
    // transform used to encode as a root; reset it to identity so the
    // child's rendered/simulated world pose is unchanged by adding this
    // joint (see docs/decisions/robot-builder-joints.md).
    const candidate: RobotDef = {
      ...robot,
      bodies: robot.bodies.map((b) => (b.id === childId ? { ...b, transform: IDENTITY } : b)),
      joints: [...robot.joints, joint],
    };
    const issues = issuesIntroducedBy(validateRobotDef(robot), validateRobotDef(candidate));
    return { candidateRobot: candidate, newIssues: issues };
  }, [robot, draft, jointId, parentId, childId, parentBody, childBody]);

  if (!parentBody || !childBody) return null;

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const hasError = newIssues.some((i) => i.severity === "error");

  const apply = () => {
    if (!candidateRobot || hasError) return;
    onApply(candidateRobot);
  };

  return (
    <div className="body-inspector">
      <h4>New joint</h4>
      <p className="inspector-note">
        {parentBody.name} → {childBody.name}
      </p>

      <label>
        Name
        <input aria-label="joint name" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
      </label>

      <section className="inspector-section">
        <h5>Type</h5>
        <label>
          Joint type
          <select aria-label="joint type" value={draft.type} onChange={(e) => setField("type", e.target.value as JointType)}>
            <option value="fixed">fixed</option>
            <option value="hinge">hinge</option>
            <option value="slider">slider</option>
            <option value="ball">ball</option>
            <option value="free">free</option>
          </select>
        </label>
      </section>

      {HAS_AXIS.has(draft.type) && (
        <section className="inspector-section">
          <h5>Axis</h5>
          <div className="inspector-grid">
            <label>
              X
              <input aria-label="joint axis x" type="number" step="0.1" value={draft.axisX} onChange={(e) => setField("axisX", e.target.value)} />
            </label>
            <label>
              Y
              <input aria-label="joint axis y" type="number" step="0.1" value={draft.axisY} onChange={(e) => setField("axisY", e.target.value)} />
            </label>
            <label>
              Z
              <input aria-label="joint axis z" type="number" step="0.1" value={draft.axisZ} onChange={(e) => setField("axisZ", e.target.value)} />
            </label>
          </div>
        </section>
      )}

      {HAS_AXIS.has(draft.type) && (
        <section className="inspector-section">
          <h5>Limits (blank = unlimited)</h5>
          <div className="inspector-grid">
            <label>
              Lower
              <input aria-label="joint limits lower" type="number" step="0.1" value={draft.limitsLower} onChange={(e) => setField("limitsLower", e.target.value)} />
            </label>
            <label>
              Upper
              <input aria-label="joint limits upper" type="number" step="0.1" value={draft.limitsUpper} onChange={(e) => setField("limitsUpper", e.target.value)} />
            </label>
          </div>
        </section>
      )}

      {(HAS_DAMPING.has(draft.type) || HAS_FRICTION.has(draft.type)) && (
        <section className="inspector-section">
          <h5>Damping &amp; friction (blank = unset)</h5>
          <div className="inspector-grid">
            {HAS_DAMPING.has(draft.type) && (
              <label>
                Damping
                <input aria-label="joint damping" type="number" step="0.001" min="0" value={draft.damping} onChange={(e) => setField("damping", e.target.value)} />
              </label>
            )}
            {HAS_FRICTION.has(draft.type) && (
              <label>
                Friction
                <input aria-label="joint friction" type="number" step="0.001" min="0" value={draft.friction} onChange={(e) => setField("friction", e.target.value)} />
              </label>
            )}
          </div>
        </section>
      )}

      <section className="inspector-section">
        <h5>Origin (m) -- {childBody.name}'s mount point in {parentBody.name}'s frame</h5>
        <div className="inspector-grid">
          <label>
            X
            <input aria-label="joint origin x" type="number" step="0.01" value={draft.originPosX} onChange={(e) => setField("originPosX", e.target.value)} />
          </label>
          <label>
            Y
            <input aria-label="joint origin y" type="number" step="0.01" value={draft.originPosY} onChange={(e) => setField("originPosY", e.target.value)} />
          </label>
          <label>
            Z
            <input aria-label="joint origin z" type="number" step="0.01" value={draft.originPosZ} onChange={(e) => setField("originPosZ", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="inspector-section">
        <h5>Origin rotation (°)</h5>
        <div className="inspector-grid">
          <label>
            X
            <input aria-label="joint origin rotation x" type="number" step="1" value={draft.originRotXDeg} onChange={(e) => setField("originRotXDeg", e.target.value)} />
          </label>
          <label>
            Y
            <input aria-label="joint origin rotation y" type="number" step="1" value={draft.originRotYDeg} onChange={(e) => setField("originRotYDeg", e.target.value)} />
          </label>
          <label>
            Z
            <input aria-label="joint origin rotation z" type="number" step="1" value={draft.originRotZDeg} onChange={(e) => setField("originRotZDeg", e.target.value)} />
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

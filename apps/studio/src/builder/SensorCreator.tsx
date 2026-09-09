import { useMemo, useState } from "react";
import type { RobotDef, Sensor, SensorType, Transform } from "../contracts/robotDef";
import { validateRobotDef } from "../contracts/robotDef";
import { applySensor, issuesIntroducedBy, nextSensorId } from "./robotEdits";

// Build mode's sensor-creation panel (Robot Builder D1) -- shown in the
// inspector slot in place of BodyInspector once a mounting body is picked
// (see BuilderPanel.tsx/BuilderViewport.tsx's "Add Sensor" tool, which
// reuses the existing single-body TARGET_PICK_TOOLS flow Fillet/Chamfer/
// Shell/Draft already established), or when editing an existing sensor
// from the hierarchy's own Sensors list. Same draft/live-validate/Apply
// idiom JointCreator.tsx/ActuatorCreator.tsx use. See
// docs/decisions/robot-builder-actuator-sensor-authoring.md.

export const SENSOR_TYPE_DESCRIPTIONS: Record<SensorType, string> = {
  camera: "Not simulated yet in Test mode (Robot Builder Phase 4) -- parses and validates, but produces no reading.",
  distance: "A single ray straight ahead from the mount point -- like the Car's own front sensor.",
  lidar: "Several rays fanned out in front of the mount -- wider awareness than a single distance sensor.",
  imu: "Reports acceleration and rotation rate at the mount point.",
  encoder: "Reads a joint's own current angle. Attaches directly to a joint, not a body position -- pick the joint below, not a transform.",
  gps: "Reports the mount point's own position in the world.",
  touch: "Reports contact force at the mount point -- best placed where the body is likely to actually touch something.",
  force_torque: "Reports the force/torque the mounting joint is reacting with -- not a generic touch point.",
};

const SENSOR_TYPES: SensorType[] = ["distance", "lidar", "imu", "encoder", "gps", "touch", "force_torque", "camera"];
const DEFAULT_LIDAR_RAYS = 9;
const DEFAULT_LIDAR_FOV = 180;

interface Draft {
  name: string;
  type: SensorType;
  joint: string;
  posX: string;
  posY: string;
  posZ: string;
  rotXDeg: string;
  rotYDeg: string;
  rotZDeg: string;
  lidarRays: string;
  lidarFov: string;
}

const num = (s: string) => Number.parseFloat(s);
const round2 = (n: number) => Math.round(n * 100) / 100;
const radToDeg = (r: number) => (r * 180) / Math.PI;
const degToRad = (d: number) => (d * Math.PI) / 180;
const IDENTITY: Transform = { position: [0, 0, 0], rotation_rpy: [0, 0, 0] };

function initialDraft(name: string, existing?: Sensor): Draft {
  const transform = existing?.transform ?? IDENTITY;
  const params = (existing?.params ?? {}) as { rays?: number; fov_degrees?: number };
  return {
    name: existing?.name ?? name,
    type: existing?.type ?? "distance",
    joint: existing?.joint ?? "",
    posX: String(transform.position[0]),
    posY: String(transform.position[1]),
    posZ: String(transform.position[2]),
    rotXDeg: String(round2(radToDeg(transform.rotation_rpy[0]))),
    rotYDeg: String(round2(radToDeg(transform.rotation_rpy[1]))),
    rotZDeg: String(round2(radToDeg(transform.rotation_rpy[2]))),
    lidarRays: params.rays !== undefined ? String(params.rays) : String(DEFAULT_LIDAR_RAYS),
    lidarFov: params.fov_degrees !== undefined ? String(params.fov_degrees) : String(DEFAULT_LIDAR_FOV),
  };
}

function draftToSensor(draft: Draft, id: string, bodyId: string): Sensor {
  const transform: Transform = {
    position: [num(draft.posX), num(draft.posY), num(draft.posZ)],
    rotation_rpy: [degToRad(num(draft.rotXDeg)), degToRad(num(draft.rotYDeg)), degToRad(num(draft.rotZDeg))],
  };
  const joint = draft.type === "encoder" && draft.joint.trim() !== "" ? draft.joint : undefined;
  const params = draft.type === "lidar" ? { rays: Math.trunc(num(draft.lidarRays)), fov_degrees: num(draft.lidarFov) } : undefined;
  return { id, name: draft.name, type: draft.type, body: bodyId, joint, transform, params };
}

export interface SensorCreatorProps {
  robot: RobotDef;
  /** The mounting body, already picked in the 3D viewport before this
   * panel ever renders (or, when editing, the existing sensor's own
   * `body`). */
  bodyId: string;
  /** Set when editing an existing sensor (prefills the draft; Apply
   * replaces it in place instead of appending a new one). */
  existing?: Sensor;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
}

export function SensorCreator({ robot, bodyId, existing, onApply, onCancel }: SensorCreatorProps) {
  const body = robot.bodies.find((b) => b.id === bodyId);
  const sensorId = useMemo(() => existing?.id ?? nextSensorId(robot), [robot, existing]);
  // Joints connected to the mounting body, either side -- the only ones a
  // student would plausibly mean by "this body's own joint angle." Fixed
  // joints never move, so an encoder there would always read zero.
  const eligibleJoints = useMemo(
    () => robot.joints.filter((j) => j.type !== "fixed" && (j.parent === bodyId || j.child === bodyId)),
    [robot.joints, bodyId],
  );

  const [draft, setDraft] = useState<Draft>(() => initialDraft(sensorId, existing));

  const { candidateRobot, newIssues } = useMemo(() => {
    const sensor = draftToSensor(draft, sensorId, bodyId);
    const candidate = applySensor(robot, sensor, existing?.id);
    const issues = issuesIntroducedBy(validateRobotDef(robot), validateRobotDef(candidate));
    return { candidateRobot: candidate, newIssues: issues };
  }, [robot, draft, sensorId, bodyId, existing]);

  if (!body) return null;

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const isEncoder = draft.type === "encoder";
  const isLidar = draft.type === "lidar";
  const isCamera = draft.type === "camera";
  const hasError = newIssues.some((i) => i.severity === "error");

  const apply = () => {
    if (hasError) return;
    onApply(candidateRobot);
  };

  return (
    <div className="body-inspector">
      <h4>{existing ? "Edit sensor" : "New sensor"}</h4>
      <p className="inspector-note">On {body.name}</p>

      <label>
        Name
        <input aria-label="sensor name" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
      </label>

      <section className="inspector-section">
        <h5>Type</h5>
        <label>
          Sensor type
          <select aria-label="sensor type" value={draft.type} onChange={(e) => setField("type", e.target.value as SensorType)}>
            {SENSOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <p className="inspector-note">{SENSOR_TYPE_DESCRIPTIONS[draft.type]}</p>
        {isCamera && <p className="body-issue warning">This sensor will parse and validate, but Test mode won't show a reading for it yet.</p>}
      </section>

      {isEncoder && (
        <section className="inspector-section">
          <h5>Joint</h5>
          {eligibleJoints.length === 0 ? (
            <p className="body-issue warning">
              {body.name} isn't connected to a movable joint -- pick a different body, or choose a different sensor
              type.
            </p>
          ) : (
            <label>
              Joint to read
              <select aria-label="sensor joint" value={draft.joint} onChange={(e) => setField("joint", e.target.value)}>
                <option value="">(choose a joint)</option>
                {eligibleJoints.map((joint) => (
                  <option key={joint.id} value={joint.id}>
                    {joint.name} ({joint.type})
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {!isEncoder && (
        <>
          <section className="inspector-section">
            <h5>Mount position (m) -- in {body.name}'s own frame</h5>
            <div className="inspector-grid">
              <label>
                X
                <input aria-label="sensor position x" type="number" step="0.01" value={draft.posX} onChange={(e) => setField("posX", e.target.value)} />
              </label>
              <label>
                Y
                <input aria-label="sensor position y" type="number" step="0.01" value={draft.posY} onChange={(e) => setField("posY", e.target.value)} />
              </label>
              <label>
                Z
                <input aria-label="sensor position z" type="number" step="0.01" value={draft.posZ} onChange={(e) => setField("posZ", e.target.value)} />
              </label>
            </div>
          </section>

          <section className="inspector-section">
            <h5>Mount rotation (°) -- local +X is the sensor's own forward direction</h5>
            <div className="inspector-grid">
              <label>
                X
                <input aria-label="sensor rotation x" type="number" step="1" value={draft.rotXDeg} onChange={(e) => setField("rotXDeg", e.target.value)} />
              </label>
              <label>
                Y
                <input aria-label="sensor rotation y" type="number" step="1" value={draft.rotYDeg} onChange={(e) => setField("rotYDeg", e.target.value)} />
              </label>
              <label>
                Z
                <input aria-label="sensor rotation z" type="number" step="1" value={draft.rotZDeg} onChange={(e) => setField("rotZDeg", e.target.value)} />
              </label>
            </div>
          </section>
        </>
      )}

      {isLidar && (
        <section className="inspector-section">
          <h5>Lidar fan</h5>
          <div className="inspector-grid">
            <label>
              Rays
              <input aria-label="sensor lidar rays" type="number" step="1" min="1" value={draft.lidarRays} onChange={(e) => setField("lidarRays", e.target.value)} />
            </label>
            <label>
              Field of view (°)
              <input aria-label="sensor lidar fov" type="number" step="1" min="1" value={draft.lidarFov} onChange={(e) => setField("lidarFov", e.target.value)} />
            </label>
          </div>
        </section>
      )}

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

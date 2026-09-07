import { useMemo, useState } from "react";
import type { Body, Geometry, Issue, RobotDef } from "../contracts/robotDef";
import { validateRobotDef } from "../contracts/robotDef";
import { FeatureTreeList } from "./FeatureTreeList";

// The Build-mode properties panel for the selected body. Same pattern as
// WorldPanel.tsx: a draft in friendly string form (so a half-typed number
// doesn't get clobbered), degrees at the surface / radians internally,
// live validation on every keystroke via useMemo, nothing reaches the
// document until Apply. Unlike WorldPanel, Apply is only blocked by an
// error that belongs to *this* body -- an unrelated pre-existing issue
// elsewhere in the document shouldn't stop you from fixing this one, and
// every issue for this body is listed, not just an accept/reject gate.
//
// Edits `visual` only; `collision` is set equal to `visual` on Apply --
// there's no separate collision editor in this slice (the schema does
// distinguish the two; a future slice may want them independent).

type GeometryType = "none" | Geometry["type"];

interface Draft {
  name: string;
  posX: string;
  posY: string;
  posZ: string;
  rotXDeg: string;
  rotYDeg: string;
  rotZDeg: string;
  geometryType: GeometryType;
  sizeX: string;
  sizeY: string;
  sizeZ: string;
  radius: string;
  length: string;
  planeW: string;
  planeH: string;
  meshPath: string;
  mass: string;
  ixx: string;
  iyy: string;
  izz: string;
  color: string;
}

const GEOMETRY_DEFAULTS = { sizeX: "0.05", sizeY: "0.05", sizeZ: "0.05", radius: "0.05", length: "0.1", planeW: "0.1", planeH: "0.1", meshPath: "" };
const DEFAULT_COLOR: readonly [number, number, number] = [0.6, 0.6, 0.6];

const round2 = (n: number) => Math.round(n * 100) / 100;
const radToDeg = (r: number) => (r * 180) / Math.PI;
const degToRad = (d: number) => (d * Math.PI) / 180;
const num = (s: string) => Number.parseFloat(s);

function hexToRgbFloat(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbFloatToHex(color: readonly number[]): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const [r, g, b] = color;
  return `#${[r, g, b].map((c) => toByte(c).toString(16).padStart(2, "0")).join("")}`;
}

function geometryDraft(geometry: Geometry | undefined): Pick<Draft, "geometryType" | "sizeX" | "sizeY" | "sizeZ" | "radius" | "length" | "planeW" | "planeH" | "meshPath"> {
  if (geometry === undefined) return { geometryType: "none", ...GEOMETRY_DEFAULTS };
  switch (geometry.type) {
    case "box":
      return { geometryType: "box", ...GEOMETRY_DEFAULTS, sizeX: String(geometry.size[0]), sizeY: String(geometry.size[1]), sizeZ: String(geometry.size[2]) };
    case "sphere":
      return { geometryType: "sphere", ...GEOMETRY_DEFAULTS, radius: String(geometry.radius) };
    case "cylinder":
    case "capsule":
    case "cone":
      return { geometryType: geometry.type, ...GEOMETRY_DEFAULTS, radius: String(geometry.radius), length: String(geometry.length) };
    case "plane":
      return { geometryType: "plane", ...GEOMETRY_DEFAULTS, planeW: String(geometry.size[0]), planeH: String(geometry.size[1]) };
    case "mesh":
      return { geometryType: "mesh", ...GEOMETRY_DEFAULTS, meshPath: geometry.path };
    case "cad_mesh":
      // Baked CAD-kernel output (v1) -- not editable as numeric fields any
      // more than an external mesh file is; see the "not editable here"
      // note below, extended to cover this type too. No Build-mode
      // authoring UI for CAD parts exists yet (docs/decisions/cad-kernel-foundation.md).
      return { geometryType: "cad_mesh", ...GEOMETRY_DEFAULTS };
  }
}

function toDraft(body: Body): Draft {
  return {
    name: body.name,
    posX: String(body.transform.position[0]),
    posY: String(body.transform.position[1]),
    posZ: String(body.transform.position[2]),
    rotXDeg: String(round2(radToDeg(body.transform.rotation_rpy[0]))),
    rotYDeg: String(round2(radToDeg(body.transform.rotation_rpy[1]))),
    rotZDeg: String(round2(radToDeg(body.transform.rotation_rpy[2]))),
    mass: String(body.mass),
    ixx: String(body.inertia.ixx),
    iyy: String(body.inertia.iyy),
    izz: String(body.inertia.izz),
    color: rgbFloatToHex(body.material?.color ?? DEFAULT_COLOR),
    ...geometryDraft(body.visual),
  };
}

function draftToGeometry(draft: Draft, existing: Geometry | undefined): Geometry | undefined {
  switch (draft.geometryType) {
    case "none":
      return undefined;
    case "box":
      return { type: "box", size: [num(draft.sizeX), num(draft.sizeY), num(draft.sizeZ)] };
    case "sphere":
      return { type: "sphere", radius: num(draft.radius) };
    case "cylinder":
      return { type: "cylinder", radius: num(draft.radius), length: num(draft.length) };
    case "capsule":
      return { type: "capsule", radius: num(draft.radius), length: num(draft.length) };
    case "cone":
      return { type: "cone", radius: num(draft.radius), length: num(draft.length) };
    case "plane":
      return { type: "plane", size: [num(draft.planeW), num(draft.planeH)] };
    case "mesh":
      return { type: "mesh", path: draft.meshPath, scale: [1, 1, 1] };
    case "cad_mesh":
      // Baked CAD-kernel data has no scalar draft fields to reconstruct
      // from (see geometryDraft above) -- Apply preserves it unchanged,
      // the same "not editable here" treatment the mesh type gets.
      return existing;
  }
}

function draftToBody(draft: Draft, existing: Body): Body {
  const geometry = draftToGeometry(draft, existing.visual);
  return {
    ...existing,
    name: draft.name,
    transform: {
      position: [num(draft.posX), num(draft.posY), num(draft.posZ)],
      rotation_rpy: [degToRad(num(draft.rotXDeg)), degToRad(num(draft.rotYDeg)), degToRad(num(draft.rotZDeg))],
    },
    visual: geometry,
    collision: geometry,
    mass: num(draft.mass),
    inertia: { ixx: num(draft.ixx), iyy: num(draft.iyy), izz: num(draft.izz) },
    material: { color: hexToRgbFloat(draft.color) },
  };
}

export interface BodyInspectorProps {
  /** The full live document, so a candidate can be re-validated against it. */
  robot: RobotDef;
  bodyId: string;
  /** Called only with a document whose candidate body has no error-severity issue. */
  onApply: (nextRobot: RobotDef) => void;
  onRequestDelete: (bodyId: string) => void;
  /** CAD Kernel Phase 7.3 (edit-any-step): threaded straight to
   * FeatureTreeList's own onSelectStep -- BuilderPanel is the one that
   * actually knows how to open a step's own editor, this component just
   * forwards the click. Omitted entirely means the Construction history
   * panel stays read-only (matches FeatureTreeList's own default). */
  onSelectFeatureStep?: (index: number) => void;
}

export function BodyInspector({ robot, bodyId, onApply, onRequestDelete, onSelectFeatureStep }: BodyInspectorProps) {
  const body = robot.bodies.find((b) => b.id === bodyId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(body ?? robot.bodies[0]));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { candidateRobot, bodyIssues } = useMemo((): { candidateRobot: RobotDef | null; bodyIssues: Issue[] } => {
    if (!body) return { candidateRobot: null, bodyIssues: [] };
    const nextBody = draftToBody(draft, body);
    const candidate: RobotDef = { ...robot, bodies: robot.bodies.map((b) => (b.id === bodyId ? nextBody : b)) };
    const issues = validateRobotDef(candidate).filter((i) => i.element_kind === "body" && i.element_id === bodyId);
    return { candidateRobot: candidate, bodyIssues: issues };
  }, [robot, bodyId, draft, body]);

  if (!body) return null;

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const hasError = bodyIssues.some((i) => i.severity === "error");

  const apply = () => {
    if (!candidateRobot || hasError) return;
    onApply(candidateRobot);
  };

  const requestDelete = () => {
    if (confirmingDelete) {
      onRequestDelete(bodyId);
      return;
    }
    setConfirmingDelete(true);
  };

  return (
    <div className="body-inspector">
      <h4>Body</h4>
      <label>
        Name
        <input aria-label="body name" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
      </label>

      <section className="inspector-section">
        <h5>Position (m)</h5>
        <div className="inspector-grid">
          <label>
            X
            <input aria-label="body position x" type="number" step="0.01" value={draft.posX} onChange={(e) => setField("posX", e.target.value)} />
          </label>
          <label>
            Y
            <input aria-label="body position y" type="number" step="0.01" value={draft.posY} onChange={(e) => setField("posY", e.target.value)} />
          </label>
          <label>
            Z
            <input aria-label="body position z" type="number" step="0.01" value={draft.posZ} onChange={(e) => setField("posZ", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="inspector-section">
        <h5>Rotation (°)</h5>
        <div className="inspector-grid">
          <label>
            X
            <input aria-label="body rotation x" type="number" step="1" value={draft.rotXDeg} onChange={(e) => setField("rotXDeg", e.target.value)} />
          </label>
          <label>
            Y
            <input aria-label="body rotation y" type="number" step="1" value={draft.rotYDeg} onChange={(e) => setField("rotYDeg", e.target.value)} />
          </label>
          <label>
            Z
            <input aria-label="body rotation z" type="number" step="1" value={draft.rotZDeg} onChange={(e) => setField("rotZDeg", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="inspector-section">
        <h5>Geometry</h5>
        <label>
          Shape
          <select
            aria-label="body geometry type"
            value={draft.geometryType}
            onChange={(e) => setField("geometryType", e.target.value as GeometryType)}
            disabled={draft.geometryType === "mesh" || draft.geometryType === "cad_mesh"}
          >
            <option value="none">none</option>
            <option value="box">box</option>
            <option value="sphere">sphere</option>
            <option value="cylinder">cylinder</option>
            <option value="capsule">capsule</option>
            <option value="cone">cone</option>
            <option value="plane">plane</option>
          </select>
        </label>

        {draft.geometryType === "cad_mesh" && (
          <div className="inspector-mesh-note">
            <p className="inspector-note">CAD part — baked mesh, not editable here.</p>
            <button type="button" onClick={() => setField("geometryType", "box")}>
              change to box
            </button>
          </div>
        )}

        {draft.geometryType === "cad_mesh" && <FeatureTreeList features={body.features} onSelectStep={onSelectFeatureStep} />}

        {draft.geometryType === "mesh" && (
          <div className="inspector-mesh-note">
            <p className="inspector-note">mesh ({draft.meshPath}) — not editable here.</p>
            <button type="button" onClick={() => setField("geometryType", "box")}>
              change to box
            </button>
          </div>
        )}

        {draft.geometryType === "box" && (
          <div className="inspector-grid">
            <label>
              W
              <input aria-label="body size x" type="number" step="0.01" min="0" value={draft.sizeX} onChange={(e) => setField("sizeX", e.target.value)} />
            </label>
            <label>
              D
              <input aria-label="body size y" type="number" step="0.01" min="0" value={draft.sizeY} onChange={(e) => setField("sizeY", e.target.value)} />
            </label>
            <label>
              H
              <input aria-label="body size z" type="number" step="0.01" min="0" value={draft.sizeZ} onChange={(e) => setField("sizeZ", e.target.value)} />
            </label>
          </div>
        )}

        {draft.geometryType === "sphere" && (
          <label>
            Radius
            <input aria-label="body radius" type="number" step="0.01" min="0" value={draft.radius} onChange={(e) => setField("radius", e.target.value)} />
          </label>
        )}

        {(draft.geometryType === "cylinder" || draft.geometryType === "capsule" || draft.geometryType === "cone") && (
          <div className="inspector-grid">
            <label>
              Radius
              <input aria-label="body radius" type="number" step="0.01" min="0" value={draft.radius} onChange={(e) => setField("radius", e.target.value)} />
            </label>
            <label>
              Length
              <input aria-label="body length" type="number" step="0.01" min="0" value={draft.length} onChange={(e) => setField("length", e.target.value)} />
            </label>
          </div>
        )}

        {draft.geometryType === "plane" && (
          <div className="inspector-grid">
            <label>
              W
              <input aria-label="body plane width" type="number" step="0.01" min="0" value={draft.planeW} onChange={(e) => setField("planeW", e.target.value)} />
            </label>
            <label>
              H
              <input aria-label="body plane height" type="number" step="0.01" min="0" value={draft.planeH} onChange={(e) => setField("planeH", e.target.value)} />
            </label>
          </div>
        )}

        <label>
          Color
          <input aria-label="body color" type="color" value={draft.color} onChange={(e) => setField("color", e.target.value)} />
        </label>
      </section>

      <section className="inspector-section">
        <h5>Mass &amp; inertia</h5>
        <label>
          Mass (kg)
          <input aria-label="body mass" type="number" step="0.01" value={draft.mass} onChange={(e) => setField("mass", e.target.value)} />
        </label>
        <div className="inspector-grid">
          <label>
            Ixx
            <input aria-label="body inertia ixx" type="number" step="0.0001" value={draft.ixx} onChange={(e) => setField("ixx", e.target.value)} />
          </label>
          <label>
            Iyy
            <input aria-label="body inertia iyy" type="number" step="0.0001" value={draft.iyy} onChange={(e) => setField("iyy", e.target.value)} />
          </label>
          <label>
            Izz
            <input aria-label="body inertia izz" type="number" step="0.0001" value={draft.izz} onChange={(e) => setField("izz", e.target.value)} />
          </label>
        </div>
      </section>

      {bodyIssues.length > 0 && (
        <ul className="body-issues">
          {bodyIssues.map((issue, index) => (
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
        <button type="button" className={confirmingDelete ? "delete-btn confirm" : "delete-btn"} onClick={requestDelete}>
          {confirmingDelete ? "delete?" : "Delete body"}
        </button>
      </div>
    </div>
  );
}

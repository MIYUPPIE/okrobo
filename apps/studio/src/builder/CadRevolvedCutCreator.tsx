import { useEffect, useMemo, useState } from "react";
import type { Feature, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { cut, replayFeatures } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { geometryToMesh } from "./geometryToMesh";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Revolved Cut panel (Robot Builder CAD Kernel Phase 4) --
// subtracts a revolved tool (a lathe cut) from an existing, already-picked
// target body. Mirrors CadExtrudedCutCreator.tsx's own structure exactly,
// substituting Revolve's own Offset/Angle fields (see
// CadRevolveCreator.tsx) for Extrude's Depth. See
// docs/decisions/cad-kernel-cut-operations.md.

interface Draft {
  profile: ProfileDraft;
  offset: string;
  angleDeg: string;
  x: string;
  y: string;
  z: string;
}

const initialDraft: Draft = {
  profile: { shape: "circle", width: "0.02", height: "0.03", radius: "0.01" },
  offset: "0.03",
  angleDeg: "360",
  x: "0",
  y: "0",
  z: "0",
};

function finiteNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return { ok: false, message: `${label} must be a number` };
  return { ok: true, value };
}

function parseAngle(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 360) return { ok: false, message: "Angle must be between 0 and 360" };
  return { ok: true, value };
}

interface ParsedDraft {
  profile: { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
  offset: number;
  angleDeg: number;
  position: [number, number, number];
}
type ParseResult = { ok: true; value: ParsedDraft } | { ok: false; message: string };

/** Same self-intersection guard as CadRevolveCreator.tsx: an offset less
 * than the profile's own half-extent runs the revolution axis through the
 * profile itself, always self-intersecting for OpenCascade. */
function parseDraft(draft: Draft): ParseResult {
  const profile = parseProfileDraft(draft.profile);
  if (!profile.ok) return profile;
  const offset = positiveNumber(draft.offset, "Offset");
  if (!offset.ok) return offset;
  const halfExtent = profile.value.type === "rectangle" ? profile.value.width / 2 : profile.value.radius;
  if (offset.value < halfExtent) {
    return { ok: false, message: profile.value.type === "rectangle" ? "Offset must be at least half the width" : "Offset must be at least the radius" };
  }
  const angle = parseAngle(draft.angleDeg);
  if (!angle.ok) return angle;
  const x = finiteNumber(draft.x, "Position X");
  if (!x.ok) return x;
  const y = finiteNumber(draft.y, "Position Y");
  if (!y.ok) return y;
  const z = finiteNumber(draft.z, "Position Z");
  if (!z.ok) return z;
  return { ok: true, value: { profile: profile.value, offset: offset.value, angleDeg: angle.value, position: [x.value, y.value, z.value] } };
}

export interface CadRevolvedCutCreatorProps {
  robot: RobotDef;
  targetBodyId: string;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
  /** CAD Kernel Phase 7.3 (edit-any-step): see CadExtrudedCutCreator's own
   * doc -- identical edit-mode shape. */
  editing?: {
    feature: Extract<Feature, { operation: "cut" }>;
    stepIndex: number;
    allFeatures: Feature[];
    onApply: (nextFeature: Feature) => void;
  };
}

function draftFromFeature(feature: Extract<Feature, { operation: "cut" }>): Draft {
  const tool = feature.tool;
  const profile = tool.operation === "revolve" ? tool.profile : { type: "circle" as const, radius: 0.01 };
  return {
    profile:
      profile.type === "rectangle"
        ? { shape: "rectangle", width: String(profile.width), height: String(profile.height), radius: "0.01" }
        : { shape: "circle", width: "0.02", height: "0.03", radius: String(profile.radius) },
    offset: tool.operation === "revolve" ? String(tool.offset) : "0.03",
    angleDeg: tool.operation === "revolve" ? String(tool.angle_deg) : "360",
    x: String(feature.position[0]),
    y: String(feature.position[1]),
    z: String(feature.position[2]),
  };
}

export function CadRevolvedCutCreator({ robot, targetBodyId, onApply, onCancel, onPreviewChange, editing }: CadRevolvedCutCreatorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const targetMesh = useMemo(() => geometryToMesh(targetBody?.visual ?? targetBody?.collision), [targetBody]);
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftFromFeature(editing.feature) : initialDraft));
  const setProfile = (profile: ProfileDraft) => setDraft((d) => ({ ...d, profile }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    if (editing) {
      const nextFeature: Feature = {
        operation: "cut",
        tool: { operation: "revolve", profile: parsed.value.profile, offset: parsed.value.offset, angle_deg: parsed.value.angleDeg },
        position: parsed.value.position,
      };
      const nextFeatures = editing.allFeatures.map((f, i) => (i === editing.stepIndex ? nextFeature : f));
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    const call = () =>
      cut({
        targetMesh,
        tool: { operation: "revolve", profile: parsed.value.profile, offset: parsed.value.offset, angleDeg: parsed.value.angleDeg },
        position: parsed.value.position,
      });
    return { ok: true, call };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.offset, draft.angleDeg, draft.x, draft.y, draft.z, targetMesh, editing]);

  useEffect(() => {
    if (!targetBody) return;
    if (status === "ready" && mesh) {
      onPreviewChange({ mesh, position: targetBody.transform.position });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, targetBody, onPreviewChange]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const parsed = parseDraft(draft);
    if (!parsed.ok) return;
    const feature: Feature = {
      operation: "cut",
      tool: { operation: "revolve", profile: parsed.value.profile, offset: parsed.value.offset, angle_deg: parsed.value.angleDeg },
      position: parsed.value.position,
    };
    if (editing) {
      editing.onApply(feature);
      return;
    }
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh, [feature]));
  };

  if (!targetBody) return null;

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>{editing ? "Edit Cut (Revolved)" : "New CAD part (Revolved Cut)"}</h4>
      <p className="inspector-note">Cutting into {targetBody.name}</p>

      <section className="inspector-section">
        <h5>Profile</h5>
        <label>
          Shape
          <select aria-label="cad profile" value={draft.profile.shape} onChange={(e) => setProfile({ ...draft.profile, shape: e.target.value as ProfileShape })}>
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
          </select>
        </label>
      </section>

      <section className="inspector-section">
        <h5>Dimensions (m)</h5>
        <div className="inspector-grid">
          <CadProfileDimensionFields ariaPrefix="cad" draft={draft.profile} onChange={setProfile} />
        </div>
      </section>

      <section className="inspector-section">
        <h5>Revolve</h5>
        <div className="inspector-grid">
          <label>
            Offset from axis
            <input
              aria-label="cad offset"
              type="number"
              step="0.01"
              min="0"
              value={draft.offset}
              onChange={(e) => setDraft((d) => ({ ...d, offset: e.target.value }))}
            />
          </label>
          <label>
            Angle (°)
            <input
              aria-label="cad angle"
              type="number"
              step="1"
              min="0"
              max="360"
              value={draft.angleDeg}
              onChange={(e) => setDraft((d) => ({ ...d, angleDeg: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <section className="inspector-section">
        <h5>Position (m)</h5>
        <div className="inspector-grid">
          <label>
            X
            <input aria-label="cad position x" type="number" step="0.01" value={draft.x} onChange={(e) => setDraft((d) => ({ ...d, x: e.target.value }))} />
          </label>
          <label>
            Y
            <input aria-label="cad position y" type="number" step="0.01" value={draft.y} onChange={(e) => setDraft((d) => ({ ...d, y: e.target.value }))} />
          </label>
          <label>
            Z
            <input aria-label="cad position z" type="number" step="0.01" value={draft.z} onChange={(e) => setDraft((d) => ({ ...d, z: e.target.value }))} />
          </label>
        </div>
      </section>

      {status === "loading" && <p className="cad-status">computing…</p>}
      {status === "error" && <p className="cad-status error">{error}</p>}

      <div className="inspector-actions">
        <button type="button" className="primary" onClick={apply} disabled={status !== "ready"}>
          Apply
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

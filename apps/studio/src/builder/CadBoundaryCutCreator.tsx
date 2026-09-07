import { useEffect, useMemo, useState } from "react";
import type { Feature, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { cut, replayFeatures } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { geometryToMesh } from "./geometryToMesh";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Boundary Cut panel (Robot Builder CAD Kernel Phase 4) --
// subtracts a lofted tool (blending a Start and an End profile) from an
// existing, already-picked target body. Mirrors CadBoundaryCreator.tsx's
// own Start/End profile layout, adding the Position (offset from the
// target's own local origin) block every Cut creator has. See
// docs/decisions/cad-kernel-cut-operations.md.

interface Draft {
  start: ProfileDraft;
  end: ProfileDraft;
  loftHeight: string;
  x: string;
  y: string;
  z: string;
}

const initialProfileDraft: ProfileDraft = { shape: "circle", width: "0.02", height: "0.02", radius: "0.02" };
const initialDraft: Draft = {
  start: initialProfileDraft,
  end: { ...initialProfileDraft, radius: "0.01" },
  loftHeight: "0.2",
  x: "0",
  y: "0",
  z: "0",
};

function finiteNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return { ok: false, message: `${label} must be a number` };
  return { ok: true, value };
}

type ParsedProfile = { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
type ParseResult =
  | { ok: true; value: { start: ParsedProfile; end: ParsedProfile; loftHeight: number; position: [number, number, number] } }
  | { ok: false; message: string };

function parseDraft(draft: Draft): ParseResult {
  const start = parseProfileDraft(draft.start, "Start");
  if (!start.ok) return start;
  const end = parseProfileDraft(draft.end, "End");
  if (!end.ok) return end;
  const loftHeight = positiveNumber(draft.loftHeight, "Height");
  if (!loftHeight.ok) return loftHeight;
  const x = finiteNumber(draft.x, "Position X");
  if (!x.ok) return x;
  const y = finiteNumber(draft.y, "Position Y");
  if (!y.ok) return y;
  const z = finiteNumber(draft.z, "Position Z");
  if (!z.ok) return z;
  return { ok: true, value: { start: start.value, end: end.value, loftHeight: loftHeight.value, position: [x.value, y.value, z.value] } };
}

export interface CadBoundaryCutCreatorProps {
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
  const start = tool.operation === "loft" ? tool.start_profile : { type: "circle" as const, radius: 0.02 };
  const end = tool.operation === "loft" ? tool.end_profile : { type: "circle" as const, radius: 0.01 };
  const toDraft = (profile: typeof start, fallbackRadius: string): ProfileDraft =>
    profile.type === "rectangle"
      ? { shape: "rectangle", width: String(profile.width), height: String(profile.height), radius: fallbackRadius }
      : { shape: "circle", width: "0.02", height: "0.02", radius: String(profile.radius) };
  return {
    start: toDraft(start, "0.02"),
    end: toDraft(end, "0.01"),
    loftHeight: tool.operation === "loft" ? String(tool.height) : "0.2",
    x: String(feature.position[0]),
    y: String(feature.position[1]),
    z: String(feature.position[2]),
  };
}

/** Same merged shape+dims layout as CadBoundaryCreator.tsx's own local
 * ProfileSection -- kept local for the same reason (specific to laying out
 * two profiles side by side). */
function ProfileSection({ label, draft, onChange }: { label: string; draft: ProfileDraft; onChange: (next: ProfileDraft) => void }) {
  const prefix = label.toLowerCase();
  return (
    <section className="inspector-section">
      <h5>{label} profile</h5>
      <label>
        Shape
        <select aria-label={`cad ${prefix} shape`} value={draft.shape} onChange={(e) => onChange({ ...draft, shape: e.target.value as ProfileShape })}>
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <div className="inspector-grid">
        <CadProfileDimensionFields ariaPrefix={`cad ${prefix}`} draft={draft} onChange={onChange} />
      </div>
    </section>
  );
}

export function CadBoundaryCutCreator({ robot, targetBodyId, onApply, onCancel, onPreviewChange, editing }: CadBoundaryCutCreatorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const targetMesh = useMemo(() => geometryToMesh(targetBody?.visual ?? targetBody?.collision), [targetBody]);
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftFromFeature(editing.feature) : initialDraft));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const { start, end, loftHeight, position } = parsed.value;
    if (editing) {
      const nextFeature: Feature = { operation: "cut", tool: { operation: "loft", start_profile: start, end_profile: end, height: loftHeight }, position };
      const nextFeatures = editing.allFeatures.map((f, i) => (i === editing.stepIndex ? nextFeature : f));
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    const call = () => cut({ targetMesh, tool: { operation: "loft", startProfile: start, endProfile: end, height: loftHeight }, position });
    return { ok: true, call };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.start, draft.end, draft.loftHeight, draft.x, draft.y, draft.z, targetMesh, editing]);

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
      tool: { operation: "loft", start_profile: parsed.value.start, end_profile: parsed.value.end, height: parsed.value.loftHeight },
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
      <h4>{editing ? "Edit Cut (Boundary)" : "New CAD part (Boundary Cut)"}</h4>
      <p className="inspector-note">Cutting into {targetBody.name}</p>

      <ProfileSection label="Start" draft={draft.start} onChange={(start) => setDraft((d) => ({ ...d, start }))} />
      <ProfileSection label="End" draft={draft.end} onChange={(end) => setDraft((d) => ({ ...d, end }))} />

      <section className="inspector-section">
        <h5>Height (m)</h5>
        <label>
          Separation between profiles
          <input
            aria-label="cad loft height"
            type="number"
            step="0.01"
            min="0"
            value={draft.loftHeight}
            onChange={(e) => setDraft((d) => ({ ...d, loftHeight: e.target.value }))}
          />
        </label>
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

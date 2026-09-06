import { useEffect, useMemo, useState } from "react";
import type { Body, Feature, RobotDef } from "../contracts/robotDef";
import type { CadEdgeOverlay, CadPreview, ShapeEdgeMesh } from "../cad/cadClient";
import { fillet, previewEdges, revolve } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { FilletEdgeList } from "./FilletEdgeList";
import { filletChamferFeatureFromPicks, parseFilletPicks, type FilletPickDraft } from "./filletPicks";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Revolve panel (Robot Builder CAD Kernel Phase 3) -- a
// profile swept around the world Y axis (a lathe operation: a torus from a
// circle profile, a ring from a rectangle one). Same draft/live-validate/
// Apply idiom as CadExtrudeCreator.tsx, sharing its debounce/status
// lifecycle via useCadPreview and its profile fields via
// ./CadProfileFields.tsx. See docs/decisions/cad-kernel-revolve-boundary.md
// for the geometry conventions (why the revolve axis's own origin is fixed
// at world [0,0,0], and why offset must be at least the profile's own
// half-extent).

interface Draft {
  profile: ProfileDraft;
  offset: string;
  angleDeg: string;
}

const initialDraft: Draft = { profile: { shape: "rectangle", width: "0.02", height: "0.03", radius: "0.02" }, offset: "0.05", angleDeg: "360" };

interface ParsedDraft {
  profile: { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
  offset: number;
  angleDeg: number;
}
type ParseResult = { ok: true; value: ParsedDraft } | { ok: false; message: string };

function parseAngle(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 360) return { ok: false, message: "Angle must be between 0 and 360" };
  return { ok: true, value };
}

/** Validated locally, before ever calling the CAD worker. An offset less
 * than the profile's own half-extent runs the revolution axis through the
 * profile itself -- always self-intersecting for OpenCascade, verified
 * empirically (see the decision doc) -- so there's no reason to ever send
 * that configuration to the worker. */
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
  return { ok: true, value: { profile: profile.value, offset: offset.value, angleDeg: angle.value } };
}

export interface CadRevolveCreatorProps {
  robot: RobotDef;
  near: Body | null;
  onApply: (nextRobot: RobotDef, newBodyId: string) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
  /** CAD Kernel Phase 5 (Fillet + Chamfer): see CadExtrudeCreator's own
   * doc -- identical lifted-state shape. */
  edgePicks: FilletPickDraft[];
  onEdgePicksChange: (next: FilletPickDraft[]) => void;
  onEdgeOverlayChange: (overlay: CadEdgeOverlay | null) => void;
}

export function CadRevolveCreator({ robot, near, onApply, onCancel, onPreviewChange, edgePicks, onEdgePicksChange, onEdgeOverlayChange }: CadRevolveCreatorProps) {
  const bodyId = useMemo(() => nextBodyId(robot), [robot]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const setProfile = (profile: ProfileDraft) => setDraft((d) => ({ ...d, profile }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    if (edgePicks.length === 0) {
      return { ok: true, call: () => revolve({ profile: parsed.value.profile, offset: parsed.value.offset, angleDeg: parsed.value.angleDeg }) };
    }
    const picks = parseFilletPicks(edgePicks);
    if (!picks.ok) return picks;
    const shape = { operation: "revolve" as const, profile: parsed.value.profile, offset: parsed.value.offset, angleDeg: parsed.value.angleDeg };
    return { ok: true, call: () => fillet(shape, picks.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.offset, draft.angleDeg, edgePicks]);

  useEffect(() => {
    if (status === "ready" && mesh) {
      const body = makeCadBody(bodyId, near, mesh, []);
      onPreviewChange({ mesh, position: body.transform.position });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, bodyId, near, onPreviewChange]);

  const edgesPreview = useCadPreview<ShapeEdgeMesh>(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const shape = { operation: "revolve" as const, profile: parsed.value.profile, offset: parsed.value.offset, angleDeg: parsed.value.angleDeg };
    return { ok: true, call: () => previewEdges(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.offset, draft.angleDeg]);

  useEffect(() => {
    if (edgesPreview.status === "ready" && edgesPreview.mesh) {
      const body = makeCadBody(bodyId, near, { vertices: [], faces: [] }, []);
      onEdgeOverlayChange({ edgeMesh: edgesPreview.mesh, position: body.transform.position, rotation: [0, 0, 0] });
    } else if (edgesPreview.status === "error") {
      onEdgeOverlayChange(null);
    }
  }, [edgesPreview.status, edgesPreview.mesh, bodyId, near, onEdgeOverlayChange]);

  useEffect(() => {
    onEdgePicksChange([]);
    onEdgeOverlayChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.offset, draft.angleDeg]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const parsed = parseDraft(draft);
    if (!parsed.ok) return;
    const rootFeature: Feature = { operation: "revolve", profile: parsed.value.profile, offset: parsed.value.offset, angle_deg: parsed.value.angleDeg };
    const picks = parseFilletPicks(edgePicks);
    const features: Feature[] = picks.ok && picks.value.length > 0 ? [rootFeature, filletChamferFeatureFromPicks(picks.value, 0)] : [rootFeature];
    const body = makeCadBody(bodyId, near, mesh, features);
    onApply({ ...robot, bodies: [...robot.bodies, body] }, body.id);
  };

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>New CAD part (Revolve)</h4>

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

      {edgesPreview.status === "ready" && <FilletEdgeList edgeMesh={edgesPreview.mesh} picks={edgePicks} onChange={onEdgePicksChange} />}

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

import { useEffect, useMemo, useState } from "react";
import type { Body, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { revolve } from "../cad/cadClient";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Revolve panel (Robot Builder CAD Kernel Phase 3) -- a
// profile swept around the world Y axis (a lathe operation: a torus from a
// circle profile, a ring from a rectangle one). Same draft/live-validate/
// Apply idiom as CadExtrudeCreator.tsx, sharing its debounce/status
// lifecycle via useCadPreview. See
// docs/decisions/cad-kernel-revolve-boundary.md for the geometry
// conventions (why the revolve axis's own origin is fixed at world
// [0,0,0], and why offset must be at least the profile's own half-extent).

type Profile = "rectangle" | "circle";

interface Draft {
  profile: Profile;
  width: string;
  height: string;
  radius: string;
  offset: string;
  angleDeg: string;
}

const initialDraft: Draft = { profile: "rectangle", width: "0.02", height: "0.03", radius: "0.02", offset: "0.05", angleDeg: "360" };

interface ParsedRectangle {
  profile: "rectangle";
  width: number;
  height: number;
  offset: number;
  angleDeg: number;
}
interface ParsedCircle {
  profile: "circle";
  radius: number;
  offset: number;
  angleDeg: number;
}
type ParseResult = { ok: true; value: ParsedRectangle | ParsedCircle } | { ok: false; message: string };

function positiveNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: `${label} must be greater than 0` };
  return { ok: true, value };
}

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
  const offset = positiveNumber(draft.offset, "Offset");
  const angle = parseAngle(draft.angleDeg);
  if (draft.profile === "rectangle") {
    const width = positiveNumber(draft.width, "Width");
    if (!width.ok) return width;
    const height = positiveNumber(draft.height, "Height");
    if (!height.ok) return height;
    if (!offset.ok) return offset;
    if (offset.value < width.value / 2) return { ok: false, message: "Offset must be at least half the width" };
    if (!angle.ok) return angle;
    return { ok: true, value: { profile: "rectangle", width: width.value, height: height.value, offset: offset.value, angleDeg: angle.value } };
  }
  const radius = positiveNumber(draft.radius, "Radius");
  if (!radius.ok) return radius;
  if (!offset.ok) return offset;
  if (offset.value < radius.value) return { ok: false, message: "Offset must be at least the radius" };
  if (!angle.ok) return angle;
  return { ok: true, value: { profile: "circle", radius: radius.value, offset: offset.value, angleDeg: angle.value } };
}

export interface CadRevolveCreatorProps {
  robot: RobotDef;
  near: Body | null;
  onApply: (nextRobot: RobotDef, newBodyId: string) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
}

export function CadRevolveCreator({ robot, near, onApply, onCancel, onPreviewChange }: CadRevolveCreatorProps) {
  const bodyId = useMemo(() => nextBodyId(robot), [robot]);
  const [draft, setDraft] = useState<Draft>(initialDraft);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const profile =
      parsed.value.profile === "rectangle"
        ? ({ type: "rectangle", width: parsed.value.width, height: parsed.value.height } as const)
        : ({ type: "circle", radius: parsed.value.radius } as const);
    return { ok: true, call: () => revolve({ profile, offset: parsed.value.offset, angleDeg: parsed.value.angleDeg }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.width, draft.height, draft.radius, draft.offset, draft.angleDeg]);

  useEffect(() => {
    if (status === "ready" && mesh) {
      const body = makeCadBody(bodyId, near, mesh);
      onPreviewChange({ mesh, position: body.transform.position });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, bodyId, near, onPreviewChange]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const body = makeCadBody(bodyId, near, mesh);
    onApply({ ...robot, bodies: [...robot.bodies, body] }, body.id);
  };

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>New CAD part (Revolve)</h4>

      <section className="inspector-section">
        <h5>Profile</h5>
        <label>
          Shape
          <select aria-label="cad profile" value={draft.profile} onChange={(e) => setField("profile", e.target.value as Profile)}>
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
          </select>
        </label>
      </section>

      <section className="inspector-section">
        <h5>Dimensions (m)</h5>
        <div className="inspector-grid">
          {draft.profile === "rectangle" ? (
            <>
              <label>
                Width
                <input aria-label="cad width" type="number" step="0.01" min="0" value={draft.width} onChange={(e) => setField("width", e.target.value)} />
              </label>
              <label>
                Height
                <input aria-label="cad height" type="number" step="0.01" min="0" value={draft.height} onChange={(e) => setField("height", e.target.value)} />
              </label>
            </>
          ) : (
            <label>
              Radius
              <input aria-label="cad radius" type="number" step="0.01" min="0" value={draft.radius} onChange={(e) => setField("radius", e.target.value)} />
            </label>
          )}
        </div>
      </section>

      <section className="inspector-section">
        <h5>Revolve</h5>
        <div className="inspector-grid">
          <label>
            Offset from axis
            <input aria-label="cad offset" type="number" step="0.01" min="0" value={draft.offset} onChange={(e) => setField("offset", e.target.value)} />
          </label>
          <label>
            Angle (°)
            <input aria-label="cad angle" type="number" step="1" min="0" max="360" value={draft.angleDeg} onChange={(e) => setField("angleDeg", e.target.value)} />
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

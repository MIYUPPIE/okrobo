import { useEffect, useMemo, useState } from "react";
import type { Body, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { loft } from "../cad/cadClient";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Boundary panel (Robot Builder CAD Kernel Phase 3) -- a solid
// lofted between a Start and an End profile (e.g. a circle blending into a
// rectangle), separated by Height along Z. Same draft/live-validate/Apply
// idiom as CadExtrudeCreator.tsx/CadRevolveCreator.tsx, sharing their
// debounce/status lifecycle via useCadPreview. Start and End are
// independently Rectangle or Circle -- the kernel cost of a cross-shape
// loft is zero, so there's no reason to restrict it to matching shapes.
// See docs/decisions/cad-kernel-revolve-boundary.md.

type ProfileShape = "rectangle" | "circle";

interface ProfileDraft {
  shape: ProfileShape;
  width: string;
  height: string;
  radius: string;
}

interface Draft {
  start: ProfileDraft;
  end: ProfileDraft;
  loftHeight: string;
}

const initialProfileDraft: ProfileDraft = { shape: "circle", width: "0.05", height: "0.05", radius: "0.03" };
const initialDraft: Draft = { start: initialProfileDraft, end: { ...initialProfileDraft, shape: "rectangle" }, loftHeight: "0.08" };

interface ParsedRectangle {
  type: "rectangle";
  width: number;
  height: number;
}
interface ParsedCircle {
  type: "circle";
  radius: number;
}
type ParsedProfile = ParsedRectangle | ParsedCircle;
type ProfileParseResult = { ok: true; value: ParsedProfile } | { ok: false; message: string };

function positiveNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: `${label} must be greater than 0` };
  return { ok: true, value };
}

function parseProfile(draft: ProfileDraft, side: "Start" | "End"): ProfileParseResult {
  if (draft.shape === "rectangle") {
    const width = positiveNumber(draft.width, `${side} width`);
    if (!width.ok) return width;
    const height = positiveNumber(draft.height, `${side} height`);
    if (!height.ok) return height;
    return { ok: true, value: { type: "rectangle", width: width.value, height: height.value } };
  }
  const radius = positiveNumber(draft.radius, `${side} radius`);
  if (!radius.ok) return radius;
  return { ok: true, value: { type: "circle", radius: radius.value } };
}

type ParseResult = { ok: true; value: { start: ParsedProfile; end: ParsedProfile; loftHeight: number } } | { ok: false; message: string };

/** Validated locally, before ever calling the CAD worker -- same
 * degenerate-input posture as Extrude/Revolve. */
function parseDraft(draft: Draft): ParseResult {
  const start = parseProfile(draft.start, "Start");
  if (!start.ok) return start;
  const end = parseProfile(draft.end, "End");
  if (!end.ok) return end;
  const loftHeight = positiveNumber(draft.loftHeight, "Height");
  if (!loftHeight.ok) return loftHeight;
  return { ok: true, value: { start: start.value, end: end.value, loftHeight: loftHeight.value } };
}

export interface CadBoundaryCreatorProps {
  robot: RobotDef;
  near: Body | null;
  onApply: (nextRobot: RobotDef, newBodyId: string) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
}

function ProfileFields({
  label,
  draft,
  onChange,
}: {
  label: string;
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
}) {
  const setField = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => onChange({ ...draft, [key]: value });
  const prefix = label.toLowerCase();
  return (
    <section className="inspector-section">
      <h5>{label} profile</h5>
      <label>
        Shape
        <select aria-label={`cad ${prefix} shape`} value={draft.shape} onChange={(e) => setField("shape", e.target.value as ProfileShape)}>
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <div className="inspector-grid">
        {draft.shape === "rectangle" ? (
          <>
            <label>
              Width
              <input aria-label={`cad ${prefix} width`} type="number" step="0.01" min="0" value={draft.width} onChange={(e) => setField("width", e.target.value)} />
            </label>
            <label>
              Height
              <input aria-label={`cad ${prefix} height`} type="number" step="0.01" min="0" value={draft.height} onChange={(e) => setField("height", e.target.value)} />
            </label>
          </>
        ) : (
          <label>
            Radius
            <input aria-label={`cad ${prefix} radius`} type="number" step="0.01" min="0" value={draft.radius} onChange={(e) => setField("radius", e.target.value)} />
          </label>
        )}
      </div>
    </section>
  );
}

export function CadBoundaryCreator({ robot, near, onApply, onCancel, onPreviewChange }: CadBoundaryCreatorProps) {
  const bodyId = useMemo(() => nextBodyId(robot), [robot]);
  const [draft, setDraft] = useState<Draft>(initialDraft);

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const { start, end, loftHeight } = parsed.value;
    return { ok: true, call: () => loft({ startProfile: start, endProfile: end, height: loftHeight }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.start, draft.end, draft.loftHeight]);

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
      <h4>New CAD part (Boundary)</h4>

      <ProfileFields label="Start" draft={draft.start} onChange={(start) => setDraft((d) => ({ ...d, start }))} />
      <ProfileFields label="End" draft={draft.end} onChange={(end) => setDraft((d) => ({ ...d, end }))} />

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

import { useEffect, useMemo, useState } from "react";
import type { Body, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { loft } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Boundary panel (Robot Builder CAD Kernel Phase 3) -- a solid
// lofted between a Start and an End profile (e.g. a circle blending into a
// rectangle), separated by Height along Z. Same draft/live-validate/Apply
// idiom as CadExtrudeCreator.tsx/CadRevolveCreator.tsx, sharing their
// debounce/status lifecycle via useCadPreview and their profile-dimension
// fields via ./CadProfileFields.tsx. Start and End are independently
// Rectangle or Circle -- the kernel cost of a cross-shape loft is zero, so
// there's no reason to restrict it to matching shapes.
// See docs/decisions/cad-kernel-revolve-boundary.md.

interface Draft {
  start: ProfileDraft;
  end: ProfileDraft;
  loftHeight: string;
}

const initialProfileDraft: ProfileDraft = { shape: "circle", width: "0.05", height: "0.05", radius: "0.03" };
const initialDraft: Draft = { start: initialProfileDraft, end: { ...initialProfileDraft, shape: "rectangle" }, loftHeight: "0.08" };

type ParsedProfile = { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
type ParseResult = { ok: true; value: { start: ParsedProfile; end: ParsedProfile; loftHeight: number } } | { ok: false; message: string };

/** Validated locally, before ever calling the CAD worker -- same
 * degenerate-input posture as Extrude/Revolve. */
function parseDraft(draft: Draft): ParseResult {
  const start = parseProfileDraft(draft.start, "Start");
  if (!start.ok) return start;
  const end = parseProfileDraft(draft.end, "End");
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

/** Combines the Shape select with CadProfileDimensionFields into one
 * merged section per side -- Boundary's own layout (unlike Extrude/
 * Revolve's separate Profile/Dimensions sections), kept local since it's
 * specific to having two profiles side by side. */
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

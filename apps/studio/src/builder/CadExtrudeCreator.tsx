import { useEffect, useMemo, useState } from "react";
import type { Body, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { extrudeCircle, extrudeRectangle } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's CAD part creation panel (Robot Builder CAD Kernel Phase 2:
// Sketch UI) -- shown in the inspector slot in place of BodyInspector while
// the "Extrude" tool is active (see BuilderPanel.tsx). Same draft/
// live-validate/Apply idiom BodyInspector.tsx/JointCreator.tsx already
// established, except "live-validate" is an async, debounced call into the
// real CAD kernel (through cadClient.ts's Worker) instead of a synchronous
// validateRobotDef diff -- OpenCascade genuinely computes a solid and meshes
// it, it doesn't just check field shapes. Two profiles only (Rectangle,
// Circle), matching exactly what the kernel supports; the user chose this
// parametric-dimensions form over a freeform 2D sketch canvas (no such
// canvas exists anywhere in this codebase). See
// docs/decisions/cad-kernel-sketch-ui.md. Profile fields (shape dropdown +
// width/height-or-radius) share their parse logic and dimension inputs
// with Revolve/Boundary/the Cut creators via ./CadProfileFields.tsx.

interface Draft {
  profile: ProfileDraft;
  depth: string;
}

const initialDraft: Draft = { profile: { shape: "rectangle", width: "0.05", height: "0.05", radius: "0.025" }, depth: "0.02" };

interface ParsedDraft {
  profile: { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
  depth: number;
}
type ParseResult = { ok: true; value: ParsedDraft } | { ok: false; message: string };

/** Validated locally, before ever calling the CAD worker -- OpenCascade
 * throws on degenerate input (e.g. zero width), so this both gives instant
 * feedback and avoids a wasted worker round-trip. */
function parseDraft(draft: Draft): ParseResult {
  const profile = parseProfileDraft(draft.profile);
  if (!profile.ok) return profile;
  const depth = positiveNumber(draft.depth, "Depth");
  if (!depth.ok) return depth;
  return { ok: true, value: { profile: profile.value, depth: depth.value } };
}

export interface CadExtrudeCreatorProps {
  robot: RobotDef;
  /** Positioning anchor -- the same `near` BuilderPanel's own addBody
   * already computes (selectedBody ?? last body ?? null). */
  near: Body | null;
  /** Called only once a real mesh is ready. The new id is exposed
   * explicitly (not left as "last item in bodies") since BuilderPanel
   * needs it to select the new body, mirroring "+ Add body"'s own
   * select-on-create UX. */
  onApply: (nextRobot: RobotDef, newBodyId: string) => void;
  onCancel: () => void;
  /** Fired on every settled debounce tick with the current live preview
   * (or null while invalid/erroring) plus the exact position the body will
   * land at -- BuilderViewport reads this back through BuilderPanel. */
  onPreviewChange: (preview: CadPreview | null) => void;
}

export function CadExtrudeCreator({ robot, near, onApply, onCancel, onPreviewChange }: CadExtrudeCreatorProps) {
  const bodyId = useMemo(() => nextBodyId(robot), [robot]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const setProfile = (profile: ProfileDraft) => setDraft((d) => ({ ...d, profile }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const call = () =>
      parsed.value.profile.type === "rectangle"
        ? extrudeRectangle({ width: parsed.value.profile.width, height: parsed.value.profile.height, depth: parsed.value.depth })
        : extrudeCircle({ radius: parsed.value.profile.radius, depth: parsed.value.depth });
    return { ok: true, call };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.depth]);

  // Only reacts on a real settle (ready/error) -- skips "loading" so the
  // previous preview stays visible during a recompute instead of flickering
  // to nothing on every keystroke.
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
      <h4>New CAD part</h4>

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
          <label>
            Depth
            <input
              aria-label="cad depth"
              type="number"
              step="0.01"
              min="0"
              value={draft.depth}
              onChange={(e) => setDraft((d) => ({ ...d, depth: e.target.value }))}
            />
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

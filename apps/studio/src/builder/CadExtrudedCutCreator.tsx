import { useEffect, useMemo, useState } from "react";
import type { RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { cut } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { geometryToMesh } from "./geometryToMesh";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's Extruded Cut panel (Robot Builder CAD Kernel Phase 4) --
// subtracts an extruded tool profile from an existing, already-picked
// target body (see BuilderPanel.tsx's bodyPick flow). Same draft/live-
// validate/Apply idiom as the Boss creators (CadExtrudeCreator.tsx etc.),
// sharing their debounce/status lifecycle (useCadPreview) and profile
// fields (CadProfileFields.tsx), differing in that Apply replaces the
// target's own geometry in place (robotEdits.ts's replaceBodyGeometry)
// rather than adding a new body, and the tool needs a Position (offset
// from the target's own local origin) instead of a `near`-relative
// placement. See docs/decisions/cad-kernel-cut-operations.md.

interface Draft {
  profile: ProfileDraft;
  depth: string;
  x: string;
  y: string;
  z: string;
}

const initialDraft: Draft = {
  profile: { shape: "circle", width: "0.02", height: "0.02", radius: "0.015" },
  depth: "0.2",
  x: "0",
  y: "0",
  z: "0",
};

function finiteNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return { ok: false, message: `${label} must be a number` };
  return { ok: true, value };
}

interface ParsedDraft {
  profile: { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
  depth: number;
  position: [number, number, number];
}
type ParseResult = { ok: true; value: ParsedDraft } | { ok: false; message: string };

function parseDraft(draft: Draft): ParseResult {
  const profile = parseProfileDraft(draft.profile);
  if (!profile.ok) return profile;
  const depth = positiveNumber(draft.depth, "Depth");
  if (!depth.ok) return depth;
  const x = finiteNumber(draft.x, "Position X");
  if (!x.ok) return x;
  const y = finiteNumber(draft.y, "Position Y");
  if (!y.ok) return y;
  const z = finiteNumber(draft.z, "Position Z");
  if (!z.ok) return z;
  return { ok: true, value: { profile: profile.value, depth: depth.value, position: [x.value, y.value, z.value] } };
}

export interface CadExtrudedCutCreatorProps {
  robot: RobotDef;
  targetBodyId: string;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
}

export function CadExtrudedCutCreator({ robot, targetBodyId, onApply, onCancel, onPreviewChange }: CadExtrudedCutCreatorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const targetMesh = useMemo(() => geometryToMesh(targetBody?.visual ?? targetBody?.collision), [targetBody]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const setProfile = (profile: ProfileDraft) => setDraft((d) => ({ ...d, profile }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const call = () =>
      cut({
        targetMesh,
        tool: { operation: "extrude", profile: parsed.value.profile, depth: parsed.value.depth },
        position: parsed.value.position,
      });
    return { ok: true, call };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.depth, draft.x, draft.y, draft.z, targetMesh]);

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
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh));
  };

  if (!targetBody) return null;

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>New CAD part (Extruded Cut)</h4>
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

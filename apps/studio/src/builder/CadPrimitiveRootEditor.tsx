import { useEffect, useState } from "react";
import type { Feature, RobotDef } from "../contracts/robotDef";
import type { CadPreview } from "../cad/cadClient";
import { replayFeatures } from "../cad/cadClient";
import { positiveNumber } from "./CadProfileFields";
import { useCadPreview } from "./useCadPreview";

// Build mode's editor for a body's own recorded box/cylinder ROOT feature
// (Robot Builder CAD Kernel Phase 7.3, edit-any-step) -- the one Feature
// kind that never had a standalone creator of its own before this phase,
// since a box/cylinder root is only ever synthesized implicitly the first
// time a modifier tool touches a bare primitive body (CAD Kernel Phase
// 7.1's own robotEdits.ts implicitRootFeatures). Editing one here means
// resizing the body's own starting shape while every step recorded after
// it (a fillet/chamfer, shell, draft, or cut) replays unchanged on top of
// the new size -- Apply always goes through the shared recompute path
// (BuilderPanel's own onApply, not makeCadBody/replaceBodyGeometry), since
// this never creates a new body or edits in isolation the way the
// standalone Fillet/Chamfer/Shell/Draft tools do. See
// docs/decisions/cad-kernel-edit-any-step.md.

type PrimitiveFeature = Extract<Feature, { operation: "box" } | { operation: "cylinder" }>;

export interface CadPrimitiveRootEditorProps {
  feature: PrimitiveFeature;
  /** This body's OWN full recorded history -- a box/cylinder root is
   * always index 0 (Phase 7.1's own write path never synthesizes one
   * anywhere else), but the live preview still needs the WHOLE list to
   * replay through the executor: any step recorded after this root (a
   * fillet/chamfer, shell, draft, or cut) still applies on top of the
   * edited size, and previewing just the isolated resized primitive
   * (ignoring those) would be misleading once any exist. */
  allFeatures: Feature[];
  targetBodyId: string;
  robot: RobotDef;
  onApply: (nextFeature: Feature) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
}

interface BoxDraft {
  kind: "box";
  sizeX: string;
  sizeY: string;
  sizeZ: string;
}

interface CylinderDraft {
  kind: "cylinder";
  radius: string;
  length: string;
}

type Draft = BoxDraft | CylinderDraft;

function draftFromFeature(feature: PrimitiveFeature): Draft {
  return feature.operation === "box"
    ? { kind: "box", sizeX: String(feature.size[0]), sizeY: String(feature.size[1]), sizeZ: String(feature.size[2]) }
    : { kind: "cylinder", radius: String(feature.radius), length: String(feature.length) };
}

type ParseResult = { ok: true; value: PrimitiveFeature } | { ok: false; message: string };

function parseDraft(draft: Draft): ParseResult {
  if (draft.kind === "box") {
    const x = positiveNumber(draft.sizeX, "Size X");
    if (!x.ok) return x;
    const y = positiveNumber(draft.sizeY, "Size Y");
    if (!y.ok) return y;
    const z = positiveNumber(draft.sizeZ, "Size Z");
    if (!z.ok) return z;
    return { ok: true, value: { operation: "box", size: [x.value, y.value, z.value] } };
  }
  const radius = positiveNumber(draft.radius, "Radius");
  if (!radius.ok) return radius;
  const length = positiveNumber(draft.length, "Length");
  if (!length.ok) return length;
  return { ok: true, value: { operation: "cylinder", radius: radius.value, length: length.value } };
}

export function CadPrimitiveRootEditor({ feature, allFeatures, targetBodyId, robot, onApply, onCancel, onPreviewChange }: CadPrimitiveRootEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromFeature(feature));
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);

  // Replays the WHOLE chain (this root replaced) through the executor,
  // not just this step in isolation -- any step recorded after it still
  // applies on top, so what's previewed here is what Apply will actually
  // produce. See docs/decisions/cad-kernel-edit-any-step.md.
  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const nextFeatures = allFeatures.map((f, i) => (i === 0 ? parsed.value : f));
    return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, allFeatures]);

  useEffect(() => {
    if (!targetBody) return;
    if (status === "ready" && mesh) {
      onPreviewChange({ mesh, position: targetBody.transform.position, rotation: targetBody.transform.rotation_rpy });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, targetBody, onPreviewChange]);

  const apply = () => {
    if (status !== "ready") return;
    const parsed = parseDraft(draft);
    if (!parsed.ok) return;
    onApply(parsed.value);
  };

  if (!targetBody) return null;

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>Edit {draft.kind === "box" ? "Box" : "Cylinder"}</h4>
      <p className="inspector-note">Editing {targetBody.name}'s own base shape</p>

      <section className="inspector-section">
        <h5>Dimensions (m)</h5>
        <div className="inspector-grid">
          {draft.kind === "box" ? (
            <>
              <label>
                Size X
                <input aria-label="root size x" type="number" step="0.01" min="0" value={draft.sizeX} onChange={(e) => setDraft({ ...draft, sizeX: e.target.value })} />
              </label>
              <label>
                Size Y
                <input aria-label="root size y" type="number" step="0.01" min="0" value={draft.sizeY} onChange={(e) => setDraft({ ...draft, sizeY: e.target.value })} />
              </label>
              <label>
                Size Z
                <input aria-label="root size z" type="number" step="0.01" min="0" value={draft.sizeZ} onChange={(e) => setDraft({ ...draft, sizeZ: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label>
                Radius
                <input aria-label="root radius" type="number" step="0.01" min="0" value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: e.target.value })} />
              </label>
              <label>
                Length
                <input aria-label="root length" type="number" step="0.01" min="0" value={draft.length} onChange={(e) => setDraft({ ...draft, length: e.target.value })} />
              </label>
            </>
          )}
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

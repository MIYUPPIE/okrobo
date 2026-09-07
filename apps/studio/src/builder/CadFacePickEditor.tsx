import { useEffect, useMemo, useState } from "react";
import type { CadPick, Feature, RobotDef } from "../contracts/robotDef";
import type { CadFaceOverlay, CadPreview, FacePick, FacePreview, FilletBaseShape } from "../cad/cadClient";
import { previewFaces, previewFacesAtStep, replayFeatures } from "../cad/cadClient";
import { shapeFromGeometry } from "./cadTargetShape";
import { FacePickList } from "./FacePickList";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

/** Wraps the kernel's own FacePick (a bare point tuple) into this step's
 * own recorded CadPick (CAD Kernel Phase 7.1) -- `sourceStep` is the single
 * step (an existing/synthesized root) this face set was picked from,
 * forward-looking and unused until Phase 7.2, see CadPick's own doc in
 * contracts/robotDef.ts. */
function cadPicksFromFacePicks(facePicks: FacePick[], sourceStep: number): CadPick[] {
  return facePicks.map((point, localIndex) => ({ source_step: sourceStep, local_index: localIndex, point }));
}

// Build mode's standalone Shell and Draft panels (Robot Builder CAD Kernel
// Phase 6) -- both hollow out or taper an already-placed box or cylinder
// body (same bodyPick flow Cut/Fillet-Chamfer already share), and both are
// structurally identical standalone editors: pick some faces, apply one
// shared numeric parameter to the whole pick set (a thickness or an
// angle -- unlike Fillet/Chamfer's own per-edge value). One shared
// component parameterized by which kernel call to make, rather than two
// near-duplicate files, mirrors CadFilletChamferEditor.tsx's own shape
// otherwise. See docs/decisions/cad-kernel-shell-draft.md.

export interface CadFacePickEditorProps {
  title: string;
  valueLabel: string;
  ariaLabel: string;
  defaultValue: string;
  validateValue: (raw: string) => { ok: true; value: number } | { ok: false; message: string };
  computeMesh: (shape: FilletBaseShape, picks: FacePick[], value: number) => Promise<{ vertices: number[]; faces: number[] }>;
  /** CAD Kernel Phase 7.1: builds this step's own Feature entry (a "shell"
   * or "draft" operation) from the picks (already wrapped into CadPick) and
   * the parsed thickness/angle value -- supplied by whichever tool
   * (Shell/Draft) BuilderPanel.tsx has wired this shared editor up for. */
  buildFeature: (picks: CadPick[], value: number) => Feature;
  robot: RobotDef;
  targetBodyId: string;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
  facePicks: FacePick[];
  onFacePicksChange: (next: FacePick[]) => void;
  onFaceOverlayChange: (overlay: CadFaceOverlay | null) => void;
  /** CAD Kernel Phase 7.3 (edit-any-step): when set, this editor is
   * editing an EXISTING recorded shell/draft step at `stepIndex` of
   * `allFeatures` (still on `targetBodyId`'s own body) -- `valueDraft`
   * seeds from `feature`'s own thickness/angle_deg, the faces to pick
   * from are replayed from `allFeatures.slice(0, stepIndex)` (the state
   * right BEFORE this step ran -- the target's own CURRENT geometry is
   * already a baked cad_mesh with no live B-rep left to pick from by the
   * time any fillet_chamfer/shell/draft/cut step exists), the live
   * preview replays the WHOLE chain (this step's own picks/value
   * replaced), and Apply calls `onApply` with the freshly built Feature
   * instead of replaceBodyGeometry. See
   * docs/decisions/cad-kernel-edit-any-step.md. */
  editing?: {
    feature: Extract<Feature, { operation: "shell" } | { operation: "draft" }>;
    stepIndex: number;
    allFeatures: Feature[];
    onApply: (nextFeature: Feature) => void;
  };
  /** CAD Kernel Phase 7.4 (reorder/insert/delete): when set, this editor
   * inserts a BRAND-NEW shell/draft step right after `afterIndex` of
   * `allFeatures`, rather than replacing an existing one -- no `feature`
   * to seed `valueDraft` from (falls back to `defaultValue`, same as
   * fresh create-mode), the faces to pick from are replayed from
   * `allFeatures.slice(0, afterIndex + 1)` (the state right AFTER the
   * insertion point -- what the new step will actually operate on), the
   * live preview replays the WHOLE chain with the new step spliced in,
   * and Apply calls `onApply` with the freshly built Feature. Mutually
   * exclusive with `editing`. See
   * docs/decisions/cad-kernel-reorder-insert-delete.md. */
  inserting?: {
    afterIndex: number;
    allFeatures: Feature[];
    onApply: (newFeature: Feature) => void;
  };
}

function valueOf(feature: Extract<Feature, { operation: "shell" } | { operation: "draft" }>): number {
  return feature.operation === "shell" ? feature.thickness : feature.angle_deg;
}

export function CadFacePickEditor({
  title,
  valueLabel,
  ariaLabel,
  defaultValue,
  validateValue,
  computeMesh,
  buildFeature,
  robot,
  targetBodyId,
  onApply,
  onCancel,
  onPreviewChange,
  facePicks,
  onFacePicksChange,
  onFaceOverlayChange,
  editing,
  inserting,
}: CadFacePickEditorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const shape = useMemo(() => (editing || inserting ? null : shapeFromGeometry(targetBody?.visual ?? targetBody?.collision)), [targetBody, !!editing, !!inserting]);
  const [valueDraft, setValueDraft] = useState(() => (editing ? String(valueOf(editing.feature)) : defaultValue));

  // Depends on editing/inserting's own STABLE inner fields, never the
  // wrapper object itself -- see CadFilletChamferEditor.tsx's own doc on
  // exactly this, a real bug found (and fixed here too) via
  // studio-e2e-check.mjs: BuilderPanel constructs `editing`/`inserting`
  // fresh, inline, on every render, so depending on the wrapper directly
  // re-fires this effect (restarting the debounce) on every parent
  // re-render, including the one this same effect's own onPreviewChange
  // call below triggers -- a self-sustaining loop that only rarely lets
  // status settle on "ready" long enough to observe once a preview takes
  // more than a trivial fraction of a second (insert mode's own
  // multi-step replay, always). See
  // docs/decisions/cad-kernel-reorder-insert-delete.md.
  const { status, error, mesh } = useCadPreview(() => {
    const value = validateValue(valueDraft);
    if (!value.ok) return value;
    if (editing) {
      const nextFeature = buildFeature(cadPicksFromFacePicks(facePicks, editing.feature.picks[0]?.source_step ?? 0), value.value);
      const nextFeatures = editing.allFeatures.map((f, i) => (i === editing.stepIndex ? nextFeature : f));
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    if (inserting) {
      const nextFeature = buildFeature(cadPicksFromFacePicks(facePicks, inserting.afterIndex), value.value);
      const nextFeatures = [...inserting.allFeatures.slice(0, inserting.afterIndex + 1), nextFeature, ...inserting.allFeatures.slice(inserting.afterIndex + 1)];
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => computeMesh(shape, facePicks, value.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, facePicks, valueDraft, editing?.feature, editing?.stepIndex, editing?.allFeatures, inserting?.afterIndex, inserting?.allFeatures]);

  useEffect(() => {
    if (!targetBody) return;
    if (status === "ready" && mesh) {
      onPreviewChange({ mesh, position: targetBody.transform.position, rotation: targetBody.transform.rotation_rpy });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, targetBody, onPreviewChange]);

  // No dims are authored here (the shape comes straight from the target's
  // own existing Geometry), so there's no separate debounced "base shape"
  // preview to fetch faces from either -- previewFaces is called directly
  // off `shape` with no picks involved, and never needs to be cleared.
  const facesPreview = useCadPreview<FacePreview>(() => {
    if (editing) return { ok: true, call: () => previewFacesAtStep(editing.allFeatures, editing.stepIndex) };
    if (inserting) return { ok: true, call: () => previewFacesAtStep(inserting.allFeatures, inserting.afterIndex + 1) };
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => previewFaces(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, editing?.allFeatures, editing?.stepIndex, inserting?.allFeatures, inserting?.afterIndex]);

  useEffect(() => {
    if (!targetBody) return;
    if (facesPreview.status === "ready" && facesPreview.mesh) {
      onFaceOverlayChange({
        faceMesh: facesPreview.mesh.mesh,
        centers: facesPreview.mesh.centers,
        position: targetBody.transform.position,
        rotation: targetBody.transform.rotation_rpy,
      });
    } else if (facesPreview.status === "error") {
      onFaceOverlayChange(null);
    }
  }, [facesPreview.status, facesPreview.mesh, targetBody, onFaceOverlayChange]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const value = validateValue(valueDraft);
    if (!value.ok) return;
    if (editing) {
      editing.onApply(buildFeature(cadPicksFromFacePicks(facePicks, editing.feature.picks[0]?.source_step ?? 0), value.value));
      return;
    }
    if (inserting) {
      inserting.onApply(buildFeature(cadPicksFromFacePicks(facePicks, inserting.afterIndex), value.value));
      return;
    }
    const feature = buildFeature(cadPicksFromFacePicks(facePicks, 0), value.value);
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh, [feature]));
  };

  if (!targetBody) return null;

  if (!editing && !inserting && !shape) {
    return (
      <div className="body-inspector cad-extrude-creator">
        <h4>{title}</h4>
        <p className="inspector-note">
          {title} only supports box and cylinder bodies today -- {targetBody.name} isn't one.
        </p>
        <div className="inspector-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>{title}</h4>
      <p className="inspector-note">Editing {targetBody.name}</p>

      {facesPreview.status === "ready" && (
        <FacePickList facePreview={facesPreview.mesh} picks={facePicks} onChange={onFacePicksChange} />
      )}

      <section className="inspector-section">
        <label>
          {valueLabel}
          <input aria-label={ariaLabel} type="number" step="0.001" min="0" value={valueDraft} onChange={(e) => setValueDraft(e.target.value)} />
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

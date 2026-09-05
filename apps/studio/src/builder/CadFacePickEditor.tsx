import { useEffect, useMemo, useState } from "react";
import type { RobotDef } from "../contracts/robotDef";
import type { CadFaceOverlay, CadPreview, FacePick, FacePreview, FilletBaseShape } from "../cad/cadClient";
import { previewFaces } from "../cad/cadClient";
import { shapeFromGeometry } from "./cadTargetShape";
import { FacePickList } from "./FacePickList";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

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
  robot: RobotDef;
  targetBodyId: string;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
  facePicks: FacePick[];
  onFacePicksChange: (next: FacePick[]) => void;
  onFaceOverlayChange: (overlay: CadFaceOverlay | null) => void;
}

export function CadFacePickEditor({
  title,
  valueLabel,
  ariaLabel,
  defaultValue,
  validateValue,
  computeMesh,
  robot,
  targetBodyId,
  onApply,
  onCancel,
  onPreviewChange,
  facePicks,
  onFacePicksChange,
  onFaceOverlayChange,
}: CadFacePickEditorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const shape = useMemo(() => shapeFromGeometry(targetBody?.visual ?? targetBody?.collision), [targetBody]);
  const [valueDraft, setValueDraft] = useState(defaultValue);

  const { status, error, mesh } = useCadPreview(() => {
    if (!shape) return { ok: false, message: "" };
    const value = validateValue(valueDraft);
    if (!value.ok) return value;
    return { ok: true, call: () => computeMesh(shape, facePicks, value.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, facePicks, valueDraft]);

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
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => previewFaces(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

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
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh));
  };

  if (!targetBody) return null;

  if (!shape) {
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

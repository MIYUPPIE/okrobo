import { useEffect, useMemo } from "react";
import type { RobotDef } from "../contracts/robotDef";
import type { CadEdgeOverlay, CadPreview, ShapeEdgeMesh } from "../cad/cadClient";
import { fillet, previewEdges } from "../cad/cadClient";
import { shapeFromGeometry } from "./cadTargetShape";
import { FilletEdgeList } from "./FilletEdgeList";
import { filletChamferFeatureFromPicks, parseFilletPicks, type FilletPickDraft } from "./filletPicks";
import { replaceBodyGeometry } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's standalone Fillet/Chamfer panel (Robot Builder CAD Kernel
// Phase 5) -- rounds or bevels edges of an already-placed box or cylinder
// body (see BuilderPanel.tsx's bodyPick flow, shared with Cut's own single-
// body pick). Unlike the three Boss creators (which fillet/chamfer their
// own fresh, not-yet-baked shape), this targets an EXISTING body: its own
// current Geometry (box size, or cylinder radius+length) becomes the
// FilletBaseShape directly -- a straight field copy, reconstructing the
// identical solid with zero information loss (verified empirically, see
// docs/decisions/cad-kernel-fillet-chamfer.md). Only box/cylinder bodies
// are supported this phase -- sphere has no edges, cone/capsule would need
// a real profile-revolve reconstruction for one marginal rim edge each, and
// an already-baked cad_mesh body has no live B-rep left to fillet at all.
// Apply replaces the target's own geometry in place (robotEdits.ts's
// replaceBodyGeometry, the same function Cut already uses) rather than
// adding a new body.

export interface CadFilletChamferEditorProps {
  robot: RobotDef;
  targetBodyId: string;
  onApply: (nextRobot: RobotDef) => void;
  onCancel: () => void;
  onPreviewChange: (preview: CadPreview | null) => void;
  edgePicks: FilletPickDraft[];
  onEdgePicksChange: (next: FilletPickDraft[]) => void;
  onEdgeOverlayChange: (overlay: CadEdgeOverlay | null) => void;
}

export function CadFilletChamferEditor({
  robot,
  targetBodyId,
  onApply,
  onCancel,
  onPreviewChange,
  edgePicks,
  onEdgePicksChange,
  onEdgeOverlayChange,
}: CadFilletChamferEditorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const shape = useMemo(() => shapeFromGeometry(targetBody?.visual ?? targetBody?.collision), [targetBody]);

  const { status, error, mesh } = useCadPreview(() => {
    if (!shape) return { ok: false, message: "" };
    const picks = parseFilletPicks(edgePicks);
    if (!picks.ok) return picks;
    return { ok: true, call: () => fillet(shape, picks.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, edgePicks]);

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
  // preview to fetch edges from either -- previewEdges is called directly
  // off `shape` with no picks involved, and never needs to be cleared.
  const edgesPreview = useCadPreview<ShapeEdgeMesh>(() => {
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => previewEdges(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => {
    if (!targetBody) return;
    if (edgesPreview.status === "ready" && edgesPreview.mesh) {
      onEdgeOverlayChange({ edgeMesh: edgesPreview.mesh, position: targetBody.transform.position, rotation: targetBody.transform.rotation_rpy });
    } else if (edgesPreview.status === "error") {
      onEdgeOverlayChange(null);
    }
  }, [edgesPreview.status, edgesPreview.mesh, targetBody, onEdgeOverlayChange]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const picks = parseFilletPicks(edgePicks);
    if (!picks.ok) return;
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh, [filletChamferFeatureFromPicks(picks.value, 0)]));
  };

  if (!targetBody) return null;

  if (!shape) {
    return (
      <div className="body-inspector cad-extrude-creator">
        <h4>Fillet / Chamfer</h4>
        <p className="inspector-note">Fillet/Chamfer only supports box and cylinder bodies today -- {targetBody.name} isn't one.</p>
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
      <h4>Fillet / Chamfer</h4>
      <p className="inspector-note">Editing {targetBody.name}</p>

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

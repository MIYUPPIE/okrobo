import { useEffect, useMemo } from "react";
import type { Feature, RobotDef } from "../contracts/robotDef";
import type { CadEdgeOverlay, CadPreview, ShapeEdgeMesh } from "../cad/cadClient";
import { fillet, previewEdges, previewEdgesAtStep, replayFeatures } from "../cad/cadClient";
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
  /** CAD Kernel Phase 7.3 (edit-any-step): when set, this editor is
   * editing an EXISTING recorded fillet_chamfer step at `stepIndex` of
   * `allFeatures` (still on `targetBodyId`'s own body) -- `edgePicks`
   * itself is still seeded by BuilderPanel (the lifted-state owner) from
   * `feature.picks`, same as create mode; what changes here is the edges
   * to pick from (replayed from `allFeatures.slice(0, stepIndex)` -- the
   * state right BEFORE this step ran, since by the time any
   * fillet_chamfer/shell/draft/cut step exists the target's own CURRENT
   * geometry is already a baked cad_mesh with no live B-rep left to pick
   * from at all) and the live preview (the WHOLE chain replayed, this
   * step's own picks replaced, so any step after it still applies on top)
   * -- and Apply calls `onApply` with the freshly parsed Feature instead
   * of replaceBodyGeometry. See docs/decisions/cad-kernel-edit-any-step.md. */
  editing?: {
    feature: Extract<Feature, { operation: "fillet_chamfer" }>;
    stepIndex: number;
    allFeatures: Feature[];
    onApply: (nextFeature: Feature) => void;
  };
  /** CAD Kernel Phase 7.4 (reorder/insert/delete): when set, this editor
   * inserts a BRAND-NEW fillet_chamfer step right after `afterIndex` of
   * `allFeatures` (still on `targetBodyId`'s own body), rather than
   * replacing an existing one -- there's no `feature` to seed from (edges
   * default to none picked, same as fresh create-mode), the edges to pick
   * from are replayed from `allFeatures.slice(0, afterIndex + 1)` (the
   * state right AFTER the insertion point, i.e. what the new step will
   * actually operate on), the live preview replays the WHOLE chain with
   * the new step spliced in, and Apply calls `onApply` with the freshly
   * built Feature instead of replaceBodyGeometry. Mutually exclusive with
   * `editing`. See docs/decisions/cad-kernel-reorder-insert-delete.md. */
  inserting?: {
    afterIndex: number;
    allFeatures: Feature[];
    onApply: (newFeature: Feature) => void;
  };
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
  editing,
  inserting,
}: CadFilletChamferEditorProps) {
  const targetBody = robot.bodies.find((b) => b.id === targetBodyId);
  const shape = useMemo(() => (editing || inserting ? null : shapeFromGeometry(targetBody?.visual ?? targetBody?.collision)), [targetBody, !!editing, !!inserting]);

  // Depends on editing/inserting's own STABLE inner fields (feature/
  // stepIndex/allFeatures/afterIndex -- all ultimately derived from the
  // stable `robot` prop, so referentially unchanged across an otherwise
  // idle re-render), never the `editing`/`inserting` wrapper OBJECT itself:
  // BuilderPanel constructs that wrapper fresh, inline, on every one of its
  // own renders (an ordinary, harmless-looking prop literal), so depending
  // on it directly would re-fire this effect -- and therefore restart the
  // debounce/recompute -- on every parent render, including the one this
  // same effect's own onPreviewChange call below triggers once it resolves.
  // Verified for real via studio-e2e-check.mjs: that loop never lets
  // status settle on "ready" for more than a rendered instant once a
  // preview takes more than a trivial fraction of a second to compute
  // (exactly insert mode's own multi-step replay) -- Apply would almost
  // never observably enable. See docs/decisions/cad-kernel-reorder-insert-delete.md.
  const { status, error, mesh } = useCadPreview(() => {
    const picks = parseFilletPicks(edgePicks);
    if (!picks.ok) return picks;
    if (editing) {
      const nextFeature = filletChamferFeatureFromPicks(picks.value, editing.feature.picks[0]?.source_step ?? 0);
      const nextFeatures = editing.allFeatures.map((f, i) => (i === editing.stepIndex ? nextFeature : f));
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    if (inserting) {
      const nextFeature = filletChamferFeatureFromPicks(picks.value, inserting.afterIndex);
      const nextFeatures = [...inserting.allFeatures.slice(0, inserting.afterIndex + 1), nextFeature, ...inserting.allFeatures.slice(inserting.afterIndex + 1)];
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => fillet(shape, picks.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, edgePicks, editing?.feature, editing?.stepIndex, editing?.allFeatures, inserting?.afterIndex, inserting?.allFeatures]);

  useEffect(() => {
    if (!targetBody) return;
    if (status === "ready" && mesh) {
      onPreviewChange({ mesh, position: targetBody.transform.position, rotation: targetBody.transform.rotation_rpy });
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, targetBody, onPreviewChange]);

  // No dims are authored here (the shape comes straight from the target's
  // own existing Geometry, or -- editing an existing step -- from replaying
  // the prefix before it), so there's no separate debounced "base shape"
  // preview to fetch edges from either -- it's called directly with no
  // picks involved, and never needs to be cleared.
  const edgesPreview = useCadPreview<ShapeEdgeMesh>(() => {
    if (editing) return { ok: true, call: () => previewEdgesAtStep(editing.allFeatures, editing.stepIndex) };
    if (inserting) return { ok: true, call: () => previewEdgesAtStep(inserting.allFeatures, inserting.afterIndex + 1) };
    if (!shape) return { ok: false, message: "" };
    return { ok: true, call: () => previewEdges(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, editing?.allFeatures, editing?.stepIndex, inserting?.allFeatures, inserting?.afterIndex]);

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
    if (editing) {
      editing.onApply(filletChamferFeatureFromPicks(picks.value, editing.feature.picks[0]?.source_step ?? 0));
      return;
    }
    if (inserting) {
      inserting.onApply(filletChamferFeatureFromPicks(picks.value, inserting.afterIndex));
      return;
    }
    onApply(replaceBodyGeometry(robot, targetBodyId, mesh, [filletChamferFeatureFromPicks(picks.value, 0)]));
  };

  if (!targetBody) return null;

  if (!editing && !inserting && !shape) {
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
      <h4>{inserting ? "Insert Fillet / Chamfer" : "Fillet / Chamfer"}</h4>
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

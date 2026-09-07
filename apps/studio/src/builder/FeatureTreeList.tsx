import { useState } from "react";
import type { Feature, Profile } from "../contracts/robotDef";

// Build mode's feature-tree panel (Robot Builder CAD Kernel Phase 7.1) --
// renders a cad_mesh body's own ordered Feature[] construction history (see
// docs/decisions/cad-kernel-feature-tree-data-model.md), one row per step
// in the order it was applied. Renders nothing for an absent/empty list, so
// a body with no recorded history (every non-CAD body, or a cad_mesh
// predating this phase) looks exactly like it did before this panel
// existed. CAD Kernel Phase 7.3 (edit-any-step): each row is a real button
// when `onSelectStep` is given -- clicking one opens that step's own editor
// pre-filled, recomputing the whole downstream chain on Apply (see
// docs/decisions/cad-kernel-edit-any-step.md). CAD Kernel Phase 7.4
// (reorder/insert/delete): every modifier row (index >= 1 -- the root
// always stays feature 0) can move up/down or be deleted, and every row
// (root included) can have a brand-new step inserted right after it, at
// any position, not just the tail. See
// docs/decisions/cad-kernel-reorder-insert-delete.md.

const round = (n: number) => Math.round(n * 1000) / 1000;

function profileLabel(profile: Profile): string {
  return profile.type === "rectangle" ? `${round(profile.width)}×${round(profile.height)}m rect` : `${round(profile.radius)}m radius circle`;
}

/** One short, human line per Feature kind -- mirrors the exact display
 * names Build mode's own toolbar/creators already use for each operation
 * (e.g. "Boundary" for a `loft`, "Extruded"/"Revolved"/"Boundary" for a
 * cut's own tool kind) so this list reads as a plain history of the same
 * tools the student already clicked, not a second vocabulary. */
function featureLabel(feature: Feature): string {
  switch (feature.operation) {
    case "extrude":
      return `Extrude (${profileLabel(feature.profile)}, depth ${round(feature.depth)}m)`;
    case "revolve":
      return `Revolve (${profileLabel(feature.profile)}, offset ${round(feature.offset)}m, ${round(feature.angle_deg)}°)`;
    case "loft":
      return `Boundary (${profileLabel(feature.start_profile)} → ${profileLabel(feature.end_profile)}, height ${round(feature.height)}m)`;
    case "box":
      return `Box (${feature.size.map(round).join(" × ")} m)`;
    case "cylinder":
      return `Cylinder (radius ${round(feature.radius)}m, length ${round(feature.length)}m)`;
    case "cut": {
      const toolLabel = feature.tool.operation === "extrude" ? "Extruded" : feature.tool.operation === "revolve" ? "Revolved" : "Boundary";
      return `Cut (${toolLabel})`;
    }
    case "fillet_chamfer": {
      const filletCount = feature.picks.filter((p) => p.operation === "fillet").length;
      const chamferCount = feature.picks.filter((p) => p.operation === "chamfer").length;
      const parts = [filletCount > 0 && `${filletCount} fillet${filletCount === 1 ? "" : "s"}`, chamferCount > 0 && `${chamferCount} chamfer${chamferCount === 1 ? "" : "s"}`].filter(
        Boolean,
      );
      return `Fillet/Chamfer (${parts.join(", ")})`;
    }
    case "shell":
      return `Shell (${feature.picks.length} face${feature.picks.length === 1 ? "" : "s"}, thickness ${round(feature.thickness)}m)`;
    case "draft":
      return `Draft (${feature.picks.length} face${feature.picks.length === 1 ? "" : "s"}, angle ${round(feature.angle_deg)}°)`;
  }
}

/** CAD Kernel Phase 7.4: every modifier kind a NEW step can be inserted as
 * -- exactly the six standalone toolbar tools that can target an existing
 * body (Cut's own three tool shapes, Fillet/Chamfer, Shell, Draft), same
 * vocabulary as the toolbar's own button labels below. A root kind
 * (box/cylinder/extrude/revolve/loft) is never insertable -- the root
 * always stays feature 0, already fixed once the body itself exists. */
export type FeatureInsertKind = "fillet_chamfer" | "shell" | "draft" | "cut_extruded" | "cut_revolved" | "cut_boundary";

const INSERT_KIND_LABELS: Record<FeatureInsertKind, string> = {
  fillet_chamfer: "Fillet/Chamfer",
  shell: "Shell",
  draft: "Draft",
  cut_extruded: "Extruded Cut",
  cut_revolved: "Revolved Cut",
  cut_boundary: "Boundary Cut",
};

export interface FeatureTreeListProps {
  features: Feature[] | undefined;
  /** CAD Kernel Phase 7.3: when given, every row becomes clickable, calling
   * this with its own index. Omitted entirely means read-only (no
   * onSelectStep at all -- e.g. a context that can't recompute). */
  onSelectStep?: (index: number) => void;
  /** CAD Kernel Phase 7.4: swap step `index` (>=1) with its neighbor one
   * position `"up"` or `"down"`. Omitted hides every move button. */
  onMoveStep?: (index: number, direction: "up" | "down") => void;
  /** CAD Kernel Phase 7.4: permanently remove step `index` (>=1). Omitted
   * hides every delete button. */
  onDeleteStep?: (index: number) => void;
  /** CAD Kernel Phase 7.4: insert a brand-new `kind` step right after
   * `afterIndex` (any existing index, root included). Omitted hides every
   * "Insert step" affordance. */
  onInsertStep?: (afterIndex: number, kind: FeatureInsertKind) => void;
  /** Disables every move/delete/insert control while a recompute triggered
   * from this list (not from an already-open step editor -- that has its
   * own separate "Recomputing…" panel) is in flight. */
  actionPending?: boolean;
  /** The most recent move/delete's own rebuild-error message, if any --
   * already names which step broke (executor.ts's own withStepContext), so
   * shown verbatim rather than re-derived. */
  actionError?: string | null;
}

export function FeatureTreeList({ features, onSelectStep, onMoveStep, onDeleteStep, onInsertStep, actionPending, actionError }: FeatureTreeListProps) {
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState<number | null>(null);
  const [insertMenuAfterIndex, setInsertMenuAfterIndex] = useState<number | null>(null);

  if (!features || features.length === 0) return null;

  const requestDelete = (index: number) => {
    if (confirmingDeleteIndex !== index) {
      setConfirmingDeleteIndex(index);
      return;
    }
    setConfirmingDeleteIndex(null);
    onDeleteStep?.(index);
  };

  const chooseInsert = (afterIndex: number, kind: FeatureInsertKind) => {
    setInsertMenuAfterIndex(null);
    onInsertStep?.(afterIndex, kind);
  };

  return (
    <section className="inspector-section feature-tree-list">
      <h5>Construction history</h5>
      {actionError && <p className="cad-status error">{actionError}</p>}
      <ol>
        {features.map((feature, index) => (
          <li key={index}>
            <div className="feature-tree-row">
              {onSelectStep ? (
                <button type="button" className="feature-tree-step" onClick={() => onSelectStep(index)} disabled={actionPending}>
                  {featureLabel(feature)}
                </button>
              ) : (
                <span className="feature-tree-step-label">{featureLabel(feature)}</span>
              )}
              {index > 0 && onMoveStep && (
                <>
                  <button
                    type="button"
                    className="feature-tree-move"
                    aria-label={`move step ${index} up`}
                    disabled={actionPending || index <= 1}
                    onClick={() => onMoveStep(index, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="feature-tree-move"
                    aria-label={`move step ${index} down`}
                    disabled={actionPending || index >= features.length - 1}
                    onClick={() => onMoveStep(index, "down")}
                  >
                    ↓
                  </button>
                </>
              )}
              {index > 0 && onDeleteStep && (
                <button
                  type="button"
                  className={confirmingDeleteIndex === index ? "feature-tree-delete confirm" : "feature-tree-delete"}
                  aria-label={`delete step ${index}`}
                  disabled={actionPending}
                  onClick={() => requestDelete(index)}
                >
                  {confirmingDeleteIndex === index ? "delete?" : "Delete"}
                </button>
              )}
            </div>
            {onInsertStep &&
              (insertMenuAfterIndex === index ? (
                <div className="feature-tree-insert-menu">
                  {(Object.keys(INSERT_KIND_LABELS) as FeatureInsertKind[]).map((kind) => (
                    <button key={kind} type="button" onClick={() => chooseInsert(index, kind)}>
                      {INSERT_KIND_LABELS[kind]}
                    </button>
                  ))}
                  <button type="button" onClick={() => setInsertMenuAfterIndex(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="feature-tree-insert-toggle" disabled={actionPending} onClick={() => setInsertMenuAfterIndex(index)}>
                  + Insert step
                </button>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

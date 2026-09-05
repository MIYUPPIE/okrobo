import type { FacePick, FacePreview } from "../cad/cadClient";

// CAD Kernel Phase 6 (Shell + Draft): the actual face-picking UI, and the
// canonical, E2E-testable input path -- structurally parallel to
// FilletEdgeList.tsx's own role for edges, but simpler: Shell/Draft each
// apply one shared parameter (thickness, angle) to the whole pick set,
// not a per-element value like Fillet/Chamfer's own radius, so a row is
// just a toggle -- no per-row Operation/Value fields. The 3D viewport's
// own face overlay (BuilderViewport.tsx) stays a visual-only aid with no
// raycasting of its own, same posture as the edge overlay. See
// docs/decisions/cad-kernel-shell-draft.md.

const EPSILON = 1e-9;

function samePoint(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON && Math.abs(a[2] - b[2]) < EPSILON;
}

export interface FacePickListProps {
  facePreview: FacePreview | null;
  picks: FacePick[];
  onChange: (next: FacePick[]) => void;
}

export function FacePickList({ facePreview, picks, onChange }: FacePickListProps) {
  if (!facePreview) return null;

  const toggle = (center: FacePick, isPicked: boolean) => {
    if (isPicked) onChange(picks.filter((p) => !samePoint(p, center)));
    else onChange([...picks, center]);
  };

  return (
    <section className="inspector-section face-pick-list">
      <h5>Faces</h5>
      {facePreview.centers.length === 0 && <p className="cad-status">No faces to pick.</p>}
      <ul className="face-pick-rows">
        {facePreview.centers.map((center, index) => {
          const isPicked = picks.some((p) => samePoint(p, center));
          return (
            <li key={index} className="face-pick-row">
              <span className="face-pick-label">Face {index + 1}</span>
              <button type="button" onClick={() => toggle(center, isPicked)}>
                {isPicked ? "Deselect" : "Select"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

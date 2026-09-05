import type { ShapeEdgeMesh } from "../cad/cadClient";
import { DEFAULT_FILLET_VALUE, edgeGroupDescriptor, type FilletOperation, type FilletPickDraft } from "./filletPicks";

// CAD Kernel Phase 5 (Fillet + Chamfer): the actual edge-picking UI, and
// the canonical, E2E-testable input path -- mirroring HierarchyList's role
// for Add Joint/Cut's own body picks. There's no per-edge DOM element
// precedent to reuse (unlike per-body .hierarchy-rows), so this is a new
// one: one row per edge, an "Add" button records that edge's own
// descriptor point; the 3D viewport's own edge overlay (BuilderViewport.tsx)
// is a visual-only aid with no raycasting of its own -- see
// docs/decisions/cad-kernel-fillet-chamfer.md. Built shared from the start
// (four known call sites: the three Boss creators plus
// CadFilletChamferEditor), not organically extracted after a third inline
// copy this time.

const EPSILON = 1e-9;

function samePoint(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON && Math.abs(a[2] - b[2]) < EPSILON;
}

export interface FilletEdgeListProps {
  edgeMesh: ShapeEdgeMesh | null;
  picks: FilletPickDraft[];
  onChange: (next: FilletPickDraft[]) => void;
}

export function FilletEdgeList({ edgeMesh, picks, onChange }: FilletEdgeListProps) {
  if (!edgeMesh) return null;

  const addPick = (point: [number, number, number]) => onChange([...picks, { point, operation: "fillet", value: DEFAULT_FILLET_VALUE }]);
  const removePick = (index: number) => onChange(picks.filter((_, i) => i !== index));
  const setOperation = (index: number, operation: FilletOperation) => onChange(picks.map((p, i) => (i === index ? { ...p, operation } : p)));
  const setValue = (index: number, value: string) => onChange(picks.map((p, i) => (i === index ? { ...p, value } : p)));

  return (
    <section className="inspector-section fillet-edge-list">
      <h5>Edges</h5>
      {edgeMesh.edgeGroups.length === 0 && <p className="cad-status">No edges to pick.</p>}
      <ul className="fillet-edge-rows">
        {edgeMesh.edgeGroups.map((_, groupIndex) => {
          const descriptor = edgeGroupDescriptor(edgeMesh, groupIndex);
          const pickIndex = picks.findIndex((p) => samePoint(p.point, descriptor));
          const pick = pickIndex >= 0 ? picks[pickIndex] : null;
          return (
            <li key={groupIndex} className="fillet-edge-row">
              <span className="fillet-edge-label">Edge {groupIndex + 1}</span>
              {pick ? (
                <>
                  <select
                    aria-label={`edge ${groupIndex + 1} operation`}
                    value={pick.operation}
                    onChange={(e) => setOperation(pickIndex, e.target.value as FilletOperation)}
                  >
                    <option value="fillet">Fillet</option>
                    <option value="chamfer">Chamfer</option>
                  </select>
                  <input
                    aria-label={`edge ${groupIndex + 1} value`}
                    type="number"
                    step="0.001"
                    min="0"
                    value={pick.value}
                    onChange={(e) => setValue(pickIndex, e.target.value)}
                  />
                  <button type="button" onClick={() => removePick(pickIndex)}>
                    Remove
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => addPick(descriptor)}>
                  Add
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

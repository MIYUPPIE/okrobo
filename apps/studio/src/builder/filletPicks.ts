import type { FilletPick, ShapeEdgeMesh } from "../cad/cadClient";
import type { Feature } from "../contracts/robotDef";
import { positiveNumber } from "./CadProfileFields";

// CAD Kernel Phase 5 (Fillet + Chamfer): shared by every creator that lets
// a student pick edges to round or bevel -- the three Boss creators
// (Extrude/Revolve/Boundary, applied to their own fresh shape before it's
// baked) and the standalone CadFilletChamferEditor (an existing box/
// cylinder body). See docs/decisions/cad-kernel-fillet-chamfer.md for why
// a pick is identified by a geometric descriptor point rather than the
// edge object itself or its hashCode (not stable across independent
// solid rebuilds).

export type FilletOperation = "fillet" | "chamfer";

/** Draft (string `value`) counterpart to kernel.ts's own FilletPick --
 * mirrors CadProfileFields.tsx's ProfileDraft/Profile split, so a value
 * field can be freely typed/cleared without an instant parse error. */
export interface FilletPickDraft {
  point: [number, number, number];
  operation: FilletOperation;
  value: string;
}

export const DEFAULT_FILLET_VALUE = "0.005";

/** A 2-point group (a straight edge) has no interior point among its own
 * vertices -- both are shared with adjacent edges, ambiguous for
 * near()-based re-identification (verified empirically: a corner point
 * matched 2-3 edges at once). Its true midpoint (the average of the two)
 * is the reliable, always-interior descriptor. A many-point group (a
 * curved edge) already has real interior polyline samples -- its own
 * middle point works directly. */
export function edgeGroupDescriptor(edgeMesh: ShapeEdgeMesh, groupIndex: number): [number, number, number] {
  const group = edgeMesh.edgeGroups[groupIndex];
  if (group.count === 2) {
    const a = group.start * 3;
    const b = (group.start + 1) * 3;
    return [
      (edgeMesh.lines[a] + edgeMesh.lines[b]) / 2,
      (edgeMesh.lines[a + 1] + edgeMesh.lines[b + 1]) / 2,
      (edgeMesh.lines[a + 2] + edgeMesh.lines[b + 2]) / 2,
    ];
  }
  const mid = (group.start + Math.floor(group.count / 2)) * 3;
  return [edgeMesh.lines[mid], edgeMesh.lines[mid + 1], edgeMesh.lines[mid + 2]];
}

export type FilletPicksParseResult = { ok: true; value: FilletPick[] } | { ok: false; message: string };

/** Validated locally before ever calling the CAD worker, same posture as
 * parseProfileDraft -- an invalid value surfaces instantly with no wasted
 * round trip. Labels picks by their 1-based position ("Edge 2 value...")
 * since that's what FilletEdgeList's own rows show the student. */
export function parseFilletPicks(drafts: FilletPickDraft[]): FilletPicksParseResult {
  const picks: FilletPick[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const value = positiveNumber(draft.value, `Edge ${i + 1} value`);
    if (!value.ok) return value;
    picks.push({ point: draft.point, operation: draft.operation, value: value.value });
  }
  return { ok: true, value: picks };
}

/** Builds this fillet/chamfer step's own Feature entry (CAD Kernel Phase
 * 7.1) from the kernel's own FilletPick[] -- every caller of
 * parseFilletPicks that goes on to apply the result also needs this, so
 * it's kept alongside rather than duplicated per creator. `sourceStep` is
 * the same value for every pick here: whichever single step (the fresh
 * Boss shape, or an existing/synthesized root) this fillet/chamfer set was
 * picked from -- forward-looking and unused until CAD Kernel Phase 7.2, see
 * CadPick's own doc in contracts/robotDef.ts. */
export function filletChamferFeatureFromPicks(picks: FilletPick[], sourceStep: number): Feature {
  return {
    operation: "fillet_chamfer",
    picks: picks.map((pick, localIndex) => ({
      source_step: sourceStep,
      local_index: localIndex,
      point: pick.point,
      operation: pick.operation,
      value: pick.value,
    })),
  };
}

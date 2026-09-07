import { replayFeatures } from "../cad/cadClient";
import type { Feature, Geometry, RobotDef } from "../contracts/robotDef";

// CAD Kernel Phase 7.3 (edit-any-step) + Phase 7.4 (reorder/insert/delete):
// every mutation a body's own recorded `features` history (Phase 7.1) can
// go through -- replace a step in place (recomputeFeatureStep), delete one
// (deleteFeatureStep), swap two adjacent ones (moveFeatureStep), or splice a
// brand-new one in at any position (insertFeatureStep) -- funnels through
// the same shared core (recomputeFeatures): build the CANDIDATE features
// array, replay the WHOLE thing through executor.ts's replayFeatures
// (through the real CAD worker, off the main thread -- see cadClient.ts),
// and on success replace the body's own visual/collision/features with the
// freshly recomputed result. On failure (a downstream pick's own edge/face
// genuinely no longer resolves, or any other OpenCascade rebuild error),
// every one of these returns a real, readable message instead of throwing
// or silently committing a broken candidate -- CAD Kernel Phase 7.2's own
// executor.ts already attributes the failure to its own step index and
// operation kind (see withStepContext there), so the message says WHICH
// step broke, not just that something did. See
// docs/decisions/cad-kernel-edit-any-step.md and
// docs/decisions/cad-kernel-reorder-insert-delete.md.

export type RecomputeResult = { ok: true; robot: RobotDef } | { ok: false; message: string };

async function recomputeFeatures(robot: RobotDef, bodyId: string, nextFeatures: Feature[]): Promise<RecomputeResult> {
  let mesh: { vertices: number[]; faces: number[] };
  try {
    const result = await replayFeatures(nextFeatures);
    mesh = result.mesh;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const geometry: Geometry = { type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces };
  return {
    ok: true,
    robot: {
      ...robot,
      bodies: robot.bodies.map((b) => (b.id === bodyId ? { ...b, visual: geometry, collision: geometry, features: nextFeatures } : b)),
    },
  };
}

export async function recomputeFeatureStep(robot: RobotDef, bodyId: string, stepIndex: number, nextFeature: Feature): Promise<RecomputeResult> {
  const body = robot.bodies.find((b) => b.id === bodyId);
  if (!body || !body.features || stepIndex < 0 || stepIndex >= body.features.length) {
    return { ok: false, message: `Could not find step ${stepIndex} on body '${bodyId}' to recompute.` };
  }
  const nextFeatures = body.features.map((f, i) => (i === stepIndex ? nextFeature : f));
  return recomputeFeatures(robot, bodyId, nextFeatures);
}

/** CAD Kernel Phase 7.4: removes step `stepIndex` entirely and replays what
 * remains. The root (index 0) can never be deleted here -- there'd be
 * nothing left to replay from -- removing an entire CAD history is already
 * the Body Inspector's own "change to box" escape hatch's job, a distinct,
 * pre-existing affordance this doesn't touch. */
export async function deleteFeatureStep(robot: RobotDef, bodyId: string, stepIndex: number): Promise<RecomputeResult> {
  const body = robot.bodies.find((b) => b.id === bodyId);
  if (!body || !body.features || stepIndex <= 0 || stepIndex >= body.features.length) {
    return { ok: false, message: `Could not find a deletable step ${stepIndex} on body '${bodyId}'.` };
  }
  const nextFeatures = body.features.filter((_, i) => i !== stepIndex);
  return recomputeFeatures(robot, bodyId, nextFeatures);
}

/** CAD Kernel Phase 7.4: swaps step `index` with its immediate neighbor in
 * `direction`. Neither `index` nor the neighbor it swaps with may be the
 * root (0) -- the root always stays feature 0, so a step at index 1 has no
 * "up" and the last step has no "down". */
export async function moveFeatureStep(robot: RobotDef, bodyId: string, index: number, direction: "up" | "down"): Promise<RecomputeResult> {
  const body = robot.bodies.find((b) => b.id === bodyId);
  if (!body || !body.features) return { ok: false, message: `Could not find body '${bodyId}' to reorder.` };
  const target = direction === "up" ? index - 1 : index + 1;
  if (index <= 0 || target <= 0 || target >= body.features.length) {
    return { ok: false, message: `Step ${index} can't move ${direction} on body '${bodyId}'.` };
  }
  const nextFeatures = [...body.features];
  [nextFeatures[index], nextFeatures[target]] = [nextFeatures[target], nextFeatures[index]];
  return recomputeFeatures(robot, bodyId, nextFeatures);
}

/** CAD Kernel Phase 7.4: splices a brand-new step in right after
 * `afterIndex` (0 means "right after the root", `features.length - 1`
 * means "append at the tail") and replays the whole thing. Every existing
 * step keeps its own recorded params; only the ones after `afterIndex` may
 * end up rebuilt on top of the newly-inserted step. */
export async function insertFeatureStep(robot: RobotDef, bodyId: string, afterIndex: number, newFeature: Feature): Promise<RecomputeResult> {
  const body = robot.bodies.find((b) => b.id === bodyId);
  if (!body || !body.features || afterIndex < 0 || afterIndex >= body.features.length) {
    return { ok: false, message: `Could not find an insertion point after step ${afterIndex} on body '${bodyId}'.` };
  }
  const nextFeatures = [...body.features.slice(0, afterIndex + 1), newFeature, ...body.features.slice(afterIndex + 1)];
  return recomputeFeatures(robot, bodyId, nextFeatures);
}

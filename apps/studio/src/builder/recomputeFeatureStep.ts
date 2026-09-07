import { replayFeatures } from "../cad/cadClient";
import type { Feature, Geometry, RobotDef } from "../contracts/robotDef";

// CAD Kernel Phase 7.3 (edit-any-step + live recompute): the one function
// every per-kind editor's own edit-mode Apply calls through. Given a body
// that already has a recorded `features` history (CAD Kernel Phase 7.1)
// and one step index to replace, rebuilds the ENTIRE chain via
// executor.ts's replayFeatures (through the real CAD worker, off the main
// thread -- see cadClient.ts) and, on success, replaces the body's own
// visual/collision/features with the freshly recomputed result. On
// failure (a downstream pick's own edge/face genuinely no longer resolves,
// or any other OpenCascade rebuild error), returns a real, readable
// message instead of throwing -- CAD Kernel Phase 7.2's own executor.ts
// already attributes the failure to its own step index and operation kind
// (see withStepContext there), so the message says WHICH step broke, not
// just that something did. See docs/decisions/cad-kernel-edit-any-step.md.

export type RecomputeResult = { ok: true; robot: RobotDef } | { ok: false; message: string };

export async function recomputeFeatureStep(robot: RobotDef, bodyId: string, stepIndex: number, nextFeature: Feature): Promise<RecomputeResult> {
  const body = robot.bodies.find((b) => b.id === bodyId);
  if (!body || !body.features || stepIndex < 0 || stepIndex >= body.features.length) {
    return { ok: false, message: `Could not find step ${stepIndex} on body '${bodyId}' to recompute.` };
  }
  const nextFeatures = body.features.map((f, i) => (i === stepIndex ? nextFeature : f));

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

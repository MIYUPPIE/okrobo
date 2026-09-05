// CAD Kernel Phase 1: the public, typed extrude API -- the shape the plan
// promises (`extrudeRectangle({width, height, depth})`), used by
// scripts/generate-cad-examples.mjs and its own test. Calls straight into
// ./kernel.ts rather than routing through a real browser Worker: nothing
// in this app calls this from a running tab yet (no sketch UI exists this
// phase, see docs/decisions/cad-kernel-foundation.md), so off-main-thread
// isolation has no user-facing benefit to buy here, and a direct call is
// what makes this module runnable under plain Node (the offline script)
// and testable under vitest's node test environment -- neither of which
// has a browser Worker global. Once Phase 2 adds a live sketch UI that
// would otherwise jank the main thread, route these functions through
// ./worker.ts's comlink-wrapped client instead.

import {
  extrudeCircle as extrudeCircleDirect,
  extrudeRectangle as extrudeRectangleDirect,
  loft as loftDirect,
  revolve as revolveDirect,
} from "./kernel.ts";
import type { CadMesh, Profile } from "./kernel.ts";

export type { CadMesh, Profile };

export function extrudeRectangle(options: { width: number; height: number; depth: number }): Promise<CadMesh> {
  return extrudeRectangleDirect(options.width, options.height, options.depth);
}

export function extrudeCircle(options: { radius: number; depth: number }): Promise<CadMesh> {
  return extrudeCircleDirect(options.radius, options.depth);
}

// CAD Kernel Phase 3 (Revolve + Boundary): see kernel.ts's revolveMesh/
// loftMesh for the geometry conventions.
export function revolve(options: { profile: Profile; offset: number; angleDeg: number }): Promise<CadMesh> {
  return revolveDirect(options.profile, options.offset, options.angleDeg);
}

export function loft(options: { startProfile: Profile; endProfile: Profile; height: number }): Promise<CadMesh> {
  return loftDirect(options.startProfile, options.endProfile, options.height);
}

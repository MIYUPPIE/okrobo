// CAD Kernel Phase 2: the comlink client a live Build-mode tab actually
// calls -- routes through the real browser Worker (./worker.ts) rather than
// ./kernel.ts/./extrude.ts's direct main-thread call (Phase 1's choice,
// kept for the offline authoring script and this module's own Node-side
// tests). A live tab would jank the UI thread on the ~23MB WASM load and
// OpenCascade compute; a Worker keeps that off it entirely. See
// docs/decisions/cad-kernel-sketch-ui.md.

import { wrap, type Remote } from "comlink";
import type { CadMesh, Profile } from "./kernel.ts";
import type { CadWorkerApi } from "./worker.ts";

export type { CadMesh, Profile };

export interface CadPreview {
  mesh: CadMesh;
  position: [number, number, number];
}

let apiPromise: Promise<Remote<CadWorkerApi>> | null = null;

/** Constructs the Worker (and therefore triggers the WASM fetch) strictly
 * on first use, memoized for the rest of the session -- a student who
 * never opens the Extrude tool never pays this cost, and one who does
 * only pays it once. */
function getApi(): Promise<Remote<CadWorkerApi>> {
  if (!apiPromise) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    apiPromise = Promise.resolve(wrap<CadWorkerApi>(worker));
  }
  return apiPromise;
}

export async function extrudeRectangle(options: { width: number; height: number; depth: number }): Promise<CadMesh> {
  const api = await getApi();
  return api.extrudeRectangle(options.width, options.height, options.depth);
}

export async function extrudeCircle(options: { radius: number; depth: number }): Promise<CadMesh> {
  const api = await getApi();
  return api.extrudeCircle(options.radius, options.depth);
}

// CAD Kernel Phase 3 (Revolve + Boundary).
export async function revolve(options: { profile: Profile; offset: number; angleDeg: number }): Promise<CadMesh> {
  const api = await getApi();
  return api.revolve(options.profile, options.offset, options.angleDeg);
}

export async function loft(options: { startProfile: Profile; endProfile: Profile; height: number }): Promise<CadMesh> {
  const api = await getApi();
  return api.loft(options.startProfile, options.endProfile, options.height);
}

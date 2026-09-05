// CAD Kernel Phase 2: the comlink client a live Build-mode tab actually
// calls -- routes through the real browser Worker (./worker.ts) rather than
// ./kernel.ts/./extrude.ts's direct main-thread call (Phase 1's choice,
// kept for the offline authoring script and this module's own Node-side
// tests). A live tab would jank the UI thread on the ~23MB WASM load and
// OpenCascade compute; a Worker keeps that off it entirely. See
// docs/decisions/cad-kernel-sketch-ui.md.

import { wrap, type Remote } from "comlink";
import type { CadMesh, CutTool, FilletBaseShape, FilletPick, Profile, ShapeEdgeMesh } from "./kernel.ts";
import type { CadWorkerApi } from "./worker.ts";

export type { CadMesh, CutTool, FilletBaseShape, FilletPick, Profile, ShapeEdgeMesh };

export interface CadPreview {
  mesh: CadMesh;
  position: [number, number, number];
  /** CAD Kernel Phase 5: the target body's own current rotation, so an
   * in-place edit (Cut, Fillet/Chamfer) of an already-rotated body renders
   * its ghost preview aligned with where the real (suppressed) body
   * actually sits. Omitted by the three Boss creators (Extrude/Revolve/
   * Boundary) -- a brand-new body is always created at identity rotation,
   * so there's nothing to pass. */
  rotation?: [number, number, number];
}

/** CAD Kernel Phase 5 (Fillet + Chamfer): the pickable-edges overlay a
 * fillet/chamfer-capable creator reports to BuilderPanel, the same way it
 * already reports `CadPreview` -- a visual-only aid in BuilderViewport
 * (no raycasting of its own; the real pick path is FilletEdgeList's own
 * DOM rows). `position`/`rotation` place it exactly where the creator's
 * own `cadPreview` ghost renders, so the two stay visually aligned. */
export interface CadEdgeOverlay {
  edgeMesh: ShapeEdgeMesh;
  position: [number, number, number];
  rotation: [number, number, number];
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

// CAD Kernel Phase 4 (Cut).
export async function cut(options: { targetMesh: CadMesh; tool: CutTool; position: readonly [number, number, number] }): Promise<CadMesh> {
  const api = await getApi();
  return api.cut(options.targetMesh, options.tool, options.position);
}

// CAD Kernel Phase 5 (Fillet + Chamfer).
export async function previewEdges(shape: FilletBaseShape): Promise<ShapeEdgeMesh> {
  const api = await getApi();
  return api.previewEdges(shape);
}

export async function fillet(shape: FilletBaseShape, picks: FilletPick[]): Promise<CadMesh> {
  const api = await getApi();
  return api.fillet(shape, picks);
}

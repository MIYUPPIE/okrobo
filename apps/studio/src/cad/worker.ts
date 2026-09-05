// CAD Kernel Phase 1: the browser Worker entry point for ./kernel.ts, ready
// for a future Build-mode UI (Phase 2+, see docs/decisions/cad-kernel-foundation.md)
// to construct off the main thread:
//
//   const api = wrap<CadWorkerApi>(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
//
// Nothing in this app does that yet (no sketch UI exists this phase), so
// this file is never bundled: Vite only emits a worker chunk for a file a
// running import graph actually reaches. Kept as a real, ready module (not
// a stub) precisely so Phase 2 has nothing left to design here -- only a
// sketch UI to build.
//
// Unlike ./kernel.ts's own loadOC() (which resolves its .wasm fine under
// plain Node with no options), a Vite-bundled browser Worker needs the
// .wasm as an explicit asset import so it gets copied into the build
// output with a real, fetchable URL -- the exact pattern the replicad
// reference app itself uses.

import { expose } from "comlink";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import {
  cutMesh,
  extrudeCircleMesh,
  extrudeRectangleMesh,
  filletMesh,
  loftMesh,
  loadManifold,
  loadOC,
  previewEdgesMesh,
  revolveMesh,
  type CadMesh,
  type CutTool,
  type FilletBaseShape,
  type FilletPick,
  type Profile,
} from "./kernel.ts";

const api = {
  async extrudeRectangle(width: number, height: number, depth: number) {
    await loadOC({ locateFile: () => wasmUrl });
    return extrudeRectangleMesh(width, height, depth);
  },
  async extrudeCircle(radius: number, depth: number) {
    await loadOC({ locateFile: () => wasmUrl });
    return extrudeCircleMesh(radius, depth);
  },
  // CAD Kernel Phase 3 (Revolve + Boundary).
  async revolve(profile: Profile, offset: number, angleDeg: number) {
    await loadOC({ locateFile: () => wasmUrl });
    return revolveMesh(profile, offset, angleDeg);
  },
  async loft(startProfile: Profile, endProfile: Profile, height: number) {
    await loadOC({ locateFile: () => wasmUrl });
    return loftMesh(startProfile, endProfile, height);
  },
  // CAD Kernel Phase 4 (Cut): needs both OpenCascade (to build the tool
  // solid) and Manifold (for the real mesh boolean).
  async cut(targetMesh: CadMesh, tool: CutTool, position: readonly [number, number, number]) {
    await Promise.all([loadOC({ locateFile: () => wasmUrl }), loadManifold({ locateFile: () => manifoldWasmUrl })]);
    return cutMesh(targetMesh, tool, position);
  },
  // CAD Kernel Phase 5 (Fillet + Chamfer): OpenCascade only, no Manifold --
  // fillet/chamfer are live-B-rep operations, not mesh booleans.
  async previewEdges(shape: FilletBaseShape) {
    await loadOC({ locateFile: () => wasmUrl });
    return previewEdgesMesh(shape);
  },
  async fillet(shape: FilletBaseShape, picks: FilletPick[]) {
    await loadOC({ locateFile: () => wasmUrl });
    return filletMesh(shape, picks);
  },
};

export type CadWorkerApi = typeof api;

expose(api);

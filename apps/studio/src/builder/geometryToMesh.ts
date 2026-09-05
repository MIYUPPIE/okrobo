import type { Geometry } from "../contracts/robotDef";
import { geometryFor } from "./robotThree";

// Robot Builder CAD Kernel Phase 4 (Cut): the bridge that lets a Cut tool
// target ANY existing body -- box, sphere, cylinder, capsule, cone, plane,
// or an existing cad_mesh part -- not just already-`cad_mesh` bodies.
// geometryFor (robotThree.ts) already builds a real THREE.BufferGeometry
// for every primitive type, purely for rendering; this just reads its
// position/index buffers back out into the same flat {vertices, faces}
// shape the CAD kernel already works with (cad/kernel.ts's own CadMesh).
// No CAD kernel involved here at all -- this is plain geometry data, the
// same cost as reading a mesh already built for the 3D viewport.

export interface FlatMesh {
  vertices: number[];
  faces: number[];
}

export function geometryToMesh(geometry: Geometry | undefined): FlatMesh {
  const bufferGeometry = geometryFor(geometry);
  const position = bufferGeometry.getAttribute("position");
  const vertices = Array.from(position.array as ArrayLike<number>);
  const index = bufferGeometry.getIndex();
  // Every primitive geometryFor builds (BoxGeometry, SphereGeometry, etc.)
  // is indexed in three.js's own implementation -- this fallback exists
  // only for a hypothetical non-indexed BufferGeometry, treating the
  // position array itself as an implicit triangle list.
  const faces = index ? Array.from(index.array as ArrayLike<number>) : Array.from({ length: position.count }, (_, i) => i);
  return { vertices, faces };
}

// CAD Kernel Phase 1: authors the shipped cad_mesh example bodies under
// contracts/robot-def/v1/examples/ by running the real replicad/OpenCascade
// pipeline offline (see apps/studio/src/cad/extrude.ts) -- no sketch UI
// exists yet (that's Phase 2), so this script is how a cad_mesh body gets
// authored this phase. Run: node scripts/generate-cad-examples.mjs
//
// Imports apps/studio/src/cad/extrude.ts directly by its real path (the
// same precedent as scripts/lib/vision-parity-check.mjs importing
// apps/studio/src/lib/vision.ts): Node's native TypeScript support runs it
// as-is, and resolving from inside apps/studio's own directory tree is
// what lets extrude.ts's "replicad"/"replicad-opencascadejs" imports find
// apps/studio/node_modules (this repo has no root-level node_modules).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extrudeRectangle } from "../apps/studio/src/cad/extrude.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(ROOT, "contracts", "robot-def", "v1", "examples");

const identity = { position: [0, 0, 0], rotation_rpy: [0, 0, 0] };

// A simple L-bracket: two extruded rectangular slabs welded together with a
// fixed joint, proving the pipeline end to end (kernel -> mesh -> a real
// robot-def document a student's robot could actually use) with no UI
// involved. Units: meters.
async function buildLBracket() {
  const base = await extrudeRectangle({ width: 0.08, height: 0.05, depth: 0.01 });
  const upright = await extrudeRectangle({ width: 0.01, height: 0.05, depth: 0.08 });

  const cadMeshGeometry = (mesh) => ({ type: "cad_mesh", vertices: mesh.vertices, faces: mesh.faces });

  return {
    id: "cad-l-bracket",
    name: "CAD L-Bracket",
    description:
      "A simple L-bracket authored by the CAD kernel pipeline (extrude only, no sketch UI yet) -- proves a real replicad/OpenCascade solid becomes a real robot-def body. See docs/decisions/cad-kernel-foundation.md.",
    root_placement: identity,
    bodies: [
      {
        id: "base",
        name: "Base Slab",
        transform: identity,
        visual: cadMeshGeometry(base),
        collision: cadMeshGeometry(base),
        mass: 0.05,
        inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
      },
      {
        id: "upright",
        name: "Upright Slab",
        // Base spans x in [-0.04, 0.04], y in [-0.025, 0.025], z in
        // [-0.005, 0.005]. Upright spans (in its own local frame) x in
        // [-0.005, 0.005], y in [-0.025, 0.025], z in [-0.04, 0.04] (its
        // extrusion depth runs along the body's local Z, standing it up).
        // x=-0.035 puts the upright flush with the base's back edge
        // (-0.04 + upright's own half-width 0.005); z=0.045 puts its
        // bottom face flush with the base's top face (0.045 - 0.04 =
        // 0.005 = the base's own top face) -- a real L-bracket, not two
        // overlapping or floating slabs. Both the joint's origin and this
        // transform carry the identical offset, matching the two-link-arm
        // example's own convention (contracts/robot-def/v0/examples/two-link-arm.json):
        // body.transform positions this body's geometry relative to its
        // own joint frame, mirroring URDF's <visual origin>/<collision
        // origin> idiom (see runtime/python/okrobo/robot_def.py's header).
        transform: { position: [-0.035, 0, 0.045], rotation_rpy: [0, 0, 0] },
        visual: cadMeshGeometry(upright),
        collision: cadMeshGeometry(upright),
        mass: 0.05,
        inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
      },
    ],
    joints: [
      {
        id: "weld",
        name: "Weld",
        type: "fixed",
        parent: "base",
        child: "upright",
        origin: { position: [-0.035, 0, 0.045], rotation_rpy: [0, 0, 0] },
      },
    ],
    actuators: [],
    sensors: [],
  };
}

async function main() {
  mkdirSync(EXAMPLES_DIR, { recursive: true });

  const bracket = await buildLBracket();
  const totalVertices = bracket.bodies.reduce((sum, b) => sum + b.visual.vertices.length / 3, 0);
  const totalFaces = bracket.bodies.reduce((sum, b) => sum + b.visual.faces.length / 3, 0);
  if (totalVertices === 0 || totalFaces === 0) {
    throw new Error("generate-cad-examples: produced an empty mesh -- the pipeline is broken, refusing to write it");
  }

  const outPath = join(EXAMPLES_DIR, `${bracket.id}.json`);
  writeFileSync(outPath, `${JSON.stringify(bracket, null, 2)}\n`);
  console.log(`wrote ${outPath} (${bracket.bodies.length} bodies, ${totalVertices} vertices, ${totalFaces} faces)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

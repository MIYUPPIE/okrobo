import type { RobotDef } from "../contracts/robotDef";
import type { FilletBaseShape } from "../cad/cadClient";

// Extracted from CadFilletChamferEditor.tsx once CAD Kernel Phase 6 (Shell +
// Draft) needed the identical mapping too -- every standalone tool that
// targets an already-placed body reconstructs the same two exactly-
// reconstructable primitive types (box size, cylinder radius+length) as a
// FilletBaseShape; everything else (sphere/cone/capsule/plane, or an
// already-baked cad_mesh body) has no live B-rep to rebuild and returns
// null. See docs/decisions/cad-kernel-fillet-chamfer.md.

export function shapeFromGeometry(geometry: RobotDef["bodies"][number]["visual"]): FilletBaseShape | null {
  if (!geometry) return null;
  if (geometry.type === "box") return { operation: "box", size: geometry.size };
  if (geometry.type === "cylinder") return { operation: "cylinder", radius: geometry.radius, length: geometry.length };
  return null;
}

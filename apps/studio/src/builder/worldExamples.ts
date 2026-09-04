// Hand-written WorldDef starter content for the Test-mode world picker
// (Robot Builder Phase 5) -- not a runtime import of
// contracts/world-def/v0/examples/*.json, mirroring robotEdits.ts's own
// makeDefaultRobotDef precedent: that directory is a contract/test asset,
// not something the shipped app should pull in as a runtime dependency.
// This is a minimal picker, not a World Builder authoring UI -- see
// docs/decisions/robot-builder-world.md for the full non-goal list.

import type { WorldDef } from "../contracts/worldDef";

/** No objects at all -- selecting this still exercises the full world-def
 * pipeline (unlike BuilderPanel's default `null`, which skips it entirely
 * and matches pre-Phase-5 Test mode exactly). */
export function makeEmptyWorld(): WorldDef {
  return { id: "empty", name: "Empty", description: "Just the floor.", objects: [] };
}

/** A few boxes and a post to test collision and sensing against. */
export function makeObstacleCourseWorld(): WorldDef {
  return {
    id: "obstacle-course",
    name: "Obstacle Course",
    description: "A few boxes and a post to test collision and sensing against.",
    objects: [
      {
        id: "box1",
        name: "Box 1",
        transform: { position: [0.6, 0.0, 0.05], rotation_rpy: [0, 0, 0] },
        geometry: { type: "box", size: [0.1, 0.1, 0.1] },
        material: { color: [0.8, 0.3, 0.3] },
      },
      {
        id: "box2",
        name: "Box 2",
        transform: { position: [-0.5, 0.4, 0.075], rotation_rpy: [0, 0, 0] },
        geometry: { type: "box", size: [0.15, 0.15, 0.15] },
        material: { color: [0.3, 0.5, 0.8] },
      },
      {
        id: "post1",
        name: "Post 1",
        transform: { position: [0.0, -0.6, 0.15], rotation_rpy: [0, 0, 0] },
        geometry: { type: "cylinder", radius: 0.03, length: 0.3 },
        material: { color: [0.3, 0.7, 0.3] },
      },
    ],
  };
}

/** A single angled box a robot can drive or roll up -- "terrain" in v0
 * means a shaped, rotated primitive, not heightfield authoring. */
export function makeRampWorld(): WorldDef {
  return {
    id: "ramp",
    name: "Ramp",
    description: "A single angled box a robot can drive or roll up.",
    objects: [
      {
        id: "ramp1",
        name: "Ramp",
        transform: { position: [0.5, 0.0, 0.1], rotation_rpy: [0.0, 0.3, 0.0] },
        geometry: { type: "box", size: [0.8, 0.4, 0.02] },
        material: { color: [0.5, 0.5, 0.55] },
      },
    ],
  };
}

export interface WorldOption {
  id: string;
  label: string;
  make: () => WorldDef;
}

/** Listed in the Test-mode world picker, in this order. Picking one of
 * these is the only way v0 selects a world -- there is no authoring UI. */
export const WORLD_OPTIONS: readonly WorldOption[] = [
  { id: "empty", label: "Empty", make: makeEmptyWorld },
  { id: "obstacle-course", label: "Obstacle Course", make: makeObstacleCourseWorld },
  { id: "ramp", label: "Ramp", make: makeRampWorld },
];

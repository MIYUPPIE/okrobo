// Kinematic tree derived from a RobotDef's joints[] edges. Mirrors (does not
// re-derive differently) validateRobotDef's dedup + first-edge-wins graph
// logic (contracts/robot-def/v0/contract.md) so the two can't silently drift
// apart -- cross-checked in robotTree.test.ts against validateRobotDef's own
// issues on the same documents. Does not modify robotDef.ts itself: that
// file is mirrored across three languages and changes there need a contract
// version bump, which this Phase-2-only helper doesn't warrant.

import type { Joint, RobotDef } from "../contracts/robotDef";

export interface KinematicTree {
  /** Bodies with no incoming joint edge, in bodies[] declaration order. */
  rootIds: string[];
  /** child body id -> parent body id (first joint wins per child). */
  parentOf: Map<string, string>;
  /** child body id -> the joint that attaches it (first joint wins per child). */
  parentJointOf: Map<string, Joint>;
  /** parent body id -> ordered child body ids (only edges whose parent resolves to a real body). */
  childrenOf: Map<string, string[]>;
  /** Bodies not reachable from any root -- a joint cycle, or an orphan whose
   * recorded parent id doesn't resolve to a real body. Still real bodies:
   * the renderer draws them at their own transform rather than hiding them. */
  unreachableIds: string[];
}

export function buildKinematicTree(robot: RobotDef): KinematicTree {
  const bodyIds = new Set<string>();
  const bodyOrder: string[] = [];
  for (const body of robot.bodies) {
    if (!bodyIds.has(body.id)) {
      bodyIds.add(body.id);
      bodyOrder.push(body.id);
    }
  }

  // Dedup joints by id (first occurrence wins), mirroring validateRobotDef.
  const jointById = new Map<string, Joint>();
  for (const joint of robot.joints) {
    if (!jointById.has(joint.id)) jointById.set(joint.id, joint);
  }

  // Group by child, excluding self-loops and joints whose child doesn't
  // resolve to a real body -- matches validateRobotDef's tree-edge rules.
  const childJoints = new Map<string, Joint[]>();
  const childOrder: string[] = [];
  for (const joint of jointById.values()) {
    if (joint.parent === joint.child) continue;
    if (!bodyIds.has(joint.child)) continue;
    if (!childJoints.has(joint.child)) childOrder.push(joint.child);
    const list = childJoints.get(joint.child) ?? [];
    list.push(joint);
    childJoints.set(joint.child, list);
  }

  const parentOf = new Map<string, string>();
  const parentJointOf = new Map<string, Joint>();
  for (const childId of childOrder) {
    const first = childJoints.get(childId)![0];
    parentOf.set(childId, first.parent);
    parentJointOf.set(childId, first);
  }

  const rootIds = bodyOrder.filter((id) => !parentOf.has(id));

  const childrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of parentOf) {
    if (!bodyIds.has(parentId)) continue; // parent id doesn't resolve; no tree edge to walk
    const list = childrenOf.get(parentId) ?? [];
    list.push(childId);
    childrenOf.set(parentId, list);
  }

  const reachable = new Set<string>();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  const unreachableIds = bodyOrder.filter((id) => !reachable.has(id));

  return { rootIds, parentOf, parentJointOf, childrenOf, unreachableIds };
}

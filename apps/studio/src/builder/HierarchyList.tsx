import type { ReactNode } from "react";
import type { RobotDef } from "../contracts/robotDef";
import { buildKinematicTree } from "./robotTree";

export interface HierarchyListProps {
  robot: RobotDef;
  selectedBodyId: string | null;
  onSelect: (id: string) => void;
}

/** The body tree as nested rows, one button per body, indentation by depth.
 * Bodies buildKinematicTree can't attach to any root (no joints yet, or a
 * cycle) render in a separate "Unattached" section rather than being
 * hidden -- they're still real, still selectable bodies. */
export function HierarchyList({ robot, selectedBodyId, onSelect }: HierarchyListProps) {
  const tree = buildKinematicTree(robot);
  const bodyById = new Map(robot.bodies.map((b) => [b.id, b] as const));

  function renderRow(id: string, depth: number): ReactNode {
    const body = bodyById.get(id);
    if (!body) return null;
    const children = tree.childrenOf.get(id) ?? [];
    return (
      <li key={id}>
        <button
          type="button"
          className={id === selectedBodyId ? "hierarchy-row active" : "hierarchy-row"}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => onSelect(id)}
        >
          {body.name}
        </button>
        {children.length > 0 && <ul>{children.map((childId) => renderRow(childId, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <div className="hierarchy-list">
      <ul>{tree.rootIds.map((id) => renderRow(id, 0))}</ul>
      {tree.unreachableIds.length > 0 && (
        <>
          <h5 className="hierarchy-section">⚠ Unattached</h5>
          <ul>{tree.unreachableIds.map((id) => renderRow(id, 0))}</ul>
        </>
      )}
    </div>
  );
}

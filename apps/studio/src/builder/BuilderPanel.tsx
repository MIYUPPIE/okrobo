import { useMemo, useState } from "react";
import { validateRobotDef, type RobotDef, type Transform } from "../contracts/robotDef";
import { BodyInspector } from "./BodyInspector";
import { BuilderViewport, type GizmoMode } from "./BuilderViewport";
import { HierarchyList } from "./HierarchyList";
import { makeDefaultBody, nextBodyId, removeBody } from "./robotEdits";

// Composes the Build-mode UI: hierarchy (left), viewport + gizmo toolbar
// (center), inspector (right). Returned as a Fragment of three siblings --
// not one wrapping element -- so each participates directly in App.css's
// `.studio.mode-build` CSS grid (grid-area only applies to direct
// children), the same sibling-fragment idiom App.tsx's own "engine not
// ready" viewport state already uses.

export interface BuilderPanelProps {
  robot: RobotDef;
  onChange: (next: RobotDef) => void;
}

export function BuilderPanel({ robot, onChange }: BuilderPanelProps) {
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(robot.bodies[0]?.id ?? null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  // Bumped only on a gizmo commit (not on the inspector's own Apply), so
  // BodyInspector resyncs its draft when a drag moved the body it's
  // showing -- mirrors App.tsx's existing worldEpoch convention.
  const [transformEpoch, setTransformEpoch] = useState(0);

  const issues = useMemo(() => validateRobotDef(robot), [robot]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const selectedBody = selectedBodyId ? (robot.bodies.find((b) => b.id === selectedBodyId) ?? null) : null;

  const addBody = () => {
    const id = nextBodyId(robot);
    const near = selectedBody ?? robot.bodies[robot.bodies.length - 1] ?? null;
    onChange({ ...robot, bodies: [...robot.bodies, makeDefaultBody(id, near)] });
    setSelectedBodyId(id);
  };

  const deleteBody = (bodyId: string) => {
    onChange(removeBody(robot, bodyId));
    setSelectedBodyId((current) => (current === bodyId ? null : current));
  };

  const transformBody = (bodyId: string, transform: Transform) => {
    onChange({ ...robot, bodies: robot.bodies.map((b) => (b.id === bodyId ? { ...b, transform } : b)) });
    setTransformEpoch((n) => n + 1);
  };

  return (
    <>
      <aside className="builder-hierarchy">
        <div className="builder-hierarchy-header">
          <span className="builder-robot-name">{robot.name}</span>
          <span className={errorCount > 0 ? "builder-issue-count error" : "builder-issue-count"}>
            {issues.length} issue{issues.length === 1 ? "" : "s"}
          </span>
        </div>
        <HierarchyList robot={robot} selectedBodyId={selectedBodyId} onSelect={setSelectedBodyId} />
        <button type="button" className="builder-add-body" onClick={addBody}>
          + Add body
        </button>
      </aside>

      <div className="builder-stage">
        <BuilderViewport
          robot={robot}
          selectedBodyId={selectedBodyId}
          onSelectBody={setSelectedBodyId}
          onTransformBody={transformBody}
          gizmoMode={gizmoMode}
        />
        <div className="builder-toolbar">
          <button type="button" className={gizmoMode === "translate" ? "active" : ""} onClick={() => setGizmoMode("translate")}>
            Move
          </button>
          <button type="button" className={gizmoMode === "rotate" ? "active" : ""} onClick={() => setGizmoMode("rotate")}>
            Rotate
          </button>
        </div>
      </div>

      <aside className="builder-inspector">
        {selectedBody ? (
          <BodyInspector
            key={`${selectedBody.id}:${transformEpoch}`}
            robot={robot}
            bodyId={selectedBody.id}
            onApply={onChange}
            onRequestDelete={deleteBody}
          />
        ) : (
          <p className="builder-empty-inspector">Select a body to edit it.</p>
        )}
      </aside>
    </>
  );
}

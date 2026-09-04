import { useEffect, useMemo, useState } from "react";
import { validateRobotDef, type RobotDef, type Transform } from "../contracts/robotDef";
import { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { ENGINE_MISSING_MESSAGE, loadEngine } from "../engine/loader";
import { ActuatorPanel } from "./ActuatorPanel";
import { BodyInspector } from "./BodyInspector";
import { BuilderViewport, type GizmoMode } from "./BuilderViewport";
import { HierarchyList } from "./HierarchyList";
import { makeDefaultBody, nextBodyId, removeBody } from "./robotEdits";
import { SensorPanel } from "./SensorPanel";
import { TestViewport } from "./TestViewport";

// Composes the Build-mode UI: hierarchy (left), viewport + toolbar (center),
// inspector (right). Returned as a Fragment of three siblings -- not one
// wrapping element -- so each participates directly in App.css's
// `.studio.mode-build` CSS grid (grid-area only applies to direct
// children), the same sibling-fragment idiom App.tsx's own "engine not
// ready" viewport state already uses.
//
// A second, inner mode ("edit" | "test", Robot Builder Phase 3) swaps the
// static gizmo-editable viewport+inspector for a live physics preview
// (TestViewport + ActuatorPanel). Test mode constructs its own WASM
// instance independently of App.tsx's own simulate-mode engine (Phase 2's
// established boundary), snapshotting the *current* document once at entry
// -- nothing in Test mode ever writes back into it, so exiting just
// destroys that instance and the document is exactly as it was.

export interface BuilderPanelProps {
  robot: RobotDef;
  onChange: (next: RobotDef) => void;
}

type BuilderMode = "edit" | "test";
type TestStatus = "loading" | "ready" | "missing" | "error";

export function BuilderPanel({ robot, onChange }: BuilderPanelProps) {
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(robot.bodies[0]?.id ?? null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  // Bumped only on a gizmo commit (not on the inspector's own Apply), so
  // BodyInspector resyncs its draft when a drag moved the body it's
  // showing -- mirrors App.tsx's existing worldEpoch convention.
  const [transformEpoch, setTransformEpoch] = useState(0);

  const [builderMode, setBuilderMode] = useState<BuilderMode>("edit");
  const [testStatus, setTestStatus] = useState<TestStatus>("loading");
  const [testError, setTestError] = useState("");
  const [builtRobot, setBuiltRobot] = useState<EngineBuiltRobot | null>(null);

  const issues = useMemo(() => validateRobotDef(robot), [robot]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const selectedBody = selectedBodyId ? (robot.bodies.find((b) => b.id === selectedBodyId) ?? null) : null;

  useEffect(() => {
    if (builderMode !== "test") return;
    let cancelled = false;
    let created: EngineBuiltRobot | null = null;
    setTestStatus("loading");
    setTestError("");
    loadEngine()
      .then((module) => {
        if (cancelled) return;
        created = new EngineBuiltRobot(module, robot);
        setBuiltRobot(created);
        setTestStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setTestStatus(message === ENGINE_MISSING_MESSAGE ? "missing" : "error");
        setTestError(message);
      });
    return () => {
      cancelled = true;
      created?.destroy();
      setBuiltRobot(null);
    };
    // Deliberately only [builderMode]: entering Test mode snapshots `robot`
    // at that moment and never rebuilds mid-test even if `robot` changes --
    // nothing can change it while builderMode==="test", since neither
    // BodyInspector nor the edit-mode gizmo render then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderMode]);

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
        <div className="builder-mode-toggle">
          <button type="button" className={builderMode === "edit" ? "active" : ""} onClick={() => setBuilderMode("edit")}>
            Edit
          </button>
          <button
            type="button"
            className={builderMode === "test" ? "active" : ""}
            disabled={errorCount > 0}
            title={errorCount > 0 ? "Fix the robot's issues before testing it" : undefined}
            onClick={() => setBuilderMode("test")}
          >
            Test
          </button>
        </div>
        <HierarchyList robot={robot} selectedBodyId={selectedBodyId} onSelect={setSelectedBodyId} />
        {builderMode === "edit" && (
          <button type="button" className="builder-add-body" onClick={addBody}>
            + Add body
          </button>
        )}
      </aside>

      {builderMode === "edit" ? (
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
      ) : (
        <div className="builder-stage">
          {testStatus === "ready" && builtRobot ? (
            <TestViewport robot={robot} builtRobot={builtRobot} />
          ) : (
            <div className="test-status-note">
              {testStatus === "loading" && "Loading physics engine…"}
              {testStatus === "missing" && "Engine not built: run ./scripts/build-engine-wasm.sh, then reload"}
              {testStatus === "error" && `Couldn't simulate this robot: ${testError}`}
            </div>
          )}
          <p className="test-mode-note">Physics here doesn't affect your document -- exiting Test resets it.</p>
        </div>
      )}

      <aside className="builder-inspector">
        {builderMode === "edit" ? (
          selectedBody ? (
            <BodyInspector
              key={`${selectedBody.id}:${transformEpoch}`}
              robot={robot}
              bodyId={selectedBody.id}
              onApply={onChange}
              onRequestDelete={deleteBody}
            />
          ) : (
            <p className="builder-empty-inspector">Select a body to edit it.</p>
          )
        ) : builtRobot ? (
          <>
            <ActuatorPanel robot={robot} control={builtRobot} />
            <SensorPanel robot={robot} source={builtRobot} />
          </>
        ) : (
          <p className="builder-empty-inspector">Waiting for the physics engine…</p>
        )}
      </aside>
    </>
  );
}

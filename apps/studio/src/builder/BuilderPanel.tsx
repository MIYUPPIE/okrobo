import { useEffect, useMemo, useRef, useState } from "react";
import { BlocksPanel } from "../BlocksPanel";
import { setBuiltRobotFields } from "../blocks/okroboBlocks";
import { validateRobotDef, type RobotDef, type Transform } from "../contracts/robotDef";
import type { WorldDef } from "../contracts/worldDef";
import { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { ENGINE_MISSING_MESSAGE, loadEngine } from "../engine/loader";
import { BuiltProgramRunner } from "../program/BuiltProgramRunner";
import { runProgram } from "../program/execute";
import { ProgramStoppedError } from "../program/ProgramRunner";
import { ActuatorPanel } from "./ActuatorPanel";
import { BodyInspector } from "./BodyInspector";
import { BuilderViewport, type GizmoMode } from "./BuilderViewport";
import { HierarchyList } from "./HierarchyList";
import { makeDefaultBody, nextBodyId, removeBody } from "./robotEdits";
import { SensorPanel } from "./SensorPanel";
import { TestViewport } from "./TestViewport";
import { WORLD_OPTIONS } from "./worldExamples";

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
type ProgramTab = "Blocks" | "Python" | "C++";
type ProgramStatus = "idle" | "running" | "error";

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
  // Robot Builder Phase 5. "" = no world (today's exact pre-Phase-5 Test
  // mode: just the robot and the floor) -- the select's own default.
  const [worldOptionId, setWorldOptionId] = useState("");
  const [worldDef, setWorldDef] = useState<WorldDef | null>(null);

  // Robot Builder Phase 6 (Programming).
  const [builtRunner, setBuiltRunner] = useState<BuiltProgramRunner | null>(null);
  const [programTab, setProgramTab] = useState<ProgramTab>("Blocks");
  const [programCode, setProgramCode] = useState({ js: "", python: "", cpp: "" });
  const [programStatus, setProgramStatus] = useState<ProgramStatus>("idle");
  const [programError, setProgramError] = useState("");
  const programActiveRef = useRef(false);

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
        created = new EngineBuiltRobot(module, robot, worldDef ?? undefined);
        setBuiltRobot(created);
        // Robot Builder Phase 6: a fresh runner per built instance -- picking
        // a different world rebuilds both together, so a program never holds
        // a stale reference to a destroyed EngineBuiltRobot.
        setBuiltRunner(new BuiltProgramRunner(created, robot));
        setProgramStatus("idle");
        setProgramError("");
        programActiveRef.current = false;
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
      setBuiltRunner(null);
    };
    // Deliberately omits `robot`: entering Test mode snapshots `robot` at
    // that moment and never rebuilds mid-test even if `robot` changes --
    // nothing can change it while builderMode==="test", since neither
    // BodyInspector nor the edit-mode gizmo render then. `worldDef` DOES
    // rebuild (Robot Builder Phase 5): picking a different world from the
    // Test-mode toolbar's <select> below is meant to take effect live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderMode, worldDef]);

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

  // Robot Builder Phase 6: mirrors App.tsx's own run()/stop() shape for the
  // Car/Arm/Drone pipeline -- abort-if-already-running, arm(), set status,
  // runProgram().then/.catch/.finally, zero every actuator on the way out
  // so a finished (or stopped) program leaves the robot at rest.
  const runProgramCode = () => {
    if (!builtRunner) return;
    if (programActiveRef.current) builtRunner.abort();
    builtRunner.arm();
    programActiveRef.current = true;
    setProgramStatus("running");
    setProgramError("");
    runProgram(programCode.js, builtRunner.api)
      .then(() => setProgramStatus("idle"))
      .catch((error: unknown) => {
        if (error instanceof ProgramStoppedError) {
          setProgramStatus("idle");
        } else {
          setProgramStatus("error");
          setProgramError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        programActiveRef.current = false;
        builtRunner.abort();
      });
  };

  const stopProgram = () => builtRunner?.abort();

  // Robot Builder Phase 6: must run before BlocksPanel's own mount effect
  // calls Blockly.inject below (which renders the flyout's block previews
  // immediately) -- a useEffect here would run after the child's mount
  // effect and lose that race, the same ordering hazard BlocksPanel.tsx's
  // own initialWorkspace doc comment flags. An idempotent module-variable
  // write, safe to repeat under StrictMode's double-render.
  if (builderMode === "test") setBuiltRobotFields(robot.actuators, robot.sensors);

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
          <div className="builder-toolbar">
            <label className="builder-world-picker">
              World
              <select
                value={worldOptionId}
                onChange={(event) => {
                  const id = event.target.value;
                  setWorldOptionId(id);
                  const option = WORLD_OPTIONS.find((o) => o.id === id);
                  setWorldDef(option ? option.make() : null);
                }}
              >
                <option value="">None (floor only)</option>
                {WORLD_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="builder-test-main">
            {testStatus === "ready" && builtRobot && builtRunner ? (
              <TestViewport robot={robot} builtRobot={builtRobot} world={worldDef ?? undefined} runner={builtRunner} />
            ) : (
              <div className="test-status-note">
                {testStatus === "loading" && "Loading physics engine…"}
                {testStatus === "missing" && "Engine not built: run ./scripts/build-engine-wasm.sh, then reload"}
                {testStatus === "error" && `Couldn't simulate this robot: ${testError}`}
              </div>
            )}
            <p className="test-mode-note">Physics here doesn't affect your document -- exiting Test resets it.</p>
          </div>
          <div className="builder-program-drawer">
            <div className="builder-program-header">
              <div className="builder-program-actions">
                <button type="button" onClick={runProgramCode} disabled={!builtRunner || programStatus === "running"}>
                  ▶ Run
                </button>
                <button type="button" onClick={stopProgram} disabled={programStatus !== "running"}>
                  ⏹ Stop
                </button>
              </div>
              <span className="builder-program-status">
                {programStatus === "running" && "running…"}
                {programStatus === "error" && `error: ${programError}`}
                {programStatus === "idle" && "idle"}
              </span>
            </div>
            <div className="code-tabs">
              {(["Blocks", "Python", "C++"] as ProgramTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={t === programTab ? "code-tab active" : "code-tab"}
                  onClick={() => setProgramTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="code-content">
              <div className={programTab === "Blocks" ? "tab-panel active" : "tab-panel"}>
                <BlocksPanel
                  robot="built"
                  onCode={(js, python, cpp) => setProgramCode({ js, python, cpp })}
                />
              </div>
              <div className={programTab === "Python" ? "tab-panel active padded" : "tab-panel padded"}>
                <pre className="cpp-preview">{programCode.python}</pre>
                <p className="placeholder-note">
                  Illustrative preview only -- there is no real Python API for a built robot yet
                  (a future phase). This isn't runnable here.
                </p>
              </div>
              <div className={programTab === "C++" ? "tab-panel active padded" : "tab-panel padded"}>
                <pre className="cpp-preview">{programCode.cpp}</pre>
                <p className="placeholder-note">
                  Illustrative preview only -- there is no real C++ SDK for a built robot yet
                  (a future phase). This isn't runnable here.
                </p>
              </div>
            </div>
          </div>
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

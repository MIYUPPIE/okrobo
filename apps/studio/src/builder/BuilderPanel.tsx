import { useEffect, useMemo, useRef, useState } from "react";
import { BlocksPanel } from "../BlocksPanel";
import { setBuiltRobotFields } from "../blocks/okroboBlocks";
import type { CadEdgeOverlay, CadPreview } from "../cad/cadClient";
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
import { CadBoundaryCreator } from "./CadBoundaryCreator";
import { CadBoundaryCutCreator } from "./CadBoundaryCutCreator";
import { CadExtrudeCreator } from "./CadExtrudeCreator";
import { CadExtrudedCutCreator } from "./CadExtrudedCutCreator";
import { CadFilletChamferEditor } from "./CadFilletChamferEditor";
import { CadRevolveCreator } from "./CadRevolveCreator";
import { CadRevolvedCutCreator } from "./CadRevolvedCutCreator";
import { exportRobotDef } from "./exportRobot";
import type { FilletPickDraft } from "./filletPicks";
import { HierarchyList } from "./HierarchyList";
import { JointCreator } from "./JointCreator";
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
/** "transform" is the ordinary select-and-gizmo tool; "add-joint" is the
 * joint-authoring tool (parent-then-child viewport picking); "extrude"/
 * "revolve"/"boundary" are the Boss CAD part creation tools (Robot Builder
 * CAD Kernel Phases 2-3); "extruded-cut"/"revolved-cut"/"boundary-cut" are
 * their Phase 4 boolean-subtraction counterparts, each first requiring a
 * single existing-body pick (see pickTargetId below) before showing their
 * own creator panel; "fillet-chamfer" (Phase 5) is a fourth single-pick
 * tool of that same shape, targeting an existing box/cylinder body. */
type BuilderTool = "transform" | "add-joint" | "extrude" | "revolve" | "boundary" | "extruded-cut" | "revolved-cut" | "boundary-cut" | "fillet-chamfer";
interface JointDraft {
  parentId: string;
  childId?: string;
}

const CUT_TOOLS: ReadonlySet<BuilderTool> = new Set(["extruded-cut", "revolved-cut", "boundary-cut"]);
/** Every tool that needs a single existing-body pick before it can show
 * its own creator/editor panel -- Cut's three tools plus Fillet/Chamfer's
 * one. Drives the shared bodyPick/suppressedBodyId wiring; CUT_TOOLS
 * itself stays narrower, for the handful of things still genuinely
 * Cut-specific (hint copy, which creator to render). */
const TARGET_PICK_TOOLS: ReadonlySet<BuilderTool> = new Set([...CUT_TOOLS, "fillet-chamfer"]);

export function BuilderPanel({ robot, onChange }: BuilderPanelProps) {
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(robot.bodies[0]?.id ?? null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [builderTool, setBuilderTool] = useState<BuilderTool>("transform");
  const [jointDraft, setJointDraft] = useState<JointDraft | null>(null);
  const [cadPreview, setCadPreview] = useState<CadPreview | null>(null);
  // Robot Builder CAD Kernel Phase 4 (Cut) / Phase 5 (Fillet + Chamfer):
  // the existing body one of the four TARGET_PICK_TOOLS is targeting. null
  // while still picking (bodyPick is wired into the viewport/hierarchy
  // then); once set, the matching creator/editor replaces the picking hint.
  const [pickTargetId, setPickTargetId] = useState<string | null>(null);
  // Robot Builder CAD Kernel Phase 5: edges picked so far, lifted here the
  // same way cadPreview already is -- shared by the three Boss creators
  // (their own fresh, not-yet-baked shape) and CadFilletChamferEditor (an
  // existing box/cylinder body).
  const [filletPicks, setFilletPicks] = useState<FilletPickDraft[]>([]);
  const [edgeOverlay, setEdgeOverlay] = useState<CadEdgeOverlay | null>(null);
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
  const isCutTool = CUT_TOOLS.has(builderTool);
  const isTargetPickTool = TARGET_PICK_TOOLS.has(builderTool);
  const isCadTool = isTargetPickTool || builderTool === "extrude" || builderTool === "revolve" || builderTool === "boundary";

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

  const toggleJointTool = () => {
    setBuilderTool((current) => (current === "add-joint" ? "transform" : "add-joint"));
    setJointDraft(null);
  };

  /** Parent-then-child picking for the Add Joint tool -- shared by both the
   * 3D viewport's raycast picking (BuilderViewport's jointPick prop) and
   * HierarchyList's own rows (a real DOM button, unlike a 3D click, so this
   * is also what a real end-to-end browser check drives). Re-picking the
   * current parent is a no-op (not a self-loop draft) rather than an error
   * -- it's clearly just a misclick, not an attempt to joint a body to itself. */
  const handleJointPick = (bodyId: string) => {
    setJointDraft((current) => {
      if (!current) return { parentId: bodyId };
      if (!current.childId) return bodyId === current.parentId ? current : { ...current, childId: bodyId };
      return current;
    });
  };

  const applyJoint = (next: RobotDef) => {
    onChange(next);
    setBuilderTool("transform");
    setJointDraft(null);
  };

  const toggleExtrudeTool = () => {
    setBuilderTool((current) => (current === "extrude" ? "transform" : "extrude"));
    setCadPreview(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  const toggleRevolveTool = () => {
    setBuilderTool((current) => (current === "revolve" ? "transform" : "revolve"));
    setCadPreview(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  const toggleBoundaryTool = () => {
    setBuilderTool((current) => (current === "boundary" ? "transform" : "boundary"));
    setCadPreview(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  // Shared by all three Boss CAD tools (Extrude/Revolve/Boundary) -- their
  // onApply/onCancel shape is identical regardless of which operation
  // produced the mesh, so one pair of handlers serves all three rather
  // than three near-duplicate copies.
  const applyCadBody = (next: RobotDef, newBodyId: string) => {
    onChange(next);
    setBuilderTool("transform");
    setCadPreview(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
    setSelectedBodyId(newBodyId);
  };

  const cancelCadTool = () => {
    setBuilderTool("transform");
    setCadPreview(null);
    setPickTargetId(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  /** Makes all nine tools mutually exclusive by construction: a tool's own
   * toolbar button never disables itself (so clicking it again toggles
   * back to "transform"), only a *different* exclusive tool being active. */
  const otherCadToolActive = (own: BuilderTool) => builderTool !== "transform" && builderTool !== own;

  const toggleExtrudedCutTool = () => {
    setBuilderTool((current) => (current === "extruded-cut" ? "transform" : "extruded-cut"));
    setCadPreview(null);
    setPickTargetId(null);
  };

  const toggleRevolvedCutTool = () => {
    setBuilderTool((current) => (current === "revolved-cut" ? "transform" : "revolved-cut"));
    setCadPreview(null);
    setPickTargetId(null);
  };

  const toggleBoundaryCutTool = () => {
    setBuilderTool((current) => (current === "boundary-cut" ? "transform" : "boundary-cut"));
    setCadPreview(null);
    setPickTargetId(null);
  };

  const toggleFilletChamferTool = () => {
    setBuilderTool((current) => (current === "fillet-chamfer" ? "transform" : "fillet-chamfer"));
    setCadPreview(null);
    setPickTargetId(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  /** Single-body pick for any of the four TARGET_PICK_TOOLS -- no parent-
   * then-child two-step, unlike handleJointPick. Shared by BuilderViewport's
   * bodyPick prop and HierarchyList's own rows, the same "two real input
   * paths" precedent Add Joint already established. */
  const handleTargetPick = (bodyId: string) => {
    setPickTargetId(bodyId);
    setFilletPicks([]);
    setEdgeOverlay(null);
  };

  /** Shared by all four TARGET_PICK_TOOLS -- no new body id to select (the
   * target body's own id is unchanged), unlike applyCadBody. */
  const applyTargetEditResult = (next: RobotDef) => {
    onChange(next);
    setBuilderTool("transform");
    setCadPreview(null);
    setPickTargetId(null);
    setFilletPicks([]);
    setEdgeOverlay(null);
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
          <button
            type="button"
            className="builder-export"
            title="Save this robot as a standalone contracts/robot-def/v0 file"
            onClick={() => void exportRobotDef(robot).catch((error: unknown) => console.error("failed to export robot:", error))}
          >
            Export
          </button>
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
        <HierarchyList
          robot={robot}
          selectedBodyId={builderTool === "add-joint" ? (jointDraft?.parentId ?? null) : isTargetPickTool ? pickTargetId : selectedBodyId}
          onSelect={builderTool === "add-joint" ? handleJointPick : isTargetPickTool && pickTargetId === null ? handleTargetPick : setSelectedBodyId}
        />
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
            jointPick={builderTool === "add-joint" ? { parentId: jointDraft?.parentId ?? null, onPick: handleJointPick } : undefined}
            bodyPick={isTargetPickTool && pickTargetId === null ? { selectedId: null, onPick: handleTargetPick } : undefined}
            cadPreview={isCadTool ? cadPreview : null}
            suppressedBodyId={isTargetPickTool ? pickTargetId : null}
            edgeOverlay={isCadTool && edgeOverlay ? { ...edgeOverlay, pickedPoints: filletPicks.map((p) => p.point) } : null}
          />
          <div className="builder-toolbar">
            <button
              type="button"
              className={gizmoMode === "translate" ? "active" : ""}
              disabled={builderTool !== "transform"}
              onClick={() => setGizmoMode("translate")}
            >
              Move
            </button>
            <button
              type="button"
              className={gizmoMode === "rotate" ? "active" : ""}
              disabled={builderTool !== "transform"}
              onClick={() => setGizmoMode("rotate")}
            >
              Rotate
            </button>
            <button
              type="button"
              className={builderTool === "add-joint" ? "active" : ""}
              disabled={robot.bodies.length < 2 || otherCadToolActive("add-joint")}
              title={robot.bodies.length < 2 ? "Add a second body first" : undefined}
              onClick={toggleJointTool}
            >
              Add Joint
            </button>
            <button
              type="button"
              className={builderTool === "extrude" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("extrude")}
              onClick={toggleExtrudeTool}
            >
              Extrude
            </button>
            <button
              type="button"
              className={builderTool === "revolve" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("revolve")}
              onClick={toggleRevolveTool}
            >
              Revolve
            </button>
            <button
              type="button"
              className={builderTool === "boundary" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("boundary")}
              onClick={toggleBoundaryTool}
            >
              Boundary
            </button>
            <button
              type="button"
              className={builderTool === "extruded-cut" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("extruded-cut")}
              onClick={toggleExtrudedCutTool}
            >
              Extruded Cut
            </button>
            <button
              type="button"
              className={builderTool === "revolved-cut" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("revolved-cut")}
              onClick={toggleRevolvedCutTool}
            >
              Revolved Cut
            </button>
            <button
              type="button"
              className={builderTool === "boundary-cut" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("boundary-cut")}
              onClick={toggleBoundaryCutTool}
            >
              Boundary Cut
            </button>
            <button
              type="button"
              className={builderTool === "fillet-chamfer" ? "active" : ""}
              disabled={robot.bodies.length === 0 || otherCadToolActive("fillet-chamfer")}
              onClick={toggleFilletChamferTool}
            >
              Fillet/Chamfer
            </button>
          </div>
          {builderTool === "add-joint" && !jointDraft?.childId && (
            <p className="joint-pick-hint">{jointDraft ? "Click the child body." : "Click the parent body."}</p>
          )}
          {isCutTool && pickTargetId === null && <p className="joint-pick-hint">Click the body to cut.</p>}
          {builderTool === "fillet-chamfer" && pickTargetId === null && <p className="joint-pick-hint">Click the body to fillet or chamfer.</p>}
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
          jointDraft?.childId ? (
            <JointCreator
              robot={robot}
              parentId={jointDraft.parentId}
              childId={jointDraft.childId}
              onApply={applyJoint}
              onCancel={() => setJointDraft(null)}
            />
          ) : builderTool === "extrude" ? (
            <CadExtrudeCreator
              robot={robot}
              near={selectedBody ?? robot.bodies[robot.bodies.length - 1] ?? null}
              onApply={applyCadBody}
              onCancel={cancelCadTool}
              onPreviewChange={setCadPreview}
              edgePicks={filletPicks}
              onEdgePicksChange={setFilletPicks}
              onEdgeOverlayChange={setEdgeOverlay}
            />
          ) : builderTool === "revolve" ? (
            <CadRevolveCreator
              robot={robot}
              near={selectedBody ?? robot.bodies[robot.bodies.length - 1] ?? null}
              onApply={applyCadBody}
              onCancel={cancelCadTool}
              onPreviewChange={setCadPreview}
              edgePicks={filletPicks}
              onEdgePicksChange={setFilletPicks}
              onEdgeOverlayChange={setEdgeOverlay}
            />
          ) : builderTool === "boundary" ? (
            <CadBoundaryCreator
              robot={robot}
              near={selectedBody ?? robot.bodies[robot.bodies.length - 1] ?? null}
              onApply={applyCadBody}
              onCancel={cancelCadTool}
              onPreviewChange={setCadPreview}
              edgePicks={filletPicks}
              onEdgePicksChange={setFilletPicks}
              onEdgeOverlayChange={setEdgeOverlay}
            />
          ) : builderTool === "extruded-cut" && pickTargetId ? (
            <CadExtrudedCutCreator robot={robot} targetBodyId={pickTargetId} onApply={applyTargetEditResult} onCancel={cancelCadTool} onPreviewChange={setCadPreview} />
          ) : builderTool === "revolved-cut" && pickTargetId ? (
            <CadRevolvedCutCreator robot={robot} targetBodyId={pickTargetId} onApply={applyTargetEditResult} onCancel={cancelCadTool} onPreviewChange={setCadPreview} />
          ) : builderTool === "boundary-cut" && pickTargetId ? (
            <CadBoundaryCutCreator robot={robot} targetBodyId={pickTargetId} onApply={applyTargetEditResult} onCancel={cancelCadTool} onPreviewChange={setCadPreview} />
          ) : builderTool === "fillet-chamfer" && pickTargetId ? (
            <CadFilletChamferEditor
              robot={robot}
              targetBodyId={pickTargetId}
              onApply={applyTargetEditResult}
              onCancel={cancelCadTool}
              onPreviewChange={setCadPreview}
              edgePicks={filletPicks}
              onEdgePicksChange={setFilletPicks}
              onEdgeOverlayChange={setEdgeOverlay}
            />
          ) : selectedBody && builderTool === "transform" ? (
            <BodyInspector
              key={`${selectedBody.id}:${transformEpoch}`}
              robot={robot}
              bodyId={selectedBody.id}
              onApply={onChange}
              onRequestDelete={deleteBody}
            />
          ) : (
            <p className="builder-empty-inspector">
              {builderTool === "add-joint"
                ? "Pick a parent and a child body in the 3D view."
                : isCutTool
                  ? "Pick a body to cut in the 3D view."
                  : builderTool === "fillet-chamfer"
                    ? "Pick a body to fillet or chamfer in the 3D view."
                    : "Select a body to edit it."}
            </p>
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import arenaJson from "@packs/core/worlds/arena.json";
import pkg from "../package.json";
import { AboutDialog, NameDialog, OpenDialog } from "./dialogs";
import { AssetStore } from "./AssetStore";
import { CameraView } from "./CameraView";
import type { RobotKind } from "./blocks/okroboBlocks";
import { BlocksPanel, type BlocksPanelHandle } from "./BlocksPanel";
import { BuilderPanel } from "./builder/BuilderPanel";
import { BuiltRobotDialog } from "./builder/BuiltRobotDialog";
import { TemplateDialog } from "./builder/TemplateDialog";
import { TestViewport } from "./builder/TestViewport";
import { WORLD_OPTIONS } from "./builder/worldExamples";
import { parseRobotDef, validateRobotDef, type RobotDef } from "./contracts/robotDef";
import type { WorldDef as BuiltWorldDef } from "./contracts/worldDef";
import { EngineArm } from "./engine/EngineArm";
import { EngineBuiltRobot } from "./engine/EngineBuiltRobot";
import { EngineDrone } from "./engine/EngineDrone";
import { EngineWorld } from "./engine/EngineWorld";
import { ENGINE_MISSING_MESSAGE, loadEngine } from "./engine/loader";
import { LessonsPanel } from "./LessonsPanel";
import { editActionsForTab } from "./lib/editMenu";
import { formatBuilderStatus, formatStudioStatus } from "./lib/statusText";
import { isTeleopKey, normalizeKey, teleopWheels } from "./lib/teleop";
import { validateWorld, type WorldDef } from "./lib/validateWorld";
import { setBuiltRobotFields } from "./blocks/okroboBlocks";
import { BuiltProgramRunner, type BuiltRobotApi } from "./program/BuiltProgramRunner";
import { runProgram } from "./program/execute";
import { ProgramRunner, ProgramStoppedError } from "./program/ProgramRunner";
import { CompetitionDialog } from "./compete/CompetitionDialog";
import { CompeteHud } from "./compete/CompeteHud";
import { CompeteReport } from "./compete/CompeteReport";
import type { CompetitionDef } from "./compete/competitionDef";
import { evaluateTick, finishRun, initRunState, type CompetitionRunState } from "./compete/score";
import {
  createProject,
  deleteProject,
  inDesktop,
  listProjects,
  loadProject,
  type ProjectMeta,
  type ProjectPayload,
  saveProject,
} from "./projects/api";
import {
  executeBuiltRemoteRequest,
  type FlashStatus,
  type HardwareStatus,
  PythonBridge,
  type SerialPort,
  SIDECAR_URL,
} from "./python/PythonBridge";
import { type OutputLine, PythonPanel, type PythonPanelHandle } from "./PythonPanel";
import { Viewport } from "./Viewport";
import { CRUISE_SPEED, type HudInfo, Viewport3D } from "./Viewport3D";
import { WorldPanel } from "./WorldPanel";
import "./App.css";

const WORLD_ID = "arena";
type MenuId = "file" | "edit" | "robot" | "simulation" | "help";

const ROBOTS: Array<{ id: RobotKind; icon: string; name: string }> = [
  { id: "car", icon: "🚗", name: "Car" },
  { id: "arm", icon: "🦾", name: "Arm" },
  { id: "drone", icon: "🛸", name: "Drone" },
];


const CODE_TABS = ["Blocks", "Python", "World", "Lessons", "C++"] as const;
type CodeTab = (typeof CODE_TABS)[number];

const TELEOP_SPEED = CRUISE_SPEED;
const TELEOP_TURN = 0.06;

function FlashStatusNote({ flash }: { flash: FlashStatus | null }) {
  if (!flash) return null;
  if (flash.stage === "compile") return <p className="hardware-note">Compiling firmware...</p>;
  if (flash.stage === "upload") return <p className="hardware-note">Uploading...</p>;
  if (flash.stage === "done") {
    return <p className="hardware-note connected">✓ Flashed. Reconnect to use it.</p>;
  }
  return <p className="hardware-note error">Flash failed: {flash.error}</p>;
}

type EngineStatus = "loading" | "ready" | "missing";
type RunStatus = "idle" | "cruise" | "wall" | "program" | "python" | "error";
type Dialog = "none" | "save-as" | "open" | "store" | "about" | "new-robot";

export default function App() {
  const [tab, setTab] = useState<CodeTab>("Blocks");
  const [robot, setRobot] = useState<RobotKind>("car");
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engine, setEngine] = useState<EngineWorld | null>(null);
  const [arm, setArm] = useState<EngineArm | null>(null);
  const [drone, setDrone] = useState<EngineDrone | null>(null);
  const [runner, setRunner] = useState<ProgramRunner | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [pythonCode, setPythonCode] = useState("");
  const [cppCode, setCppCode] = useState("");
  const [pythonConnected, setPythonConnected] = useState(false);
  const [pythonOutput, setPythonOutput] = useState<OutputLine[]>([]);
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [hardware, setHardware] = useState<HardwareStatus>({ connected: false });
  const [flash, setFlash] = useState<FlashStatus | null>(null);
  const flashing = flash?.stage === "compile" || flash?.stage === "upload";
  const [hud, setHud] = useState<HudInfo | null>(null);
  const autopilotRef = useRef(false);
  const programActiveRef = useRef(false);
  const pythonActiveRef = useRef(false);
  // The WASM world steps every animation frame regardless of Run/Stop (see
  // Viewport3D.tsx's own "both worlds always step" comment) -- so without
  // this gate, a competition's own clock would start ticking the instant an
  // arena loads, not when the student presses Run, and would keep ticking
  // after Stop. Flipped true by every one of run()'s three paths (cruise,
  // Python, Blocks/C++ program) and false by haltEverything()/the program
  // .finally(), mirroring how programActiveRef/pythonActiveRef already track
  // "is something actually driving the robot right now."
  const competeActiveRef = useRef(false);
  const jsCodeRef = useRef("");
  const pythonSourceRef = useRef("");
  const bridgeRef = useRef<PythonBridge | null>(null);

  const [currentProject, setCurrentProject] = useState<ProjectMeta | null>(null);
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [notice, setNotice] = useState("");
  const blocksRef = useRef<BlocksPanelHandle>(null);
  const pythonRef = useRef<PythonPanelHandle>(null);
  // Seeds a freshly-mounted BlocksPanel/PythonPanel (after a robot switch)
  // with content other than the default starter. State, not a ref: BOTH
  // panels read it via props at their OWN mount time, which is immune to
  // React StrictMode's dev-mode double-invoke of effects — an imperative
  // ref.load() call from a parent effect is not (see the comments on
  // PythonPanelProps.initialOverride and BlocksPanelProps.initialWorkspace).
  const [pendingContent, setPendingContent] = useState<{
    robot: RobotKind;
    blocks?: object | null;
    python?: string;
    pythonEdited: boolean;
  } | null>(null);
  const clearPendingContent = useCallback(() => setPendingContent(null), []);
  const noticeTimer = useRef(0);

  const defaultWorld = useMemo(() => validateWorld(arenaJson), []);
  const [world, setWorld] = useState<WorldDef>(defaultWorld);
  // Bumped whenever `world` changes for a reason other than the World tab's
  // own "Apply changes" (a project load, "New", or "reset to default") so
  // WorldPanel remounts and re-seeds its draft form from the new prop value,
  // the same key-remount convention BlocksPanel/PythonPanel use for content
  // seeded from outside — see their initialWorkspace/initialOverride docs.
  const [worldEpoch, setWorldEpoch] = useState(0);

  // Build mode is a separate top-level mode from `robot: RobotKind` -- a
  // robot-def in progress isn't a physics-simulated robot kind, and has no
  // WASM engine behind it. Switching modes never touches `robot`/`engine`.
  // Compete mode reuses the exact same car-physics path Simulate mode uses
  // (same engine/runner, same Viewport3D) -- only the arena underneath and
  // an outside-the-program scoring layer differ. See
  // docs/decisions/competition-arena-definition-scoring.md.
  const [mode, setMode] = useState<"simulate" | "build" | "compete">("simulate");
  const [robotDef, setRobotDef] = useState<RobotDef | null>(null);
  const [competition, setCompetition] = useState<CompetitionDef | null>(null);
  const [competeRun, setCompeteRun] = useState<CompetitionRunState | null>(null);
  const [competeDialogOpen, setCompeteDialogOpen] = useState(false);

  // Robot Builder B2: a built robot in Simulate mode. Deliberately
  // orthogonal to `robot: RobotKind` (car/arm/drone stay untouched, an
  // always-resident trio regardless of this) rather than a 4th RobotKind
  // value -- see docs/decisions/robot-builder-simulate-mode.md for why.
  const [simulateBuilt, setSimulateBuilt] = useState<{ robot: RobotDef; world: BuiltWorldDef | null } | null>(null);
  const [builtRobotDialogOpen, setBuiltRobotDialogOpen] = useState(false);
  const [builtWorldOptionId, setBuiltWorldOptionId] = useState("");
  const [builtEngineStatus, setBuiltEngineStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [builtEngineError, setBuiltEngineError] = useState("");
  const [builtEngine, setBuiltEngine] = useState<EngineBuiltRobot | null>(null);
  const [builtRunner, setBuiltRunner] = useState<BuiltProgramRunner | null>(null);
  const [builtRunStatus, setBuiltRunStatus] = useState<"idle" | "running" | "error">("idle");
  const [builtRunError, setBuiltRunError] = useState("");
  const [builtPythonConnected, setBuiltPythonConnected] = useState(false);
  const [builtPythonOutput, setBuiltPythonOutput] = useState<OutputLine[]>([]);
  const builtBridgeRef = useRef<PythonBridge<BuiltRobotApi> | null>(null);
  const builtProgramActiveRef = useRef(false);
  const builtPythonActiveRef = useRef(false);
  // Gates BuiltRobotDialog's "current robot" row -- the same zero-error
  // gate Build mode's own Test button already uses.
  const builtRobotIssues = useMemo(() => (robotDef ? validateRobotDef(robotDef) : []), [robotDef]);
  // Must run before <BlocksPanel robot="built"> mounts (its dropdown fields
  // are read at construction time) -- render-body write, not an effect, the
  // same race-avoidance ordering BuilderPanel.tsx/robot-builder-programming.md
  // already document.
  if (simulateBuilt) setBuiltRobotFields(simulateBuilt.robot.actuators, simulateBuilt.robot.sensors);
  // A built robot never populates pendingContent (only lesson "Try this"/
  // project loads do, both car/arm/drone-only) -- excluded explicitly so a
  // stale pending entry from before picking a built robot can never seed
  // its Blocks/Python panels with content meant for a different robot kind.
  const pendingForRobot = !simulateBuilt && pendingContent?.robot === robot ? pendingContent : null;
  // Read inside the PythonBridge's onDone closure (created once per
  // engine/runner change, so `mode` itself would go stale there) -- kept
  // current every render rather than via an effect, same "cheap enough to
  // just do inline" reasoning as jsCodeRef/pythonSourceRef above.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    let cancelled = false;
    let created: EngineWorld | null = null;
    let createdArm: EngineArm | null = null;
    let createdDrone: EngineDrone | null = null;
    loadEngine()
      .then((module) => {
        if (cancelled) return;
        created = new EngineWorld(module, world);
        createdArm = new EngineArm(module);
        createdDrone = new EngineDrone(module, world);
        setEngine(created);
        setArm(createdArm);
        setDrone(createdDrone);
        setRunner(new ProgramRunner(created, world.wheel_base, createdArm, createdDrone));
        setEngineStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setEngineStatus("missing");
      });
    return () => {
      cancelled = true;
      created?.destroy();
      createdArm?.destroy();
      createdDrone?.destroy();
      setEngine(null);
      setArm(null);
      setDrone(null);
      setRunner(null);
    };
  }, [world]);

  // Robot Builder B2: constructs a built robot's own engine/runner when
  // picked, mirroring BuilderPanel.tsx's Test-mode construction effect
  // exactly. Keyed on `simulateBuilt` itself (a fresh pick is a new object
  // identity) rather than on `robotDef`, so Build mode editing its own
  // in-progress document never rebuilds this -- a snapshot at pick time,
  // the same reasoning Test mode's own effect documents for omitting
  // `robot` from its deps.
  useEffect(() => {
    if (!simulateBuilt) return;
    let cancelled = false;
    let created: EngineBuiltRobot | null = null;
    setBuiltEngineStatus("loading");
    setBuiltEngineError("");
    loadEngine()
      .then((module) => {
        if (cancelled) return;
        created = new EngineBuiltRobot(module, simulateBuilt.robot, simulateBuilt.world ?? undefined);
        setBuiltEngine(created);
        setBuiltRunner(new BuiltProgramRunner(created, simulateBuilt.robot));
        setBuiltEngineStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setBuiltEngineStatus(message === ENGINE_MISSING_MESSAGE ? "missing" : "error");
        setBuiltEngineError(message);
      });
    return () => {
      cancelled = true;
      created?.destroy();
      setBuiltEngine(null);
      setBuiltRunner(null);
    };
  }, [simulateBuilt]);

  // Robot Builder B2: a dedicated Python bridge for the built robot, same
  // shape as B1's BuilderPanel.tsx effect -- see
  // docs/decisions/robot-builder-python-execution.md.
  useEffect(() => {
    if (!builtRunner) return;
    const appendOutput = (line: OutputLine) =>
      setBuiltPythonOutput((previous) => [...previous.slice(-499), line]);
    const bridge = new PythonBridge<BuiltRobotApi>(
      SIDECAR_URL,
      builtRunner.api,
      {
        onStatus: setBuiltPythonConnected,
        onStarted: () => {},
        onOutput: (stream, text) => appendOutput({ stream, text }),
        onDone: (exitCode) => {
          builtPythonActiveRef.current = false;
          builtRunner.abort();
          setBuiltRunStatus("idle");
          if (exitCode !== 0) {
            appendOutput({ stream: "stderr", text: `--- exited with code ${exitCode} ---\n` });
          }
        },
      },
      executeBuiltRemoteRequest,
    );
    builtBridgeRef.current = bridge;
    bridge.connect();
    return () => {
      builtBridgeRef.current = null;
      bridge.dispose();
    };
  }, [builtRunner]);

  // Python sidecar bridge: robot calls from real local Python execute here.
  useEffect(() => {
    if (!engine || !runner) return;
    const appendOutput = (line: OutputLine) =>
      setPythonOutput((previous) => [...previous.slice(-499), line]);
    const bridge = new PythonBridge(SIDECAR_URL, runner.api, {
      onStatus: (connected) => {
        setPythonConnected(connected);
        if (connected) bridge.listPorts();
        else {
          setPorts([]);
          setHardware({ connected: false });
          setFlash(null);
        }
      },
      onPorts: setPorts,
      onHardware: (status) => {
        setHardware(status);
        if (status.error) {
          setPythonOutput((previous) => [
            ...previous.slice(-499),
            { stream: "stderr", text: `hardware: ${status.error}\n` },
          ]);
        }
      },
      onFlash: (status) => {
        setFlash(status);
        const label =
          status.stage === "compile"
            ? "compiling firmware/okrobo_car..."
            : status.stage === "upload"
              ? "uploading..."
              : status.stage === "done"
                ? "flashed."
                : `error: ${status.error ?? "unknown error"}`;
        setPythonOutput((previous) => [
          ...previous.slice(-499),
          { stream: status.stage === "error" ? "stderr" : "stdout", text: `flash: ${label}\n` },
        ]);
      },
      onStarted: () => {},
      onOutput: (stream, text) => appendOutput({ stream, text }),
      onDone: (exitCode) => {
        pythonActiveRef.current = false;
        engine.apply({ type: "stop" });
        setRunStatus("idle");
        if (exitCode !== 0) {
          appendOutput({ stream: "stderr", text: `--- exited with code ${exitCode} ---\n` });
        }
        if (modeRef.current === "compete") {
          competeActiveRef.current = false;
          setCompeteRun((previous) => (previous ? finishRun(previous, "program_ended") : previous));
        }
      },
    });
    bridgeRef.current = bridge;
    bridge.connect();
    return () => {
      bridgeRef.current = null;
      bridge.dispose();
    };
  }, [engine, runner]);

  // Keyboard teleop: arrows / WASD drive the car's wheels directly.
  // Mapping logic lives in lib/teleop.ts, tested in isolation.
  useEffect(() => {
    if (!engine || !runner || robot !== "car") return;
    const held = new Set<string>();

    const applyWheels = () => {
      const { left, right } = teleopWheels(held, TELEOP_SPEED, TELEOP_TURN);
      engine.apply(left === 0 && right === 0 ? { type: "stop" } : { type: "drive", left, right });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea)$/i.test(target.tagName))) return;
      const key = normalizeKey(e.key);
      if (!isTeleopKey(key)) return;
      e.preventDefault();
      held.add(key);
      if (programActiveRef.current) runner.abort();
      if (pythonActiveRef.current) {
        bridgeRef.current?.stop();
        runner.abort();
      }
      autopilotRef.current = false;
      setRunStatus("idle");
      applyWheels();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = normalizeKey(e.key);
      if (!isTeleopKey(key)) return;
      held.delete(key);
      applyWheels();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [engine, runner, robot]);

  const onState = useCallback((info: HudInfo) => setHud(info), []);
  const onAutoStop = useCallback(() => {
    autopilotRef.current = false;
    setRunStatus("wall");
  }, []);
  // Compete mode's own per-tick scoring hook, threaded into Viewport3D's
  // ProgramRunner.tick() only while a competition is loaded. Reads
  // `competition` via the ref-free closure recreated each render (mirrors
  // `onCode`/`onPythonSource`'s own plain-callback posture) -- cheap, and
  // Viewport3D's effect already depends on this identity via its deps array.
  const onEngineStep = useCallback(
    (state: { pose: { x: number; y: number; theta: number } }, dt: number) => {
      if (!competition || !competeActiveRef.current) return;
      // Pure state transition only -- no side effect here. React (Strict
      // Mode especially) may invoke a setState updater more than once per
      // real event to check for impurities, so a call to haltEverything()
      // from inside this updater could double-fire. The auto-halt-on-
      // time-up side effect lives in the useEffect below instead, which
      // only re-runs when `competeRun.timeUp` actually changes.
      setCompeteRun((previous) => (previous ? evaluateTick(competition, previous, state.pose, dt) : previous));
    },
    [competition],
  );
  useEffect(() => {
    if (competeRun?.timeUp) haltEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competeRun?.timeUp]);
  const onCode = useCallback((js: string, python: string, cpp: string) => {
    jsCodeRef.current = js;
    setPythonCode(python);
    setCppCode(cpp);
  }, []);
  const onPythonSource = useCallback((code: string) => {
    pythonSourceRef.current = code;
  }, []);

  const run = () => {
    if (simulateBuilt) {
      if (!builtRunner) return;
      if (tab === "Python") {
        const bridge = builtBridgeRef.current;
        if (!bridge?.connected) {
          setBuiltPythonOutput([
            {
              stream: "stderr",
              text: "python sidecar is not running · start it with ./scripts/run-python-sidecar.sh\n",
            },
          ]);
          return;
        }
        if (builtProgramActiveRef.current) builtRunner.abort();
        builtRunner.arm();
        builtPythonActiveRef.current = true;
        setBuiltPythonOutput([]);
        setBuiltRunStatus("running");
        setBuiltRunError("");
        bridge.run(pythonSourceRef.current);
        return;
      }
      if (builtProgramActiveRef.current) builtRunner.abort();
      builtRunner.arm();
      builtProgramActiveRef.current = true;
      setBuiltRunStatus("running");
      setBuiltRunError("");
      runProgram(jsCodeRef.current, builtRunner.api)
        .then(() => setBuiltRunStatus("idle"))
        .catch((error: unknown) => {
          if (error instanceof ProgramStoppedError) {
            setBuiltRunStatus("idle");
          } else {
            console.error("built robot program failed:", error);
            setBuiltRunStatus("error");
            setBuiltRunError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          builtProgramActiveRef.current = false;
          builtRunner.abort();
        });
      return;
    }
    if (!engine || !runner) return;
    if (tab === "Python") {
      // Run the Python file through the local sidecar (Phase 3).
      const bridge = bridgeRef.current;
      if (!bridge?.connected) {
        setPythonOutput([
          {
            stream: "stderr",
            text: "python sidecar is not running · start it with ./scripts/run-python-sidecar.sh\n",
          },
        ]);
        return;
      }
      if (programActiveRef.current) runner.abort();
      autopilotRef.current = false;
      runner.arm();
      pythonActiveRef.current = true;
      if (mode === "compete") competeActiveRef.current = true;
      setPythonOutput([]);
      setRunStatus("python");
      bridge.run(pythonSourceRef.current);
      return;
    }
    const code = jsCodeRef.current.trim();
    if (code.length === 0) {
      if (robot !== "car") return;
      // No blocks on the workspace: fall back to the Phase 1 cruise.
      engine.apply({ type: "drive", left: CRUISE_SPEED, right: CRUISE_SPEED });
      autopilotRef.current = true;
      if (mode === "compete") competeActiveRef.current = true;
      setRunStatus("cruise");
      return;
    }
    if (programActiveRef.current) runner.abort();
    autopilotRef.current = false;
    runner.arm();
    programActiveRef.current = true;
    if (mode === "compete") competeActiveRef.current = true;
    setRunStatus("program");
    runProgram(code, runner.api)
      .then(() => setRunStatus("idle"))
      .catch((error) => {
        if (error instanceof ProgramStoppedError) {
          setRunStatus("idle");
        } else {
          console.error("program failed:", error);
          setRunStatus("error");
        }
      })
      .finally(() => {
        programActiveRef.current = false;
        engine.apply({ type: "stop" });
        arm?.apply({ type: "stop" });
        drone?.apply({ type: "drone_stop" });
        if (mode === "compete") {
          competeActiveRef.current = false;
          setCompeteRun((previous) => (previous ? finishRun(previous, "program_ended") : previous));
        }
      });
  };

  const stop = () => {
    if (simulateBuilt) {
      if (builtPythonActiveRef.current) builtBridgeRef.current?.stop();
      builtRunner?.abort();
      return;
    }
    haltEverything();
    if (mode === "compete") setCompeteRun((previous) => (previous ? finishRun(previous, "stopped") : previous));
  };

  const reset = () => {
    if (simulateBuilt) {
      if (builtPythonActiveRef.current) builtBridgeRef.current?.stop();
      builtRunner?.abort();
      // No reset() call exists on EngineBuiltRobot (unlike engine/arm/drone)
      // -- a built robot's only way back to its start pose is a fresh
      // instance, so this re-identities `simulateBuilt` to retrigger its
      // own construction effect exactly like picking it fresh would.
      setSimulateBuilt((previous) => (previous ? { ...previous } : previous));
      return;
    }
    if (!engine || !runner) return;
    haltEverything();
    engine.apply({ type: "reset" });
    arm?.apply({ type: "reset" });
    drone?.apply({ type: "drone_reset" });
    if (mode === "compete" && competition) setCompeteRun(initRunState(competition));
  };

  const pickCompetition = (picked: CompetitionDef) => {
    switchRobot("car");
    applyWorld(picked.arena);
    setCompetition(picked);
    setCompeteRun(initRunState(picked));
    setCompeteDialogOpen(false);
  };

  const chooseAnotherCompetition = () => {
    haltEverything();
    setCompetition(null);
    setCompeteRun(null);
    setCompeteDialogOpen(true);
  };

  const pickBuiltRobot = (picked: RobotDef) => {
    haltEverything();
    setBuiltRobotDialogOpen(false);
    setSimulateBuilt({ robot: picked, world: null });
  };

  const chooseAnotherBuiltRobot = () => {
    haltEverything();
    setSimulateBuilt(null);
    setBuiltRobotDialogOpen(true);
  };

  // Desktop window title follows the open project.
  useEffect(() => {
    if (!inDesktop) return;
    const title = currentProject
      ? `${currentProject.name} · OKHUB Robotics Studio`
      : "OKHUB Robotics Studio";
    void getCurrentWindow().setTitle(title);
  }, [currentProject]);

  const showNotice = (text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4000);
  };

  const collectPayload = (): ProjectPayload => {
    const python = pythonRef.current?.get() ?? { code: "", edited: false };
    return {
      blocks: blocksRef.current?.save() ?? {},
      python: python.code,
      python_edited: python.edited,
      world: WORLD_ID,
      robot,
      world_custom: world,
      robot_def: robotDef,
    };
  };

  const applyPayload = (payload: ProjectPayload) => {
    blocksRef.current?.load((payload.blocks ?? null) as object | null);
    pythonRef.current?.load(payload.python, payload.python_edited);
  };

  /** Loads a project's world (custom or the pack default), resyncing the
   * World tab's draft form via worldEpoch. Project files are untrusted data
   * (see validateWorld's docstring), so a corrupted world_custom falls back
   * to the pack default instead of crashing the app. */
  const applyProjectWorld = (payload: ProjectPayload) => {
    haltEverything();
    try {
      setWorld(payload.world_custom ? validateWorld(payload.world_custom) : defaultWorld);
    } catch (error) {
      console.error("invalid world_custom, falling back to the pack default:", error);
      setWorld(defaultWorld);
    }
    setWorldEpoch((e) => e + 1);
  };

  /** Loads a project's robot-def (or clears it), same defensive posture as
   * applyProjectWorld: project files are untrusted data, so a corrupted
   * robot_def is discarded rather than crashing the app. */
  const applyProjectRobotDef = (payload: ProjectPayload) => {
    if (!payload.robot_def) {
      setRobotDef(null);
      return;
    }
    try {
      setRobotDef(parseRobotDef(payload.robot_def));
    } catch (error) {
      console.error("invalid robot_def, discarding:", error);
      setRobotDef(null);
    }
  };

  /** Rebuilds the sim from an edited world (World tab "Apply"/"reset to
   * default"); stop first, same as a robot switch, rather than let a running
   * program keep driving a wheel_base/pose that's about to change under it. */
  const applyWorld = (next: WorldDef) => {
    haltEverything();
    setWorld(next);
  };

  const haltEverything = () => {
    if (builtPythonActiveRef.current) builtBridgeRef.current?.stop();
    builtRunner?.abort();
    builtProgramActiveRef.current = false;
    setBuiltRunStatus("idle");
    if (!engine || !runner) return;
    if (pythonActiveRef.current) bridgeRef.current?.stop();
    runner.abort();
    autopilotRef.current = false;
    competeActiveRef.current = false;
    engine.apply({ type: "stop" });
    arm?.apply({ type: "stop" });
    drone?.apply({ type: "drone_stop" });
    setRunStatus("idle");
  };

  const switchRobot = (target: RobotKind) => {
    if (target === robot && !simulateBuilt) return;
    haltEverything();
    setSimulateBuilt(null);
    setHud(null);
    setRobot(target);
  };

  // "Try this" in a lesson: put the step's code in the Python editor, switch
  // robots if the lesson needs the other one, and show the editor. A robot
  // switch seeds the new PythonPanel instance via the pendingContent prop
  // (see its docstring for why not an imperative ref call).
  const tryLessonStep = (code: string, lessonRobot: RobotKind) => {
    if (lessonRobot !== robot) {
      setPendingContent({ robot: lessonRobot, python: code, pythonEdited: true });
      switchRobot(lessonRobot);
    } else {
      pythonRef.current?.load(code, true);
    }
    setTab("Python");
    showNotice("loaded lesson step · press Run");
  };

  const refreshProjects = async () => {
    try {
      setProjectList(await listProjects());
    } catch (error) {
      console.error("list projects failed:", error);
    }
  };

  const actionNew = () => {
    closeMenu();
    blocksRef.current?.load(null);
    pythonRef.current?.load("", false);
    setCurrentProject(null);
    setWorld(defaultWorld);
    setWorldEpoch((e) => e + 1);
    setRobotDef(null);
    reset();
    showNotice("new project");
  };

  const actionSave = async () => {
    closeMenu();
    if (!currentProject) {
      setDialog("save-as");
      return;
    }
    try {
      setCurrentProject(await saveProject(currentProject.id, collectPayload()));
      showNotice("saved");
    } catch (error) {
      showNotice(`save failed: ${String(error)}`);
    }
  };

  const submitSaveAs = async (name: string) => {
    try {
      setCurrentProject(await createProject(name, collectPayload()));
      setDialog("none");
      showNotice("saved");
    } catch (error) {
      showNotice(String(error));
    }
  };

  const openProjectById = async (id: string) => {
    closeMenu();
    setDialog("none");
    try {
      const [meta, payload] = await loadProject(id);
      applyProjectWorld(payload);
      applyProjectRobotDef(payload);
      const target: RobotKind =
        payload.robot === "arm" ? "arm" : payload.robot === "drone" ? "drone" : "car";
      if (target !== robot) {
        setPendingContent({
          robot: target,
          blocks: (payload.blocks ?? null) as object | null,
          python: payload.python,
          pythonEdited: payload.python_edited,
        });
        switchRobot(target);
      } else {
        applyPayload(payload);
      }
      setCurrentProject(meta);
      reset();
      showNotice(`opened ${meta.name}`);
    } catch (error) {
      showNotice(`open failed: ${String(error)}`);
    }
  };

  const removeProject = async (id: string) => {
    try {
      await deleteProject(id);
      if (currentProject?.id === id) setCurrentProject(null);
      await refreshProjects();
    } catch (error) {
      showNotice(`delete failed: ${String(error)}`);
    }
  };

  const closeMenu = () => setOpenMenu(null);
  const toggleMenu = (id: MenuId) => {
    const next = openMenu === id ? null : id;
    setOpenMenu(next);
    if (next === "file") void refreshProjects();
  };

  // Which Edit actions apply depends on which tab is showing: Blockly's
  // workspace (Blocks) has undo/redo/clean-up, Monaco (Python) has its own
  // undo/redo, and the rest (World/Lessons/C++) have nothing to edit — see
  // lib/editMenu.ts, tested in isolation.
  const editActions = editActionsForTab(tab);
  const doUndo = () => {
    closeMenu();
    if (tab === "Blocks") blocksRef.current?.undo();
    else if (tab === "Python") pythonRef.current?.undo();
  };
  const doRedo = () => {
    closeMenu();
    if (tab === "Blocks") blocksRef.current?.redo();
    else if (tab === "Python") pythonRef.current?.redo();
  };
  const doCleanUpBlocks = () => {
    closeMenu();
    blocksRef.current?.cleanUp();
  };

  // Ctrl+S saves in the desktop app.
  useEffect(() => {
    if (!inDesktop) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void actionSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Formatting lives in lib/statusText.ts, tested in isolation.
  const statusText =
    mode === "build"
      ? formatBuilderStatus(robotDef, robotDef ? validateRobotDef(robotDef) : [])
      : mode === "compete"
        ? competition
          ? formatStudioStatus({
              robotLabel: competition.name,
              engineStatus,
              hud,
              runStatus,
              pythonConnected,
              hardware,
              notice,
            })
          : "choose a competition"
        : simulateBuilt
          ? [
              `offline · ${simulateBuilt.robot.name}`,
              builtEngineStatus === "loading" ? "engine: loading…" : null,
              builtEngineStatus === "missing" ? "engine: not built · run scripts/build-engine-wasm.sh" : null,
              builtEngineStatus === "error" ? `engine error: ${builtEngineError}` : null,
              builtRunStatus === "running" ? "▶ running" : null,
              builtRunStatus === "error" ? `program error: ${builtRunError}` : null,
              builtPythonConnected ? "py ✓" : "py ✗",
              notice || null,
            ]
              .filter((part): part is string => Boolean(part))
              .join("  ·  ")
          : formatStudioStatus({
              robotLabel: robot === "arm" ? "Arm" : robot === "drone" ? "Drone" : world.name,
              engineStatus,
              hud,
              runStatus,
              pythonConnected,
              hardware,
              notice,
            });

  const runBarDisabled = Boolean(
    mode === "build" ||
      (mode === "compete" && (!competition || engineStatus !== "ready")) ||
      (mode === "simulate" && simulateBuilt && builtEngineStatus !== "ready") ||
      (mode === "simulate" && !simulateBuilt && engineStatus !== "ready"),
  );

  return (
    <div className={mode === "build" ? "studio mode-build" : "studio"}>
      <header className="titlebar">
        <span className="app-name">OKHUB Robotics Studio</span>
        <nav className="menus">
          <div className="menu-wrap">
            <button
              className="menu-item"
              disabled={!inDesktop}
              title={inDesktop ? undefined : "Available in the desktop app"}
              onClick={() => toggleMenu("file")}
            >
              File
            </button>
            {openMenu === "file" && (
              <div className="menu-dropdown" onMouseLeave={closeMenu}>
                <button onClick={actionNew}>New Project</button>
                <button
                  onClick={() => {
                    closeMenu();
                    void refreshProjects();
                    setDialog("open");
                  }}
                >
                  Open…
                </button>
                <button onClick={() => void actionSave()}>
                  Save <span className="shortcut">Ctrl+S</span>
                </button>
                <div className="menu-sep" />
                <button
                  onClick={() => {
                    closeMenu();
                    setDialog("store");
                  }}
                >
                  Asset Store…
                </button>
                {projectList.length > 0 && <div className="menu-sep" />}
                {projectList.slice(0, 5).map((p) => (
                  <button key={p.id} className="recent" onClick={() => void openProjectById(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="menu-wrap">
            <button
              className="menu-item"
              disabled={editActions.length === 0}
              title={editActions.length === 0 ? "Nothing to edit on this tab" : undefined}
              onClick={() => toggleMenu("edit")}
            >
              Edit
            </button>
            {openMenu === "edit" && (
              <div className="menu-dropdown" onMouseLeave={closeMenu}>
                {editActions.includes("undo") && (
                  <button onClick={doUndo}>
                    Undo <span className="shortcut">Ctrl+Z</span>
                  </button>
                )}
                {editActions.includes("redo") && (
                  <button onClick={doRedo}>
                    Redo <span className="shortcut">Ctrl+Y</span>
                  </button>
                )}
                {editActions.includes("cleanUp") && (
                  <button onClick={doCleanUpBlocks}>Clean Up Blocks</button>
                )}
              </div>
            )}
          </div>

          <div className="menu-wrap">
            <button className="menu-item" onClick={() => toggleMenu("robot")}>
              Robot
            </button>
            {openMenu === "robot" && (
              <div className="menu-dropdown" onMouseLeave={closeMenu}>
                {ROBOTS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      closeMenu();
                      switchRobot(r.id);
                    }}
                  >
                    <span>
                      {r.icon} {r.name}
                    </span>
                    {robot === r.id && <span className="shortcut">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="menu-wrap">
            <button className="menu-item" onClick={() => toggleMenu("simulation")}>
              Simulation
            </button>
            {openMenu === "simulation" && (
              <div className="menu-dropdown" onMouseLeave={closeMenu}>
                <button
                  disabled={engineStatus !== "ready"}
                  onClick={() => {
                    closeMenu();
                    run();
                  }}
                >
                  ▶ Run
                </button>
                <button
                  disabled={engineStatus !== "ready"}
                  onClick={() => {
                    closeMenu();
                    stop();
                  }}
                >
                  ⏹ Stop
                </button>
                <button
                  disabled={engineStatus !== "ready"}
                  onClick={() => {
                    closeMenu();
                    reset();
                  }}
                >
                  🔄 Reset
                </button>
              </div>
            )}
          </div>

          <div className="menu-wrap">
            <button className="menu-item" onClick={() => toggleMenu("help")}>
              Help
            </button>
            {openMenu === "help" && (
              <div className="menu-dropdown" onMouseLeave={closeMenu}>
                <button
                  onClick={() => {
                    closeMenu();
                    setDialog("about");
                  }}
                >
                  About OKHUB Robotics Studio
                </button>
              </div>
            )}
          </div>
        </nav>
        <div className="mode-toggle">
          <button
            className={mode === "simulate" ? "active" : ""}
            onClick={() => setMode("simulate")}
          >
            Simulate
          </button>
          <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}>
            Build
          </button>
          <button
            className={mode === "compete" ? "active" : ""}
            onClick={() => {
              setMode("compete");
              if (!competition) setCompeteDialogOpen(true);
            }}
          >
            Compete
          </button>
        </div>
        {inDesktop && (
          <span className="project-chip">{currentProject ? currentProject.name : "untitled"}</span>
        )}
      </header>

      {(mode === "simulate" || mode === "compete") && (
      <>
      <aside className="sidebar">
        {mode === "compete" ? (
          <>
            <h2>Competition</h2>
            {competition ? (
              <>
                <p className="compete-sidebar-note">{competition.name}</p>
                {competition.description && <p className="compete-sidebar-note">{competition.description}</p>}
                <button className="link-button" onClick={() => setCompeteDialogOpen(true)}>
                  Choose a different competition
                </button>
              </>
            ) : (
              <>
                <p className="compete-sidebar-note">No competition chosen yet.</p>
                <button className="link-button" onClick={() => setCompeteDialogOpen(true)}>
                  Choose a competition…
                </button>
              </>
            )}
          </>
        ) : simulateBuilt ? (
          <>
            <h2>Built robot</h2>
            <p className="compete-sidebar-note">{simulateBuilt.robot.name}</p>
            <button className="link-button" onClick={chooseAnotherBuiltRobot}>
              Choose a different robot
            </button>
            <button className="link-button" onClick={() => switchRobot("car")}>
              Back to Car/Arm/Drone
            </button>
          </>
        ) : (
          <>
        <h2>Robots</h2>
        <ul>
          {ROBOTS.map((r) => (
            <li key={r.name}>
              <button
                className={robot === r.id ? "robot selectable active" : "robot selectable"}
                onClick={() => switchRobot(r.id)}
              >
                <span className="robot-icon">{r.icon}</span>
                <span>{r.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button className="robot selectable" onClick={() => setBuiltRobotDialogOpen(true)}>
              <span className="robot-icon">🔧</span>
              <span>Built robot…</span>
            </button>
          </li>
        </ul>
        <div className="teleop-hint">
          <h2>Drive</h2>
          <p>
            {robot === "car"
              ? "Arrow keys or WASD steer the car any time. Run executes your blocks."
              : "Run executes your blocks; the arm moves joint by joint."}
          </p>
        </div>

        {robot === "car" && engine && <CameraView engine={engine} />}

        <div className="hardware-panel">
          <h2>Hardware</h2>
          {!pythonConnected ? (
            <p className="hardware-note">
              Start the Python sidecar to use a real robot.
            </p>
          ) : hardware.connected ? (
            <>
              <p className="hardware-note connected">
                ✓ {hardware.identity ?? "robot"}
                <br />
                {hardware.port}
              </p>
              <button
                className="hardware-button"
                onClick={() => bridgeRef.current?.disconnectHardware()}
              >
                Disconnect
              </button>
              <p className="hardware-note">Run now drives the real robot.</p>
              <button
                className="link-button"
                disabled={flashing}
                title="Compile firmware/okrobo_car with arduino-cli and upload it"
                onClick={() => hardware.port && bridgeRef.current?.flashFirmware(hardware.port)}
              >
                ⚡ Flash new firmware
              </button>
              <FlashStatusNote flash={flash} />
            </>
          ) : (
            <>
              {ports.length === 0 ? (
                <p className="hardware-note">No robot found. Plug one in and refresh.</p>
              ) : (
                <ul className="port-list">
                  {ports.map((port) => (
                    <li key={port.device} className="port-row">
                      <button
                        className="hardware-button"
                        title={port.description || port.hwid}
                        onClick={() => bridgeRef.current?.connectHardware(port.device)}
                      >
                        {port.device.replace("/dev/", "")}
                      </button>
                      <button
                        className="flash-button"
                        disabled={flashing}
                        title="Compile firmware/okrobo_car with arduino-cli and upload it"
                        onClick={() => bridgeRef.current?.flashFirmware(port.device)}
                      >
                        ⚡
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="link-button"
                onClick={() => bridgeRef.current?.listPorts()}
              >
                ↻ Refresh ports
              </button>
              <FlashStatusNote flash={flash} />
            </>
          )}
        </div>
          </>
        )}
      </aside>

      <main className="viewport">
        {simulateBuilt ? (
          builtEngineStatus === "ready" && builtEngine && builtRunner ? (
            <TestViewport
              robot={simulateBuilt.robot}
              builtRobot={builtEngine}
              world={simulateBuilt.world ?? undefined}
              runner={builtRunner}
            />
          ) : (
            <div className="viewport-note">
              {builtEngineStatus === "loading" && "Loading physics engine…"}
              {builtEngineStatus === "missing" &&
                "Engine not built: run ./scripts/build-engine-wasm.sh, then reload"}
              {builtEngineStatus === "error" && `Couldn't simulate this robot: ${builtEngineError}`}
            </div>
          )
        ) : engine && arm && drone && runner ? (
          <Viewport3D
            key={robot}
            robot={robot}
            engine={engine}
            arm={arm}
            drone={drone}
            world={world}
            runner={runner}
            autopilotRef={autopilotRef}
            onState={onState}
            onAutoStop={onAutoStop}
            onEngineStep={mode === "compete" ? onEngineStep : undefined}
          />
        ) : (
          <>
            <Viewport />
            <div className="viewport-note">
              {engineStatus === "loading"
                ? "Loading engine…"
                : "Engine not built: run ./scripts/build-engine-wasm.sh, then reload"}
            </div>
          </>
        )}
        {mode === "compete" && competition && competeRun && !competeRun.finished && (
          <CompeteHud competition={competition} run={competeRun} />
        )}
        {mode === "compete" && competition && competeRun && competeRun.finished && (
          <CompeteReport
            competition={competition}
            run={competeRun}
            onRunAgain={reset}
            onChooseAnother={chooseAnotherCompetition}
          />
        )}
      </main>

      <section className="code-panel">
        <div className="code-tabs">
          {CODE_TABS.map((t) => (
            <button
              key={t}
              className={t === tab ? "code-tab active" : "code-tab"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="code-content">
          <div className={tab === "Blocks" ? "tab-panel active" : "tab-panel"}>
            <BlocksPanel
              key={simulateBuilt ? "built" : robot}
              robot={simulateBuilt ? "built" : robot}
              onCode={onCode}
              ref={blocksRef}
              initialWorkspace={pendingForRobot?.blocks}
              onWorkspaceConsumed={clearPendingContent}
            />
          </div>
          <div className={tab === "Python" ? "tab-panel active" : "tab-panel"}>
            <PythonPanel
              key={simulateBuilt ? "built" : robot}
              generatedCode={pythonCode}
              output={simulateBuilt ? builtPythonOutput : pythonOutput}
              connected={simulateBuilt ? builtPythonConnected : pythonConnected}
              onSource={onPythonSource}
              ref={pythonRef}
              initialOverride={
                pendingForRobot?.python !== undefined
                  ? { code: pendingForRobot.python, edited: pendingForRobot.pythonEdited }
                  : undefined
              }
              onOverrideConsumed={clearPendingContent}
            />
          </div>
          <div className={tab === "World" ? "tab-panel active padded" : "tab-panel padded"}>
            {simulateBuilt ? (
              <label className="builder-world-picker">
                World
                <select
                  value={builtWorldOptionId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setBuiltWorldOptionId(id);
                    const option = WORLD_OPTIONS.find((o) => o.id === id);
                    setSimulateBuilt((previous) =>
                      previous ? { ...previous, world: option ? option.make() : null } : previous,
                    );
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
            ) : robot === "car" || robot === "drone" ? (
              <WorldPanel key={worldEpoch} world={world} defaultWorld={defaultWorld} onApply={applyWorld} />
            ) : (
              <p className="placeholder-note">
                World editing applies to the shared arena the Car and Drone fly in; the Arm has no floor
                objects.
              </p>
            )}
          </div>
          <div className={tab === "Lessons" ? "tab-panel active scrolls" : "tab-panel scrolls"}>
            <LessonsPanel onTryStep={tryLessonStep} />
          </div>
          <div className={tab === "C++" ? "tab-panel active padded" : "tab-panel padded"}>
            <pre className="cpp-preview">{cppCode}</pre>
            <p className="placeholder-note">
              {simulateBuilt
                ? "Illustrative preview only -- there is no real C++ SDK for a built robot yet (a fixed compiled header can't represent per-student actuator/sensor ids)."
                : `Real, compilable C++ against engine/api/${robot}.hpp — not runnable here (no browser has a C++ compiler), but yours to take and build: see engine/api/README.md.`}
            </p>
          </div>
        </div>
      </section>
      </>
      )}

      {mode === "build" &&
        (robotDef ? (
          <BuilderPanel robot={robotDef} onChange={setRobotDef} />
        ) : (
          <div className="builder-stage builder-empty">
            <p>No robot in this project yet.</p>
            <button
              type="button"
              className="builder-new-robot"
              onClick={() => setDialog("new-robot")}
            >
              + New Robot
            </button>
          </div>
        ))}

      <footer className="run-bar">
        <button className="run" onClick={run} disabled={runBarDisabled}>
          ▶ Run
        </button>
        <button onClick={stop} disabled={runBarDisabled}>
          ⏹ Stop
        </button>
        <button onClick={reset} disabled={runBarDisabled}>
          🔄 Reset
        </button>
        <span className="status">{statusText}</span>
      </footer>

      {dialog === "save-as" && (
        <NameDialog
          title="Save project as"
          onSubmit={(name) => void submitSaveAs(name)}
          onCancel={() => setDialog("none")}
        />
      )}
      {dialog === "store" && <AssetStore onClose={() => setDialog("none")} />}
      {dialog === "open" && (
        <OpenDialog
          projects={projectList}
          onOpen={(id) => void openProjectById(id)}
          onDelete={(id) => void removeProject(id)}
          onCancel={() => setDialog("none")}
        />
      )}
      {dialog === "about" && <AboutDialog version={pkg.version} onClose={() => setDialog("none")} />}
      {dialog === "new-robot" && (
        <TemplateDialog
          onPick={(picked) => {
            setRobotDef(picked);
            setDialog("none");
          }}
          onCancel={() => setDialog("none")}
        />
      )}
      {competeDialogOpen && (
        <CompetitionDialog
          onPick={pickCompetition}
          onCancel={() => setCompeteDialogOpen(false)}
        />
      )}
      {builtRobotDialogOpen && (
        <BuiltRobotDialog
          currentRobotDef={robotDef}
          currentIssues={builtRobotIssues}
          onPick={pickBuiltRobot}
          onCancel={() => setBuiltRobotDialogOpen(false)}
        />
      )}
    </div>
  );
}

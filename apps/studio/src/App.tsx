import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import arenaJson from "@packs/core/worlds/arena.json";
import pkg from "../package.json";
import { AboutDialog, NameDialog, OpenDialog } from "./dialogs";
import { AssetStore } from "./AssetStore";
import { CameraView } from "./CameraView";
import type { RobotKind } from "./blocks/okroboBlocks";
import { BlocksPanel, type BlocksPanelHandle } from "./BlocksPanel";
import { EngineArm } from "./engine/EngineArm";
import { EngineDrone } from "./engine/EngineDrone";
import { EngineWorld } from "./engine/EngineWorld";
import { loadEngine } from "./engine/loader";
import { LessonsPanel } from "./LessonsPanel";
import { editActionsForTab } from "./lib/editMenu";
import { formatStudioStatus } from "./lib/statusText";
import { isTeleopKey, normalizeKey, teleopWheels } from "./lib/teleop";
import { validateWorld, type WorldDef } from "./lib/validateWorld";
import { runProgram } from "./program/execute";
import { ProgramRunner, ProgramStoppedError } from "./program/ProgramRunner";
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

type EngineStatus = "loading" | "ready" | "missing";
type RunStatus = "idle" | "cruise" | "wall" | "program" | "python" | "error";
type Dialog = "none" | "save-as" | "open" | "store" | "about";

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
  const [hud, setHud] = useState<HudInfo | null>(null);
  const autopilotRef = useRef(false);
  const programActiveRef = useRef(false);
  const pythonActiveRef = useRef(false);
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
  const pendingForRobot = pendingContent?.robot === robot ? pendingContent : null;
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
      onStarted: () => {},
      onOutput: (stream, text) => appendOutput({ stream, text }),
      onDone: (exitCode) => {
        pythonActiveRef.current = false;
        engine.apply({ type: "stop" });
        setRunStatus("idle");
        if (exitCode !== 0) {
          appendOutput({ stream: "stderr", text: `--- exited with code ${exitCode} ---\n` });
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
  const onCode = useCallback((js: string, python: string, cpp: string) => {
    jsCodeRef.current = js;
    setPythonCode(python);
    setCppCode(cpp);
  }, []);
  const onPythonSource = useCallback((code: string) => {
    pythonSourceRef.current = code;
  }, []);

  const run = () => {
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
      setRunStatus("cruise");
      return;
    }
    if (programActiveRef.current) runner.abort();
    autopilotRef.current = false;
    runner.arm();
    programActiveRef.current = true;
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
      });
  };

  const stop = () => {
    haltEverything();
  };

  const reset = () => {
    if (!engine || !runner) return;
    haltEverything();
    engine.apply({ type: "reset" });
    arm?.apply({ type: "reset" });
    drone?.apply({ type: "drone_reset" });
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

  /** Rebuilds the sim from an edited world (World tab "Apply"/"reset to
   * default"); stop first, same as a robot switch, rather than let a running
   * program keep driving a wheel_base/pose that's about to change under it. */
  const applyWorld = (next: WorldDef) => {
    haltEverything();
    setWorld(next);
  };

  const haltEverything = () => {
    if (!engine || !runner) return;
    if (pythonActiveRef.current) bridgeRef.current?.stop();
    runner.abort();
    autopilotRef.current = false;
    engine.apply({ type: "stop" });
    arm?.apply({ type: "stop" });
    drone?.apply({ type: "drone_stop" });
    setRunStatus("idle");
  };

  const switchRobot = (target: RobotKind) => {
    if (target === robot) return;
    haltEverything();
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
  const statusText = formatStudioStatus({
    robotLabel: robot === "arm" ? "Arm" : robot === "drone" ? "Drone" : world.name,
    engineStatus,
    hud,
    runStatus,
    pythonConnected,
    hardware,
    notice,
  });

  return (
    <div className="studio">
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
        {inDesktop && (
          <span className="project-chip">{currentProject ? currentProject.name : "untitled"}</span>
        )}
      </header>

      <aside className="sidebar">
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
            </>
          ) : (
            <>
              {ports.length === 0 ? (
                <p className="hardware-note">No robot found. Plug one in and refresh.</p>
              ) : (
                <ul className="port-list">
                  {ports.map((port) => (
                    <li key={port.device}>
                      <button
                        className="hardware-button"
                        title={port.description || port.hwid}
                        onClick={() => bridgeRef.current?.connectHardware(port.device)}
                      >
                        {port.device.replace("/dev/", "")}
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
            </>
          )}
        </div>
      </aside>

      <main className="viewport">
        {engine && arm && drone && runner ? (
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
              key={robot}
              robot={robot}
              onCode={onCode}
              ref={blocksRef}
              initialWorkspace={pendingForRobot?.blocks}
              onWorkspaceConsumed={clearPendingContent}
            />
          </div>
          <div className={tab === "Python" ? "tab-panel active" : "tab-panel"}>
            <PythonPanel
              key={robot}
              generatedCode={pythonCode}
              output={pythonOutput}
              connected={pythonConnected}
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
            {robot === "car" || robot === "drone" ? (
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
            {robot === "car" ? (
              <>
                <pre className="cpp-preview">{cppCode}</pre>
                <p className="placeholder-note">
                  Real, compilable C++ against engine/api/robot.hpp — not runnable here (no
                  browser has a C++ compiler), but yours to take and build: see
                  engine/api/README.md.
                </p>
              </>
            ) : (
              <p className="placeholder-note">
                The C++ track covers the Car so far; {robot === "arm" ? "the Arm" : "the Drone"}{" "}
                doesn't have a C++ SDK yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="run-bar">
        <button className="run" onClick={run} disabled={engineStatus !== "ready"}>
          ▶ Run
        </button>
        <button onClick={stop} disabled={engineStatus !== "ready"}>
          ⏹ Stop
        </button>
        <button onClick={reset} disabled={engineStatus !== "ready"}>
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
    </div>
  );
}

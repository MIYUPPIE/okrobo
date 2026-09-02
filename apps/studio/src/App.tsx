import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import arenaJson from "@packs/core/worlds/arena.json";
import type { RobotKind } from "./blocks/okroboBlocks";
import { BlocksPanel, type BlocksPanelHandle } from "./BlocksPanel";
import { EngineArm } from "./engine/EngineArm";
import { EngineWorld } from "./engine/EngineWorld";
import { loadEngine } from "./engine/loader";
import { validateWorld } from "./lib/validateWorld";
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
import { PythonBridge, SIDECAR_URL } from "./python/PythonBridge";
import { type OutputLine, PythonPanel, type PythonPanelHandle } from "./PythonPanel";
import { Viewport } from "./Viewport";
import { CRUISE_SPEED, type HudInfo, Viewport3D } from "./Viewport3D";
import "./App.css";

const OTHER_MENUS = ["Edit", "Robot", "Simulation", "Help"];
const WORLD_ID = "arena";

const ROBOTS: Array<{ id: RobotKind | null; icon: string; name: string; phase?: string }> = [
  { id: "car", icon: "🚗", name: "Car" },
  { id: "arm", icon: "🦾", name: "Arm" },
  { id: null, icon: "🛸", name: "Drone", phase: "Phase 6+" },
];


const CODE_TABS = ["Blocks", "Python", "C++"] as const;
type CodeTab = (typeof CODE_TABS)[number];

const TELEOP_SPEED = CRUISE_SPEED;
const TELEOP_TURN = 0.06;

type EngineStatus = "loading" | "ready" | "missing";
type RunStatus = "idle" | "cruise" | "wall" | "program" | "python" | "error";
type Dialog = "none" | "save-as" | "open";

export default function App() {
  const [tab, setTab] = useState<CodeTab>("Blocks");
  const [robot, setRobot] = useState<RobotKind>("car");
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engine, setEngine] = useState<EngineWorld | null>(null);
  const [arm, setArm] = useState<EngineArm | null>(null);
  const [runner, setRunner] = useState<ProgramRunner | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [pythonCode, setPythonCode] = useState("");
  const [pythonConnected, setPythonConnected] = useState(false);
  const [pythonOutput, setPythonOutput] = useState<OutputLine[]>([]);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const autopilotRef = useRef(false);
  const programActiveRef = useRef(false);
  const pythonActiveRef = useRef(false);
  const jsCodeRef = useRef("");
  const pythonSourceRef = useRef("");
  const bridgeRef = useRef<PythonBridge | null>(null);

  const [currentProject, setCurrentProject] = useState<ProjectMeta | null>(null);
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [notice, setNotice] = useState("");
  const blocksRef = useRef<BlocksPanelHandle>(null);
  const pythonRef = useRef<PythonPanelHandle>(null);
  const pendingPayloadRef = useRef<ProjectPayload | null>(null);
  const noticeTimer = useRef(0);

  const world = useMemo(() => validateWorld(arenaJson), []);

  useEffect(() => {
    let cancelled = false;
    let created: EngineWorld | null = null;
    let createdArm: EngineArm | null = null;
    loadEngine()
      .then((module) => {
        if (cancelled) return;
        created = new EngineWorld(module, world);
        createdArm = new EngineArm(module);
        setEngine(created);
        setArm(createdArm);
        setRunner(new ProgramRunner(created, world.wheel_base, createdArm));
        setEngineStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setEngineStatus("missing");
      });
    return () => {
      cancelled = true;
      created?.destroy();
      createdArm?.destroy();
      setEngine(null);
      setArm(null);
      setRunner(null);
    };
  }, [world]);

  // Python sidecar bridge: robot calls from real local Python execute here.
  useEffect(() => {
    if (!engine || !runner) return;
    const appendOutput = (line: OutputLine) =>
      setPythonOutput((previous) => [...previous.slice(-499), line]);
    const bridge = new PythonBridge(SIDECAR_URL, runner.api, {
      onStatus: setPythonConnected,
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
  useEffect(() => {
    if (!engine || !runner || robot !== "car") return;
    const held = new Set<string>();
    const keyFor = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

    const applyWheels = () => {
      let left = 0;
      let right = 0;
      if (held.has("ArrowUp") || held.has("w")) [left, right] = [left + TELEOP_SPEED, right + TELEOP_SPEED];
      if (held.has("ArrowDown") || held.has("s")) [left, right] = [left - TELEOP_SPEED, right - TELEOP_SPEED];
      if (held.has("ArrowLeft") || held.has("a")) [left, right] = [left - TELEOP_TURN, right + TELEOP_TURN];
      if (held.has("ArrowRight") || held.has("d")) [left, right] = [left + TELEOP_TURN, right - TELEOP_TURN];
      engine.apply(left === 0 && right === 0 ? { type: "stop" } : { type: "drive", left, right });
    };

    const relevant = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"]);
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea)$/i.test(target.tagName))) return;
      const key = keyFor(e);
      if (!relevant.has(key)) return;
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
      const key = keyFor(e);
      if (!relevant.has(key)) return;
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
  const onCode = useCallback((js: string, python: string) => {
    jsCodeRef.current = js;
    setPythonCode(python);
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
    };
  };

  const applyPayload = (payload: ProjectPayload) => {
    blocksRef.current?.load((payload.blocks ?? null) as object | null);
    pythonRef.current?.load(payload.python, payload.python_edited);
  };

  const haltEverything = () => {
    if (!engine || !runner) return;
    if (pythonActiveRef.current) bridgeRef.current?.stop();
    runner.abort();
    autopilotRef.current = false;
    engine.apply({ type: "stop" });
    arm?.apply({ type: "stop" });
    setRunStatus("idle");
  };

  const switchRobot = (target: RobotKind) => {
    if (target === robot) return;
    haltEverything();
    setHud(null);
    setRobot(target);
  };

  // A project load that switches robots applies its content after the
  // panels remount for the new robot.
  useEffect(() => {
    const pending = pendingPayloadRef.current;
    if (pending) {
      pendingPayloadRef.current = null;
      applyPayload(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot]);

  const refreshProjects = async () => {
    try {
      setProjectList(await listProjects());
    } catch (error) {
      console.error("list projects failed:", error);
    }
  };

  const actionNew = () => {
    setFileMenuOpen(false);
    blocksRef.current?.load(null);
    pythonRef.current?.load("", false);
    setCurrentProject(null);
    reset();
    showNotice("new project");
  };

  const actionSave = async () => {
    setFileMenuOpen(false);
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
    setFileMenuOpen(false);
    setDialog("none");
    try {
      const [meta, payload] = await loadProject(id);
      const target: RobotKind = payload.robot === "arm" ? "arm" : "car";
      if (target !== robot) {
        pendingPayloadRef.current = payload;
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

  const statusText = (() => {
    const parts = [`offline · ${robot === "arm" ? "Arm" : world.name}`];
    if (engineStatus === "loading") parts.push("engine: loading…");
    if (engineStatus === "missing") parts.push("engine: not built · run scripts/build-engine-wasm.sh");
    if (engineStatus === "ready" && hud) {
      if (hud.kind === "car") {
        parts.push(
          `tick ${hud.state.tick}`,
          `x ${hud.state.pose.x.toFixed(2)} y ${hud.state.pose.y.toFixed(2)}`,
          `d ${hud.state.sensors.distance.toFixed(2)} m`,
        );
      } else {
        const degrees = hud.state.joints.angles
          .map((a) => `${Math.round((a * 180) / Math.PI)}°`)
          .join(" ");
        parts.push(
          `tick ${hud.state.tick}`,
          `joints ${degrees}`,
          `tip z ${hud.state.tip.z.toFixed(2)} m`,
        );
        if (hud.state.moving) parts.push("moving");
      }
      if (runStatus === "program") parts.push("▶ blocks running");
      if (runStatus === "python") parts.push("▶ python running");
      if (runStatus === "cruise") parts.push("cruising");
      if (runStatus === "wall") parts.push("stopped at wall");
      if (runStatus === "error") parts.push("program error (see console)");
      if (hud.kind === "car" && hud.state.collided) parts.push("⚠ wall contact");
      parts.push(pythonConnected ? "py ✓" : "py ✗");
    }
    if (notice) parts.push(notice);
    return parts.join("  ·  ");
  })();

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
              onClick={() => {
                const next = !fileMenuOpen;
                setFileMenuOpen(next);
                if (next) void refreshProjects();
              }}
            >
              File
            </button>
            {fileMenuOpen && (
              <div className="menu-dropdown" onMouseLeave={() => setFileMenuOpen(false)}>
                <button onClick={actionNew}>New Project</button>
                <button
                  onClick={() => {
                    setFileMenuOpen(false);
                    void refreshProjects();
                    setDialog("open");
                  }}
                >
                  Open…
                </button>
                <button onClick={() => void actionSave()}>
                  Save <span className="shortcut">Ctrl+S</span>
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
          {OTHER_MENUS.map((m) => (
            <button key={m} className="menu-item" disabled title="Later phases">
              {m}
            </button>
          ))}
        </nav>
        {inDesktop && (
          <span className="project-chip">{currentProject ? currentProject.name : "untitled"}</span>
        )}
      </header>

      <aside className="sidebar">
        <h2>Robots</h2>
        <ul>
          {ROBOTS.map((r) =>
            r.id ? (
              <li key={r.name}>
                <button
                  className={robot === r.id ? "robot selectable active" : "robot selectable"}
                  onClick={() => switchRobot(r.id as RobotKind)}
                >
                  <span className="robot-icon">{r.icon}</span>
                  <span>{r.name}</span>
                </button>
              </li>
            ) : (
              <li key={r.name} className="robot">
                <span className="robot-icon">{r.icon}</span>
                <span>{r.name}</span>
                <span className="badge">{r.phase}</span>
              </li>
            ),
          )}
        </ul>
        <div className="teleop-hint">
          <h2>Drive</h2>
          <p>
            {robot === "car"
              ? "Arrow keys or WASD steer the car any time. Run executes your blocks."
              : "Run executes your blocks; the arm moves joint by joint."}
          </p>
        </div>
      </aside>

      <main className="viewport">
        {engine && arm && runner ? (
          <Viewport3D
            key={robot}
            robot={robot}
            engine={engine}
            arm={arm}
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
            <BlocksPanel key={robot} robot={robot} onCode={onCode} ref={blocksRef} />
          </div>
          <div className={tab === "Python" ? "tab-panel active" : "tab-panel"}>
            <PythonPanel
              key={robot}
              generatedCode={pythonCode}
              output={pythonOutput}
              connected={pythonConnected}
              onSource={onPythonSource}
              ref={pythonRef}
            />
          </div>
          <div className={tab === "C++" ? "tab-panel active padded" : "tab-panel padded"}>
            <pre className="cpp-placeholder">{`// Advanced track: extend the engine itself.\n// See engine/src/world.hpp`}</pre>
            <p className="placeholder-note">C++ track opens after Phase 6</p>
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
      {dialog === "open" && (
        <OpenDialog
          projects={projectList}
          onOpen={(id) => void openProjectById(id)}
          onDelete={(id) => void removeProject(id)}
          onCancel={() => setDialog("none")}
        />
      )}
    </div>
  );
}

function NameDialog({
  title,
  onSubmit,
  onCancel,
}: {
  title: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <h3>{title}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
        />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function OpenDialog({
  projects,
  onOpen,
  onDelete,
  onCancel,
}: {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Open project</h3>
        {projects.length === 0 && <p className="dialog-empty">No saved projects yet.</p>}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="project-row" onClick={() => onOpen(p.id)}>
                <span className="project-name">{p.name}</span>
                <span className="project-date">
                  {new Date(p.updated_at * 1000).toLocaleString()}
                </span>
              </button>
              {confirmingDelete === p.id ? (
                <button className="delete-btn confirm" onClick={() => onDelete(p.id)}>
                  delete?
                </button>
              ) : (
                <button
                  className="delete-btn"
                  title="Delete project"
                  onClick={() => setConfirmingDelete(p.id)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button onClick={onCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}

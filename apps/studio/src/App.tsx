import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import arenaJson from "@packs/core/worlds/arena.json";
import type { State } from "./contracts/robotApi";
import { EngineWorld } from "./engine/EngineWorld";
import { loadEngine } from "./engine/loader";
import { validateWorld } from "./lib/validateWorld";
import { Viewport } from "./Viewport";
import { CRUISE_SPEED, Viewport3D } from "./Viewport3D";
import "./App.css";

const MENUS = ["File", "Edit", "Robot", "Simulation", "Help"];

const ROBOTS = [
  { icon: "🚗", name: "Car", available: true },
  { icon: "🦾", name: "Arm", available: false, phase: "Phase 5" },
  { icon: "🛸", name: "Drone", available: false, phase: "Phase 5" },
];

const CODE_TABS = ["Blocks", "Python", "C++"] as const;
type CodeTab = (typeof CODE_TABS)[number];

const PYTHON_SNIPPET = `from okrobo import Robot

robot = Robot()

while True:
    robot.forward(0.05)
    if robot.distance() < 0.2:
        robot.turn_left()
`;

const TELEOP_SPEED = CRUISE_SPEED;
const TELEOP_TURN = 0.06;

type EngineStatus = "loading" | "ready" | "missing";
type RunStatus = "idle" | "running" | "wall";

export default function App() {
  const [tab, setTab] = useState<CodeTab>("Blocks");
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("loading");
  const [engine, setEngine] = useState<EngineWorld | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [hud, setHud] = useState<State | null>(null);
  const autopilotRef = useRef(false);

  const world = useMemo(() => validateWorld(arenaJson), []);

  useEffect(() => {
    let cancelled = false;
    let created: EngineWorld | null = null;
    loadEngine()
      .then((module) => {
        if (cancelled) return;
        created = new EngineWorld(module, world);
        setEngine(created);
        setEngineStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setEngineStatus("missing");
      });
    return () => {
      cancelled = true;
      created?.destroy();
      setEngine(null);
    };
  }, [world]);

  // Keyboard teleop: arrows / WASD drive the wheels directly.
  useEffect(() => {
    if (!engine) return;
    const held = new Set<string>();
    const keyFor = (e: KeyboardEvent) => e.key.length === 1 ? e.key.toLowerCase() : e.key;

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
      const key = keyFor(e);
      if (!relevant.has(key)) return;
      e.preventDefault();
      held.add(key);
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
  }, [engine]);

  const onState = useCallback((state: State) => setHud(state), []);
  const onAutoStop = useCallback(() => {
    autopilotRef.current = false;
    setRunStatus("wall");
  }, []);

  const run = () => {
    if (!engine) return;
    engine.apply({ type: "drive", left: CRUISE_SPEED, right: CRUISE_SPEED });
    autopilotRef.current = true;
    setRunStatus("running");
  };
  const stop = () => {
    if (!engine) return;
    engine.apply({ type: "stop" });
    autopilotRef.current = false;
    setRunStatus("idle");
  };
  const reset = () => {
    if (!engine) return;
    engine.apply({ type: "reset" });
    autopilotRef.current = false;
    setRunStatus("idle");
  };

  const statusText = (() => {
    const parts = [`offline · ${world.name}`];
    if (engineStatus === "loading") parts.push("engine: loading…");
    if (engineStatus === "missing") parts.push("engine: not built · run scripts/build-engine-wasm.sh");
    if (engineStatus === "ready" && hud) {
      parts.push(
        `tick ${hud.tick}`,
        `x ${hud.pose.x.toFixed(2)} y ${hud.pose.y.toFixed(2)}`,
        `d ${hud.sensors.distance.toFixed(2)} m`,
      );
      if (runStatus === "wall") parts.push("stopped at wall");
      if (hud.collided) parts.push("⚠ wall contact");
    }
    return parts.join("  ·  ");
  })();

  return (
    <div className="studio">
      <header className="titlebar">
        <span className="app-name">OKHUB Robotics Studio</span>
        <nav className="menus">
          {MENUS.map((m) => (
            <button key={m} className="menu-item" disabled title="Phase 4: desktop shell">
              {m}
            </button>
          ))}
        </nav>
      </header>

      <aside className="sidebar">
        <h2>Robots</h2>
        <ul>
          {ROBOTS.map((r) => (
            <li key={r.name} className={r.available ? "robot available" : "robot"}>
              <span className="robot-icon">{r.icon}</span>
              <span>{r.name}</span>
              {!r.available && <span className="badge">{r.phase}</span>}
            </li>
          ))}
        </ul>
        <div className="teleop-hint">
          <h2>Drive</h2>
          <p>Arrow keys or WASD steer the robot any time.</p>
        </div>
      </aside>

      <main className="viewport">
        {engine ? (
          <Viewport3D
            engine={engine}
            world={world}
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
          {tab === "Blocks" && (
            <div className="blocks-placeholder">
              <span className="block block-start">WHEN START</span>
              <span className="block-arrow">→</span>
              <span className="block block-move">MOVE FORWARD</span>
              <span className="block-arrow">→</span>
              <span className="block block-if">IF DISTANCE &lt; 0.2 → TURN LEFT</span>
              <p className="placeholder-note">Blockly lands here in Phase 2</p>
            </div>
          )}
          {tab === "Python" && (
            <div className="editor-placeholder">
              <pre>{PYTHON_SNIPPET}</pre>
              <p className="placeholder-note">
                Monaco lands here in Phase 2; this exact code already runs today via{" "}
                <code>python3 -m okrobo.demo</code>
              </p>
            </div>
          )}
          {tab === "C++" && (
            <div className="editor-placeholder">
              <pre>{`// Advanced track: extend the engine itself.\n// See engine/src/world.hpp`}</pre>
              <p className="placeholder-note">C++ track opens after Phase 5</p>
            </div>
          )}
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
    </div>
  );
}

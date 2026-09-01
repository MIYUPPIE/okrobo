import { useState } from "react";
import { Viewport } from "./Viewport";
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

export default function App() {
  const [tab, setTab] = useState<CodeTab>("Blocks");

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
      </aside>

      <main className="viewport">
        <Viewport />
        <div className="viewport-note">Live simulation arrives in Phase 1 (engine → WASM)</div>
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
        <button className="run" disabled title="Enabled in Phase 1">
          ▶ Run
        </button>
        <button disabled title="Enabled in Phase 1">
          ⏹ Stop
        </button>
        <button disabled title="Enabled in Phase 1">
          🔄 Reset
        </button>
        <span className="status">offline · engine: not loaded (Phase 1)</span>
      </footer>
    </div>
  );
}

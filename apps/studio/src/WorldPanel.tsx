import { useMemo, useState } from "react";
import { MAX_OBSTACLES, type ObstacleDef, validateWorld, type WorldDef } from "./lib/validateWorld";

// The World tab: lets a student add, move, resize, recolor and delete the
// coloured boxes in the arena, and edit the arena size and robot start pose.
// contracts/world/v1 is the on-the-wire shape; this form works in a friendlier
// draft shape (strings, so a half-typed "1." or "-" doesn't get clobbered by a
// parse, and degrees for heading, matching the student-facing API convention
// of degrees at the surface / radians internally).
//
// Nothing reaches the live simulation until "Apply changes": obstacles and
// arena size flow into a full engine rebuild (see App.tsx's world-keyed
// effect), which also resets the 3D camera framing, so applying on every
// keystroke would make the viewport jump while typing a number.

interface ObstacleDraft {
  x: string;
  y: string;
  width: string;
  height: string;
  color: string;
  label: string;
}

interface Draft {
  arena_width: string;
  arena_height: string;
  start_x: string;
  start_y: string;
  start_theta_deg: string;
  obstacles: ObstacleDraft[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
}

function obstacleToDraft(o: ObstacleDef): ObstacleDraft {
  return {
    x: String(o.x),
    y: String(o.y),
    width: String(o.width),
    height: String(o.height),
    color: rgbToHex(o.color),
    label: o.label ?? "",
  };
}

function toDraft(world: WorldDef): Draft {
  return {
    arena_width: String(world.arena_width),
    arena_height: String(world.arena_height),
    start_x: String(world.start.x),
    start_y: String(world.start.y),
    start_theta_deg: String(round2((world.start.theta * 180) / Math.PI)),
    obstacles: world.obstacles.map(obstacleToDraft),
  };
}

const num = (s: string) => Number.parseFloat(s);

/** Builds a candidate world object from the draft; validateWorld checks it. */
function buildCandidate(base: WorldDef, draft: Draft): unknown {
  return {
    ...base,
    arena_width: num(draft.arena_width),
    arena_height: num(draft.arena_height),
    start: {
      x: num(draft.start_x),
      y: num(draft.start_y),
      theta: (num(draft.start_theta_deg) * Math.PI) / 180,
    },
    obstacles: draft.obstacles.map((o) => ({
      x: num(o.x),
      y: num(o.y),
      width: num(o.width),
      height: num(o.height),
      color: hexToRgb(o.color),
      ...(o.label.trim() ? { label: o.label.trim() } : {}),
    })),
  };
}

export interface WorldPanelProps {
  /** Seeds the form at mount; remount via `key` to force a resync (project load, robot switch). */
  world: WorldDef;
  /** The pack's shipped world, offered as "reset to default". */
  defaultWorld: WorldDef;
  /** Called only with a world that already passed validateWorld. */
  onApply: (world: WorldDef) => void;
}

export function WorldPanel({ world, defaultWorld, onApply }: WorldPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(world));
  const [baseline, setBaseline] = useState(world);

  const { candidateWorld, error } = useMemo(() => {
    try {
      return { candidateWorld: validateWorld(buildCandidate(baseline, draft)), error: null };
    } catch (e) {
      return { candidateWorld: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [baseline, draft]);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setObstacleField = (index: number, key: keyof ObstacleDraft, value: string) =>
    setDraft((d) => ({
      ...d,
      obstacles: d.obstacles.map((o, i) => (i === index ? { ...o, [key]: value } : o)),
    }));

  const addObstacle = () =>
    setDraft((d) => ({
      ...d,
      obstacles: [
        ...d.obstacles,
        {
          x: String(round2(baseline.arena_width / 2)),
          y: String(round2(baseline.arena_height / 2)),
          width: "0.2",
          height: "0.2",
          color: "#969696",
          label: "",
        },
      ],
    }));

  const removeObstacle = (index: number) =>
    setDraft((d) => ({ ...d, obstacles: d.obstacles.filter((_, i) => i !== index) }));

  const apply = () => {
    if (!candidateWorld) return;
    onApply(candidateWorld);
  };

  const resetToDefault = () => {
    setBaseline(defaultWorld);
    setDraft(toDraft(defaultWorld));
    onApply(defaultWorld);
  };

  const atObstacleLimit = draft.obstacles.length >= MAX_OBSTACLES;

  return (
    <div className="world-panel">
      <section className="world-section">
        <h4>Arena</h4>
        <div className="world-grid">
          <label>
            Width (m)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={draft.arena_width}
              onChange={(e) => setField("arena_width", e.target.value)}
            />
          </label>
          <label>
            Height (m)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={draft.arena_height}
              onChange={(e) => setField("arena_height", e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="world-section">
        <h4>Robot start</h4>
        <div className="world-grid">
          <label>
            X (m)
            <input
              type="number"
              step="0.05"
              value={draft.start_x}
              onChange={(e) => setField("start_x", e.target.value)}
            />
          </label>
          <label>
            Y (m)
            <input
              type="number"
              step="0.05"
              value={draft.start_y}
              onChange={(e) => setField("start_y", e.target.value)}
            />
          </label>
          <label>
            Heading (°)
            <input
              type="number"
              step="1"
              value={draft.start_theta_deg}
              onChange={(e) => setField("start_theta_deg", e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="world-section">
        <h4>
          Objects
          <span className="world-count">
            {draft.obstacles.length} / {MAX_OBSTACLES}
          </span>
        </h4>
        {draft.obstacles.length === 0 && <p className="world-empty">No objects yet.</p>}
        {draft.obstacles.map((o, i) => (
          <div className="world-obstacle" key={i}>
            <input
              className="world-obstacle-label"
              type="text"
              placeholder={`object ${i + 1}`}
              value={o.label}
              onChange={(e) => setObstacleField(i, "label", e.target.value)}
              aria-label={`object ${i + 1} label`}
            />
            <label className="world-inline">
              x
              <input
                type="number"
                step="0.05"
                value={o.x}
                onChange={(e) => setObstacleField(i, "x", e.target.value)}
                aria-label={`object ${i + 1} x`}
              />
            </label>
            <label className="world-inline">
              y
              <input
                type="number"
                step="0.05"
                value={o.y}
                onChange={(e) => setObstacleField(i, "y", e.target.value)}
                aria-label={`object ${i + 1} y`}
              />
            </label>
            <label className="world-inline">
              w
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={o.width}
                onChange={(e) => setObstacleField(i, "width", e.target.value)}
                aria-label={`object ${i + 1} width`}
              />
            </label>
            <label className="world-inline">
              h
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={o.height}
                onChange={(e) => setObstacleField(i, "height", e.target.value)}
                aria-label={`object ${i + 1} height`}
              />
            </label>
            <input
              type="color"
              value={o.color}
              onChange={(e) => setObstacleField(i, "color", e.target.value)}
              aria-label={`object ${i + 1} color`}
            />
            <button
              type="button"
              className="link-button world-remove"
              onClick={() => removeObstacle(i)}
              aria-label={`delete object ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="world-add" onClick={addObstacle} disabled={atObstacleLimit}>
          + Add object
        </button>
        {atObstacleLimit && <p className="world-empty">Limit reached ({MAX_OBSTACLES} objects).</p>}
      </section>

      {error && <p className="world-error">{error}</p>}

      <div className="world-actions">
        <button type="button" className="primary" onClick={apply} disabled={!candidateWorld}>
          Apply changes
        </button>
        <button type="button" className="link-button" onClick={resetToDefault}>
          ↺ reset to pack default
        </button>
      </div>
    </div>
  );
}

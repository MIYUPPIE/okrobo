import { DEFAULT_WORLD, type State } from "./contracts/robotApi";

// Top-down view of the arena. Pure drawing: all state comes in through the
// contract State; the sim math itself lives in engine/ (WASM from Phase 1).

const PLACEHOLDER_STATE: State = {
  tick: 0,
  pose: DEFAULT_WORLD.start,
  sensors: {
    distance: DEFAULT_WORLD.arenaWidth - DEFAULT_WORLD.start.x - DEFAULT_WORLD.robotRadius,
  },
  collided: false,
};

export function Viewport({ state = PLACEHOLDER_STATE }: { state?: State }) {
  const { arenaWidth: w, arenaHeight: h, robotRadius: r } = DEFAULT_WORLD;
  const { pose, sensors } = state;
  const wall = 0.04;
  const cos = Math.cos(pose.theta);
  const sin = Math.sin(pose.theta);
  const rayStart = { x: pose.x + r * cos, y: pose.y + r * sin };
  const rayEnd = {
    x: rayStart.x + sensors.distance * cos,
    y: rayStart.y + sensors.distance * sin,
  };

  const gridLines = [];
  for (let g = 0.5; g < w; g += 0.5) {
    gridLines.push(
      <line key={`v${g}`} x1={g} y1={0} x2={g} y2={h} className="grid-line" />,
      <line key={`h${g}`} x1={0} y1={g} x2={w} y2={g} className="grid-line" />,
    );
  }

  return (
    <svg
      className="viewport-svg"
      viewBox={`${-wall} ${-wall} ${w + 2 * wall} ${h + 2 * wall}`}
      // World y points up, SVG y points down.
      transform="scale(1,-1)"
      role="img"
      aria-label="Robot arena, top-down view"
    >
      <rect x={-wall} y={-wall} width={w + 2 * wall} height={h + 2 * wall} className="arena-wall" />
      <rect x={0} y={0} width={w} height={h} className="arena-floor" />
      {gridLines}
      <line
        x1={rayStart.x}
        y1={rayStart.y}
        x2={rayEnd.x}
        y2={rayEnd.y}
        className="sensor-ray"
        strokeDasharray="0.05 0.03"
      />
      <circle cx={pose.x} cy={pose.y} r={r} className="robot-body" />
      <line
        x1={pose.x}
        y1={pose.y}
        x2={pose.x + r * cos}
        y2={pose.y + r * sin}
        className="robot-heading"
      />
    </svg>
  );
}

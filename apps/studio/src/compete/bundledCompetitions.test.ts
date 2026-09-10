import { describe, expect, it } from "vitest";
import { bundledCompetitions } from "./bundledCompetitions";
import { validateCompetitionDef } from "./competitionDef";
import { circleIntersectsAabb } from "./score";

describe("bundledCompetitions", () => {
  it("every bundled competition parses and validates clean", () => {
    const bundled = bundledCompetitions();
    expect(bundled.length).toBeGreaterThanOrEqual(5); // the 3 original + Object Delivery Race + Maze Challenge

    for (const { file, make } of bundled) {
      const competition = make();
      expect(validateCompetitionDef(competition), `${file} has validation issues`).toEqual([]);
    }
  });

  it("lists Object Delivery Race and Maze Challenge among the bundled competitions", () => {
    const names = bundledCompetitions().map((c) => c.label);
    expect(names).toContain("Object Delivery Race");
    expect(names).toContain("Maze Challenge");
  });
});

// Competition Arena C4: a hand-authored maze needs to be PROVEN navigable,
// not just visually plausible -- this reuses score.ts's own
// circleIntersectsAabb (the exact function that scores avoid_obstacle_
// collision during a real run) to sample a real waypoint path through
// Maze Challenge's own wall obstacle, so this is checking the same
// geometry the student's own robot will actually be scored against, not a
// re-derived approximation of it. See docs/decisions/
// competition-arena-definition-scoring.md's C4 addendum.
describe("Maze Challenge is actually solvable", () => {
  const maze = bundledCompetitions().find((c) => c.label === "Maze Challenge");
  if (!maze) throw new Error("maze-challenge.json not found among bundled competitions");
  const def = maze.make();
  const robotRadius = def.arena.robot_radius;
  const wall = def.arena.obstacles[0];
  const [checkpoint1, exitZone] = def.objectives.filter((o) => o.type === "reach_zone");

  // South around the wall, then east, then north to the exit -- the one
  // route this maze's own single wall (sealing off the north side) allows.
  const waypoints: Array<[number, number]> = [
    [def.arena.start.x, def.arena.start.y],
    [def.arena.start.x, 0.4],
    [1.75, 0.4],
    [3.2, 0.4],
    [3.2, 1.75],
  ];

  function sampleSegment(a: [number, number], b: [number, number], steps = 50): Array<[number, number]> {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number];
    });
  }

  it("a real waypoint path clears the maze wall along its entire length, with margin", () => {
    for (let i = 0; i < waypoints.length - 1; i++) {
      for (const [x, y] of sampleSegment(waypoints[i], waypoints[i + 1])) {
        expect(circleIntersectsAabb(x, y, robotRadius, wall), `collides with the wall at (${x}, ${y})`).toBe(false);
      }
    }
  });

  it("the path stays inside the arena along its entire length, with margin", () => {
    for (let i = 0; i < waypoints.length - 1; i++) {
      for (const [x, y] of sampleSegment(waypoints[i], waypoints[i + 1])) {
        expect(x - robotRadius).toBeGreaterThanOrEqual(0);
        expect(y - robotRadius).toBeGreaterThanOrEqual(0);
        expect(x + robotRadius).toBeLessThanOrEqual(def.arena.arena_width);
        expect(y + robotRadius).toBeLessThanOrEqual(def.arena.arena_height);
      }
    }
  });

  it("the path actually reaches Checkpoint 1 before the Exit zone, in that order", () => {
    if (checkpoint1?.type !== "reach_zone" || exitZone?.type !== "reach_zone") throw new Error("expected two reach_zone objectives");
    const checkpoint1WaypointIndex = waypoints.findIndex(([x, y]) => Math.hypot(x - checkpoint1.x, y - checkpoint1.y) <= checkpoint1.radius);
    const exitWaypointIndex = waypoints.findIndex(([x, y]) => Math.hypot(x - exitZone.x, y - exitZone.y) <= exitZone.radius);
    expect(checkpoint1WaypointIndex).toBeGreaterThanOrEqual(0);
    expect(exitWaypointIndex).toBeGreaterThanOrEqual(0);
    expect(checkpoint1WaypointIndex).toBeLessThan(exitWaypointIndex);
    expect(checkpoint1.sequence).toBeLessThan(exitZone.sequence!);
  });
});

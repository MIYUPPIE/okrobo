// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CompetitionDef } from "./competitionDef";
import { CompeteHud } from "./CompeteHud";
import { evaluateTick, initRunState } from "./score";

afterEach(() => cleanup());

const arena = {
  name: "Arena",
  arena_width: 10,
  arena_height: 10,
  robot_radius: 0.1,
  wheel_base: 0.15,
  start: { x: 0, y: 0, theta: 0 },
  obstacles: [{ x: 1, y: 1, width: 0.4, height: 0.4, color: [200, 60, 60] as [number, number, number] }],
};

const competition: CompetitionDef = {
  id: "test",
  name: "Test Competition",
  robot: "car",
  arena,
  objectives: [
    { type: "reach_zone", x: 5, y: 5, radius: 0.3, points: 100 },
    { type: "avoid_obstacle_collision", penaltyPerHit: 10 },
    { type: "time_limit", seconds: 60 },
  ],
};

describe("CompeteHud", () => {
  it("shows the competition name, score, and remaining time", () => {
    const run = initRunState(competition);
    render(<CompeteHud competition={competition} run={run} />);
    expect(screen.getByText("Test Competition")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // score
    expect(screen.getByText("60.0s left")).toBeInTheDocument();
  });

  it("reflects a live run's own score and objective outcomes", () => {
    let run = initRunState(competition);
    run = evaluateTick(competition, run, { x: 1, y: 1, theta: 0 }, 0.1); // hits the obstacle
    run = evaluateTick(competition, run, { x: 5, y: 5, theta: 0 }, 0.1); // reaches the zone

    render(<CompeteHud competition={competition} run={run} />);
    expect(screen.getByText("90")).toBeInTheDocument(); // 100 - 10
    expect(screen.getByText("1 hit")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("59.8s left")).toBeInTheDocument();
  });

  it("shows plain elapsed time when the competition has no time_limit objective", () => {
    const noTimeLimit: CompetitionDef = { ...competition, objectives: [competition.objectives[0]] };
    const run = evaluateTick(noTimeLimit, initRunState(noTimeLimit), { x: 0, y: 0, theta: 0 }, 0.1);
    render(<CompeteHud competition={noTimeLimit} run={run} />);
    expect(screen.getByText("0.1s")).toBeInTheDocument();
  });
});

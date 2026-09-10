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

  // Competition Arena C4: ordered checkpoints.
  it("uses a reach_zone's own label when present, and shows a locked zone as locked", () => {
    const sequenced: CompetitionDef = {
      ...competition,
      objectives: [
        { type: "reach_zone", x: 1, y: 1, radius: 0.3, points: 80, sequence: 0, label: "Pickup zone" },
        { type: "reach_zone", x: 5, y: 5, radius: 0.3, points: 150, sequence: 1, label: "Delivery zone" },
      ],
    };
    // initRunState alone never computes `locked` (that only happens inside
    // evaluateTick) -- one tick away from either zone is what App.tsx's own
    // very first onEngineStep call would already have produced.
    const run = evaluateTick(sequenced, initRunState(sequenced), { x: 9, y: 9, theta: 0 }, 0.1);
    render(<CompeteHud competition={sequenced} run={run} />);

    expect(screen.getByText("Pickup zone (+80)")).toBeInTheDocument();
    expect(screen.getByText("Delivery zone (+150)")).toBeInTheDocument();
    expect(screen.getByText("🔒")).toBeInTheDocument();
    expect(screen.getByText("Delivery zone (+150)").closest("li")).toHaveClass("locked");
    expect(screen.getByText("Pickup zone (+80)").closest("li")).not.toHaveClass("locked");
  });
});

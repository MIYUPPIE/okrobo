// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetitionDef } from "./competitionDef";
import { CompeteReport } from "./CompeteReport";
import { evaluateTick, finishRun, initRunState } from "./score";

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
  ],
};

describe("CompeteReport", () => {
  it("shows the score breakdown, total, and finish reason", () => {
    let run = initRunState(competition);
    run = evaluateTick(competition, run, { x: 1, y: 1, theta: 0 }, 0.1);
    run = evaluateTick(competition, run, { x: 5, y: 5, theta: 0 }, 0.1);
    run = finishRun(run, "stopped");

    render(<CompeteReport competition={competition} run={run} onRunAgain={() => {}} onChooseAnother={() => {}} />);
    expect(screen.getByText(/Stopped/)).toBeInTheDocument();
    expect(screen.getByText("achieved")).toBeInTheDocument();
    expect(screen.getByText("1 hit")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });

  it("shows 'Time ran out' when finished by the time limit", () => {
    const withTime: CompetitionDef = { ...competition, objectives: [...competition.objectives, { type: "time_limit", seconds: 0.05 }] };
    const run = evaluateTick(withTime, initRunState(withTime), { x: 0, y: 0, theta: 0 }, 0.1);
    render(<CompeteReport competition={withTime} run={run} onRunAgain={() => {}} onChooseAnother={() => {}} />);
    expect(screen.getByText(/Time ran out/)).toBeInTheDocument();
  });

  it("uses a reach_zone's own label instead of the generic wording when present", () => {
    const labeled: CompetitionDef = {
      ...competition,
      objectives: [{ type: "reach_zone", x: 5, y: 5, radius: 0.3, points: 100, label: "Delivery zone" }],
    };
    const run = finishRun(evaluateTick(labeled, initRunState(labeled), { x: 5, y: 5, theta: 0 }, 0.1), "stopped");
    render(<CompeteReport competition={labeled} run={run} onRunAgain={() => {}} onChooseAnother={() => {}} />);
    expect(screen.getByText("Delivery zone")).toBeInTheDocument();
    expect(screen.queryByText("Reach the zone")).not.toBeInTheDocument();
  });

  // Competition run history: best-score display.
  it("shows nothing when this is the competition's first-ever recorded run", () => {
    const run = finishRun(evaluateTick(competition, initRunState(competition), { x: 0, y: 0, theta: 0 }, 0.1), "stopped");
    render(<CompeteReport competition={competition} run={run} onRunAgain={() => {}} onChooseAnother={() => {}} />);
    expect(screen.queryByText(/New best/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Best:/)).not.toBeInTheDocument();
  });

  it("shows 'New best!' when this run beat the previous best", () => {
    const run = finishRun(evaluateTick(competition, initRunState(competition), { x: 0, y: 0, theta: 0 }, 0.1), "stopped");
    render(
      <CompeteReport
        competition={competition}
        run={run}
        bestScore={{ previousBest: 50, isNewBest: true }}
        onRunAgain={() => {}}
        onChooseAnother={() => {}}
      />,
    );
    expect(screen.getByText(/New best/)).toBeInTheDocument();
    expect(screen.queryByText(/^Best: 50/)).not.toBeInTheDocument();
  });

  it("shows the previous best when this run didn't beat it", () => {
    const run = finishRun(evaluateTick(competition, initRunState(competition), { x: 0, y: 0, theta: 0 }, 0.1), "stopped");
    render(
      <CompeteReport
        competition={competition}
        run={run}
        bestScore={{ previousBest: 500, isNewBest: false }}
        onRunAgain={() => {}}
        onChooseAnother={() => {}}
      />,
    );
    expect(screen.getByText("Best: 500")).toBeInTheDocument();
    expect(screen.queryByText(/New best/)).not.toBeInTheDocument();
  });

  it("Run again and Choose another competition call their own handlers", async () => {
    const run = finishRun(initRunState(competition), "program_ended");
    const onRunAgain = vi.fn();
    const onChooseAnother = vi.fn();
    const user = userEvent.setup();
    render(<CompeteReport competition={competition} run={run} onRunAgain={onRunAgain} onChooseAnother={onChooseAnother} />);

    await user.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRunAgain).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Choose another competition" }));
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
  });
});

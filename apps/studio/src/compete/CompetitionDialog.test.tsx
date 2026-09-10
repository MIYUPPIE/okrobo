// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitionDef } from "./competitionDef";
import { bundledCompetitions } from "./bundledCompetitions";
import { listPackCompetitions } from "./packCompetitions";
import { getBestScore } from "./runHistory";
import { CompetitionDialog } from "./CompetitionDialog";

vi.mock("./bundledCompetitions", () => ({ bundledCompetitions: vi.fn() }));
vi.mock("./packCompetitions", () => ({ listPackCompetitions: vi.fn() }));
vi.mock("./runHistory", () => ({ getBestScore: vi.fn() }));

const arena = {
  name: "Arena",
  arena_width: 2,
  arena_height: 2,
  robot_radius: 0.1,
  wheel_base: 0.15,
  start: { x: 0.5, y: 0.5, theta: 0 },
  obstacles: [],
};

function makeCompetition(id: string, name: string, description?: string): CompetitionDef {
  return { id, name, description, robot: "car", arena, objectives: [{ type: "reach_zone", x: 1, y: 1, radius: 0.2, points: 50 }] };
}

beforeEach(() => {
  vi.mocked(bundledCompetitions).mockReturnValue([]);
  vi.mocked(listPackCompetitions).mockResolvedValue([]);
  vi.mocked(getBestScore).mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CompetitionDialog", () => {
  it("lists every bundled competition by label and description", () => {
    const sprint = makeCompetition("sprint", "Sprint to the Zone", "Reach the far zone quickly.");
    vi.mocked(bundledCompetitions).mockReturnValue([{ file: "sprint.json", label: sprint.name, make: () => sprint }]);

    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Sprint to the Zone")).toBeInTheDocument();
    expect(screen.getByText("Reach the far zone quickly.")).toBeInTheDocument();
  });

  it("shows an empty state when no bundled competitions exist", () => {
    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/no bundled competitions/i)).toBeInTheDocument();
  });

  it("clicking a bundled competition row calls onPick with a freshly made CompetitionDef", async () => {
    const sprint = makeCompetition("sprint", "Sprint to the Zone");
    vi.mocked(bundledCompetitions).mockReturnValue([{ file: "sprint.json", label: sprint.name, make: () => sprint }]);

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<CompetitionDialog onPick={onPick} onCancel={() => {}} />);

    await user.click(screen.getByText("Sprint to the Zone"));
    expect(onPick).toHaveBeenCalledWith(sprint);
  });

  it("cancels via Cancel and via clicking the backdrop, without picking anything", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<CompetitionDialog onPick={onPick} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clicking inside the dialog does not trigger the backdrop cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CompetitionDialog onPick={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByText("Choose a competition"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows an empty state when no installed pack carries a competition", async () => {
    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no installed packs carry a competition/i)).toBeInTheDocument());
  });

  it("lists a competition from an installed pack and picks it via make()", async () => {
    const packCompetition = makeCompetition("pack-sprint", "Pack Sprint");
    vi.mocked(listPackCompetitions).mockResolvedValue([
      {
        pack: { id: "arena-pack", name: "Arena Pack", version: "1.0.0" },
        competitions: [{ label: "Pack Sprint", make: () => packCompetition }],
      },
    ]);

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<CompetitionDialog onPick={onPick} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Pack Sprint")).toBeInTheDocument());
    expect(screen.getByText(/from Arena Pack/i)).toBeInTheDocument();

    await user.click(screen.getByText("Pack Sprint"));
    expect(onPick).toHaveBeenCalledWith(packCompetition);
  });

  // Competition run history: best-score hints.
  it("shows no best-score hint when none has been recorded", () => {
    const sprint = makeCompetition("sprint", "Sprint to the Zone");
    vi.mocked(bundledCompetitions).mockReturnValue([{ file: "sprint.json", label: sprint.name, make: () => sprint }]);

    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/Best:/)).not.toBeInTheDocument();
  });

  it("shows a bundled competition's own best score when one's been recorded", () => {
    const sprint = makeCompetition("sprint", "Sprint to the Zone");
    vi.mocked(bundledCompetitions).mockReturnValue([{ file: "sprint.json", label: sprint.name, make: () => sprint }]);
    vi.mocked(getBestScore).mockImplementation((id) => (id === "sprint" ? 230 : null));

    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Best: 230")).toBeInTheDocument();
  });

  it("shows a pack competition's own best score when one's been recorded", async () => {
    const packCompetition = makeCompetition("pack-sprint", "Pack Sprint");
    vi.mocked(listPackCompetitions).mockResolvedValue([
      {
        pack: { id: "arena-pack", name: "Arena Pack", version: "1.0.0" },
        competitions: [{ label: "Pack Sprint", make: () => packCompetition }],
      },
    ]);
    vi.mocked(getBestScore).mockImplementation((id) => (id === "pack-sprint" ? 75 : null));

    render(<CompetitionDialog onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText("Best: 75")).toBeInTheDocument());
  });
});

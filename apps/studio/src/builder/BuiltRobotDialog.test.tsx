// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateRobotDef, type RobotDef } from "../contracts/robotDef";
import { makeDefaultRobotDef } from "./robotEdits";
import { BuiltRobotDialog } from "./BuiltRobotDialog";
import { listPackRobots } from "./packRobots";
import { listProjectRobots } from "./projectRobots";

vi.mock("./packRobots", () => ({ listPackRobots: vi.fn() }));
vi.mock("./projectRobots", () => ({ listProjectRobots: vi.fn() }));

beforeEach(() => {
  vi.mocked(listPackRobots).mockResolvedValue([]);
  vi.mocked(listProjectRobots).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeInvalidRobot(): RobotDef {
  const robot = makeDefaultRobotDef();
  robot.joints = [{ id: "bad-joint", name: "Bad", type: "hinge", parent: "no-such-body", child: robot.bodies[0].id, origin: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] }, axis: [0, 0, 1], limits: { lower: -1, upper: 1 }, damping: 0.1 }];
  return robot;
}

describe("BuiltRobotDialog", () => {
  it("shows the current Build-mode robot when one exists and is valid", () => {
    const robot = makeDefaultRobotDef();
    render(
      <BuiltRobotDialog currentRobotDef={robot} currentIssues={validateRobotDef(robot)} onPick={() => {}} onCancel={() => {}} />,
    );
    const row = screen.getByText(robot.name).closest("button");
    expect(row).not.toBeNull();
    expect(row).not.toBeDisabled();
    expect(screen.getByText("Your current Build-mode robot")).toBeInTheDocument();
  });

  it("shows an empty state when there is no current robot yet", () => {
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/No robot in this project yet/i)).toBeInTheDocument();
  });

  it("disables the current-robot row when it has real error-severity issues", () => {
    const robot = makeInvalidRobot();
    const issues = validateRobotDef(robot);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    render(<BuiltRobotDialog currentRobotDef={robot} currentIssues={issues} onPick={() => {}} onCancel={() => {}} />);
    const row = screen.getByText(robot.name).closest("button");
    expect(row).toBeDisabled();
    expect(screen.getByText(/issue.*to fix first/)).toBeInTheDocument();
  });

  it("clicking the current-robot row calls onPick with that exact robot", async () => {
    const robot = makeDefaultRobotDef();
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <BuiltRobotDialog currentRobotDef={robot} currentIssues={validateRobotDef(robot)} onPick={onPick} onCancel={() => {}} />,
    );
    await user.click(screen.getByText(robot.name));
    expect(onPick).toHaveBeenCalledWith(robot);
  });

  it("cancels via Cancel and via clicking the backdrop, without picking anything", async () => {
    const robot = makeDefaultRobotDef();
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <BuiltRobotDialog currentRobotDef={robot} currentIssues={validateRobotDef(robot)} onPick={onPick} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clicking inside the dialog does not trigger the backdrop cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByText("Choose a built robot"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows an empty state when no installed pack carries a built robot", async () => {
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No installed packs carry a built robot/i)).toBeInTheDocument());
  });

  it("lists a robot from an installed pack and picks it via make()", async () => {
    const packRobot = makeDefaultRobotDef();
    vi.mocked(listPackRobots).mockResolvedValue([
      {
        pack: { id: "arena-pack", name: "Arena Pack", version: "1.0.0" },
        robots: [{ label: "Pack Rover", make: () => packRobot }],
      },
    ]);

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={onPick} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Pack Rover")).toBeInTheDocument());
    expect(screen.getByText(/from Arena Pack/i)).toBeInTheDocument();

    await user.click(screen.getByText("Pack Rover"));
    expect(onPick).toHaveBeenCalledWith(packRobot);
  });

  it("shows an empty state when no other saved project carries a robot", async () => {
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No other saved project carries a robot/i)).toBeInTheDocument());
  });

  it("lists a robot from another saved project and picks it via make()", async () => {
    const projectRobot = makeDefaultRobotDef();
    vi.mocked(listProjectRobots).mockResolvedValue([
      { project: { id: "other", name: "My Other Project", created_at: 0, updated_at: 0 }, label: "Saved Rover", make: () => projectRobot },
    ]);

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} onPick={onPick} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Saved Rover")).toBeInTheDocument());
    expect(screen.getByText(/from "My Other Project"/i)).toBeInTheDocument();

    await user.click(screen.getByText("Saved Rover"));
    expect(onPick).toHaveBeenCalledWith(projectRobot);
  });

  it("passes currentProjectId through to listProjectRobots, so the open project isn't listed twice", () => {
    render(<BuiltRobotDialog currentRobotDef={null} currentIssues={[]} currentProjectId="proj-1" onPick={() => {}} onCancel={() => {}} />);
    expect(listProjectRobots).toHaveBeenCalledWith("proj-1");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { listPackRobots } from "./packRobots";
import { TEMPLATE_OPTIONS } from "./robotTemplates";
import { TemplateDialog } from "./TemplateDialog";

vi.mock("./packRobots", () => ({ listPackRobots: vi.fn() }));

beforeEach(() => {
  // Default: no installed pack carries a robot -- the common case, and
  // what every pre-Phase-8 test below assumes. Individual tests override.
  vi.mocked(listPackRobots).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TemplateDialog", () => {
  it("lists every template by label and description", () => {
    render(<TemplateDialog onPick={() => {}} onCancel={() => {}} />);
    for (const template of TEMPLATE_OPTIONS) {
      expect(screen.getByText(template.label)).toBeTruthy();
      expect(screen.getByText(template.description)).toBeTruthy();
    }
  });

  it("clicking a template row calls onPick with that template's RobotDef", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={onPick} onCancel={() => {}} />);

    await user.click(screen.getByText("Two-Wheeled Rover"));
    expect(onPick).toHaveBeenCalledTimes(1);
    const picked = onPick.mock.calls[0][0];
    expect(picked.id).toBe("two-wheeled-rover");
    expect(picked.bodies.map((b: { id: string }) => b.id)).toEqual(["chassis", "left_wheel", "right_wheel"]);
  });

  it("cancels via Cancel and via clicking the backdrop, without picking anything", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<TemplateDialog onPick={onPick} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clicking inside the dialog does not trigger the backdrop cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByText("New robot"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Robot Builder Phase 8: robots surfaced from installed packs.
  it("shows an empty state when no installed pack carries a robot", async () => {
    render(<TemplateDialog onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no installed packs carry a built robot/i)).toBeInTheDocument());
  });

  it("lists a robot from an installed pack and picks it via make()", async () => {
    const packRobot: RobotDef = {
      id: "pack-rover",
      name: "Pack Rover",
      description: "",
      root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
      bodies: [],
      joints: [],
      actuators: [],
      sensors: [],
    };
    vi.mocked(listPackRobots).mockResolvedValue([
      {
        pack: { id: "robotics", name: "Robotics Pack", version: "1.0.0" },
        robots: [{ label: "Rover", make: () => packRobot }],
      },
    ]);

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={onPick} onCancel={() => {}} />);

    await waitFor(() => expect(screen.getByText("Rover")).toBeInTheDocument());
    expect(screen.getByText(/from Robotics Pack/i)).toBeInTheDocument();

    await user.click(screen.getByText("Rover"));
    expect(onPick).toHaveBeenCalledWith(packRobot);
  });

  // Web persistence round: importing a robot-def file, the reciprocal of
  // Build mode's "Export" button.
  it("importing a well-formed robot-def file calls onPick with the parsed robot", async () => {
    const importedRobot: RobotDef = {
      id: "imported-rover",
      name: "Imported Rover",
      description: "",
      root_placement: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] },
      bodies: [{ id: "chassis", name: "Chassis", transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const file = new File([JSON.stringify(importedRobot)], "imported-rover.robot-def.json", { type: "application/json" });

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={onPick} onCancel={() => {}} />);

    await user.upload(screen.getByLabelText("import robot file"), file);
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(importedRobot));
  });

  it("importing a malformed file shows an inline error and never calls onPick", async () => {
    const file = new File(["not valid json"], "broken.robot-def.json", { type: "application/json" });

    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={onPick} onCancel={() => {}} />);

    await user.upload(screen.getByLabelText("import robot file"), file);
    await waitFor(() => expect(screen.getByText(/Couldn't import that file/)).toBeInTheDocument());
    expect(onPick).not.toHaveBeenCalled();
  });
});

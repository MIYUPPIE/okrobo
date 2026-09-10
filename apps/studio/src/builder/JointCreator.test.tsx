// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { JointCreator } from "./JointCreator";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

/** Two independent root bodies -- the common case: neither is attached to
 * anything yet, so creating a joint between them is unambiguously valid. */
function makeTwoRoots(): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [
      { id: "chassis", name: "Chassis", transform: { position: [0, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 1, inertia },
      { id: "wheel", name: "Wheel", transform: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] }, mass: 0.1, inertia },
    ],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("JointCreator", () => {
  it("seeds the form with a generated name, fixed type, and the origin that keeps the child's world pose unchanged", () => {
    render(<JointCreator robot={makeTwoRoots()} parentId="chassis" childId="wheel" onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("joint name")).toHaveValue("joint-1");
    expect(screen.getByLabelText("joint type")).toHaveValue("fixed");
    // chassis at origin, wheel at [0.1,0,0], neither rotated -> origin is a plain [0.1,0,0] offset
    expect(screen.getByLabelText("joint origin x")).toHaveValue(0.1);
    expect(screen.getByLabelText("joint origin y")).toHaveValue(0);
    expect(screen.getByLabelText("joint origin z")).toHaveValue(0);
  });

  it("shows Parent -> Child and hides axis/limits fields for the default fixed type", () => {
    render(<JointCreator robot={makeTwoRoots()} parentId="chassis" childId="wheel" onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Chassis → Wheel")).toBeInTheDocument();
    expect(screen.queryByLabelText("joint axis x")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("joint limits lower")).not.toBeInTheDocument();
  });

  it("switching to hinge reveals axis and limits fields", async () => {
    const user = userEvent.setup();
    render(<JointCreator robot={makeTwoRoots()} parentId="chassis" childId="wheel" onApply={() => {}} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText("joint type"), "hinge");
    expect(screen.getByLabelText("joint axis x")).toBeInTheDocument();
    expect(screen.getByLabelText("joint axis y")).toHaveValue(1); // default axis [0,1,0]
    expect(screen.getByLabelText("joint limits lower")).toBeInTheDocument();
  });

  it("Apply is enabled for a valid pair and produces a robot with the new joint, child reset to identity transform", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<JointCreator robot={makeTwoRoots()} parentId="chassis" childId="wheel" onApply={onApply} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const next: RobotDef = onApply.mock.calls[0][0];
    expect(next.joints).toHaveLength(1);
    expect(next.joints[0]).toMatchObject({ id: "joint-1", type: "fixed", parent: "chassis", child: "wheel" });
    const wheel = next.bodies.find((b) => b.id === "wheel")!;
    expect(wheel.transform).toEqual(identity);
  });

  it("disables Apply when the child already has an incoming joint (joint-duplicate-child)", () => {
    const robot: RobotDef = {
      ...makeTwoRoots(),
      bodies: [...makeTwoRoots().bodies, { id: "extra", name: "Extra", transform: { position: [0, 0.2, 0], rotation_rpy: [0, 0, 0] }, mass: 0.1, inertia }],
      joints: [{ id: "existing", name: "Existing", type: "fixed", parent: "chassis", child: "wheel", origin: identity }],
    };
    // wheel already has a parent joint -- attaching it to "extra" too must be rejected.
    render(<JointCreator robot={robot} parentId="extra" childId="wheel" onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText(/attached by more than one joint/i)).toBeInTheDocument();
  });

  it("disables Apply when the proposed joint would introduce a cycle", () => {
    const robot: RobotDef = {
      ...makeTwoRoots(),
      joints: [{ id: "existing", name: "Existing", type: "fixed", parent: "chassis", child: "wheel", origin: identity }],
    };
    // chassis -> wheel already exists; wheel -> chassis would close the loop.
    render(<JointCreator robot={robot} parentId="wheel" childId="chassis" onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("Cancel calls onCancel without applying anything", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<JointCreator robot={makeTwoRoots()} parentId="chassis" childId="wheel" onApply={onApply} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  // Robot Builder D3: editing an existing joint (fixing one left at the
  // default "fixed" type is the motivating case -- see BuilderPanel.tsx's
  // own Add Actuator gate).
  describe("editing an existing joint", () => {
    function makeAttachedRobot(): RobotDef {
      const robot = makeTwoRoots();
      return {
        ...robot,
        joints: [{ id: "joint-1", name: "Joint 1", type: "fixed", parent: "chassis", child: "wheel", origin: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] } }],
      };
    }

    it("prefills the draft from the existing joint, header reads 'Edit joint'", () => {
      const robot = makeAttachedRobot();
      render(<JointCreator robot={robot} parentId="chassis" childId="wheel" existing={robot.joints[0]} onApply={() => {}} onCancel={() => {}} />);
      expect(screen.getByText("Edit joint")).toBeInTheDocument();
      expect(screen.getByLabelText("joint name")).toHaveValue("Joint 1");
      expect(screen.getByLabelText("joint type")).toHaveValue("fixed");
      expect(screen.getByLabelText("joint origin x")).toHaveValue(0.1);
    });

    it("switching the type from fixed to hinge and Apply replaces the joint in place, same id, no new one added", async () => {
      const robot = makeAttachedRobot();
      const onApply = vi.fn();
      const user = userEvent.setup();
      render(<JointCreator robot={robot} parentId="chassis" childId="wheel" existing={robot.joints[0]} onApply={onApply} onCancel={() => {}} />);

      await user.selectOptions(screen.getByLabelText("joint type"), "hinge");
      expect(screen.getByLabelText("joint axis y")).toHaveValue(1); // default axis [0,1,0]
      await user.click(screen.getByRole("button", { name: "Apply" }));

      expect(onApply).toHaveBeenCalledTimes(1);
      const next: RobotDef = onApply.mock.calls[0][0];
      expect(next.joints).toHaveLength(1); // replaced, not appended
      expect(next.joints[0]).toMatchObject({ id: "joint-1", type: "hinge", parent: "chassis", child: "wheel" });
    });

    it("editing does not reset the child body's transform again (only a brand-new joint does that)", async () => {
      const robot = makeAttachedRobot();
      const onApply = vi.fn();
      const user = userEvent.setup();
      render(<JointCreator robot={robot} parentId="chassis" childId="wheel" existing={robot.joints[0]} onApply={onApply} onCancel={() => {}} />);

      await user.click(screen.getByRole("button", { name: "Apply" }));
      const next: RobotDef = onApply.mock.calls[0][0];
      const wheel = next.bodies.find((b) => b.id === "wheel")!;
      // wheel's own transform is whatever makeTwoRoots() gave it -- untouched.
      expect(wheel.transform).toEqual(robot.bodies.find((b) => b.id === "wheel")!.transform);
    });
  });
});

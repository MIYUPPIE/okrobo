// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { HierarchyList } from "./HierarchyList";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

const TWO_LINK: RobotDef = {
  id: "arm",
  name: "Arm",
  description: "",
  root_placement: identity,
  bodies: [
    { id: "base", name: "Base", transform: identity, mass: 1, inertia },
    { id: "link1", name: "Link 1", transform: identity, mass: 1, inertia },
    { id: "link2", name: "Link 2", transform: identity, mass: 1, inertia },
  ],
  joints: [
    { id: "j1", name: "J1", type: "fixed", parent: "base", child: "link1", origin: identity },
    { id: "j2", name: "J2", type: "fixed", parent: "link1", child: "link2", origin: identity },
  ],
  actuators: [],
  sensors: [],
};

describe("HierarchyList", () => {
  it("renders every body as a row, nested by depth", () => {
    render(<HierarchyList robot={TWO_LINK} selectedBodyId={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Base" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 2" })).toBeInTheDocument();
    expect(screen.queryByText("⚠ Unattached")).not.toBeInTheDocument();
  });

  it("marks the selected row active", () => {
    render(<HierarchyList robot={TWO_LINK} selectedBodyId="link1" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Link 1" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Base" })).not.toHaveClass("active");
  });

  it("calls onSelect with the clicked body's id", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<HierarchyList robot={TWO_LINK} selectedBodyId={null} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Link 2" }));
    expect(onSelect).toHaveBeenCalledWith("link2");
  });

  it("a body with no joints at all is just another root, not Unattached", () => {
    const withExtraRoot: RobotDef = {
      ...TWO_LINK,
      bodies: [...TWO_LINK.bodies, { id: "extra", name: "Extra", transform: identity, mass: 1, inertia }],
    };
    render(<HierarchyList robot={withExtraRoot} selectedBodyId={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Extra" })).toBeInTheDocument();
    expect(screen.queryByText("⚠ Unattached")).not.toBeInTheDocument();
  });

  it("puts a genuinely unreachable body (claimed by a joint whose parent doesn't resolve) in a separate, still-selectable Unattached section", async () => {
    const withOrphan: RobotDef = {
      ...TWO_LINK,
      bodies: [...TWO_LINK.bodies, { id: "orphan", name: "Orphan", transform: identity, mass: 1, inertia }],
      joints: [...TWO_LINK.joints, { id: "j3", name: "J3", type: "fixed", parent: "ghost", child: "orphan", origin: identity }],
    };
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<HierarchyList robot={withOrphan} selectedBodyId={null} onSelect={onSelect} />);

    expect(screen.getByText("⚠ Unattached")).toBeInTheDocument();
    const orphanRow = screen.getByRole("button", { name: "Orphan" });
    await user.click(orphanRow);
    expect(onSelect).toHaveBeenCalledWith("orphan");
  });
});

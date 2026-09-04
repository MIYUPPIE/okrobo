// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { BuilderPanel } from "./BuilderPanel";

afterEach(() => cleanup());

// jsdom can't construct a real WebGLRenderer -- mock the two components
// that need one (BuilderViewport, TestViewport), not the canvas, and test
// everything else (hierarchy/inspector sync, add/delete cascading, mode
// switching, real EngineBuiltRobot construction against the real compiled
// WASM module) for real.
vi.mock("./BuilderViewport", () => ({
  BuilderViewport: (props: { robot: RobotDef; selectedBodyId: string | null }) => (
    <div data-testid="builder-viewport-stub" data-selected={props.selectedBodyId ?? ""} data-body-count={props.robot.bodies.length} />
  ),
}));
vi.mock("./TestViewport", () => ({
  TestViewport: () => <div data-testid="test-viewport-stub" />,
}));
// jsdom has no ResizeObserver and can't lay out real SVG, both of which
// Blockly.inject needs -- same reason BuilderViewport/TestViewport are
// mocked above. BlocksPanel is only ever exercised for real via the
// browser CDP e2e check (scripts/lib/studio-e2e-check.mjs).
vi.mock("../BlocksPanel", () => ({
  BlocksPanel: (props: { robot: string }) => <div data-testid="blocks-panel-stub" data-robot={props.robot} />,
}));

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "My Robot",
    description: "",
    root_placement: identity,
    bodies: [{ id: "base", name: "Base", transform: identity, mass: 1, inertia, visual: { type: "box", size: [0.1, 0.1, 0.1] } }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("BuilderPanel", () => {
  it("auto-selects the first body and shows its inspector", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Base" })).toHaveClass("active");
    expect(screen.getByLabelText("body name")).toHaveValue("Base");
  });

  it("shows the issue count from validateRobotDef", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByText("0 issues")).toBeInTheDocument();
  });

  it("Add body appends a new body, selects it, and passes the update to onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "+ Add body" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(2);
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", next.bodies[1].id);
  });

  it("selecting a hierarchy row updates the inspector and the viewport's selection prop", async () => {
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "second", name: "Second", transform: identity, mass: 1, inertia }] };
    const user = userEvent.setup();
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getByLabelText("body name")).toHaveValue("Second");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", "second");
  });

  it("Delete body (two-click confirm) cascades correctly and clears selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Delete body" }));
    await user.click(screen.getByRole("button", { name: "delete?" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(0);
    expect(screen.getByText("Select a body to edit it.")).toBeInTheDocument();
  });

  it("disables Test mode while the document has an error", () => {
    const base = makeRobot();
    // A second body with no joint attaching it is an extra root ->
    // robot-multiple-root-bodies, an error-severity issue.
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "second", name: "Second", transform: identity, mass: 1, inertia }] };
    render(<BuilderPanel robot={robot} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("switching to Test mode builds a real physics instance and never mutates the document", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Test" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByTestId("builder-viewport-stub")).not.toBeInTheDocument();
    expect(screen.getByText(/doesn't affect your document/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switching back to Edit mode restores the gizmo viewport", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("builder-viewport-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("test-viewport-stub")).not.toBeInTheDocument();
  });

  // Robot Builder Phase 5: the Test-mode world picker.
  it("Test mode shows a world picker defaulting to None, listing every WORLD_OPTIONS entry", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });

    const picker = screen.getByLabelText("World");
    expect(picker).toHaveValue("");
    expect(screen.getByRole("option", { name: "None (floor only)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Obstacle Course" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ramp" })).toBeInTheDocument();
  });

  // Robot Builder Phase 6: the Test-mode program drawer.
  it("the program drawer only renders in Test mode", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    expect(screen.queryByText("▶ Run")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("▶ Run")).toBeInTheDocument();
    expect(screen.getByTestId("blocks-panel-stub")).toHaveAttribute("data-robot", "built");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText("▶ Run")).not.toBeInTheDocument();
  });

  it("Run is disabled until the physics engine is ready, Stop is disabled until a program is running", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("button", { name: "▶ Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "⏹ Stop" })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: "▶ Run" })).not.toBeDisabled(), { timeout: 10000 });
    expect(screen.getByRole("button", { name: "⏹ Stop" })).toBeDisabled();
  });

  it("clicking Run drives a real BuiltProgramRunner and never mutates the document", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "▶ Run" })).not.toBeDisabled(), { timeout: 10000 });

    expect(screen.getByText("idle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "▶ Run" }));
    // The mocked BlocksPanel never calls onCode, so the compiled program is
    // an empty async function -- it runs against the real BuiltProgramRunner
    // (real EngineBuiltRobot, mocked viewport, same pattern this file
    // already uses) and finishes immediately, back to idle.
    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument(), { timeout: 10000 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picking a world from the Test-mode picker doesn't crash or mutate the document", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });

    await user.selectOptions(screen.getByLabelText("World"), "Obstacle Course");
    expect(screen.getByLabelText("World")).toHaveValue("obstacle-course");
    // Picking a world rebuilds the physics instance against it (a world
    // object is a real MuJoCo collider, not just a rendered decoration) --
    // briefly back to "loading" before the new instance is ready.
    await waitFor(() => expect(screen.getByTestId("test-viewport-stub")).toBeInTheDocument(), { timeout: 10000 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

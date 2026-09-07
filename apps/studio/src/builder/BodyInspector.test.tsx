// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { BodyInspector } from "./BodyInspector";

afterEach(() => cleanup());

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

function makeRobot(): RobotDef {
  return {
    id: "r",
    name: "R",
    description: "",
    root_placement: identity,
    bodies: [
      {
        id: "chassis",
        name: "Chassis",
        transform: identity,
        visual: { type: "box", size: [0.2, 0.15, 0.08] },
        collision: { type: "box", size: [0.2, 0.15, 0.08] },
        mass: 1,
        inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
        material: { color: [0.3, 0.5, 0.9] },
      },
    ],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

describe("BodyInspector", () => {
  it("seeds the form from the selected body", () => {
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);
    expect(screen.getByLabelText("body name")).toHaveValue("Chassis");
    expect(screen.getByLabelText("body size x")).toHaveValue(0.2);
    expect(screen.getByLabelText("body mass")).toHaveValue(1);
  });

  it("edits name, position, and mass, applying only on Apply", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={onApply} onRequestDelete={() => {}} />);

    await user.clear(screen.getByLabelText("body name"));
    await user.type(screen.getByLabelText("body name"), "Frame");
    await user.clear(screen.getByLabelText("body position x"));
    await user.type(screen.getByLabelText("body position x"), "0.5");
    await user.clear(screen.getByLabelText("body mass"));
    await user.type(screen.getByLabelText("body mass"), "2.5");
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied: RobotDef = onApply.mock.calls[0][0];
    const body = applied.bodies.find((b) => b.id === "chassis")!;
    expect(body.name).toBe("Frame");
    expect(body.transform.position[0]).toBe(0.5);
    expect(body.mass).toBe(2.5);
  });

  it("shows an inline issue and disables Apply for invalid mass, without discarding the typed value", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={onApply} onRequestDelete={() => {}} />);

    await user.clear(screen.getByLabelText("body mass"));
    await user.type(screen.getByLabelText("body mass"), "0");

    expect(screen.getByLabelText("body mass")).toHaveValue(0);
    expect(screen.getByText(/has no valid mass/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("switching geometry type swaps the visible dimension fields", async () => {
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);

    expect(screen.getByLabelText("body size x")).toBeInTheDocument();
    expect(screen.queryByLabelText("body radius")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("body geometry type"), "sphere");
    expect(screen.queryByLabelText("body size x")).not.toBeInTheDocument();
    expect(screen.getByLabelText("body radius")).toBeInTheDocument();
    expect(screen.queryByLabelText("body length")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("body geometry type"), "cylinder");
    expect(screen.getByLabelText("body radius")).toBeInTheDocument();
    expect(screen.getByLabelText("body length")).toBeInTheDocument();
  });

  it("deletes only after a second confirming click", async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    render(<BodyInspector robot={makeRobot()} bodyId="chassis" onApply={() => {}} onRequestDelete={onRequestDelete} />);

    const deleteBtn = screen.getByRole("button", { name: "Delete body" });
    await user.click(deleteBtn);
    expect(onRequestDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "delete?" }));
    expect(onRequestDelete).toHaveBeenCalledWith("chassis");
  });

  // CAD Kernel Phase 7.1: the read-only construction-history panel, shown
  // only for a cad_mesh body that actually has a recorded features list.
  it("shows the construction history for a cad_mesh body with a recorded features list", () => {
    const robot = makeRobot();
    robot.bodies[0] = {
      ...robot.bodies[0],
      visual: { type: "cad_mesh", vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] },
      features: [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
      ],
    };
    render(<BodyInspector robot={robot} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);
    expect(screen.getByText("Construction history")).toBeInTheDocument();
    expect(screen.getByText(/Box \(/)).toBeInTheDocument();
    expect(screen.getByText(/Shell \(1 face, thickness 0.005m\)/)).toBeInTheDocument();
  });

  it("shows no construction history section for a cad_mesh body with no recorded features", () => {
    const robot = makeRobot();
    robot.bodies[0] = { ...robot.bodies[0], visual: { type: "cad_mesh", vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] } };
    render(<BodyInspector robot={robot} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} />);
    expect(screen.queryByText("Construction history")).not.toBeInTheDocument();
  });

  // CAD Kernel Phase 7.3 (edit-any-step): threaded straight through to
  // FeatureTreeList's own onSelectStep.
  it("threads onSelectFeatureStep through to the Construction history panel's own rows", () => {
    const onSelectFeatureStep = vi.fn();
    const robot = makeRobot();
    robot.bodies[0] = {
      ...robot.bodies[0],
      visual: { type: "cad_mesh", vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] },
      features: [{ operation: "box", size: [0.1, 0.06, 0.04] }],
    };
    render(<BodyInspector robot={robot} bodyId="chassis" onApply={() => {}} onRequestDelete={() => {}} onSelectFeatureStep={onSelectFeatureStep} />);
    fireEvent.click(screen.getByRole("button", { name: /Box \(/ }));
    expect(onSelectFeatureStep).toHaveBeenCalledWith(0);
  });

  // CAD Kernel Phase 7.4 (reorder/insert/delete): threaded straight
  // through to FeatureTreeList's own onMoveStep/onDeleteStep/onInsertStep,
  // plus the pending/error pair -- same forwarding posture as
  // onSelectFeatureStep above.
  it("threads onMoveFeatureStep/onDeleteFeatureStep/onInsertFeatureStep and the action pending/error pair through to the Construction history panel", () => {
    const onMoveFeatureStep = vi.fn();
    const onDeleteFeatureStep = vi.fn();
    const onInsertFeatureStep = vi.fn();
    const robot = makeRobot();
    robot.bodies[0] = {
      ...robot.bodies[0],
      visual: { type: "cad_mesh", vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] },
      features: [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
        { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 5 },
      ],
    };
    render(
      <BodyInspector
        robot={robot}
        bodyId="chassis"
        onApply={() => {}}
        onRequestDelete={() => {}}
        onMoveFeatureStep={onMoveFeatureStep}
        onDeleteFeatureStep={onDeleteFeatureStep}
        onInsertFeatureStep={onInsertFeatureStep}
        featureActionError="cad executor: step 1 (shell) failed to rebuild: no face found near [1, 1, 1]"
      />,
    );
    expect(screen.getByText(/no face found near/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("move step 1 down"));
    expect(onMoveFeatureStep).toHaveBeenCalledWith(1, "down");
    fireEvent.click(screen.getAllByText("+ Insert step")[0]);
    fireEvent.click(screen.getByText("Draft"));
    expect(onInsertFeatureStep).toHaveBeenCalledWith(0, "draft");
    fireEvent.click(screen.getByLabelText("delete step 1"));
    fireEvent.click(screen.getByLabelText("delete step 1"));
    expect(onDeleteFeatureStep).toHaveBeenCalledWith(1);
  });
});

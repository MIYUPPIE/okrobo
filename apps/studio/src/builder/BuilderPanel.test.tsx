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
  BuilderViewport: (props: {
    robot: RobotDef;
    selectedBodyId: string | null;
    jointPick?: { parentId: string | null; onPick: (id: string) => void };
    bodyPick?: { selectedId: string | null; onPick: (id: string) => void };
    cadPreview?: { mesh: unknown; position: unknown } | null;
    suppressedBodyId?: string | null;
    edgeOverlay?: unknown;
  }) => (
    <div
      data-testid="builder-viewport-stub"
      data-selected={props.selectedBodyId ?? ""}
      data-body-count={props.robot.bodies.length}
      data-joint-parent={props.jointPick?.parentId ?? ""}
      data-cad-preview={props.cadPreview ? "1" : ""}
      data-suppressed={props.suppressedBodyId ?? ""}
      data-edge-overlay={props.edgeOverlay ? "1" : ""}
    >
      {/* Real BuilderViewport picks a body by raycasting a 3D click; this
       * stub exposes the same "click a body" interaction as plain buttons
       * so tests can drive the Add Joint tool's parent-then-child picking,
       * and Cut's own single-body pick, without a real WebGLRenderer. */}
      {props.jointPick && props.robot.bodies.map((b) => (
        <button key={b.id} onClick={() => props.jointPick!.onPick(b.id)}>
          {`pick ${b.id}`}
        </button>
      ))}
      {props.bodyPick && props.robot.bodies.map((b) => (
        <button key={b.id} onClick={() => props.bodyPick!.onPick(b.id)}>
          {`pick ${b.id}`}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./TestViewport", () => ({
  TestViewport: () => <div data-testid="test-viewport-stub" />,
}));
// CadExtrudeCreator's own async debounced worker pipeline is tested for
// real in CadExtrudeCreator.test.tsx -- this stub keeps BuilderPanel's own
// tests focused on tool-switching/wiring (Apply/Cancel plumbing, preview
// pass-through) rather than re-testing those internals.
vi.mock("./CadExtrudeCreator", () => ({
  CadExtrudeCreator: (props: {
    robot: RobotDef;
    onApply: (next: RobotDef, id: string) => void;
    onCancel: () => void;
    onPreviewChange: (preview: { mesh: unknown; position: unknown } | null) => void;
  }) => (
    <div data-testid="cad-extrude-creator-stub">
      <button
        onClick={() => {
          const newBody = {
            id: "body-2",
            name: "body-2",
            transform: { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] },
            mass: 0.05,
            inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
            visual: { type: "cad_mesh" as const, vertices: [0, 0, 0], faces: [0, 0, 0] },
          };
          props.onApply({ ...props.robot, bodies: [...props.robot.bodies, newBody] }, newBody.id);
        }}
      >
        stub apply
      </button>
      <button onClick={() => props.onPreviewChange({ mesh: { vertices: [0, 0, 0], faces: [0, 0, 0] }, position: [0.1, 0, 0] })}>
        stub preview
      </button>
      <button onClick={props.onCancel}>stub cancel</button>
    </div>
  ),
}));
// Same reasoning as the CadExtrudeCreator stub above -- CadRevolveCreator/
// CadBoundaryCreator's own async pipelines are tested for real in their
// own test files (Robot Builder CAD Kernel Phase 3).
vi.mock("./CadRevolveCreator", () => ({
  CadRevolveCreator: (props: { robot: RobotDef; onApply: (next: RobotDef, id: string) => void; onCancel: () => void }) => (
    <div data-testid="cad-revolve-creator-stub">
      <button
        onClick={() => {
          const newBody = {
            id: "body-2",
            name: "body-2",
            transform: { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] },
            mass: 0.05,
            inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
            visual: { type: "cad_mesh" as const, vertices: [0, 0, 0], faces: [0, 0, 0] },
          };
          props.onApply({ ...props.robot, bodies: [...props.robot.bodies, newBody] }, newBody.id);
        }}
      >
        stub apply
      </button>
      <button onClick={props.onCancel}>stub cancel</button>
    </div>
  ),
}));
vi.mock("./CadBoundaryCreator", () => ({
  CadBoundaryCreator: (props: { robot: RobotDef; onApply: (next: RobotDef, id: string) => void; onCancel: () => void }) => (
    <div data-testid="cad-boundary-creator-stub">
      <button
        onClick={() => {
          const newBody = {
            id: "body-2",
            name: "body-2",
            transform: { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] },
            mass: 0.05,
            inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
            visual: { type: "cad_mesh" as const, vertices: [0, 0, 0], faces: [0, 0, 0] },
          };
          props.onApply({ ...props.robot, bodies: [...props.robot.bodies, newBody] }, newBody.id);
        }}
      >
        stub apply
      </button>
      <button onClick={props.onCancel}>stub cancel</button>
    </div>
  ),
}));
// Same reasoning as the Boss creator stubs above -- the three Cut
// creators' own async pipelines are tested for real in their own test
// files (Robot Builder CAD Kernel Phase 4). onApply takes a single arg
// here (no new body id -- Cut replaces the target's own geometry, it
// doesn't add a body), unlike the Boss stubs' two-arg onApply.
function makeCadCutCreatorStub(testId: string) {
  return (props: { robot: RobotDef; targetBodyId: string; onApply: (next: RobotDef) => void; onCancel: () => void }) => (
    <div data-testid={testId} data-target={props.targetBodyId}>
      <button
        onClick={() => {
          const cutGeometry = { type: "cad_mesh" as const, vertices: [0, 0, 0], faces: [0, 0, 0] };
          props.onApply({
            ...props.robot,
            bodies: props.robot.bodies.map((b) => (b.id === props.targetBodyId ? { ...b, visual: cutGeometry, collision: cutGeometry } : b)),
          });
        }}
      >
        stub apply
      </button>
      <button onClick={props.onCancel}>stub cancel</button>
    </div>
  );
}
vi.mock("./CadExtrudedCutCreator", () => ({ CadExtrudedCutCreator: makeCadCutCreatorStub("cad-extruded-cut-creator-stub") }));
vi.mock("./CadRevolvedCutCreator", () => ({ CadRevolvedCutCreator: makeCadCutCreatorStub("cad-revolved-cut-creator-stub") }));
vi.mock("./CadBoundaryCutCreator", () => ({ CadBoundaryCutCreator: makeCadCutCreatorStub("cad-boundary-cut-creator-stub") }));
// Same reasoning and shape as the Cut stubs above -- Robot Builder CAD
// Kernel Phase 5 (Fillet + Chamfer). Its own real edge-picking pipeline is
// tested in CadFilletChamferEditor.test.tsx.
vi.mock("./CadFilletChamferEditor", () => ({ CadFilletChamferEditor: makeCadCutCreatorStub("cad-fillet-chamfer-editor-stub") }));
// Robot Builder CAD Kernel Phase 6 (Shell + Draft): one shared component
// used twice (Shell and Draft each pass their own `title`), so the stub
// exposes it as a data attribute rather than a fixed test id the way the
// Cut/Fillet-Chamfer stubs above do -- both tools render through the same
// mocked component. Its own real face-picking pipeline is tested in
// CadFacePickEditor.test.tsx.
vi.mock("./CadFacePickEditor", () => ({
  CadFacePickEditor: (props: { title: string; targetBodyId: string; onApply: (next: RobotDef) => void; onCancel: () => void; robot: RobotDef }) => (
    <div data-testid="cad-face-pick-editor-stub" data-title={props.title} data-target={props.targetBodyId}>
      <button
        onClick={() => {
          const geometry = { type: "cad_mesh" as const, vertices: [0, 0, 0], faces: [0, 0, 0] };
          props.onApply({
            ...props.robot,
            bodies: props.robot.bodies.map((b) => (b.id === props.targetBodyId ? { ...b, visual: geometry, collision: geometry } : b)),
          });
        }}
      >
        stub apply
      </button>
      <button onClick={props.onCancel}>stub cancel</button>
    </div>
  ),
}));
// jsdom has no ResizeObserver and can't lay out real SVG, both of which
// Blockly.inject needs -- same reason BuilderViewport/TestViewport are
// mocked above. BlocksPanel is only ever exercised for real via the
// browser CDP e2e check (scripts/lib/studio-e2e-check.mjs).
vi.mock("../BlocksPanel", () => ({
  BlocksPanel: (props: { robot: string }) => <div data-testid="blocks-panel-stub" data-robot={props.robot} />,
}));
vi.mock("./exportRobot", () => ({ exportRobotDef: vi.fn().mockResolvedValue(undefined) }));

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

  // Robot Builder Phase 8.
  it("the Export button saves the current robot via exportRobotDef", async () => {
    const { exportRobotDef } = await import("./exportRobot");
    const user = userEvent.setup();
    const robot = makeRobot();
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(exportRobotDef).toHaveBeenCalledWith(robot);
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

  it("Add Joint is disabled with fewer than two bodies", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Add Joint" })).toBeDisabled();
  });

  it("Add Joint: picking parent then child shows JointCreator; Apply commits the joint and returns to the normal tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }] };
    render(<BuilderPanel robot={robot} onChange={onChange} />);

    const addJoint = screen.getByRole("button", { name: "Add Joint" });
    expect(addJoint).not.toBeDisabled();
    await user.click(addJoint);
    expect(addJoint).toHaveClass("active");
    expect(screen.getByText("Click the parent body.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByText("Click the child body.")).toBeInTheDocument();
    // Re-picking the same body as its own child is a no-op, not a self-loop draft.
    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByText("Click the child body.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick wheel" }));
    expect(screen.getByText("Base → Wheel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.joints).toHaveLength(1);
    expect(next.joints[0]).toMatchObject({ parent: "base", child: "wheel" });
    // The tool resets back to normal selection once the joint is applied.
    expect(screen.queryByRole("button", { name: "Add Joint" })).not.toHaveClass("active");
  });

  it("Add Joint: Cancel from JointCreator clears the draft but stays in the tool for another pick", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }] };
    render(<BuilderPanel robot={robot} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Add Joint" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "pick wheel" }));
    expect(screen.getByText("Base → Wheel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add Joint" })).toHaveClass("active"); // still in the tool
    expect(screen.getByText("Click the parent body.")).toBeInTheDocument();
  });

  it("Extrude shows the CadExtrudeCreator stub and hides BodyInspector", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    const extrude = screen.getByRole("button", { name: "Extrude" });
    expect(extrude).not.toBeDisabled();
    await user.click(extrude);
    expect(extrude).toHaveClass("active");
    expect(screen.getByTestId("cad-extrude-creator-stub")).toBeInTheDocument();
    expect(screen.queryByLabelText("body name")).not.toBeInTheDocument();
  });

  it("Move/Rotate/Add Joint disable while Extrude is active, and re-enable on Cancel", async () => {
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }] };
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Extrude" }));
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Joint" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "stub cancel" }));
    expect(screen.getByRole("button", { name: "Move" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Rotate" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Joint" })).not.toBeDisabled();
  });

  it("Extrude: Apply from the stub grows the document by one body, selects it, and returns to the transform tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Extrude" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(2);
    expect(next.bodies[1]).toMatchObject({ id: "body-2", visual: { type: "cad_mesh" } });
    expect(screen.queryByRole("button", { name: "Extrude" })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", "body-2");
  });

  it("Extrude: Cancel from the stub returns to the transform tool without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Extrude" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Extrude" })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-extrude-creator-stub")).not.toBeInTheDocument();
  });

  it("Extrude: a live preview from the stub reaches BuilderViewport, and clears once the tool exits", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Extrude" }));
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-cad-preview", "");
    await user.click(screen.getByRole("button", { name: "stub preview" }));
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-cad-preview", "1");

    await user.click(screen.getByRole("button", { name: "stub cancel" }));
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-cad-preview", "");
  });

  it("Extrude/Revolve/Boundary disable each other, not just Move/Rotate/Add Joint", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Revolve" }));
    expect(screen.getByRole("button", { name: "Extrude" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Boundary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revolve" })).not.toBeDisabled(); // never disables itself

    await user.click(screen.getByRole("button", { name: "stub cancel" }));
    expect(screen.getByRole("button", { name: "Extrude" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Boundary" })).not.toBeDisabled();
  });

  it("Revolve shows the CadRevolveCreator stub and hides BodyInspector", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    const revolve = screen.getByRole("button", { name: "Revolve" });
    await user.click(revolve);
    expect(revolve).toHaveClass("active");
    expect(screen.getByTestId("cad-revolve-creator-stub")).toBeInTheDocument();
    expect(screen.queryByLabelText("body name")).not.toBeInTheDocument();
  });

  it("Revolve: Apply from the stub grows the document by one body, selects it, and returns to the transform tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Revolve" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Revolve" })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", "body-2");
  });

  it("Revolve: Cancel from the stub returns to the transform tool without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Revolve" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Revolve" })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-revolve-creator-stub")).not.toBeInTheDocument();
  });

  it("Boundary shows the CadBoundaryCreator stub and hides BodyInspector", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    const boundary = screen.getByRole("button", { name: "Boundary" });
    await user.click(boundary);
    expect(boundary).toHaveClass("active");
    expect(screen.getByTestId("cad-boundary-creator-stub")).toBeInTheDocument();
    expect(screen.queryByLabelText("body name")).not.toBeInTheDocument();
  });

  it("Boundary: Apply from the stub grows the document by one body, selects it, and returns to the transform tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Boundary" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Boundary" })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-selected", "body-2");
  });

  it("Boundary: Cancel from the stub returns to the transform tool without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Boundary" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Boundary" })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-boundary-creator-stub")).not.toBeInTheDocument();
  });

  it("Extruded Cut: shows a pick hint until a target is picked, then the CadExtrudedCutCreator stub with that target's id", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    const extrudedCut = screen.getByRole("button", { name: "Extruded Cut" });
    await user.click(extrudedCut);
    expect(extrudedCut).toHaveClass("active");
    expect(screen.getByText("Click the body to cut.")).toBeInTheDocument();
    expect(screen.queryByTestId("cad-extruded-cut-creator-stub")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.queryByText("Click the body to cut.")).not.toBeInTheDocument();
    expect(screen.getByTestId("cad-extruded-cut-creator-stub")).toHaveAttribute("data-target", "base");
    // The picked target's real mesh is suppressed in the viewport while
    // the Cut creator's own live preview takes its place.
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "base");
  });

  it("Extruded Cut: Apply from the stub replaces the target body's geometry and returns to the transform tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Extruded Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(1); // no new body -- the target's own geometry was replaced
    expect(next.bodies[0]).toMatchObject({ id: "base", visual: { type: "cad_mesh" } });
    expect(screen.queryByRole("button", { name: "Extruded Cut" })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "");
  });

  it("Extruded Cut: Cancel from the stub returns to the transform tool without calling onChange, clearing the target pick", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Extruded Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Extruded Cut" })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-extruded-cut-creator-stub")).not.toBeInTheDocument();

    // Reopening starts a fresh pick, not resuming the old one.
    await user.click(screen.getByRole("button", { name: "Extruded Cut" }));
    expect(screen.getByText("Click the body to cut.")).toBeInTheDocument();
  });

  it("Revolved Cut: picks a target then shows the CadRevolvedCutCreator stub", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Revolved Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByTestId("cad-revolved-cut-creator-stub")).toHaveAttribute("data-target", "base");
  });

  it("Revolved Cut: Apply from the stub replaces the target body's geometry", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Revolved Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(1);
    expect(next.bodies[0]).toMatchObject({ id: "base", visual: { type: "cad_mesh" } });
  });

  it("Boundary Cut: picks a target then shows the CadBoundaryCutCreator stub", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Boundary Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByTestId("cad-boundary-cut-creator-stub")).toHaveAttribute("data-target", "base");
  });

  it("Boundary Cut: Apply from the stub replaces the target body's geometry", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Boundary Cut" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(1);
    expect(next.bodies[0]).toMatchObject({ id: "base", visual: { type: "cad_mesh" } });
  });

  it("Fillet/Chamfer: shows a pick hint until a target is picked, then the CadFilletChamferEditor stub with that target's id", async () => {
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

    const filletChamfer = screen.getByRole("button", { name: "Fillet/Chamfer" });
    await user.click(filletChamfer);
    expect(filletChamfer).toHaveClass("active");
    expect(screen.getByText("Click the body to fillet or chamfer.")).toBeInTheDocument();
    expect(screen.queryByTestId("cad-fillet-chamfer-editor-stub")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.queryByText("Click the body to fillet or chamfer.")).not.toBeInTheDocument();
    expect(screen.getByTestId("cad-fillet-chamfer-editor-stub")).toHaveAttribute("data-target", "base");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "base");
  });

  it("Fillet/Chamfer: Apply from the stub replaces the target body's geometry and returns to the transform tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Fillet/Chamfer" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(1); // no new body -- the target's own geometry was replaced
    expect(next.bodies[0]).toMatchObject({ id: "base", visual: { type: "cad_mesh" } });
    expect(screen.queryByRole("button", { name: "Fillet/Chamfer" })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "");
  });

  it("Fillet/Chamfer: Cancel from the stub returns to the transform tool without calling onChange, clearing the target pick", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Fillet/Chamfer" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Fillet/Chamfer" })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-fillet-chamfer-editor-stub")).not.toBeInTheDocument();

    // Reopening starts a fresh pick, not resuming the old one.
    await user.click(screen.getByRole("button", { name: "Fillet/Chamfer" }));
    expect(screen.getByText("Click the body to fillet or chamfer.")).toBeInTheDocument();
  });

  it.each(["Shell", "Draft"] as const)(
    "%s: shows a pick hint until a target is picked, then the CadFacePickEditor stub with the right title and target's id",
    async (title) => {
      const user = userEvent.setup();
      render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);

      const toolButton = screen.getByRole("button", { name: title });
      await user.click(toolButton);
      expect(toolButton).toHaveClass("active");
      expect(screen.getByText(`Click the body to ${title.toLowerCase()}.`)).toBeInTheDocument();
      expect(screen.queryByTestId("cad-face-pick-editor-stub")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "pick base" }));
      expect(screen.queryByText(`Click the body to ${title.toLowerCase()}.`)).not.toBeInTheDocument();
      const stub = screen.getByTestId("cad-face-pick-editor-stub");
      expect(stub).toHaveAttribute("data-title", title);
      expect(stub).toHaveAttribute("data-target", "base");
      expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "base");
    },
  );

  it.each(["Shell", "Draft"] as const)("%s: Apply from the stub replaces the target body's geometry and returns to the transform tool", async (title) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: title }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub apply" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.bodies).toHaveLength(1); // no new body -- the target's own geometry was replaced
    expect(next.bodies[0]).toMatchObject({ id: "base", visual: { type: "cad_mesh" } });
    expect(screen.queryByRole("button", { name: title })).not.toHaveClass("active");
    expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "");
  });

  it.each(["Shell", "Draft"] as const)("%s: Cancel from the stub returns to the transform tool without calling onChange, clearing the target pick", async (title) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: title }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    await user.click(screen.getByRole("button", { name: "stub cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: title })).not.toHaveClass("active");
    expect(screen.queryByTestId("cad-face-pick-editor-stub")).not.toBeInTheDocument();

    // Reopening starts a fresh pick, not resuming the old one.
    await user.click(screen.getByRole("button", { name: title }));
    expect(screen.getByText(`Click the body to ${title.toLowerCase()}.`)).toBeInTheDocument();
  });

  it("all eleven tools stay mutually exclusive: activating any Cut/Fillet-Chamfer/Shell/Draft tool disables every Boss tool and Add Joint too", async () => {
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = { ...base, bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }] };
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Boundary Cut" }));
    expect(screen.getByRole("button", { name: "Add Joint" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Extrude" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revolve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Boundary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Extruded Cut" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revolved Cut" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fillet/Chamfer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shell" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Boundary Cut" })).not.toBeDisabled(); // never disables itself
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

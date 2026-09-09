// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Feature, RobotDef } from "../contracts/robotDef";
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
// CAD Kernel Phase 7.3 (edit-any-step): every Boss/Cut/Fillet-Chamfer/
// Shell/Draft stub below also accepts an optional `editing` prop (the
// same shape each real creator now takes) and exposes one more button
// that calls `editing.onApply` with a fixed, arbitrary Feature -- enough
// for BuilderPanel's own dispatch/recompute-wiring tests below without
// re-testing each creator's own edit-mode internals (already covered in
// their own test files).
vi.mock("./CadExtrudeCreator", () => ({
  CadExtrudeCreator: (props: {
    robot: RobotDef;
    onApply: (next: RobotDef, id: string) => void;
    onCancel: () => void;
    onPreviewChange: (preview: { mesh: unknown; position: unknown } | null) => void;
    editing?: { feature: unknown; onApply: (next: unknown) => void };
  }) => (
    <div data-testid="cad-extrude-creator-stub" data-editing={props.editing ? "1" : ""}>
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
      {props.editing && <button onClick={() => props.editing!.onApply({ operation: "extrude", profile: { type: "rectangle", width: 0.2, height: 0.2 }, depth: 0.05 })}>stub editing apply</button>}
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
  return (props: {
    robot: RobotDef;
    targetBodyId: string;
    onApply: (next: RobotDef) => void;
    onCancel: () => void;
    editing?: { feature: unknown; stepIndex: number; allFeatures: unknown[]; onApply: (next: unknown) => void };
    inserting?: { afterIndex: number; allFeatures: unknown[]; onApply: (next: unknown) => void };
  }) => (
    <div
      data-testid={testId}
      data-target={props.targetBodyId}
      data-editing={props.editing ? "1" : ""}
      data-step-index={props.editing?.stepIndex ?? ""}
      data-inserting={props.inserting ? "1" : ""}
      data-after-index={props.inserting?.afterIndex ?? ""}
    >
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
      {props.editing && (
        <button onClick={() => props.editing!.onApply({ operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0], operation: "fillet", value: 0.01 }] })}>
          stub editing apply
        </button>
      )}
      {props.inserting && (
        <button onClick={() => props.inserting!.onApply({ operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0], operation: "fillet", value: 0.01 }] })}>
          stub inserting apply
        </button>
      )}
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
  CadFacePickEditor: (props: {
    title: string;
    targetBodyId: string;
    onApply: (next: RobotDef) => void;
    onCancel: () => void;
    robot: RobotDef;
    editing?: { feature: unknown; stepIndex: number; allFeatures: unknown[]; onApply: (next: unknown) => void };
    inserting?: { afterIndex: number; allFeatures: unknown[]; onApply: (next: unknown) => void };
  }) => (
    <div
      data-testid="cad-face-pick-editor-stub"
      data-title={props.title}
      data-target={props.targetBodyId}
      data-editing={props.editing ? "1" : ""}
      data-inserting={props.inserting ? "1" : ""}
      data-after-index={props.inserting?.afterIndex ?? ""}
    >
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
      {props.editing && <button onClick={() => props.editing!.onApply({ operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.01 })}>stub editing apply</button>}
      {props.inserting && <button onClick={() => props.inserting!.onApply({ operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.01 })}>stub inserting apply</button>}
    </div>
  ),
}));
// CAD Kernel Phase 7.3: the one editor with no create-mode counterpart --
// a box/cylinder root feature is only ever synthesized implicitly (never
// authored fresh), so this stub only ever needs an edit-mode shape.
vi.mock("./CadPrimitiveRootEditor", () => ({
  CadPrimitiveRootEditor: (props: {
    feature: { operation: string };
    allFeatures: unknown[];
    targetBodyId: string;
    onApply: (next: unknown) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="cad-primitive-root-editor-stub" data-target={props.targetBodyId} data-feature-op={props.feature.operation}>
      <button onClick={() => props.onApply({ operation: "box", size: [0.2, 0.2, 0.2] })}>stub editing apply</button>
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
// jsdom can't construct Monaco's real editor (InstantiationService) -- same
// reasoning as BlocksPanel above. Real Python execution against the sidecar
// is proven by scripts/lib/studio-e2e-check.mjs and PythonBridge's own
// integration tests; BuilderPanel's own tests only need to prove the wiring
// (a bridge/runner is constructed, Run/Stop dispatch to the right place).
vi.mock("../PythonPanel", () => ({
  PythonPanel: (props: { connected: boolean; output: { text: string }[] }) => (
    <div data-testid="python-panel-stub" data-connected={props.connected} data-output-count={props.output.length} />
  ),
}));
vi.mock("./exportRobot", () => ({ exportRobotDef: vi.fn().mockResolvedValue(undefined) }));
// CAD Kernel Phase 7.3 (edit-any-step): recomputeFeatureStep's own real
// behavior (calling into the CAD worker via cadClient.ts's replayFeatures)
// is tested directly in recomputeFeatureStep.test.ts -- BuilderPanel's own
// tests only need to prove the WIRING (it's called with the right args,
// and the result -- success or a real rebuild error -- is handled right).
const recomputeFeatureStepMock = vi.fn();
// CAD Kernel Phase 7.4 (reorder/insert/delete): same reasoning -- each
// function's own real behavior is tested directly in
// recomputeFeatureStep.test.ts; BuilderPanel's own tests only prove the
// wiring.
const deleteFeatureStepMock = vi.fn();
const moveFeatureStepMock = vi.fn();
const insertFeatureStepMock = vi.fn();
vi.mock("./recomputeFeatureStep", () => ({
  recomputeFeatureStep: (...args: unknown[]) => recomputeFeatureStepMock(...args),
  deleteFeatureStep: (...args: unknown[]) => deleteFeatureStepMock(...args),
  moveFeatureStep: (...args: unknown[]) => moveFeatureStepMock(...args),
  insertFeatureStep: (...args: unknown[]) => insertFeatureStepMock(...args),
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

  it("Add Actuator is disabled with no hinge/slider/ball/free joint yet", () => {
    render(<BuilderPanel robot={makeRobot()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Add Actuator" })).toBeDisabled();
  });

  it("Add Actuator: clicking the tool shows ActuatorCreator directly (no viewport pick needed); Apply commits and returns to the normal tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = {
      ...base,
      bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }],
      joints: [{ id: "joint-1", name: "Joint 1", type: "hinge", parent: "base", child: "wheel", origin: identity, axis: [0, 1, 0] }],
    };
    render(<BuilderPanel robot={robot} onChange={onChange} />);

    const addActuator = screen.getByRole("button", { name: "Add Actuator" });
    expect(addActuator).not.toBeDisabled();
    await user.click(addActuator);
    expect(addActuator).toHaveClass("active");
    expect(screen.getByLabelText("actuator name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.actuators).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add Actuator" })).not.toHaveClass("active");
  });

  it("Add Sensor: picking a body shows SensorCreator; Apply commits and returns to the normal tool", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    const addSensor = screen.getByRole("button", { name: "Add Sensor" });
    await user.click(addSensor);
    expect(addSensor).toHaveClass("active");
    expect(screen.getByText("Click the body to mount the sensor on.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByLabelText("sensor name")).toBeInTheDocument();
    expect(screen.getByText("On Base")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.sensors).toHaveLength(1);
    expect(next.sensors[0].body).toBe("base");
    expect(screen.queryByRole("button", { name: "Add Sensor" })).not.toHaveClass("active");
  });

  it("Add Sensor: Cancel returns to the normal tool without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BuilderPanel robot={makeRobot()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Add Sensor" }));
    await user.click(screen.getByRole("button", { name: "pick base" }));
    expect(screen.getByLabelText("sensor name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add Sensor" })).not.toHaveClass("active");
  });

  it("Actuators & Sensors list: clicking an existing entry opens it for editing, prefilled; Apply replaces it in place", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = {
      ...base,
      sensors: [{ id: "sensor-1", name: "Front Lidar", type: "lidar", body: "base", transform: identity }],
    };
    render(<BuilderPanel robot={robot} onChange={onChange} />);

    await user.click(screen.getByText("Front Lidar", { exact: false }));
    expect(screen.getByText("Edit sensor")).toBeInTheDocument();
    expect(screen.getByLabelText("sensor name")).toHaveValue("Front Lidar");

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: RobotDef = onChange.mock.calls[0][0];
    expect(next.sensors).toHaveLength(1);
    expect(next.sensors[0].name).toBe("Front Lidar");
  });

  it("Actuators & Sensors list: two-click delete removes the entity via onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = {
      ...base,
      sensors: [{ id: "sensor-1", name: "Front Lidar", type: "lidar", body: "base", transform: identity }],
    };
    render(<BuilderPanel robot={robot} onChange={onChange} />);

    const deleteButton = screen.getByRole("button", { name: "delete sensor Front Lidar" });
    await user.click(deleteButton);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(deleteButton);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sensors).toEqual([]);
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

  it("all thirteen tools stay mutually exclusive: activating any Cut/Fillet-Chamfer/Shell/Draft tool disables every Boss tool, Add Joint, Add Actuator, and Add Sensor too", async () => {
    const user = userEvent.setup();
    const base = makeRobot();
    const robot: RobotDef = {
      ...base,
      bodies: [...base.bodies, { id: "wheel", name: "Wheel", transform: identity, mass: 0.1, inertia }],
      // A real targetable joint, so "Add Actuator" being disabled below is
      // proof of mutual exclusivity, not just the separate "no joint yet" gate.
      joints: [{ id: "joint-1", name: "Joint 1", type: "hinge", parent: "base", child: "wheel", origin: identity, axis: [0, 1, 0] }],
    };
    render(<BuilderPanel robot={robot} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Boundary Cut" }));
    expect(screen.getByRole("button", { name: "Add Joint" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Actuator" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Sensor" })).toBeDisabled();
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

  // CAD Kernel Phase 7.3 (edit-any-step): clicking a Construction history
  // row opens that step's own editor, pre-filled; Apply recomputes the
  // whole chain (through recomputeFeatureStep, mocked here -- its own real
  // behavior is tested in recomputeFeatureStep.test.ts) and either commits
  // the result or surfaces a real rebuild-error message.
  describe("Feature step editing", () => {
    function makeCadRobotWithFeatures(features: RobotDef["bodies"][number]["features"]): RobotDef {
      return {
        id: "r",
        name: "My Robot",
        description: "",
        root_placement: identity,
        bodies: [
          {
            id: "part",
            name: "Part",
            transform: identity,
            mass: 0.05,
            inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
            visual: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
            collision: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
            features,
          },
        ],
        joints: [],
        actuators: [],
        sensors: [],
      };
    }

    it("clicking a box root row opens CadPrimitiveRootEditor, suppressing the real body in the viewport", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByRole("button", { name: /Box \(/ }));
      expect(screen.getByTestId("cad-primitive-root-editor-stub")).toHaveAttribute("data-target", "part");
      expect(screen.getByTestId("cad-primitive-root-editor-stub")).toHaveAttribute("data-feature-op", "box");
      expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "part");
    });

    it("clicking a fillet_chamfer row opens CadFilletChamferEditor in edit mode, at the right step index", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0], operation: "fillet", value: 0.005 }] },
      ];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByRole("button", { name: /Fillet\/Chamfer \(/ }));
      const stub = screen.getByTestId("cad-fillet-chamfer-editor-stub");
      expect(stub).toHaveAttribute("data-target", "part");
      expect(stub).toHaveAttribute("data-editing", "1");
      expect(stub).toHaveAttribute("data-step-index", "1");
    });

    it("clicking a shell row opens CadFacePickEditor in edit mode with the 'Edit Shell' title", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
      ];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByRole("button", { name: /Shell \(/ }));
      const stub = screen.getByTestId("cad-face-pick-editor-stub");
      expect(stub).toHaveAttribute("data-title", "Edit Shell");
      expect(stub).toHaveAttribute("data-editing", "1");
    });

    it("Apply (success): recomputeFeatureStep resolving ok commits the result via onChange and closes the editor", async () => {
      recomputeFeatureStepMock.mockReset();
      const nextRobot = makeCadRobotWithFeatures([{ operation: "box", size: [0.2, 0.2, 0.2] }]);
      recomputeFeatureStepMock.mockResolvedValue({ ok: true, robot: nextRobot });
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: /Box \(/ }));
      await user.click(screen.getByRole("button", { name: "stub editing apply" }));

      expect(recomputeFeatureStepMock).toHaveBeenCalledWith(expect.objectContaining({ id: "r" }), "part", 0, { operation: "box", size: [0.2, 0.2, 0.2] });
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(nextRobot));
      expect(screen.queryByTestId("cad-primitive-root-editor-stub")).not.toBeInTheDocument();
    });

    it("Apply (failure): a real rebuild error shows a message and keeps the editor open, without calling onChange", async () => {
      recomputeFeatureStepMock.mockReset();
      recomputeFeatureStepMock.mockResolvedValue({ ok: false, message: "cad executor: step 1 (shell) failed to rebuild: no face found near [0.05, 0, 0]" });
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: /Box \(/ }));
      await user.click(screen.getByRole("button", { name: "stub editing apply" }));

      await waitFor(() => expect(screen.getByText(/Could not apply this edit/)).toBeInTheDocument());
      expect(screen.getByText(/no face found near/)).toBeInTheDocument();
      expect(screen.getByTestId("cad-primitive-root-editor-stub")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Cancel closes the editor without calling onChange or recomputeFeatureStep", async () => {
      recomputeFeatureStepMock.mockReset();
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: /Box \(/ }));
      await user.click(screen.getByRole("button", { name: "stub cancel" }));

      expect(screen.queryByTestId("cad-primitive-root-editor-stub")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(recomputeFeatureStepMock).not.toHaveBeenCalled();
    });
  });

  function makeCadRobotWithFeatures(features: RobotDef["bodies"][number]["features"]): RobotDef {
    return {
      id: "r",
      name: "My Robot",
      description: "",
      root_placement: identity,
      bodies: [
        {
          id: "part",
          name: "Part",
          transform: identity,
          mass: 0.05,
          inertia: { ixx: 0.0001, iyy: 0.0001, izz: 0.0001 },
          visual: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
          collision: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
          features,
        },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
  }

  // CAD Kernel Phase 7.4 (reorder/insert/delete): the Construction history
  // panel's own "+ Insert step" affordance opens a kind menu, then the
  // matching creator/editor in insert mode -- Apply splices the new
  // Feature in via insertFeatureStep (mocked here; its own real behavior is
  // tested in recomputeFeatureStep.test.ts) and recomputes the whole chain.
  // The insert-kind menu's own button labels deliberately match the
  // toolbar's own tool button labels ("Shell", "Fillet/Chamfer", etc.) --
  // scoped to the menu's own container so a query doesn't also match the
  // (still-rendered, if disabled) toolbar button of the same name.
  function chooseInsertKind(label: string): HTMLElement {
    const menu = document.querySelector(".feature-tree-insert-menu");
    if (!menu) throw new Error("insert menu is not open");
    return within(menu as HTMLElement).getByText(label);
  }

  describe("Feature step inserting", () => {
    it("choosing Fillet/Chamfer from the root row's Insert menu opens CadFilletChamferEditor in insert mode, after step 0", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Fillet/Chamfer"));

      const stub = screen.getByTestId("cad-fillet-chamfer-editor-stub");
      expect(stub).toHaveAttribute("data-target", "part");
      expect(stub).toHaveAttribute("data-inserting", "1");
      expect(stub).toHaveAttribute("data-after-index", "0");
      expect(screen.getByTestId("builder-viewport-stub")).toHaveAttribute("data-suppressed", "part");
    });

    it("choosing Shell opens CadFacePickEditor in insert mode with the 'Insert Shell' title", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Shell"));

      const stub = screen.getByTestId("cad-face-pick-editor-stub");
      expect(stub).toHaveAttribute("data-title", "Insert Shell");
      expect(stub).toHaveAttribute("data-inserting", "1");
    });

    it("choosing Extruded Cut opens CadExtrudedCutCreator in insert mode", async () => {
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={() => {}} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Extruded Cut"));

      expect(screen.getByTestId("cad-extruded-cut-creator-stub")).toHaveAttribute("data-inserting", "1");
    });

    it("Apply (success): insertFeatureStep resolving ok commits the result via onChange and closes the editor", async () => {
      insertFeatureStepMock.mockReset();
      const insertedFeature: Feature = {
        operation: "fillet_chamfer",
        picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0], operation: "fillet", value: 0.01 }],
      };
      const nextRobot = makeCadRobotWithFeatures([{ operation: "box", size: [0.1, 0.06, 0.04] }, insertedFeature]);
      insertFeatureStepMock.mockResolvedValue({ ok: true, robot: nextRobot });
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Fillet/Chamfer"));
      await user.click(screen.getByRole("button", { name: "stub inserting apply" }));

      expect(insertFeatureStepMock).toHaveBeenCalledWith(expect.objectContaining({ id: "r" }), "part", 0, insertedFeature);
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(nextRobot));
      expect(screen.queryByTestId("cad-fillet-chamfer-editor-stub")).not.toBeInTheDocument();
    });

    it("Apply (failure): a real rebuild error shows a message and keeps the editor open, without calling onChange", async () => {
      insertFeatureStepMock.mockReset();
      insertFeatureStepMock.mockResolvedValue({ ok: false, message: "cad executor: step 1 (fillet_chamfer) failed to rebuild: no edge found near [0.05, 0, 0]" });
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Fillet/Chamfer"));
      await user.click(screen.getByRole("button", { name: "stub inserting apply" }));

      await waitFor(() => expect(screen.getByText(/Could not insert this step/)).toBeInTheDocument());
      expect(screen.getByText(/no edge found near/)).toBeInTheDocument();
      expect(screen.getByTestId("cad-fillet-chamfer-editor-stub")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Cancel closes the editor without calling onChange or insertFeatureStep", async () => {
      insertFeatureStepMock.mockReset();
      const onChange = vi.fn();
      const user = userEvent.setup();
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }];
      render(<BuilderPanel robot={makeCadRobotWithFeatures(features)} onChange={onChange} />);

      await user.click(screen.getByText("+ Insert step"));
      await user.click(chooseInsertKind("Fillet/Chamfer"));
      await user.click(screen.getByRole("button", { name: "stub cancel" }));

      expect(screen.queryByTestId("cad-fillet-chamfer-editor-stub")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(insertFeatureStepMock).not.toHaveBeenCalled();
    });
  });

  // CAD Kernel Phase 7.4 (reorder/insert/delete): move/delete act directly
  // from the Construction history list, no separate editor panel involved
  // -- routed to moveFeatureStep/deleteFeatureStep (mocked here; their own
  // real behavior is tested in recomputeFeatureStep.test.ts).
  describe("Feature step delete/reorder", () => {
    const threeStepFeatures: Feature[] = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], thickness: 0.005 },
      { operation: "draft", picks: [{ source_step: 0, local_index: 0, point: [0.05, 0, 0] }], angle_deg: 5 },
    ];

    it("clicking move down on a step calls moveFeatureStep and commits the result via onChange", async () => {
      moveFeatureStepMock.mockReset();
      const nextRobot = makeCadRobotWithFeatures([threeStepFeatures[0], threeStepFeatures[2], threeStepFeatures[1]]);
      moveFeatureStepMock.mockResolvedValue({ ok: true, robot: nextRobot });
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<BuilderPanel robot={makeCadRobotWithFeatures(threeStepFeatures)} onChange={onChange} />);

      await user.click(screen.getByLabelText("move step 1 down"));

      expect(moveFeatureStepMock).toHaveBeenCalledWith(expect.objectContaining({ id: "r" }), "part", 1, "down");
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(nextRobot));
    });

    it("a failed move shows a rebuild-error message near the Construction history list, without calling onChange", async () => {
      moveFeatureStepMock.mockReset();
      moveFeatureStepMock.mockResolvedValue({ ok: false, message: "cad executor: step 2 (draft) failed to rebuild: no face found near [9, 9, 9]" });
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<BuilderPanel robot={makeCadRobotWithFeatures(threeStepFeatures)} onChange={onChange} />);

      await user.click(screen.getByLabelText("move step 1 down"));

      await waitFor(() => expect(screen.getByText(/no face found near/)).toBeInTheDocument());
      expect(onChange).not.toHaveBeenCalled();
    });

    it("deleting a step needs a second confirming click, then calls deleteFeatureStep and commits via onChange", async () => {
      deleteFeatureStepMock.mockReset();
      const nextRobot = makeCadRobotWithFeatures([threeStepFeatures[0], threeStepFeatures[2]]);
      deleteFeatureStepMock.mockResolvedValue({ ok: true, robot: nextRobot });
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<BuilderPanel robot={makeCadRobotWithFeatures(threeStepFeatures)} onChange={onChange} />);

      await user.click(screen.getByLabelText("delete step 1"));
      expect(deleteFeatureStepMock).not.toHaveBeenCalled();
      await user.click(screen.getByLabelText("delete step 1"));

      expect(deleteFeatureStepMock).toHaveBeenCalledWith(expect.objectContaining({ id: "r" }), "part", 1);
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(nextRobot));
    });

    it("switching to a different cad_mesh body clears a stale action error from the previous one", async () => {
      moveFeatureStepMock.mockReset();
      moveFeatureStepMock.mockResolvedValue({ ok: false, message: "cad executor: step 2 (draft) failed to rebuild: no face found near [9, 9, 9]" });
      const user = userEvent.setup();
      const robot = makeCadRobotWithFeatures(threeStepFeatures);
      robot.bodies.push({
        id: "other",
        name: "Other",
        transform: identity,
        mass: 1,
        inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
        visual: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
        collision: { type: "cad_mesh", vertices: [0, 0, 0], faces: [0, 0, 0] },
        features: [{ operation: "box", size: [0.05, 0.05, 0.05] }],
      });
      render(<BuilderPanel robot={robot} onChange={() => {}} />);

      await user.click(screen.getByLabelText("move step 1 down"));
      await waitFor(() => expect(screen.getByText(/no face found near/)).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Other" }));
      expect(screen.getByText("Construction history")).toBeInTheDocument();
      expect(screen.queryByText(/no face found near/)).not.toBeInTheDocument();
    });
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { exportRobotDef } from "./exportRobot";

vi.mock("../projects/api", () => ({
  inDesktop: false,
  exportRobotFile: vi.fn().mockResolvedValue(undefined),
}));

const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveMock }));

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

function makeRobot(): RobotDef {
  return {
    id: "my-rover",
    name: "My Rover",
    description: "",
    root_placement: identity,
    bodies: [{ id: "chassis", name: "Chassis", transform: identity, mass: 1, inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 } }],
    joints: [],
    actuators: [],
    sensors: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("exportRobotDef (browser)", () => {
  it("creates a Blob download with the robot's serialized content and a derived filename", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let capturedAnchor: HTMLAnchorElement | undefined;
    const createElementSpy = vi.spyOn(document, "createElement");

    await exportRobotDef(makeRobot(), false);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    const text = await blob.text();
    expect(JSON.parse(text)).toMatchObject({ id: "my-rover", name: "My Rover" });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    capturedAnchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(capturedAnchor.download).toBe("my-rover.robot-def.json");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");

    createElementSpy.mockRestore();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to a generic filename for a robot with a blank id", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await exportRobotDef({ ...makeRobot(), id: "  " }, false);
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("robot.robot-def.json");

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("exportRobotDef (desktop)", () => {
  it("opens a native save dialog and writes the file via exportRobotFile", async () => {
    const { exportRobotFile } = await import("../projects/api");
    saveMock.mockResolvedValue("/home/student/my-rover.robot-def.json");

    await exportRobotDef(makeRobot(), true);

    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: "my-rover.robot-def.json",
      filters: [{ name: "Robot definition", extensions: ["json"] }],
    });
    expect(exportRobotFile).toHaveBeenCalledTimes(1);
    const [path, contents] = vi.mocked(exportRobotFile).mock.calls[0];
    expect(path).toBe("/home/student/my-rover.robot-def.json");
    expect(JSON.parse(contents)).toMatchObject({ id: "my-rover" });
  });

  it("writes nothing when the student cancels the save dialog", async () => {
    const { exportRobotFile } = await import("../projects/api");
    saveMock.mockResolvedValue(null);

    await exportRobotDef(makeRobot(), true);

    expect(exportRobotFile).not.toHaveBeenCalled();
  });
});

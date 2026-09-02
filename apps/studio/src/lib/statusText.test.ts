import { describe, expect, it } from "vitest";
import { formatStudioStatus, type StatusInput } from "./statusText";

const BASE: StatusInput = {
  robotLabel: "Arena",
  engineStatus: "ready",
  hud: null,
  runStatus: "idle",
  pythonConnected: false,
  hardware: { connected: false },
  notice: "",
};

const CAR_HUD: StatusInput["hud"] = {
  kind: "car",
  state: {
    tick: 42,
    pose: { x: 1.234, y: 0.5, theta: 0 },
    sensors: { distance: 0.9 },
    collided: false,
  },
};

const ARM_HUD: StatusInput["hud"] = {
  kind: "arm",
  state: {
    tick: 10,
    joints: { angles: [0, Math.PI / 2, 0, 0], targets: [0, Math.PI / 2, 0, 0] },
    moving: false,
    tip: { x: 0, y: 0, z: 0.62 },
  },
};

describe("formatStudioStatus", () => {
  it("always leads with 'offline · <robot>'", () => {
    expect(formatStudioStatus(BASE)).toBe("offline · Arena");
  });

  it("reports the engine loading or missing before any telemetry exists", () => {
    expect(formatStudioStatus({ ...BASE, engineStatus: "loading" })).toBe(
      "offline · Arena  ·  engine: loading…",
    );
    expect(formatStudioStatus({ ...BASE, engineStatus: "missing" })).toContain(
      "engine: not built · run scripts/build-engine-wasm.sh",
    );
  });

  it("shows no telemetry while the engine is ready but no state has arrived yet", () => {
    expect(formatStudioStatus({ ...BASE, engineStatus: "ready", hud: null })).toBe(
      "offline · Arena",
    );
  });

  it("formats car telemetry: tick, pose, and distance", () => {
    const text = formatStudioStatus({ ...BASE, hud: CAR_HUD });
    expect(text).toContain("tick 42");
    expect(text).toContain("x 1.23 y 0.50");
    expect(text).toContain("d 0.90 m");
  });

  it("formats arm telemetry: tick, joint angles in degrees, tip height", () => {
    const text = formatStudioStatus({ ...BASE, robotLabel: "Arm", hud: ARM_HUD });
    expect(text).toContain("tick 10");
    expect(text).toContain("joints 0° 90° 0° 0°");
    expect(text).toContain("tip z 0.62 m");
  });

  it("appends 'moving' only while the arm is in motion", () => {
    const still = formatStudioStatus({ ...BASE, hud: ARM_HUD });
    expect(still).not.toContain("moving");

    const moving = formatStudioStatus({
      ...BASE,
      hud: { ...ARM_HUD, state: { ...ARM_HUD!.state, moving: true } },
    });
    expect(moving).toContain("moving");
  });

  it("flags wall contact only for the car, and only when collided", () => {
    const clear = formatStudioStatus({ ...BASE, hud: CAR_HUD });
    expect(clear).not.toContain("wall contact");

    const collided = formatStudioStatus({
      ...BASE,
      hud: { ...CAR_HUD, state: { ...CAR_HUD!.state, collided: true } },
    });
    expect(collided).toContain("⚠ wall contact");
  });

  it.each([
    ["program", "▶ blocks running"],
    ["python", "▶ python running"],
    ["cruise", "cruising"],
    ["wall", "stopped at wall"],
    ["error", "program error (see console)"],
  ] as const)("shows the right phrase for runStatus=%s", (runStatus, phrase) => {
    expect(formatStudioStatus({ ...BASE, hud: CAR_HUD, runStatus })).toContain(phrase);
  });

  it("shows nothing extra for runStatus=idle", () => {
    const text = formatStudioStatus({ ...BASE, hud: CAR_HUD, runStatus: "idle" });
    for (const phrase of ["running", "cruising", "stopped at wall", "program error"]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("shows the python connection state once telemetry exists", () => {
    expect(formatStudioStatus({ ...BASE, hud: CAR_HUD, pythonConnected: true })).toContain("py ✓");
    expect(formatStudioStatus({ ...BASE, hud: CAR_HUD, pythonConnected: false })).toContain("py ✗");
  });

  it("shows the connected robot's identity, defaulting to 'robot' if unnamed", () => {
    const named = formatStudioStatus({
      ...BASE,
      hud: CAR_HUD,
      hardware: { connected: true, identity: "okrobo-car 1" },
    });
    expect(named).toContain("🔌 okrobo-car 1");

    const unnamed = formatStudioStatus({ ...BASE, hud: CAR_HUD, hardware: { connected: true } });
    expect(unnamed).toContain("🔌 robot");

    const disconnected = formatStudioStatus({ ...BASE, hud: CAR_HUD, hardware: { connected: false } });
    expect(disconnected).not.toContain("🔌");
  });

  it("appends a transient notice last, and omits it when empty", () => {
    expect(formatStudioStatus({ ...BASE, notice: "saved" })).toBe("offline · Arena  ·  saved");
    expect(formatStudioStatus({ ...BASE, notice: "" })).toBe("offline · Arena");
  });

  it("joins every visible segment with the same separator", () => {
    const text = formatStudioStatus({
      ...BASE,
      hud: CAR_HUD,
      pythonConnected: true,
      notice: "opened demo",
    });
    expect(text.split("  ·  ")).toEqual([
      "offline · Arena",
      "tick 42",
      "x 1.23 y 0.50",
      "d 0.90 m",
      "py ✓",
      "opened demo",
    ]);
  });
});

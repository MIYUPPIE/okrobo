// Formats the run-bar status line. Pure and framework-free: this is the
// single readout students and teachers watch to understand what the robot is
// doing, so its formatting is tested directly rather than only glimpsed
// through a rendered component.

import type { HardwareStatus } from "../python/PythonBridge";
import type { HudInfo } from "../Viewport3D";

export type EngineStatus = "loading" | "ready" | "missing";
export type RunStatus = "idle" | "cruise" | "wall" | "program" | "python" | "error";

export interface StatusInput {
  /** "Arm"/"Drone" for those robots, or the world's display name for the car. */
  robotLabel: string;
  engineStatus: EngineStatus;
  hud: HudInfo | null;
  runStatus: RunStatus;
  pythonConnected: boolean;
  hardware: HardwareStatus;
  notice: string;
}

export function formatStudioStatus(input: StatusInput): string {
  const parts = [`offline · ${input.robotLabel}`];

  if (input.engineStatus === "loading") parts.push("engine: loading…");
  if (input.engineStatus === "missing") {
    parts.push("engine: not built · run scripts/build-engine-wasm.sh");
  }

  if (input.engineStatus === "ready" && input.hud) {
    const hud = input.hud;
    if (hud.kind === "car") {
      parts.push(
        `tick ${hud.state.tick}`,
        `x ${hud.state.pose.x.toFixed(2)} y ${hud.state.pose.y.toFixed(2)}`,
        `d ${hud.state.sensors.distance.toFixed(2)} m`,
      );
    } else if (hud.kind === "arm") {
      const degrees = hud.state.joints.angles
        .map((a) => `${Math.round((a * 180) / Math.PI)}°`)
        .join(" ");
      parts.push(
        `tick ${hud.state.tick}`,
        `joints ${degrees}`,
        `tip z ${hud.state.tip.z.toFixed(2)} m`,
      );
      if (hud.state.moving) parts.push("moving");
    } else {
      parts.push(
        `tick ${hud.state.tick}`,
        `x ${hud.state.pose.x.toFixed(2)} y ${hud.state.pose.y.toFixed(2)}`,
        `alt ${hud.state.pose.z.toFixed(2)} m`,
        `d ${hud.state.sensors.distance.toFixed(2)} m`,
      );
      if (hud.state.collided) parts.push("⚠ wall/altitude limit");
    }

    if (input.runStatus === "program") parts.push("▶ blocks running");
    if (input.runStatus === "python") parts.push("▶ python running");
    if (input.runStatus === "cruise") parts.push("cruising");
    if (input.runStatus === "wall") parts.push("stopped at wall");
    if (input.runStatus === "error") parts.push("program error (see console)");
    if (hud.kind === "car" && hud.state.collided) parts.push("⚠ wall contact");

    parts.push(input.pythonConnected ? "py ✓" : "py ✗");
    if (input.hardware.connected) parts.push(`🔌 ${input.hardware.identity ?? "robot"}`);
  }

  if (input.notice) parts.push(input.notice);
  return parts.join("  ·  ");
}

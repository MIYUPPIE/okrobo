// A direct TypeScript port of runtime/python/okrobo/vision.py's find_color.
// Blocks execute as JS against the WASM engine (see program/execute.ts:
// generated code only has `robot` in scope, not a Python import), while a
// student's real Python program goes through the actual vision.py — so this
// port exists purely so a "sees color" block behaves identically to what
// find_color(robot.camera(), color) would do. Locked to the Python reference
// by scripts/lib/vision-parity-check.mjs, the same way validateWorld.ts's
// obstacle shape is locked to contracts/world/v1 and the WASM engine is
// locked to okrobo/_sim.py.

export interface CameraFrame {
  width: number;
  height: number;
  pixels: Uint8Array | number[];
}

export interface Detection {
  color: string;
  x: number;
  y: number;
  area: number;
  /** degrees from straight ahead; negative is left, positive is right */
  bearing: number;
  /** fraction of the frame covered, 0..1 */
  coverage: number;
}

// Matches okrobo/vision.py's COLORS.
export const COLORS: Record<string, [number, number, number]> = {
  red: [220, 40, 40],
  green: [40, 200, 80],
  blue: [60, 110, 230],
  yellow: [230, 210, 60],
};

// Matches okrobo/camera.py's CAMERA_FOV (60 degrees).
const CAMERA_FOV = 1.0471975511965976;

/** Hue-like ratio match, not absolute values: a distant box is darker but still that colour. */
function matchesColor(
  r: number,
  g: number,
  b: number,
  reference: [number, number, number],
  tolerance: number,
): boolean {
  const total = r + g + b;
  if (total < 40) return false;
  const refTotal = reference[0] + reference[1] + reference[2];
  const channels: [number, number, number] = [r, g, b];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(channels[i] / total - reference[i] / refTotal) > tolerance) return false;
  }
  return true;
}

/** Finds the largest patch of a named colour in the frame, or null. */
export function findColor(frame: CameraFrame, color: string, tolerance = 0.12): Detection | null {
  const reference = COLORS[color];
  if (!reference) {
    throw new Error(`unknown colour "${color}"; try one of ${Object.keys(COLORS).sort().join(", ")}`);
  }

  let totalX = 0;
  let totalY = 0;
  let count = 0;
  for (let y = 0; y < frame.height; y++) {
    const row = y * frame.width * 3;
    for (let x = 0; x < frame.width; x++) {
      const i = row + x * 3;
      if (matchesColor(frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2], reference, tolerance)) {
        totalX += x;
        totalY += y;
        count++;
      }
    }
  }
  if (count === 0) return null;

  const centreX = totalX / count;
  const fraction = frame.width === 1 ? 0.5 : centreX / (frame.width - 1);
  // Column 0 is the left edge of the field of view (matches camera.render).
  const bearingRadians = fraction * CAMERA_FOV - CAMERA_FOV / 2;

  return {
    color,
    x: centreX,
    y: totalY / count,
    area: count,
    bearing: (bearingRadians * 180) / Math.PI,
    coverage: count / (frame.width * frame.height),
  };
}

// Keyboard teleop for the car: maps held keys to wheel speeds. Pure and
// framework-free, so driving logic (including diagonal key combinations) is
// tested without touching the DOM or the engine.

export const TELEOP_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
] as const;

/**
 * Normalizes a KeyboardEvent.key the way the studio's key handlers do:
 * single printable characters are lowercased (so Shift+W still reads "w"),
 * special keys (arrows, etc.) are left as-is.
 */
export function normalizeKey(rawKey: string): string {
  return rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
}

export function isTeleopKey(key: string): boolean {
  return (TELEOP_KEYS as readonly string[]).includes(key);
}

export interface WheelSpeeds {
  left: number;
  right: number;
}

/**
 * Wheel speeds for the currently-held teleop keys. Forward/back and
 * left/right combine (diagonal driving); a key and its opposite held
 * together cancel out to zero on that axis.
 */
export function teleopWheels(held: ReadonlySet<string>, speed: number, turn: number): WheelSpeeds {
  let left = 0;
  let right = 0;
  if (held.has("ArrowUp") || held.has("w")) {
    left += speed;
    right += speed;
  }
  if (held.has("ArrowDown") || held.has("s")) {
    left -= speed;
    right -= speed;
  }
  if (held.has("ArrowLeft") || held.has("a")) {
    left -= turn;
    right += turn;
  }
  if (held.has("ArrowRight") || held.has("d")) {
    left += turn;
    right -= turn;
  }
  return { left, right };
}

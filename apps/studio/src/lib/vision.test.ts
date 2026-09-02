import { describe, expect, it } from "vitest";
import { COLORS, findColor } from "./vision";

// A tiny synthetic frame: a solid patch of `color` in the left half, dark
// background (below the total<40 "too dark to have a colour" cutoff) in the
// right half. Cross-language correctness against the real Python reference
// (runtime/python/okrobo/vision.py) is scripts/lib/vision-parity-check.mjs;
// these cover this module's own edge cases fast, without needing python3.
function frameWithPatch(color: keyof typeof COLORS, width = 8, height = 4): {
  width: number;
  height: number;
  pixels: number[];
} {
  const [r, g, b] = COLORS[color];
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < width / 2) pixels.push(r, g, b);
      else pixels.push(5, 5, 5);
    }
  }
  return { width, height, pixels };
}

describe("findColor", () => {
  it("finds a solid patch of the requested colour", () => {
    const detection = findColor(frameWithPatch("red"), "red");
    expect(detection).not.toBeNull();
    expect(detection?.color).toBe("red");
    expect(detection?.area).toBe(16); // left half of an 8x4 frame
    expect(detection?.coverage).toBeCloseTo(0.5, 9);
  });

  it("returns null when the colour is not present", () => {
    expect(findColor(frameWithPatch("red"), "blue")).toBeNull();
  });

  it("returns null for an all-dark frame (below the brightness cutoff)", () => {
    const dark = { width: 4, height: 4, pixels: new Array(4 * 4 * 3).fill(2) };
    expect(findColor(dark, "red")).toBeNull();
  });

  it("centred patch has ~zero bearing; off-centre patch does not", () => {
    // A patch dead centre.
    const width = 9;
    const pixels: number[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 4) pixels.push(...COLORS.green);
        else pixels.push(5, 5, 5);
      }
    }
    const centred = findColor({ width, height: 4, pixels }, "green");
    expect(centred?.bearing).toBeCloseTo(0, 6);

    const offCentre = findColor(frameWithPatch("green"), "green"); // left half, not centred
    expect(Math.abs(offCentre!.bearing)).toBeGreaterThan(1);
  });

  it("throws on an unknown colour, listing the valid ones", () => {
    expect(() => findColor(frameWithPatch("red"), "purple")).toThrow(/unknown colour/i);
  });
});

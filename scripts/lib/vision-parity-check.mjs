// Parity gate: the Blocks/JS vision port (apps/studio/src/lib/vision.ts)
// must match the Python reference (runtime/python/okrobo/vision.py) on the
// same frames, the same way engine/tests/parity/ locks the WASM engine to
// okrobo/_sim.py. Run: node scripts/lib/vision-parity-check.mjs

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findColor } from "../../apps/studio/src/lib/vision.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOLERANCE = 1e-6;

const vectors = JSON.parse(
  execFileSync("python3", ["-m", "okrobo.dump_vision"], {
    cwd: join(ROOT, "runtime", "python"),
    encoding: "utf8",
  }),
);

if (vectors.length === 0) {
  console.error("FAIL: no vision test vectors produced");
  process.exit(1);
}

let failures = 0;
for (const vector of vectors) {
  const frame = { width: vector.width, height: vector.height, pixels: vector.pixels };
  const actual = findColor(frame, vector.query_color);
  const expected = vector.expected;
  const label = `query=${vector.query_color} obstacle=${vector.obstacle_color ?? "none"}`;

  if (expected === null || actual === null) {
    if (expected !== actual) {
      console.error(`FAIL ${label}: python=${JSON.stringify(expected)} js=${JSON.stringify(actual)}`);
      failures++;
    }
    continue;
  }

  const fields = ["color", "x", "y", "area", "bearing", "coverage"];
  for (const field of fields) {
    const a = actual[field];
    const e = expected[field];
    const close = typeof a === "number" ? Math.abs(a - e) <= TOLERANCE : a === e;
    if (!close) {
      console.error(`FAIL ${label} field=${field}: python=${e} js=${a}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nvision parity: ${failures} mismatch(es) across ${vectors.length} vectors`);
  process.exit(1);
}
console.log(`vision parity: ${vectors.length} vectors match (JS findColor == Python find_color)`);

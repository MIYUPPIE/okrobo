// @vitest-environment jsdom
// Validates the pack that actually ships with the studio. The important part
// is the URDF-to-engine check: packs/core/robots/arm.urdf describes the same
// arm that engine/src/arm.cpp simulates, and this fails if they drift.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ARM } from "../contracts/robotApi";
import { validateWorld } from "../lib/validateWorld";
import { parseLesson } from "./lesson";
import { validateManifest } from "./manifest";
import { jointChain, parseUrdf } from "./urdf";

// Anchored on the working directory (apps/studio) rather than import.meta.url,
// which the jsdom environment rewrites to Vite's /@fs form.
const CORE = join(process.cwd(), "..", "..", "packs", "core");
const read = (relative: string) => readFileSync(join(CORE, relative), "utf8");

describe("core pack", () => {
  const manifest = validateManifest(JSON.parse(read("pack.json")));

  it("has a valid manifest", () => {
    expect(manifest.id).toBe("core");
    expect(manifest.contents.robots).toContain("robots/arm.urdf");
    expect(manifest.contents.lessons.length).toBeGreaterThan(0);
  });

  it("ships every file its manifest lists", () => {
    const listed = [
      ...manifest.contents.worlds,
      ...manifest.contents.robots,
      ...manifest.contents.lessons,
    ];
    for (const file of listed) {
      expect(() => read(file), `missing pack file: ${file}`).not.toThrow();
    }
  });

  it("describes the same arm the engine simulates", () => {
    const chain = jointChain(parseUrdf(read("robots/arm.urdf")));
    expect(chain.joints.map((j) => j.name)).toEqual([
      "base_yaw",
      "shoulder_pitch",
      "elbow_pitch",
      "wrist_pitch",
    ]);

    // Link lengths must match engine ArmConfig (0.22 / 0.18 / 0.10) and the
    // pedestal height must match base_height (0.12).
    expect(chain.linkLengths[0]).toBeCloseTo(DEFAULT_ARM.link1, 6);
    expect(chain.linkLengths[1]).toBeCloseTo(DEFAULT_ARM.link2, 6);
    expect(chain.linkLengths[2]).toBeCloseTo(DEFAULT_ARM.link3, 6);
    expect(chain.joints[0].origin[2]).toBeCloseTo(DEFAULT_ARM.baseHeight, 6);

    // Joint limits must match engine ArmConfig lower/upper.
    const expected = [
      [-Math.PI, Math.PI],
      [-0.17453293, 1.74532925],
      [-2.0943951, 2.0943951],
      [-1.57079633, 1.57079633],
    ];
    chain.joints.forEach((joint, index) => {
      expect(joint.lower).toBeCloseTo(expected[index][0], 6);
      expect(joint.upper).toBeCloseTo(expected[index][1], 6);
      expect(joint.velocity).toBeCloseTo(Math.PI / 2, 6);
    });
  });

  it("ships lessons that parse and name a real robot", () => {
    for (const file of manifest.contents.lessons) {
      const lesson = parseLesson(read(file));
      expect(lesson.title.length).toBeGreaterThan(0);
      expect(["car", "arm"]).toContain(lesson.robot);
      expect(lesson.steps.some((step) => step.code)).toBe(true);
    }
  });

  it("every pack in the repo is valid and its files load", () => {
    const packsDir = join(process.cwd(), "..", "..", "packs");
    const packIds = readdirSync(packsDir).filter((entry) =>
      statSync(join(packsDir, entry)).isDirectory(),
    );
    expect(packIds.length).toBeGreaterThan(0);

    for (const packId of packIds) {
      const packDir = join(packsDir, packId);
      const packManifest = validateManifest(
        JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")),
      );
      expect(packManifest.id, `directory ${packId} declares a different id`).toBe(packId);

      for (const world of packManifest.contents.worlds) {
        const parsed = validateWorld(JSON.parse(readFileSync(join(packDir, world), "utf8")));
        expect(parsed.name.length).toBeGreaterThan(0);
      }
      for (const robot of packManifest.contents.robots) {
        expect(parseUrdf(readFileSync(join(packDir, robot), "utf8")).links.length).toBeGreaterThan(0);
      }
      for (const lesson of packManifest.contents.lessons) {
        expect(parseLesson(readFileSync(join(packDir, lesson), "utf8")).steps.length).toBeGreaterThan(0);
      }
    }
  });

  it("every pack's lessons use only APIs the runtime exposes", () => {
    // A lesson that calls a method the runtime does not have is a broken
    // lesson for a student, and nothing else would catch it.
    const known = [
      /robot\.(forward|backward|turn_left|turn_right|wait|distance|lidar|camera|heading|position|stop)\(/,
      /arm\.(move|move_all|angles|tip|wait|stop)\(/,
      /(find_color|find_color_opencv)\(/,
      /(frame|picture)\.(pixel|width|height|pixels)/,
      /target\.(bearing|coverage|area|color|x|y)/,
      /^(from okrobo|import |robot = Robot\(\)|arm = Arm\(\)|frame = |target = |print\(|while |if |elif |else:|for |x, y, z =|x, y =|$)/,
    ];

    const packsDir = join(process.cwd(), "..", "..", "packs");
    for (const packId of readdirSync(packsDir).filter((e) =>
      statSync(join(packsDir, e)).isDirectory(),
    )) {
      const packDir = join(packsDir, packId);
      const packManifest = validateManifest(
        JSON.parse(readFileSync(join(packDir, "pack.json"), "utf8")),
      );
      for (const file of packManifest.contents.lessons) {
        for (const step of parseLesson(readFileSync(join(packDir, file), "utf8")).steps) {
          if (!step.code) continue;
          for (const line of step.code.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const recognised = known.some((pattern) => pattern.test(trimmed));
            expect(recognised, `unknown API in ${packId}/${file}: ${trimmed}`).toBe(true);
          }
        }
      }
    }
  });
});

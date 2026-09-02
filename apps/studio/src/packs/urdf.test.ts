// @vitest-environment jsdom
// The parser uses the browser's native DOMParser; Node has none, so this
// file runs in a DOM environment instead of hand-rolling an XML parser.

import { describe, expect, it } from "vitest";
import { jointChain, parseUrdf } from "./urdf";

const ARM_URDF = `<?xml version="1.0"?>
<robot name="okrobo_arm">
  <link name="base_link"/>
  <link name="shoulder_link"/>
  <link name="elbow_link"/>
  <link name="wrist_link"/>
  <link name="tool_link"/>
  <joint name="base_yaw" type="revolute">
    <parent link="base_link"/>
    <child link="shoulder_link"/>
    <origin xyz="0 0 0.12" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159" velocity="1.5708"/>
  </joint>
  <joint name="shoulder_pitch" type="revolute">
    <parent link="shoulder_link"/>
    <child link="elbow_link"/>
    <origin xyz="0.22 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-0.1745" upper="1.7453" velocity="1.5708"/>
  </joint>
  <joint name="elbow_pitch" type="revolute">
    <parent link="elbow_link"/>
    <child link="wrist_link"/>
    <origin xyz="0.18 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.0944" upper="2.0944" velocity="1.5708"/>
  </joint>
  <joint name="tool_mount" type="fixed">
    <parent link="wrist_link"/>
    <child link="tool_link"/>
    <origin xyz="0.10 0 0"/>
  </joint>
</robot>`;

describe("URDF subset parsing", () => {
  it("reads links, joints, origins, axes and limits", () => {
    const robot = parseUrdf(ARM_URDF);
    expect(robot.name).toBe("okrobo_arm");
    expect(robot.links).toHaveLength(5);
    expect(robot.joints.map((j) => j.name)).toEqual([
      "base_yaw",
      "shoulder_pitch",
      "elbow_pitch",
      "tool_mount",
    ]);
    const shoulder = robot.joints[1];
    expect(shoulder.origin).toEqual([0.22, 0, 0]);
    expect(shoulder.axis).toEqual([0, 1, 0]);
    expect(shoulder.lower).toBeCloseTo(-0.1745, 4);
    expect(shoulder.velocity).toBeCloseTo(1.5708, 4);
  });

  it("builds the movable joint chain with link lengths", () => {
    const chain = jointChain(parseUrdf(ARM_URDF));
    expect(chain.joints.map((j) => j.name)).toEqual([
      "base_yaw",
      "shoulder_pitch",
      "elbow_pitch",
    ]);
    // Link lengths come from each following joint's origin; the last is the
    // fixed tool mount, matching the engine's 0.22 / 0.18 / 0.10 arm.
    expect(chain.linkLengths[0]).toBeCloseTo(0.22, 9);
    expect(chain.linkLengths[1]).toBeCloseTo(0.18, 9);
    expect(chain.linkLengths[2]).toBeCloseTo(0.1, 9);
  });

  it("gives continuous joints full rotation and defaults missing limits", () => {
    const robot = parseUrdf(`<robot name="spinner">
      <link name="a"/><link name="b"/>
      <joint name="spin" type="continuous">
        <parent link="a"/><child link="b"/>
      </joint>
    </robot>`);
    expect(robot.joints[0].lower).toBeCloseTo(-Math.PI, 9);
    expect(robot.joints[0].upper).toBeCloseTo(Math.PI, 9);
    expect(robot.joints[0].velocity).toBeGreaterThan(0);
  });

  it("ignores unsupported joint types and extra elements", () => {
    const robot = parseUrdf(`<robot name="mixed">
      <material name="blue"><color rgba="0 0 1 1"/></material>
      <link name="a"><inertial><mass value="1"/></inertial></link>
      <link name="b"/><link name="c"/>
      <joint name="slide" type="prismatic">
        <parent link="a"/><child link="b"/>
      </joint>
      <joint name="turn" type="revolute">
        <parent link="a"/><child link="c"/>
      </joint>
    </robot>`);
    expect(robot.joints.map((j) => j.name)).toEqual(["turn"]);
  });

  it("rejects malformed documents", () => {
    expect(() => parseUrdf("<robot")).toThrow("invalid URDF");
    expect(() => parseUrdf("<thing/>")).toThrow("no <robot>");
    expect(() => parseUrdf("<robot/>")).toThrow("no name");
    expect(() => parseUrdf('<robot name="empty"/>')).toThrow("no links");
  });
});

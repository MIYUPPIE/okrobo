import { describe, expect, it } from "vitest";
import { parseLesson } from "./lesson";

const LESSON = `---
title: Drive to the wall
robot: car
pack: core
---

Robots move by driving their wheels. Try this:

\`\`\`okrobo-python
from okrobo import Robot
robot = Robot()
robot.forward(0.3)
\`\`\`

Now stop before you hit the wall.

\`\`\`okrobo-python
while robot.distance() > 0.2:
    robot.forward(0.05)
\`\`\`

Well done.
`;

describe("lesson parsing", () => {
  it("reads front matter and splits runnable steps", () => {
    const lesson = parseLesson(LESSON);
    expect(lesson.title).toBe("Drive to the wall");
    expect(lesson.robot).toBe("car");
    expect(lesson.steps).toHaveLength(3);
    expect(lesson.steps[0].markdown).toContain("Robots move by driving");
    expect(lesson.steps[0].code).toContain("robot.forward(0.3)");
    expect(lesson.steps[1].code).toContain("while robot.distance()");
    // Trailing prose becomes a step with no code.
    expect(lesson.steps[2].code).toBeUndefined();
    expect(lesson.steps[2].markdown).toBe("Well done.");
  });

  it("defaults the robot to car and accepts arm lessons", () => {
    const arm = parseLesson("---\ntitle: Wave\nrobot: arm\n---\n\nMove the shoulder.\n");
    expect(arm.robot).toBe("arm");
    const noRobot = parseLesson("---\ntitle: Basics\n---\n\nHello.\n");
    expect(noRobot.robot).toBe("car");
  });

  it("rejects lessons without a title or content", () => {
    expect(() => parseLesson("no front matter")).toThrow("missing 'title'");
    expect(() => parseLesson("---\ntitle: Empty\n---\n\n")).toThrow("no content");
  });
});

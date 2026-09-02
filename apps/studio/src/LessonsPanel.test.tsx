// @vitest-environment jsdom
// The real lesson content is validated in packs/corePack.test.ts; this file
// covers the player's own logic (list -> open -> back, "Try this" wiring)
// against a mocked lesson source.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedLesson } from "./packs/lessonSource";

const bundledLessons = vi.hoisted(() => vi.fn<() => LoadedLesson[]>());
vi.mock("./packs/lessonSource", () => ({ bundledLessons: () => bundledLessons() }));

import { LessonsPanel } from "./LessonsPanel";

afterEach(() => cleanup());

const CAR_LESSON: LoadedLesson = {
  title: "Drive to the wall",
  robot: "car",
  file: "01-drive.md",
  pack: "core",
  steps: [
    { markdown: "Intro text." },
    { markdown: "Try this:", code: "robot.forward(0.3)" },
  ],
};

const ARM_LESSON: LoadedLesson = {
  title: "Wave the arm",
  robot: "arm",
  file: "02-wave.md",
  pack: "core",
  steps: [{ markdown: "Move a joint.", code: "arm.move('shoulder', 85)" }],
};

describe("LessonsPanel", () => {
  it("shows an empty state when no lessons are installed", () => {
    bundledLessons.mockReturnValue([]);
    render(<LessonsPanel onTryStep={() => {}} />);
    expect(screen.getByText(/no lessons installed/i)).toBeTruthy();
  });

  it("lists every lesson with its robot and step count", () => {
    bundledLessons.mockReturnValue([CAR_LESSON, ARM_LESSON]);
    render(<LessonsPanel onTryStep={() => {}} />);

    expect(screen.getByText("Drive to the wall")).toBeTruthy();
    expect(screen.getByText("Wave the arm")).toBeTruthy();
    expect(screen.getByText(/🚗 Car · 2 steps/)).toBeTruthy();
    expect(screen.getByText(/🦾 Arm · 1 steps/)).toBeTruthy();
  });

  it("opens a lesson to show its steps, and returns to the list", async () => {
    bundledLessons.mockReturnValue([CAR_LESSON, ARM_LESSON]);
    const user = userEvent.setup();
    render(<LessonsPanel onTryStep={() => {}} />);

    await user.click(screen.getByText("Drive to the wall"));
    expect(screen.getByText("Intro text.")).toBeTruthy();
    expect(screen.getByText("robot.forward(0.3)")).toBeTruthy();
    // The other lesson is not shown while this one is open.
    expect(screen.queryByText("Wave the arm")).toBeNull();

    await user.click(screen.getByText(/all lessons/i));
    expect(screen.getByText("Drive to the wall")).toBeTruthy();
    expect(screen.getByText("Wave the arm")).toBeTruthy();
  });

  it('"Try this" passes the step code and the lesson\'s robot', async () => {
    bundledLessons.mockReturnValue([CAR_LESSON, ARM_LESSON]);
    const onTryStep = vi.fn();
    const user = userEvent.setup();
    render(<LessonsPanel onTryStep={onTryStep} />);

    await user.click(screen.getByText("Drive to the wall"));
    await user.click(screen.getByRole("button", { name: /try this/i }));
    expect(onTryStep).toHaveBeenCalledWith("robot.forward(0.3)", "car");
  });

  it('"Try this" reports the arm for an arm lesson', async () => {
    bundledLessons.mockReturnValue([CAR_LESSON, ARM_LESSON]);
    const onTryStep = vi.fn();
    const user = userEvent.setup();
    render(<LessonsPanel onTryStep={onTryStep} />);

    await user.click(screen.getByText("Wave the arm"));
    await user.click(screen.getByRole("button", { name: /try this/i }));
    expect(onTryStep).toHaveBeenCalledWith("arm.move('shoulder', 85)", "arm");
  });

  it("does not show a Try button for a step with no code", async () => {
    bundledLessons.mockReturnValue([CAR_LESSON]);
    const user = userEvent.setup();
    render(<LessonsPanel onTryStep={() => {}} />);

    await user.click(screen.getByText("Drive to the wall"));
    // Two steps, only one has code, so exactly one Try button.
    expect(screen.getAllByRole("button", { name: /try this/i })).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { editActionsForTab } from "./editMenu";

describe("editActionsForTab", () => {
  it("offers undo, redo, and clean-up on the Blocks tab", () => {
    expect(editActionsForTab("Blocks")).toEqual(["undo", "redo", "cleanUp"]);
  });

  it("offers undo and redo, but not clean-up, on the Python tab", () => {
    expect(editActionsForTab("Python")).toEqual(["undo", "redo"]);
  });

  it("offers nothing on tabs with no editing surface", () => {
    expect(editActionsForTab("World")).toEqual([]);
    expect(editActionsForTab("Lessons")).toEqual([]);
    expect(editActionsForTab("C++")).toEqual([]);
  });
});
